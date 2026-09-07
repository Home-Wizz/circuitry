import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Bug #12 (found 2026-09-06, during the YAML decompile-direction audit):
// NativeStrategy's if/then/else builder (both the "branches converge on a
// shared downstream node" case and the "no convergence" case) and its
// choose-case builder all took a genuine multi-target then/else fan-out --
// an ordinary `parallel:` block as an if:'s own `then:`/`else:`, or as a
// choose case's `sequence:` -- and flattened it with `.flatMap()` into a
// plain sequential list instead of wrapping it in `{ parallel: [...] }`.
// Same class of bug as #4/#9/#11, just on the DEFAULT (native, unforced)
// if/then-else and choose-case builders. Unlike a purely cosmetic YAML
// difference, this silently changes automation behavior for any branch
// containing a delay/wait: what should run concurrently with a delayed
// branch instead waits for it to finish first.
describe('NativeStrategy if/then/else and choose fan-out (parallel branches, not sequential)', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('if/then with a delayed branch + an immediate branch must stay parallel, not sequentialize', async () => {
    const yaml = `
alias: If then parallel with delay
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
          - sequence:
              - delay:
                  seconds: 300
              - action: light.turn_off
                target:
                  entity_id: light.porch
          - action: notify.notify
            data:
              message: "light will turn off in 5 minutes"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('OUT:\n', outYaml);

    // The real check: notify.notify must NOT be gated behind the 5-minute
    // delay. If it were sequentialized, "delay" would appear in the YAML
    // text strictly before "notify" with nothing marking them as
    // concurrent. Wrapped correctly, they're siblings inside a `parallel:`
    // step, both reachable immediately.
    expect(outYaml).toMatch(/parallel:\s*\n\s*-\s*sequence:/);
    expect(outYaml).toContain('notify.notify');
    expect(outYaml).toContain('light.turn_off');
  });

  it('if/then with a plain 3-way parallel round-trips as parallel, not a flat list', async () => {
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
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('OUT:\n', outYaml);

    expect(outYaml).toContain('parallel:');
    expect(outYaml).toContain('light.porch');
    expect(outYaml).toContain('light.lamp');
    expect(outYaml).toContain('light.hallway');
  });

  it('a choose: case whose own sequence is a parallel block round-trips as parallel', async () => {
    const yaml = `
alias: Choose case with parallel
triggers:
  - trigger: state
    entity_id: sensor.mode
actions:
  - choose:
      - conditions:
          - condition: state
            entity_id: sensor.mode
            state: "party"
        sequence:
          - parallel:
              - action: light.turn_on
                target:
                  entity_id: light.living_room
              - action: media_player.turn_on
                target:
                  entity_id: media_player.living_room
    default:
      - action: notify.notify
        data:
          message: "unknown mode"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    console.log('TRANSPILE success/warnings:', result.success, result.warnings);
    expect(result.success).toBe(true);
    const outYaml = transpiler.toYaml(graph);
    console.log('OUT:\n', outYaml);

    expect(outYaml).toContain('parallel:');
    expect(outYaml).toContain('light.living_room');
    expect(outYaml).toContain('media_player.turn_on');
    expect(outYaml).toContain('notify.notify');
  });
});
