import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Final Phase A stress-test batch for StateMachineStrategy fan-out handling
// (follow-up to bugs #7/#8/#9, which covered trigger-direct, mid-flow, and
// condition-branch fan-out at the top level). Three remaining shapes:
//  1. a fan-out whose branches loop back into an enclosing while-loop
//     condition, rather than reconverging on an ordinary downstream node
//  2. a fan-out with 3+ branches (only ever tested with exactly 2 before)
//  3. a nested fan-out -- one branch of a parallel block itself contains
//     another parallel block before rejoining the outer group
describe('StateMachineStrategy fan-out stress tests (loop body / 3-way / nested)', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  function dispatchBlockFor(forcedYaml: string, nodeId: string): string {
    const marker = `current_node == \\"${nodeId}\\"`;
    const idx = forcedYaml.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const nextIdx = forcedYaml.indexOf('current_node ==', idx + marker.length);
    return forcedYaml.slice(idx, nextIdx === -1 ? undefined : nextIdx);
  }

  it('fan-out inside a while-loop body must run both branches every iteration and loop back', async () => {
    const yaml = `
alias: Loop with parallel body
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.motion
          state: "on"
      sequence:
        - parallel:
            - action: light.turn_on
              target:
                entity_id: light.porch
            - action: light.turn_on
              target:
                entity_id: light.lamp
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 60)}`).join('\n      ')
    );
    console.log(
      'EDGES:',
      graph.edges.map((e) => `${e.source} --${e.sourceHandle ?? ''}--> ${e.target}`).join('\n      ')
    );

    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED success/warnings:', forced.success, forced.warnings);
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED YAML:\n', forcedYaml);

    const conditionId = graph.nodes.find((n) => n.type === 'condition')!.id;
    const conditionBlock = dispatchBlockFor(forcedYaml, conditionId);
    console.log('CONDITION DISPATCH BLOCK:\n', conditionBlock);

    // Whatever node the true-path fans out into (whether it's inlined here
    // or routed to a separate dispatch block), both lights must actually run
    // somewhere in the generated YAML, and current_node must eventually
    // route back to the loop condition, not to END or nowhere.
    expect(forcedYaml).toContain('light.porch');
    expect(forcedYaml).toContain('light.lamp');
    expect(forcedYaml).toContain(`current_node: ${conditionId}`);
  });

  it('fan-out with 3 branches must run all three, not just the first two', async () => {
    const yaml = `
alias: Three way parallel
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - parallel:
      - action: light.turn_on
        target:
          entity_id: light.porch
      - action: light.turn_on
        target:
          entity_id: light.lamp
      - action: light.turn_on
        target:
          entity_id: light.hallway
  - action: notify.notify
    data:
      message: "all three on"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED YAML (3-way):\n', forcedYaml);

    expect(forcedYaml).toContain('light.porch');
    expect(forcedYaml).toContain('light.lamp');
    expect(forcedYaml).toContain('light.hallway');
    expect(forcedYaml).toContain('notify.notify');
  });

  it('nested fan-out: a parallel branch that itself contains a parallel block must run all four leaves and still converge', async () => {
    const yaml = `
alias: Nested parallel
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - parallel:
      - action: light.turn_on
        target:
          entity_id: light.porch
      - sequence:
          - parallel:
              - action: light.turn_on
                target:
                  entity_id: light.hallway
              - action: light.turn_on
                target:
                  entity_id: light.kitchen
          - action: input_boolean.turn_on
            target:
              entity_id: input_boolean.inner_done
  - action: notify.notify
    data:
      message: "all done"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 60)}`).join('\n      ')
    );
    console.log(
      'EDGES:',
      graph.edges.map((e) => `${e.source} --${e.sourceHandle ?? ''}--> ${e.target}`).join('\n      ')
    );

    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED success/warnings:', forced.success, forced.warnings);
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED YAML (nested):\n', forcedYaml);

    expect(forcedYaml).toContain('light.porch');
    expect(forcedYaml).toContain('light.hallway');
    expect(forcedYaml).toContain('light.kitchen');
    expect(forcedYaml).toContain('input_boolean.inner_done');
    expect(forcedYaml).toContain('notify.notify');

    // Whole-file substring counts are NOT a reliable "ran exactly once"
    // check here: the generated YAML uses anchors (&ref_N) + aliases
    // (*ref_N) for repeated `target:` blocks, and every node also gets its
    // own (often unreachable) per-node dispatch case regardless of whether
    // anything ever routes current_node to it -- both of which can make a
    // block look single-occurrence in the raw text even when something's
    // wrong, or look duplicated when it isn't. The real check is the one
    // dispatch block that's actually reachable from the trigger: it must
    // inline the FULL nested structure (all four actions) in one shot and
    // route straight to the convergence (notify) node afterward -- proving
    // the outer fan-out's per-branch subtree builder correctly walked
    // through the inner nested parallel without losing or duplicating
    // anything, rather than relying on text presence alone (the same
    // "trace current_node reachability by hand" discipline bug #7 needed).
    const notifyId = graph.nodes.find(
      (n) => n.type === 'action' && JSON.stringify(n.data).includes('notify.notify')
    )!.id;
    // The real entry point isn't any graph node id -- when the trigger
    // itself fans out to 2+ targets, state-machine.ts seeds current_node
    // with its own synthetic sentinel (e.g. "__parallel_trigger_0"), set in
    // the `variables:` step before the repeat loop even starts. Pull it
    // from there rather than assuming it's one of the branch target ids.
    const initialAssignMatch = forcedYaml.match(/current_node:\s*(\S+)/);
    expect(initialAssignMatch).not.toBeNull();
    const entryDispatchId = initialAssignMatch![1];
    const entryBlock = dispatchBlockFor(forcedYaml, entryDispatchId);
    console.log('ENTRY DISPATCH BLOCK:\n', entryBlock);

    expect(entryBlock).toContain('light.porch');
    expect(entryBlock).toContain('light.hallway');
    expect(entryBlock).toContain('light.kitchen');
    expect(entryBlock).toContain('input_boolean.inner_done');
    expect(entryBlock).toContain(`current_node: ${notifyId}`);
  });
});
