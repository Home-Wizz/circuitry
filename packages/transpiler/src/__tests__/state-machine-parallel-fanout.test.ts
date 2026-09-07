import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Empirical stress-test of StateMachineStrategy's self-documented limitation:
// "mid-flow fan-out into an explicit Join node isn't fully supported" (see
// the warning pushed in generate() for any join node with 2+ incoming
// edges). That warning only fires for the JOIN node's incoming side, but
// generateNodeBlock's per-type block builders (generateActionBlock,
// generateConditionBlock, etc.) all wire exactly one outgoing edge
// (`edges[0]`), same shape as the bug native.ts's buildFanOut fixed this
// session (2026-09-06) for the tree-walker -- so the FAN-OUT SOURCE node
// (the one with 2+ outgoing, unlabeled edges feeding the parallel branches)
// is a second, distinct hazard nothing currently warns about: if it's
// wired via edges[0] only, current_node never becomes the second branch's
// id, so that branch's nodes are permanently undispatchable dead code.
//
// This is reached in practice by forcing state-machine (YamlPreview.tsx's
// manual strategy selector) on a flow shaped like a normal `parallel:`
// block -- ordinary YAML, not a canvas-only construct -- since a plain
// parallel+join IS tree-shaped and would otherwise just use native.
describe('StateMachineStrategy parallel fan-out/join (trigger-based)', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('forcing state-machine on a plain parallel-then-continue flow must not drop a branch', async () => {
    const yaml = `
alias: Parallel then continue
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
conditions: []
actions:
  - parallel:
      - action: light.turn_on
        target:
          entity_id: light.porch
      - action: light.turn_on
        target:
          entity_id: light.lamp
  - action: notify.notify
    data:
      message: "both lights are on"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 80)}`).join('\n      ')
    );
    console.log(
      'EDGES:',
      graph.edges.map((e) => `${e.source} --${e.sourceHandle ?? ''}--> ${e.target}`).join('\n      ')
    );

    // Confirm this really is the fan-out/convergence shape we intend to
    // test, and that -- exactly as topology.ts's checkParallelConvergence
    // promises -- it's ordinarily tree-shaped (native handles it fine).
    const analysis = transpiler.analyzeTopology(graph);
    console.log('ANALYSIS:', JSON.stringify(analysis, null, 2));
    expect(analysis.isTree).toBe(true);

    const autoYaml = transpiler.toYaml(graph);
    console.log('AUTO (native) YAML:\n', autoYaml);
    expect(autoYaml).toContain('light.porch');
    expect(autoYaml).toContain('light.lamp');
    expect(autoYaml).toContain('notify.notify');

    // Now force state-machine on the exact same graph -- what
    // YamlPreview.tsx's manual selector does -- and check whether both
    // parallel branches AND the continuation after them survive.
    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED state-machine result:', JSON.stringify(forced, null, 2));
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED state-machine YAML:\n', forcedYaml);

    expect(forcedYaml).toContain('light.porch');
    expect(forcedYaml).toContain('light.lamp');
    expect(forcedYaml).toContain('notify.notify');
  });

  it('forcing state-machine with an explicit user-placed Join node (2+ incoming) must not drop a branch', async () => {
    const yaml = `
alias: Parallel then continue via explicit join
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
conditions: []
actions:
  - parallel:
      - action: light.turn_on
        target:
          entity_id: light.porch
      - action: light.turn_on
        target:
          entity_id: light.lamp
  - action: notify.notify
    data:
      message: "both lights are on"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    // Splice an explicit 'join' node (the canvas UI's dedicated
    // convergence marker, see JoinNodeSchema) between the two parallel
    // branch ends and the continuation action, exactly like a user
    // dragging a Join block onto the canvas at that spot.
    const notifyNode = graph.nodes.find(
      (n) => n.type === 'action' && JSON.stringify(n.data).includes('notify.notify')
    )!;
    expect(notifyNode).toBeTruthy();
    const incomingToNotify = graph.edges.filter((e) => e.target === notifyNode.id);
    expect(incomingToNotify.length).toBe(2);

    const joinId = 'join-1';
    graph.nodes.push({
      id: joinId,
      type: 'join',
      position: { x: 0, y: 0 },
      data: { mode: 'all' },
    } as (typeof graph.nodes)[number]);
    for (const e of incomingToNotify) {
      e.target = joinId;
    }
    graph.edges.push({
      id: 'join-1-to-notify',
      source: joinId,
      target: notifyNode.id,
      type: 'default',
    } as (typeof graph.edges)[number]);

    console.log(
      'NODES (with join):',
      graph.nodes.map((n) => `${n.id}(${n.type})`).join(', ')
    );
    console.log(
      'EDGES (with join):',
      graph.edges.map((e) => `${e.source} --${e.sourceHandle ?? ''}--> ${e.target}`).join('\n      ')
    );

    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED (with join) result warnings:', forced.warnings);
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED (with join) YAML:\n', forcedYaml);

    expect(forcedYaml).toContain('light.porch');
    expect(forcedYaml).toContain('light.lamp');
    expect(forcedYaml).toContain('notify.notify');
  });
});
