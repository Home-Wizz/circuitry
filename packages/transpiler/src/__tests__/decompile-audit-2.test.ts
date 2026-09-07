import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Continuation of the YAML decompile-direction audit (2026-09-06), second
// batch: nested and/or/not conditions, wait_for_trigger, scene actions,
// automation mode variants, and a trigger with no other actions.
describe('YAML decompile-direction audit, batch 2', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('nested and/or/not conditions round-trip without data loss', async () => {
    const yaml = `
alias: Nested and or not
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
conditions:
  - condition: and
    conditions:
      - condition: or
        conditions:
          - condition: state
            entity_id: sensor.mode
            state: "home"
          - condition: state
            entity_id: sensor.mode
            state: "guest"
      - condition: not
        conditions:
          - condition: state
            entity_id: alarm_control_panel.house
            state: "armed_away"
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
mode: single
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;
    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 150)}`).join('\n      ')
    );

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('condition: and');
    expect(outYaml).toContain('condition: or');
    expect(outYaml).toContain('condition: not');
    expect(outYaml).toContain('sensor.mode');
    expect(outYaml).toContain('alarm_control_panel.house');
    expect(outYaml).toContain('armed_away');
  });

  it('wait_for_trigger action round-trips', async () => {
    const yaml = `
alias: Wait for trigger
triggers:
  - trigger: state
    entity_id: binary_sensor.doorbell
    to: "on"
actions:
  - action: light.turn_on
    target:
      entity_id: light.porch
  - wait_for_trigger:
      - trigger: state
        entity_id: binary_sensor.door
        to: "on"
    timeout:
      seconds: 30
    continue_on_timeout: true
  - action: lock.unlock
    target:
      entity_id: lock.front_door
mode: single
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('wait_for_trigger');
    expect(outYaml).toContain('continue_on_timeout');
    expect(outYaml).toContain('lock.unlock');
    expect(outYaml).toContain('timeout');
  });

  it('scene.apply / scene.turn_on and mode: parallel with max round-trip', async () => {
    const yaml = `
alias: Scene and parallel mode
triggers:
  - trigger: state
    entity_id: binary_sensor.movie_button
    to: "on"
actions:
  - action: scene.turn_on
    target:
      entity_id: scene.movie_time
  - action: scene.apply
    data:
      entities:
        light.living_room:
          state: "on"
          brightness: 50
mode: parallel
max: 5
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('scene.turn_on');
    expect(outYaml).toContain('scene.apply');
    expect(outYaml).toContain('mode: parallel');
    expect(outYaml).toContain('max: 5');
  });

  it('multiple triggers with ids used for OR-based routing round-trip (no actions loss)', async () => {
    const yaml = `
alias: Multi trigger ids
triggers:
  - trigger: state
    entity_id: binary_sensor.front_door
    to: "on"
    id: "front"
  - trigger: state
    entity_id: binary_sensor.back_door
    to: "on"
    id: "back"
conditions:
  - condition: trigger
    id:
      - front
      - back
actions:
  - action: notify.notify
    data:
      message: "a door opened"
mode: single
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;
    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 120)}`).join('\n      ')
    );

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('binary_sensor.front_door');
    expect(outYaml).toContain('binary_sensor.back_door');
    expect(outYaml).toContain('notify.notify');
  });

  it('a templated data field and a templated target entity_id survive untouched', async () => {
    const yaml = `
alias: Templated fields
triggers:
  - trigger: state
    entity_id: input_select.target_room
actions:
  - action: light.turn_on
    target:
      entity_id: "light.{{ states('input_select.target_room') | lower }}"
    data:
      brightness_pct: "{{ 20 if is_state('sun.sun', 'below_horizon') else 100 }}"
mode: single
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain("states('input_select.target_room')");
    expect(outYaml).toContain("is_state('sun.sun', 'below_horizon')");
  });
});
