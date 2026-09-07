import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Systematic audit of the YAML-DECOMPILE direction (native/hand-written HA
// YAML -> canvas graph), authorized 2026-09-06 to start once the
// Phase A generator-side stress-test sweep was complete. Unlike the rest of
// this session's tests, these aren't graphs Circuitry's own transpiler
// would have produced first -- they're representative real-world HA YAML
// shapes (legacy keys, native multi-case choose, device triggers, etc.)
// that a user could paste in or that came from editing in the native HA
// UI. For each: parse -> dump the actual graph -> re-transpile -> check for
// crashes, warnings, silent data loss, or a nonsensical graph shape.
describe('YAML decompile-direction audit', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('native multi-case choose: (3 cases + default) parses and round-trips', async () => {
    const yaml = `
alias: Multi case choose
triggers:
  - trigger: state
    entity_id: sensor.mode
actions:
  - choose:
      - conditions:
          - condition: state
            entity_id: sensor.mode
            state: "home"
        sequence:
          - action: light.turn_on
            target:
              entity_id: light.living_room
      - conditions:
          - condition: state
            entity_id: sensor.mode
            state: "away"
        sequence:
          - action: light.turn_off
            target:
              entity_id: light.living_room
      - conditions:
          - condition: state
            entity_id: sensor.mode
            state: "vacation"
        sequence:
          - action: lock.lock
            target:
              entity_id: lock.front_door
    default:
      - action: notify.notify
        data:
          message: "unknown mode"
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
      graph.edges.map((e) => `${e.source} --${e.sourceHandle ?? ''}--> ${e.target} [${(e as any).type ?? 'flow'}]`).join('\n      ')
    );

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('light.living_room');
    expect(outYaml).toContain('light.turn_off');
    expect(outYaml).toContain('lock.lock');
    expect(outYaml).toContain('notify.notify');
    expect((outYaml.match(/light\.living_room/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it('legacy service: key (not action:) parses and round-trips', async () => {
    const yaml = `
alias: Legacy service key
trigger:
  - platform: state
    entity_id: binary_sensor.door
    to: "on"
condition:
  - condition: numeric_state
    entity_id: sensor.temperature
    below: 20
action:
  - service: climate.set_temperature
    target:
      entity_id: climate.living_room
    data:
      temperature: 22
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;
    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 70)}`).join('\n      ')
    );

    const result = transpiler.transpile(graph);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);
    expect(outYaml).toContain('climate.set_temperature');
    expect(outYaml).toContain('binary_sensor.door');
    expect(outYaml).toContain('numeric_state');
  });

  it('device trigger/condition/action round-trips', async () => {
    const yaml = `
alias: Device trigger condition action
triggers:
  - trigger: device
    device_id: abc123
    domain: binary_sensor
    entity_id: binary_sensor.garage
    type: opened
conditions:
  - condition: device
    device_id: def456
    domain: sun
    type: is_night
actions:
  - device_id: ghi789
    domain: light
    entity_id: light.garage
    type: turn_on
mode: single
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;
    console.log(
      'NODES:',
      graph.nodes.map((n) => `${n.id}(${n.type}) ${JSON.stringify(n.data).slice(0, 100)}`).join('\n      ')
    );

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);
    expect(outYaml).toContain('device_id');
    expect(outYaml).toContain('abc123');
    expect(outYaml).toContain('ghi789');
  });

  it('choose: block nested inside a repeat: block round-trips', async () => {
    const yaml = `
alias: Choose inside repeat
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
        - choose:
            - conditions:
                - condition: state
                  entity_id: sun.sun
                  state: below_horizon
              sequence:
                - action: light.turn_on
                  target:
                    entity_id: light.porch
          default:
            - action: light.turn_off
              target:
                entity_id: light.porch
        - delay:
            seconds: 10
mode: single
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE success/error:', parsed.success, parsed.error);
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

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('repeat');
    expect(outYaml).toContain('light.porch');
    expect(outYaml).toContain('light.turn_off');
    expect(outYaml).toContain('delay');
    // The delay after the choose must survive -- not dropped or hoisted
    // outside the loop.
    const repeatIdx = outYaml.indexOf('repeat');
    const delayIdx = outYaml.indexOf('delay', repeatIdx);
    expect(delayIdx).toBeGreaterThan(repeatIdx);
  });

  it('a native if/then/else whose then: is a 3-way parallel round-trips (no forceStrategy)', async () => {
    const yaml = `
alias: If then three way parallel
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
          - action: light.turn_on
            target:
              entity_id: light.hallway
    else:
      - action: light.turn_off
        target:
          entity_id: light.porch
  - action: notify.notify
    data:
      message: "handled"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE (unforced) success/warnings/strategy:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('ROUNDTRIP YAML:\n', outYaml);

    expect(outYaml).toContain('light.porch');
    expect(outYaml).toContain('light.lamp');
    expect(outYaml).toContain('light.hallway');
    expect(outYaml).toContain('light.turn_off');
    expect(outYaml).toContain('notify.notify');
  });
});
