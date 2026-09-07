import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

/**
 * Regression coverage for FlowTranspiler.transpile()'s handling of a
 * forced strategy that its own canHandle() rejects.
 *
 * Before this fix, forcing a strategy onto a topology it can't represent
 * only pushed a warning and generated the YAML anyway. For NativeStrategy
 * specifically, canHandle() is exactly `analysis.isTree`, and every flag
 * that can make that false (cycles, cross-links, converging paths,
 * divergent trigger paths, a branching repeat body, convergence at a loop
 * condition) marks a shape its tree-walker is structurally unable to
 * represent -- so "may not be optimal" was the wrong description of what
 * actually happens: it can silently drop entire branches (found via
 * empirical audit, 2026-09-06 -- an if/else with two independently-drawn
 * conditions converging on the same downstream while-loop entry produced
 * `repeat: { sequence: [] }`, losing the loop body and every action in it,
 * with no error at all). This is reachable from a real user action, not
 * just tests: the YAML preview panel (packages/frontend/src/components/
 * panels/YamlPreview.tsx) exposes a manual "native" strategy selector that
 * calls transpiler.transpile() with forceStrategy set from user input.
 */
describe('FlowTranspiler strategy forcing safety', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('fails clearly instead of silently corrupting output when native is forced onto a non-tree graph', async () => {
    const yaml = `
alias: Two separate loops to merge
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
  - trigger: state
    entity_id: binary_sensor.door
    to: "on"
conditions: []
actions:
  - if:
      - condition: state
        entity_id: sun.sun
        state: below_horizon
    then:
      - repeat:
          while:
            - condition: state
              entity_id: binary_sensor.presence
              state: "on"
          sequence:
            - action: light.toggle
              target:
                entity_id: light.porch
            - delay:
                seconds: 1
  - if:
      - condition: state
        entity_id: input_boolean.guest_mode
        state: "on"
    then:
      - repeat:
          while:
            - condition: state
              entity_id: binary_sensor.presence2
              state: "on"
          sequence:
            - action: light.toggle
              target:
                entity_id: light.lamp
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    // Rewire the second if's TRUE edge to point at the first loop's own
    // entry node -- synthesizing the "two independent conditions converge
    // on one loop entry" shape that only a manual canvas edit (not plain
    // YAML) can produce, and that analyzeTopology correctly flags as
    // non-tree (hasConvergingPaths / isTree:false).
    const loopL1Entry = graph.nodes.find(
      (n) => n.type === 'condition' && JSON.stringify(n.data).includes('binary_sensor.presence"')
    )!;
    const loopL2Entry = graph.nodes.find(
      (n) => n.type === 'condition' && JSON.stringify(n.data).includes('binary_sensor.presence2')
    )!;
    const condGuest = graph.nodes.find(
      (n) => n.type === 'condition' && JSON.stringify(n.data).includes('input_boolean.guest_mode')
    )!;
    expect(loopL1Entry).toBeTruthy();
    expect(loopL2Entry).toBeTruthy();
    expect(condGuest).toBeTruthy();

    const guestTrueEdge = graph.edges.find(
      (e) => e.source === condGuest.id && e.sourceHandle === 'true'
    )!;
    guestTrueEdge.target = loopL1Entry.id;

    // Prune L2's now-orphaned subtree so the graph stays valid (every node
    // reachable from a trigger) -- otherwise validation fails first, before
    // strategy selection is even reached.
    const l2Action = graph.edges.find(
      (e) => e.source === loopL2Entry.id && e.sourceHandle === 'true'
    )?.target;
    const l2Delay = graph.edges.find((e) => e.source === l2Action)?.target;
    const orphanIds = new Set([loopL2Entry.id, l2Action, l2Delay].filter(Boolean) as string[]);
    graph.nodes = graph.nodes.filter((n) => !orphanIds.has(n.id));
    graph.edges = graph.edges.filter((e) => !orphanIds.has(e.source) && !orphanIds.has(e.target));

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(false);
    // NOT hasConvergingPaths specifically -- Phase B item 3 (2026-09-06)
    // generalized the convergence classifier so two independent, sequential
    // top-level `if`s that merely fall through onto the same next action
    // (this fixture's OWN pre-rewire shape: if1's loop implicitly falls
    // through to if2 exactly like if1's own false path does) are correctly
    // recognized as a legitimate if/then continuation, same as the
    // already-covered choose-ifelse-external-connection-audit and
    // choose-chain-convergence fixtures. That generalization is scoped to
    // `traceToBranchCondition`/`detectConvergingPaths` only -- it has
    // nothing to do with what actually makes THIS graph dangerous, which is
    // the synthetic rewire's convergence landing on a repeat loop's own
    // condition entry node. That is caught by a separate, dedicated pair of
    // checks (hasBranchingRepeatBody / hasConvergenceAtLoopCondition, see
    // topology.ts) that this rewire still trips independently -- verified
    // directly (bypassing canHandle() and calling NativeStrategy.generate()
    // on this exact graph still reproduces the historical corruption,
    // `repeat: { sequence: [] }`, confirming isTree's overall verdict below
    // is still correct even though hasConvergingPaths itself is no longer
    // the flag responsible for it). Those two flags aren't part of the
    // public TopologyAnalysis shape, so isTree/recommendedStrategy -- the
    // outcomes that actually matter -- are what this test asserts on.
    expect(analysis.recommendedStrategy).toBe('state-machine');

    // Forcing the mismatched strategy must fail clearly, not corrupt data.
    const forced = transpiler.transpile(graph, { forceStrategy: 'native' });
    expect(forced.success).toBe(false);
    expect(forced.errors?.[0]).toContain('cannot represent');
    expect(forced.errors?.[0]).toContain('state-machine');

    // toYaml() must throw rather than ever hand back the broken YAML string.
    expect(() => transpiler.toYaml(graph, { forceStrategy: 'native' })).toThrow();

    // The actual (unforced, auto-selected) strategy -- what every real
    // save/preview uses when the user hasn't overridden it -- must still
    // produce fully correct output for this same graph.
    const auto = transpiler.transpile(graph);
    expect(auto.success).toBe(true);
    expect(auto.yaml).toContain('light.porch');
    expect(auto.yaml).toContain('binary_sensor.presence');
  });

  it('still allows forcing state-machine on any topology (it always canHandle)', async () => {
    const yaml = `
alias: Simple tree
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - action: light.turn_on
    target:
      entity_id: light.porch
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const result = transpiler.transpile(parsed.graph!, { forceStrategy: 'state-machine' });
    expect(result.success).toBe(true);
    expect(result.yaml).toContain('light.porch');
  });

  it('still allows forcing native on an actually tree-shaped graph', async () => {
    const yaml = `
alias: Simple tree
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - if:
      - condition: state
        entity_id: sun.sun
        state: below_horizon
    then:
      - action: light.turn_on
        target:
          entity_id: light.porch
    else:
      - action: light.turn_off
        target:
          entity_id: light.porch
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const analysis = transpiler.analyzeTopology(parsed.graph!);
    expect(analysis.isTree).toBe(true);
    const result = transpiler.transpile(parsed.graph!, { forceStrategy: 'native' });
    expect(result.success).toBe(true);
    expect(result.yaml).toContain('light.porch');
  });
});
