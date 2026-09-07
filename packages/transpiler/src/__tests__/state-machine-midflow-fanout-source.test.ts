import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Follow-up to audit7: that test showed the "parallel:" fan-out is
// special-cased for the trigger's own direct targets (buildTriggerRouting /
// generateParallelEntryBlocks). This test checks the other case: a
// `parallel:` block that occurs mid-flow, after a preceding action, so the
// fan-out SOURCE is an ordinary action node, not the trigger.
//
// Before the fix (found via empirical audit, 2026-09-06):
// generateNodeBlock's per-type builders (generateActionBlock,
// generateDelayBlock, generateWaitBlock, generateSetVariablesBlock,
// generatePassthroughBlock) all wired exactly one outgoing edge
// (`edges[0]`), with no fan-out handling at all -- unlike native.ts's
// buildFanOut (this session's bug #4 fix). The pre-action's own dispatch
// block set current_node to only ONE of the two parallel targets' ids, so
// the OTHER branch's node was never dispatched by anything -- its action
// permanently never ran, silently, with no warning (the existing Join-node
// warning only covers a join's incoming side, not a fan-out node's
// outgoing side).
//
// Fix: buildFanOutContinuation (shared by all 5 builders above) detects a
// genuine multi-target, unlabeled fan-out and inlines it as a real
// `parallel:` step directly in the fan-out source's own sequence (mirroring
// generateParallelEntryBlocks' already-correct trigger-based handling),
// finding the branches' shared convergence point and routing current_node
// there afterward instead of following only edges[0].
describe('StateMachineStrategy mid-flow (non-trigger) fan-out', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('forcing state-machine on pre-action -> parallel -> continue must run both branches and the continuation', async () => {
    const yaml = `
alias: Pre-action then parallel then continue
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
conditions: []
actions:
  - action: input_boolean.turn_on
    target:
      entity_id: input_boolean.armed
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
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 70)}`).join('\n      ')
    );
    console.log(
      'EDGES:',
      graph.edges.map((e) => `${e.source} --${e.sourceHandle ?? ''}--> ${e.target}`).join('\n      ')
    );

    const preActionId = graph.nodes.find(
      (n) => n.type === 'action' && JSON.stringify(n.data).includes('input_boolean.armed')
    )!.id;
    const notifyId = graph.nodes.find(
      (n) => n.type === 'action' && JSON.stringify(n.data).includes('notify.notify')
    )!.id;

    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED result success/warnings:', forced.success, forced.warnings);
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });
    console.log('FORCED YAML:\n', forcedYaml);

    // The pre-action's own choose-block must contain a real `parallel:`
    // step with BOTH light actions inside it, and must hand off to the
    // convergence node (notify) afterward instead of ending the flow or
    // silently dropping either branch.
    const dispatchMarker = `current_node == \\"${preActionId}\\"`;
    const dispatchIdx = forcedYaml.indexOf(dispatchMarker);
    expect(dispatchIdx).toBeGreaterThan(-1);
    // The next dispatch block (or end of choose list) bounds this one's sequence.
    const nextDispatchIdx = forcedYaml.indexOf('current_node ==', dispatchIdx + dispatchMarker.length);
    const preActionBlock = forcedYaml.slice(dispatchIdx, nextDispatchIdx === -1 ? undefined : nextDispatchIdx);

    expect(preActionBlock).toContain('input_boolean.armed');
    expect(preActionBlock).toContain('parallel:');
    expect(preActionBlock).toContain('light.porch');
    expect(preActionBlock).toContain('light.lamp');
    expect(preActionBlock).toContain(`current_node: ${notifyId}`);

    expect(forcedYaml).toContain('notify.notify');
  });
});
