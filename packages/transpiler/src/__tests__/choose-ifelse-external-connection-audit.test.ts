import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

/**
 * Empirical audit (Phase B item 6, 2026-09-06): flow-store.ts's onConnect
 * guard blocks any SECOND, externally-drawn edge into a Choose block's
 * Case 2+ condition node or an If/Else block's then/else branch node --
 * its own doc comment says this is because such a connection makes the
 * target's SOURCE trigger (or whichever node the extra edge comes from)
 * have multiple direct targets, which routes through
 * StateMachineStrategy.generateParallelEntryBlocks, which (at the time
 * the guard was written) replaced any non-action branch target with a
 * throwaway `system_log.write` placeholder -- a real, reported corruption
 * ("Template placeholder" bug reports).
 *
 * That specific corruption was fixed during Phase A (see
 * generateParallelEntryBlocks's own inline doc comment in
 * state-machine.ts, which now inlines the branch via
 * NativeStrategy.buildActionsFromEntryPoint instead of stubbing it), and
 * StateMachineStrategy's own output is now further protected end-to-end by
 * the Phase B behavioral-verification gate (verifyStateMachineOutput,
 * wired into FlowTranspiler.transpile() as of 2026-09-06). This test
 * empirically confirms -- not assumes -- that the exact shape the guard
 * exists to block now transpiles correctly and passes verification, which
 * is the evidence needed to decide whether the guard still meets the
 * maintainer's bar ("no restriction unless there's truly no way to represent it in
 * native HA at all").
 *
 * A related, previously-undiscovered bug surfaced while building this
 * audit: a trigger's own direct fan-out targets could include one that is
 * itself the convergence point of the set (reachable from another target
 * in the same list via that target's own internal chain edge) --
 * `generateParallelEntryBlocks`/`buildTriggerRouting` didn't filter this
 * the way mid-flow fan-out already does via
 * `filterIndependentFanOutTargets`, so `buildActionsUntilNode` degenerated
 * to zero actions (start === stop) and fell back to the same
 * `system_log.write` stub the guard was written around. Fixed in
 * `buildTriggerRouting` (state-machine.ts) and mirrored in
 * `extractStateMachineFromGraph.ts`'s own independent trigger-entry
 * resolution, so both sides of the verification gate agree on when a
 * trigger's fan-out collapses to a single target.
 */
describe('Choose/If-Else external-connection shapes (Phase B item 6 audit)', () => {
  const transpiler = new FlowTranspiler();

  it("a trigger connected directly to a Choose block's Case 2 (in addition to Case 1's own chain edge) transpiles correctly", async () => {
    const yaml = `
alias: Climate Control Based on Presence
description: Adjust temperature based on occupancy and time
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
    for: "00:05:00"
action:
  - choose:
      - conditions:
          - condition: and
            conditions:
              - condition: state
                entity_id: binary_sensor.occupancy
                state: "on"
              - condition: time
                after: "08:00:00"
                before: "22:00:00"
        sequence:
          - service: climate.set_temperature
            target:
              entity_id: climate.main
            data:
              temperature: 22
      - conditions:
          - condition: and
            conditions:
              - condition: state
                entity_id: binary_sensor.occupancy
                state: "on"
              - condition: time
                after: "22:00:00"
        sequence:
          - service: climate.set_temperature
            target:
              entity_id: climate.main
            data:
              temperature: 20
    default:
      - service: climate.set_temperature
        target:
          entity_id: climate.main
        data:
          temperature: 18
mode: restart
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const trigger = graph.nodes.find((n) => n.type === 'trigger')!;
    const case1 = graph.nodes.find(
      (n) => n.type === 'condition' && (n.data as { _chooseCase?: number })._chooseCase === 1
    )!;
    const case2 = graph.nodes.find(
      (n) => n.type === 'condition' && (n.data as { _chooseCase?: number })._chooseCase === 2
    )!;
    expect(case1).toBeDefined();
    expect(case2).toBeDefined();

    // Confirm the graph is a clean tree BEFORE the synthetic edit (sanity
    // check on the fixture/parse itself).
    const before = transpiler.analyzeTopology(graph);
    expect(before.isTree).toBe(true);

    // Synthesize exactly what flow-store.ts's onConnect guard exists to
    // block: drag the trigger's own handle directly onto Case 2, in
    // addition to its real entry point (Case 1).
    graph.edges.push({
      id: 'e-synthetic-trigger-to-case2',
      source: trigger.id,
      target: case2.id,
      sourceHandle: null,
      targetHandle: null,
    } as (typeof graph.edges)[number]);

    const after = transpiler.analyzeTopology(graph);
    expect(after.isTree).toBe(false); // now a real converging/divergent shape

    const result = transpiler.transpile(graph);

    expect(result.success).toBe(true);
    expect(result.errors ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';

    // The exact corruption this guard was built around: a stubbed
    // placeholder standing in for the real Case 2 condition logic. The
    // dispatcher's own generic "unknown state" safety net (a fixed
    // `default:` case shared by every state-machine automation,
    // unconditionally present regardless of this fixture) is the ONLY
    // legitimate occurrence, so assert on the count rather than banning
    // the string outright.
    const stubOccurrences = (yamlOut.match(/system_log\.write/g) ?? []).length;
    expect(stubOccurrences).toBe(1);
    // Both real climate.set_temperature branches (22 and 20) must still be
    // present somewhere in the output -- confirms Case 2's condition
    // subtree was inlined, not dropped.
    expect(yamlOut).toContain('temperature: 22');
    expect(yamlOut).toContain('temperature: 20');
  });

  it('a node connected directly into an If/Else block\'s "else" branch (in addition to the condition\'s own false-edge) transpiles correctly', async () => {
    const yaml = `
alias: Simple If Else
trigger:
  - platform: state
    entity_id: binary_sensor.motion
    to: "on"
  - platform: state
    entity_id: binary_sensor.backup_trigger
    to: "on"
condition: []
action:
  - if:
      - condition: state
        entity_id: sun.sun
        state: below_horizon
    then:
      - service: light.turn_on
        target:
          entity_id: light.porch
    else:
      - service: light.turn_off
        target:
          entity_id: light.porch
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const triggers = graph.nodes.filter((n) => n.type === 'trigger');
    expect(triggers.length).toBe(2);
    const secondTrigger = triggers[1];

    const ifElseCond = graph.nodes.find(
      (n) => n.type === 'condition' && (n.data as { _blockKey?: string })._blockKey === 'if_else'
    )!;
    expect(ifElseCond).toBeDefined();

    // YamlParser's own decompile only tags the CONDITION node with
    // `_blockKey: 'if_else'` -- it doesn't (and has no reason to) mark the
    // then/else action nodes with `_ifElseBranch`, since that field is a
    // canvas-only affordance createIfElseBlock() (block-factories.ts)
    // stamps on the two placeholder branches it scaffolds when a user
    // drags an If/Else compound block from the palette, purely so
    // ActionNode.tsx can render "Click to configure then/else" instead of
    // a generic placeholder. flow-store.ts's onConnect guard keys off that
    // same field (`targetData?._ifElseBranch`), so to genuinely reproduce
    // the shape the guard blocks, the else-branch action node reached via
    // the condition's own false-handle edge is tagged here exactly the
    // way createIfElseBlock() tags it -- not invented, read directly from
    // that function's source.
    const falseEdge = graph.edges.find(
      (e) => e.source === ifElseCond.id && e.sourceHandle === 'false'
    )!;
    expect(falseEdge).toBeDefined();
    const elseNode = graph.nodes.find((n) => n.id === falseEdge.target)!;
    expect(elseNode).toBeDefined();
    elseNode.data = { ...elseNode.data, _blockKey: 'if_else', _ifElseBranch: 'else' };

    // Two independent triggers each with their own single-target chain is
    // still tree-shaped (analyzeTopology considers each trigger's own
    // reachable subgraph independently) -- it's the SYNTHETIC edge below,
    // not the second trigger by itself, that creates the converging shape
    // the guard exists to block.
    const before = transpiler.analyzeTopology(graph);
    expect(before.isTree).toBe(true);

    // Synthesize what the guard blocks: the SECOND trigger connected
    // directly into the "else" branch action node, in addition to that
    // node's own legitimate false-handle edge from the condition.
    graph.edges.push({
      id: 'e-synthetic-trigger2-to-else',
      source: secondTrigger.id,
      target: elseNode.id,
      sourceHandle: null,
      targetHandle: null,
    } as (typeof graph.edges)[number]);

    const after = transpiler.analyzeTopology(graph);
    expect(after.isTree).toBe(false); // now a real converging shape

    const result = transpiler.transpile(graph);

    expect(result.success).toBe(true);
    expect(result.errors ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';

    const stubOccurrences = (yamlOut.match(/system_log\.write/g) ?? []).length;
    expect(stubOccurrences).toBe(1);
    expect(yamlOut).toContain('light.turn_on');
    expect(yamlOut).toContain('light.turn_off');
  });
});
