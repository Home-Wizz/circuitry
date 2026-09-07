import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Phase B item 3 (NativeStrategy structuring-coverage quality pass),
 * 2026-09-06, round 3 -- found via the same stress-test battery as
 * parallel-fanout-convergence.test.ts.
 *
 * A real bug in YamlParser.ts's decompiler (NOT in native.ts's generator
 * or the verification gate itself, both of which correctly caught this
 * before it was root-caused): when a `choose:` case's own `sequence:`
 * ends with a nested `if:`/`then:`/`else:` block (rather than a single
 * flat action), `parseChooseBlock`'s per-case handling connected only
 * `sequenceResult.nodes[sequenceResult.nodes.length - 1]` -- the last
 * node CREATED, in insertion order -- onward to whatever follows the
 * whole `choose:` block, instead of every real terminal node of that
 * case's sequence. Because a nested if's nodes are pushed condition-then
 * else-branch, "last created" is always the ELSE branch's own last node,
 * regardless of which branch is actually a terminal for this case -- so
 * the THEN branch's terminal node silently ended up with no outgoing edge
 * to the choose block's shared continuation at all. Concretely: decompile
 * this fixture's YAML, don't touch the eco-mode branch, and re-save --
 * the shared `notify.notify` after the whole choose: block would
 * silently stop running for that one path. `parseActions` already
 * computes the correct full terminal set via `terminalNodeIds` (used
 * this same way by parseIfBlock's own then/else handling) -- the fix
 * reuses it here instead of the narrower last-node heuristic.
 *
 * Caught end-to-end by the verification gate before the parser fix (a
 * `step count changed (1 -> 2)` mismatch between the ORIGINAL, buggy
 * graph -- extractFromGraph faithfully walked its one broken edge -- and
 * what native.ts's YAML actually executes, since HA always runs a
 * `choose:` block's next sibling action unconditionally regardless of
 * which case fired), so no corrupted output ever reached a save; the
 * fallback to state-machine was masking a real upstream graph-construction
 * defect rather than a genuine structuring limit.
 */
describe('YamlParser: choose-case nested if/else terminal tracking (Phase B item 3, round 3)', () => {
  const transpiler = new FlowTranspiler();

  it('a choose case whose sequence ends in a nested if/else connects BOTH inner branches to the shared tail after the choose block', async () => {
    const yaml = `
alias: Choose chain with nested if in a case
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
action:
  - choose:
      - conditions:
          - condition: numeric_state
            entity_id: sensor.temp
            below: 18
        sequence:
          - if:
              - condition: state
                entity_id: input_boolean.eco_mode
                state: "on"
            then:
              - service: climate.set_hvac_mode
                data: { hvac_mode: heat }
                target: { entity_id: climate.eco }
            else:
              - service: climate.set_hvac_mode
                data: { hvac_mode: heat }
                target: { entity_id: climate.normal }
      - conditions:
          - condition: numeric_state
            entity_id: sensor.temp
            above: 26
        sequence:
          - service: climate.set_hvac_mode
            data: { hvac_mode: cool }
            target: { entity_id: climate.normal }
    default:
      - service: climate.set_hvac_mode
        data: { hvac_mode: 'off' }
        target: { entity_id: climate.normal }
  - service: notify.notify
    data: { message: "climate handled" }
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    // The inner if's TRUE branch (climate.eco) must have an outgoing edge
    // reaching the shared notify.notify tail, same as its FALSE branch,
    // case 2's branch, and the default branch all already correctly do.
    const ecoActionNode = graph.nodes.find(
      (n) => n.type === 'action' && JSON.stringify(n.data).includes('climate.eco')
    )!;
    expect(ecoActionNode).toBeDefined();
    const ecoOutgoing = graph.edges.filter((e) => e.source === ecoActionNode.id);
    expect(ecoOutgoing.length).toBeGreaterThan(0);

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).not.toContain('current_node');
    expect(yamlOut).toContain('climate.eco');
    expect(yamlOut).toContain('climate.normal');
    // notify.notify must run exactly once, after the whole choose block --
    // including on the eco-mode path.
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);

    const verification = verifyNativeOutput(graph, yamlOut);
    expect(verification.valid, verification.reason).toBe(true);
  });
});
