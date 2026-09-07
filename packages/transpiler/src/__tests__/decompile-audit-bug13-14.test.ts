import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import type { FlowGraph } from '@circuitry/shared';
import { v4 as uuidv4 } from 'uuid';

// Found via the YAML decompile-direction audit, 2026-09-06, while getting
// yaml-roundtrip.test.ts's fixture-snapshot suite running again (it had
// been silently unable to run AT ALL -- one fixture with an invalid
// options.behavior value crashed the whole file's async describe() setup
// before any snapshot comparison ever executed, hiding every regression
// under it for an unknown length of time, likely since before this
// session). Both bugs below are real, pre-existing (not introduced this
// session) NativeStrategy output bugs, confirmed present all the way back
// to the v1.0.0 initial commit.
describe('Phase A decompile audit — bug #13 (trigger metadata ordering) and #14 (gate-condition alias duplication)', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('bug #13: a trigger node must be written FIRST in _circuitry_metadata.nodes, not appended after every action', async () => {
    // NativeStrategy's nodeVisitOrder tracker (recordNodeOrder) is only
    // ever populated from buildNodeAction/buildCondition's own call
    // sites -- trigger nodes are extracted separately (extractTriggers)
    // and never reached either one, so they always landed at the END of
    // generateCircuitryMetadata's nodePositions object regardless of
    // their real position. Since YamlParser.ts's getNextNodeId() pulls
    // saved ids from that list in strict positional order and parses
    // triggers first, this silently swapped the trigger's own saved node
    // id with the first action's id on every single save -> reload round
    // trip for any automation with more than one node -- a real,
    // narrow-but-pervasive node-identity-corruption bug, not just a
    // cosmetic metadata ordering quirk.
    const flow: FlowGraph = {
      id: uuidv4(),
      name: 'Bug 13 repro',
      description: '',
      nodes: [
        {
          id: 'my_custom_trigger_id',
          type: 'trigger',
          position: { x: 50, y: 50 },
          data: { trigger: 'state', entity_id: 'sensor.test' },
        },
        {
          id: 'my_custom_action_id',
          type: 'action',
          position: { x: 150, y: 150 },
          data: { action: 'notify.notify', data: { message: 'hi' } },
        },
      ],
      edges: [
        { id: 'e1', source: 'my_custom_trigger_id', target: 'my_custom_action_id' },
      ],
      metadata: { mode: 'single', initial_state: true },
      version: 1,
    } as FlowGraph;

    const yaml = transpiler.toYaml(flow);

    // The metadata's node list must list the trigger BEFORE the action --
    // not merely contain both ids somewhere.
    const nodesBlockMatch = yaml.match(/nodes:\n([\s\S]*?)\n\s*graph_id:/);
    expect(nodesBlockMatch).not.toBeNull();
    const nodesBlock = nodesBlockMatch![1];
    const triggerIdx = nodesBlock.indexOf('my_custom_trigger_id');
    const actionIdx = nodesBlock.indexOf('my_custom_action_id');
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(actionIdx).toBeGreaterThan(-1);
    expect(triggerIdx).toBeLessThan(actionIdx);

    // And re-parsing must restore each node's ORIGINAL custom id, not a
    // shuffled one -- this is the actual user-visible consequence.
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    expect(parsed.graph!.nodes[0].id).toBe('my_custom_trigger_id');
    expect(parsed.graph!.nodes[1].id).toBe('my_custom_action_id');
  });

  it('bug #14: an if/then/else block alias must not be duplicated onto its own gate condition', async () => {
    // parseIfBlock (YamlParser.ts) deliberately stashes the if-action's own
    // `alias:` onto its first/gate condition node's data.alias (there's no
    // separate node type for "the if-block's own label"), stamping
    // _blockKey: 'if_else' on that node so the write side knows this
    // alias is borrowed, not the condition's own. But native.ts's
    // AND-chain if/then/else builder re-attached that same alias to the
    // wrapping ifAction AND buildCondition's mapCondition unconditionally
    // re-included it on the condition object too -- writing the user's
    // one alias onto both `if: [{ alias: ..., condition: or, ... }]` and
    // the wrapping `{ alias: ..., if: [...], then: [...] }` step. Same
    // root cause hit buildConditionChoose (choose-blocks) and
    // buildRepeatBlock's while/until branches, since all three re-attach
    // a block-level alias from the exact same borrowed node.data.alias.
    const yaml = `
alias: Scene Selection Test
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - alias: Time-based Scene Selection
    if:
      - condition: or
        conditions:
          - condition: sun
            after: sunset
          - condition: sun
            before: sunrise
    then:
      - action: script.turn_on
        target:
          entity_id: script.night_scene
    else:
      - action: script.turn_on
        target:
          entity_id: script.morning_scene
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const outYaml = transpiler.toYaml(graph);

    // The block's own alias must appear exactly once (on the wrapping
    // if-step), never a second time on the nested condition object.
    const aliasMatches = (outYaml.match(/Time-based Scene Selection/g) || []).length;
    expect(aliasMatches).toBe(1);

    // And it must still be present at all -- this isn't a test that
    // passes by silently dropping the alias everywhere.
    expect(outYaml).toContain('alias: Time-based Scene Selection');

    // A genuinely nested condition's OWN alias (inside a conditions:
    // group, unrelated to the if-block's own label) must still survive --
    // regression guard for the suppression being scoped too broadly.
    const nestedYaml = `
alias: Nested condition alias test
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - if:
      - condition: and
        conditions:
          - condition: state
            entity_id: sun.sun
            state: below_horizon
            alias: Its dark out
    then:
      - action: light.turn_on
        target:
          entity_id: light.porch
mode: single
`;
    const nestedParsed = await parser.parse(nestedYaml);
    expect(nestedParsed.success).toBe(true);
    const nestedOutYaml = transpiler.toYaml(nestedParsed.graph!);
    expect(nestedOutYaml).toContain('Its dark out');
  });
});
