import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Follow-up to bugs #7/#8: those covered a plain action/delay/etc. node
// fanning out to multiple targets. This checks the remaining case:
// generateConditionBlock uses `edges.find(e => e.sourceHandle === 'true')`
// (and the same for 'false') -- a single .find(), not a filter -- so a
// condition whose TRUE (or FALSE) path itself fans out to 2+ targets (an
// `if:` immediately followed by a `parallel:` in its `then:`, an entirely
// ordinary YAML shape) would have every target but the first silently
// dropped under state-machine strategy, with no warning at all.
describe('StateMachineStrategy condition true/false-path fan-out', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('forcing state-machine on if -> parallel(A,B) -> continue must run both branches', async () => {
    const yaml = `
alias: If then parallel then continue
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
conditions: []
actions:
  - if:
      - condition: state
        entity_id: sun.sun
        state: below_horizon
    then:
      - parallel:
          - action: light.turn_on
            target:
              entity_id: light.porch
          - action: light.turn_on
            target:
              entity_id: light.lamp
  - action: notify.notify
    data:
      message: "done"
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
    const dispatchMarker = `current_node == \\"${conditionId}\\"`;
    const dispatchIdx = forcedYaml.indexOf(dispatchMarker);
    expect(dispatchIdx).toBeGreaterThan(-1);
    const nextDispatchIdx = forcedYaml.indexOf('current_node ==', dispatchIdx + dispatchMarker.length);
    const conditionBlock = forcedYaml.slice(dispatchIdx, nextDispatchIdx === -1 ? undefined : nextDispatchIdx);
    console.log('CONDITION BLOCK:\n', conditionBlock);

    expect(conditionBlock).toContain('light.porch');
    expect(conditionBlock).toContain('light.lamp');
  });

  it('does not treat a condition-terminal "shortcut" edge as a second fan-out branch (issue #164 regression)', async () => {
    // Found as a regression while fixing the bug above: a same-handle edge
    // list can contain more than genuine sibling branches. Here the outer
    // condition's `then:` body (light.turn_on -> nested if/else -> volume_set)
    // naturally reaches the action after the whole if-block, but the
    // parser ALSO wires a direct condition --true--> (that same
    // after-block action) edge as bookkeeping for the empty `else: []`.
    // Treating both edges as fan-out targets duplicated volume_set 3x
    // instead of once. buildFanOutFromTargets must filter out a target
    // that's already reachable from another target in the same list.
    const yaml = `
alias: Full issue 164 test
triggers:
  - trigger: state
    entity_id: binary_sensor.button
    to: "on"
actions:
  - if:
      - condition: state
        entity_id: switch.tv
        state: "off"
    then:
      - action: light.turn_on
        data:
          brightness_pct: 30
      - if:
          - condition: numeric_state
            entity_id: sensor.days
            below: 30
        then:
          - action: tts.speak
            data:
              message: Many days left
        else:
          - action: tts.speak
            data:
              message: Few days left
      - action: media_player.volume_set
        data:
          volume_level: 0.5
        target:
          entity_id: media_player.tv
    else: []
  - action: switch.toggle
    data: {}
    target:
      entity_id: switch.tv
  - action: switch.toggle
    data: {}
    target:
      entity_id: switch.relay
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const forced = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    expect(forced.success).toBe(true);
    const forcedYaml = transpiler.toYaml(graph, { forceStrategy: 'state-machine' });

    const toggleMatches = (forcedYaml.match(/switch\.toggle/g) || []).length;
    expect(toggleMatches).toBe(2);
    const volumeMatches = (forcedYaml.match(/volume_set/g) || []).length;
    expect(volumeMatches).toBe(1);
  });
});
