import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * End-to-end validation of the behavioral-equivalence gate (see
 * verifyNativeOutput.ts's doc comment) against real graphs produced by
 * parsing hand-written YAML through the actual YamlParser -- not hand-rolled
 * FlowGraph objects -- for each of NativeStrategy's known canonicalizations
 * (see native.ts, read in full this session): AND-chain folding,
 * choose-chain nesting, OR-convergence, root-condition promotion, inverted
 * (not-wrapped) conditions, and while/until/count repeat loops. Each case
 * asserts the real transpile()->verifyNativeOutput() pipeline accepts
 * NativeStrategy's own real output as behaviorally equivalent to the graph
 * that produced it -- the exact scenario the previous graph-diff-based
 * implementation got wrong (see project memory's Phase B notes).
 */

async function roundtrip(yaml: string) {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();
  const parsed = await parser.parse(yaml);
  expect(parsed.success, JSON.stringify(parsed.errors)).toBe(true);
  const result = transpiler.transpile(parsed.graph!, { forceStrategy: 'native' });
  expect(result.success, JSON.stringify(result.errors)).toBe(true);
  const verification = verifyNativeOutput(parsed.graph!, result.yaml!);
  return { parsed, result, verification };
}

describe('behavioral-equivalence gate vs. NativeStrategy canonicalizations', () => {
  it('AND-chain: two sequential single-path conditions folded into one if with an implicit-AND array', async () => {
    const yaml = `
alias: AND chain
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
actions:
  - if:
      - condition: state
        entity_id: light.kitchen
        state: 'on'
      - condition: state
        entity_id: light.hall
        state: 'on'
    then:
      - action: notify.send
        data:
          message: both on
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('choose-chain: nested if/else via false-path renders as a choose: block', async () => {
    const yaml = `
alias: Choose chain
triggers:
  - trigger: state
    entity_id: sensor.mode
actions:
  - if:
      - condition: state
        entity_id: sensor.mode
        state: 'home'
    then:
      - action: scene.turn_on
        target:
          entity_id: scene.home
    else:
      - if:
          - condition: state
            entity_id: sensor.mode
            state: 'away'
        then:
          - action: scene.turn_on
            target:
              entity_id: scene.away
        else:
          - action: scene.turn_on
            target:
              entity_id: scene.default
mode: single
`;
    const { verification, result } = await roundtrip(yaml);
    expect(result.yaml).toContain('choose:');
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('OR-convergence: two conditions whose true paths converge to the same target', async () => {
    const yaml = `
alias: OR convergence
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
actions:
  - if:
      - condition: or
        conditions:
          - condition: state
            entity_id: light.living_room
            state: 'off'
          - condition: state
            entity_id: light.bedroom
            state: 'off'
    then:
      - action: light.turn_on
        target:
          entity_id: light.all
    else: []
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('root-condition promotion: a leading condition with no else gets promoted to conditions:', async () => {
    const yaml = `
alias: Root condition promotion
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
conditions:
  - condition: state
    entity_id: sun.sun
    state: below_horizon
actions:
  - action: light.turn_on
    target:
      entity_id: light.porch
mode: single
`;
    const { verification, result } = await roundtrip(yaml);
    expect(result.yaml).toContain('conditions:');
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('inverted condition: a false-handle-only continuation renders as condition: not', async () => {
    const yaml = `
alias: Inverted condition
triggers:
  - trigger: state
    entity_id: binary_sensor.door
actions:
  - if:
      - condition: state
        entity_id: alarm_control_panel.home
        state: 'armed_away'
    then: []
    else:
      - action: notify.send
        data:
          message: door opened while away
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('while-loop: repeat.while round-trips through the graph correctly', async () => {
    const yaml = `
alias: While loop
triggers:
  - trigger: state
    entity_id: input_boolean.run
actions:
  - repeat:
      while:
        - condition: numeric_state
          entity_id: sensor.count
          below: 5
      sequence:
        - action: counter.increment
          target:
            entity_id: counter.loop
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('until-loop: repeat.until round-trips through the graph correctly', async () => {
    const yaml = `
alias: Until loop
triggers:
  - trigger: state
    entity_id: input_boolean.run
actions:
  - repeat:
      until:
        - condition: numeric_state
          entity_id: sensor.count
          above: 5
      sequence:
        - action: counter.increment
          target:
            entity_id: counter.loop
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('count-loop: repeat.count round-trips through the graph correctly', async () => {
    const yaml = `
alias: Count loop
triggers:
  - trigger: state
    entity_id: input_boolean.run
actions:
  - repeat:
      count: 3
      sequence:
        - action: light.toggle
          target:
            entity_id: light.blinker
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('parallel block: concurrent branches round-trip correctly', async () => {
    const yaml = `
alias: Parallel block
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
actions:
  - parallel:
      - action: light.turn_on
        target:
          entity_id: light.a
      - action: light.turn_on
        target:
          entity_id: light.b
mode: single
`;
    const { verification } = await roundtrip(yaml);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('a genuine behavioral bug (wrong entity in the then-branch) IS caught as invalid', async () => {
    const yaml = `
alias: Sanity check -- gate must actually catch mismatches
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);

    // Simulate a bug: tamper with the CANDIDATE yaml's action target after
    // the fact (as if a generator bug silently changed which entity gets
    // acted on) and confirm the gate rejects it rather than passing
    // anything that merely parses.
    const tampered = yaml.replace('light.kitchen', 'light.bedroom');
    const verification = verifyNativeOutput(parsed.graph!, tampered);
    expect(verification.valid).toBe(false);
  });
});
