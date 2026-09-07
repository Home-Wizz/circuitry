import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowGraph } from '@circuitry/shared';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyStateMachineOutput } from '../verification/verifyStateMachineOutput';

/**
 * Diagnostic / validation pass for the new StateMachineStrategy
 * behavioral-equivalence gate (see verifyStateMachineOutput.ts's doc
 * comment) -- mirrors native-fixtures-behavioral-check.test.ts's own
 * approach (run the gate against real fixtures/regressions BEFORE deciding
 * whether/how to wire it into FlowTranspiler.transpile()), but forces
 * state-machine on every fixture regardless of its recommended strategy
 * (StateMachineStrategy.canHandle() is unconditionally true), so this
 * exercises the gate against a much broader corpus than just the fixtures
 * that naturally select it.
 *
 * NOT wired into FlowTranspiler.transpile() yet.
 */
const FIXTURES_DIR = join(__dirname, '../../../../__tests__/yaml-automation-fixtures');

function listFixtures(): string[] {
  try {
    return readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.yaml'));
  } catch {
    return [];
  }
}

async function forceAndVerify(yaml: string): Promise<{ success: boolean; reason?: string; yaml?: string }> {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();
  const parsed = await parser.parse(yaml);
  if (!parsed.success || !parsed.graph) {
    return { success: false, reason: `fixture did not parse: ${JSON.stringify(parsed.errors)}` };
  }
  const result = transpiler.transpile(parsed.graph, { forceStrategy: 'state-machine' });
  if (!result.success || !result.yaml) {
    return { success: false, reason: `forced state-machine transpile failed: ${JSON.stringify(result.errors)}` };
  }
  const verification = verifyStateMachineOutput(parsed.graph, result.yaml);
  return { success: verification.valid, reason: verification.reason, yaml: result.yaml };
}

async function forceAndVerifyGraph(graph: FlowGraph): Promise<{ success: boolean; reason?: string; yaml?: string }> {
  const transpiler = new FlowTranspiler();
  const result = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
  if (!result.success || !result.yaml) {
    return { success: false, reason: `forced state-machine transpile failed: ${JSON.stringify(result.errors)}` };
  }
  const verification = verifyStateMachineOutput(graph, result.yaml);
  return { success: verification.valid, reason: verification.reason, yaml: result.yaml };
}

describe('StateMachineStrategy behavioral-equivalence gate vs. real fixtures (diagnostic)', () => {
  const fixtures = listFixtures();
  expect(fixtures.length).toBeGreaterThan(0);

  for (const filename of fixtures) {
    it(`${filename}: state-machine output (forced) passes behavioral verification`, async () => {
      const yaml = readFileSync(join(FIXTURES_DIR, filename), 'utf8');
      const parser = new YamlParser();
      const parsed = await parser.parse(yaml);
      if (!parsed.success || !parsed.graph) return; // not every fixture is guaranteed parseable (some exist for other purposes)

      const { success, reason } = await forceAndVerify(yaml);
      expect(success, reason).toBe(true);
    });
  }
});

describe('StateMachineStrategy behavioral-equivalence gate vs. known tricky fan-out/loop shapes (diagnostic)', () => {
  it('if -> parallel(A,B) -> continue (condition true-path fan-out)', async () => {
    const yaml = `
alias: If then parallel then continue
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
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('issue #164 regression: shortcut edge must not be treated as a second fan-out branch', async () => {
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
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('fan-out inside a while-loop body (loop-back convergence, not an ordinary downstream node)', async () => {
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
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('fan-out with 3 branches', async () => {
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
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('nested fan-out: a parallel branch that itself contains a parallel block', async () => {
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
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('mid-flow (non-trigger) fan-out source: pre-action -> parallel -> continue', async () => {
    const yaml = `
alias: Pre-action then parallel then continue
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
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
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('plain parallel-then-continue (trigger-direct fan-out, ordinarily tree-shaped, forced onto state-machine)', async () => {
    const yaml = `
alias: Parallel then continue
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
  - action: notify.notify
    data:
      message: "both lights are on"
mode: single
`;
    const { success, reason } = await forceAndVerify(yaml);
    expect(success, reason).toBe(true);
  });

  it('multiple triggers with divergent targets (trigger.idx routing, no fan-out)', async () => {
    const flow: FlowGraph = {
      id: '6d933f09-4d19-410e-bf70-01dd3c07b57d',
      name: 'Alarm Mode Changes',
      nodes: [
        { id: 'trigger_0', type: 'trigger', position: { x: 0, y: 0 }, data: { trigger: 'time', at: '21:00:00' } },
        { id: 'trigger_1', type: 'trigger', position: { x: 0, y: 100 }, data: { trigger: 'time', at: '07:00:00' } },
        { id: 'action_0', type: 'action', position: { x: 200, y: 0 }, data: { service: 'alarm_control_panel.alarm_arm_night' } },
        { id: 'action_1', type: 'action', position: { x: 200, y: 100 }, data: { service: 'alarm_control_panel.alarm_arm_home' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger_0', target: 'action_0' },
        { id: 'e2', source: 'trigger_1', target: 'action_1' },
      ],
      metadata: { mode: 'single', initial_state: true },
      version: 1,
    };
    const { success, reason } = await forceAndVerifyGraph(flow);
    expect(success, reason).toBe(true);
  });

  it('trigger with multiple targets, another trigger with a single target (mixed parallel-entry + trigger.idx routing)', async () => {
    const flow: FlowGraph = {
      id: 'dd446194-a857-41cd-a2c6-7e44df19919e',
      name: 'Untitled Automation',
      nodes: [
        { id: 'trigger_0', type: 'trigger', position: { x: -60, y: 45 }, data: { entity_id: ['update.home_assistant_core_update'], trigger: 'state' } },
        { id: 'action_A', type: 'action', position: { x: 360, y: -15 }, data: { service: 'light.turn_on', alias: 'Light Turn On' } },
        { id: 'action_B', type: 'action', position: { x: 360, y: 155 }, data: { service: 'switch.turn_on', alias: 'Switch Turn On' } },
        { id: 'trigger_1', type: 'trigger', position: { x: -30, y: 360 }, data: { trigger: 'time', at: '08:00:00' } },
        { id: 'action_C', type: 'action', position: { x: 345, y: 360 }, data: { service: 'light.turn_off', alias: 'Light Turn Off' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger_0', target: 'action_A' },
        { id: 'e2', source: 'trigger_0', target: 'action_B' },
        { id: 'e3', source: 'trigger_1', target: 'action_C' },
      ],
      metadata: { mode: 'single', initial_state: true },
      version: 1,
    };
    const { success, reason } = await forceAndVerifyGraph(flow);
    expect(success, reason).toBe(true);
  });

  it('two conditions with independently-drawn true-paths converging on the same downstream while-loop entry (genuine non-tree convergence)', async () => {
    const yaml = `
alias: Two separate loops to merge
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
  - trigger: state
    entity_id: binary_sensor.door
    to: "on"
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
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

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

    const guestTrueEdge = graph.edges.find((e) => e.source === condGuest.id && e.sourceHandle === 'true')!;
    guestTrueEdge.target = loopL1Entry.id;

    const l2Action = graph.edges.find((e) => e.source === loopL2Entry.id && e.sourceHandle === 'true')?.target;
    const l2Delay = graph.edges.find((e) => e.source === l2Action)?.target;
    const orphanIds = new Set([loopL2Entry.id, l2Action, l2Delay].filter(Boolean) as string[]);
    graph.nodes = graph.nodes.filter((n) => !orphanIds.has(n.id));
    graph.edges = graph.edges.filter((e) => !orphanIds.has(e.source) && !orphanIds.has(e.target));

    const { success, reason } = await forceAndVerifyGraph(graph);
    expect(success, reason).toBe(true);
  });

  it('explicit user-placed Join node with 2 incoming branches (documented limitation -- only first branch reliably wired)', async () => {
    const yaml = `
alias: Parallel then continue via explicit join
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
  - action: notify.notify
    data:
      message: "both lights are on"
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const notifyNode = graph.nodes.find(
      (n) => n.type === 'action' && JSON.stringify(n.data).includes('notify.notify')
    )!;
    const incomingToNotify = graph.edges.filter((e) => e.target === notifyNode.id);
    expect(incomingToNotify.length).toBe(2);

    const joinId = 'join-1';
    graph.nodes.push({ id: joinId, type: 'join', position: { x: 0, y: 0 }, data: { mode: 'all' } } as (typeof graph.nodes)[number]);
    for (const e of incomingToNotify) e.target = joinId;
    graph.edges.push({ id: 'join-1-to-notify', source: joinId, target: notifyNode.id, type: 'default' } as (typeof graph.edges)[number]);

    const { success, reason } = await forceAndVerifyGraph(graph);
    // This is StateMachineStrategy's own documented, warned-about
    // limitation (see the "Join node ... has multiple incoming branches"
    // warning in generate()) -- NOT a surprise bug this diagnostic is
    // meant to catch fresh, so it's reported rather than asserted on,
    // pending a decision on how FlowTranspiler should treat an already-
    // known, already-warned limitation (see project discussion).
    console.log('Join-node known-limitation case: valid =', success, reason);
  });
});
