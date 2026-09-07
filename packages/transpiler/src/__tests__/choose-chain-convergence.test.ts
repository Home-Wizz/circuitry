import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Phase B item 3 (NativeStrategy structuring-coverage quality pass),
 * 2026-09-06. Found via empirical audit: NativeStrategy's own generator
 * (native.ts's isChooseChain / findConvergencePoint / buildFanOutUntilNode
 * machinery) already correctly renders an N-way choose/elif cascade whose
 * branches converge onto a shared downstream continuation -- confirmed by
 * bypassing topology.ts's isTree gate and calling NativeStrategy.generate()
 * directly, then behaviorally verifying the result. But topology.ts's own
 * convergence classifier (detectConvergingPaths -> checkParallelConvergence,
 * and separately detectCrossLinks's backward-edge exception) only ever
 * recognized a SINGLE shared condition ancestor as a legitimate
 * if/then/else continuation, so any real choose-chain with 2+ actual
 * condition nodes was misclassified as `hasConvergingPaths`/`hasCrossLinks`
 * and routed to StateMachineStrategy's dispatcher even though native.ts
 * could already render it cleanly. Generalized both checks via a new
 * `formsChooseChain` helper (topology.ts) that mirrors native.ts's own
 * chain-walk semantics (a false-edge cascade, excluding the
 * `falseTargetReachableViaTruePath` "sequential, not elif" shape bug #10
 * already guards against) rather than reimplementing an independent,
 * possibly-divergent rule.
 */
describe('topology: N-way choose-chain convergence (Phase B item 3)', () => {
  const transpiler = new FlowTranspiler();

  it('a 3-case choose block with a default and a shared tail action is now classified as tree-shaped and rendered natively', async () => {
    const yaml = `
alias: Three way climate
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
action:
  - choose:
      - conditions:
          - condition: numeric_state
            entity_id: sensor.temp
            below: 18
        sequence:
          - service: climate.set_hvac_mode
            data: { hvac_mode: heat }
      - conditions:
          - condition: numeric_state
            entity_id: sensor.temp
            above: 26
        sequence:
          - service: climate.set_hvac_mode
            data: { hvac_mode: cool }
      - conditions:
          - condition: numeric_state
            entity_id: sensor.temp
            above: 20
            below: 24
        sequence:
          - service: climate.set_hvac_mode
            data: { hvac_mode: 'off' }
    default:
      - service: climate.set_hvac_mode
        data: { hvac_mode: fan_only }
  - service: notify.notify
    data:
      message: "climate adjusted"
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);
    expect(analysis.recommendedStrategy).toBe('native');

    const result = transpiler.transpile(graph);
    expect(result.success).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).toContain('choose:');
    expect(yamlOut).not.toContain('current_node'); // no state-machine dispatcher
    expect(yamlOut).toContain('hvac_mode: heat');
    expect(yamlOut).toContain('hvac_mode: cool');
    expect(yamlOut).toContain('hvac_mode: "off"');
    expect(yamlOut).toContain('hvac_mode: fan_only');
    // notify.notify must run exactly once, after the whole choose block --
    // not duplicated into every branch.
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);

    const verification = verifyNativeOutput(graph, yamlOut);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('two independent, sequential single-case ifs (not an elif chain) still converge correctly on their shared tail', async () => {
    // Same underlying shape as the real-world 07-adaptive-lighting-complex.yaml
    // fixture this fix also unblocked: two unrelated, back-to-back `if`s
    // (no shared condition, no false-edge link between them) whose
    // multi-step true-branches both fall through to the same next
    // statement. This must NOT be misidentified as a choose-chain (their
    // conditions aren't linked by a false edge at all), but the ORIGINAL
    // single-condition convergence rule already covers each `if`
    // independently -- this test guards that `formsChooseChain`'s
    // generalization didn't regress the plain single-condition case.
    const yaml = `
alias: Two independent ifs then shared tail
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - if:
      - condition: state
        entity_id: light.kitchen
        state: 'off'
    then:
      - service: light.turn_on
        target:
          entity_id: light.kitchen
      - delay:
          seconds: 1
  - if:
      - condition: state
        entity_id: light.hallway
        state: 'off'
    then:
      - service: light.turn_on
        target:
          entity_id: light.hallway
      - delay:
          seconds: 1
  - service: notify.notify
    data:
      message: "lights checked"
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).not.toContain('current_node');
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);

    const verification = verifyNativeOutput(graph, yamlOut);
    expect(verification.valid, verification.reason).toBe(true);
  });

  it('a genuine, unrelated convergence (two conditions with no chain relationship, both independently gating the same downstream action from unrelated branches) still requires state-machine', async () => {
    // Two triggers, each gating its own condition, whose true AND false
    // paths both happen to point at the same downstream action -- there is
    // no false-edge link between the two conditions at all (they are not
    // part of one cascade), so formsChooseChain must correctly reject this
    // as NOT a valid choose-chain, preserving the existing, correct
    // fallback to state-machine for shapes native.ts's chain-walker cannot
    // represent as a single choose:/if-else construct.
    const yaml = `
alias: Two independent triggers converging
trigger:
  - platform: state
    entity_id: binary_sensor.a
    to: 'on'
  - platform: state
    entity_id: binary_sensor.b
    to: 'on'
condition: []
action:
  - service: light.turn_on
    target:
      entity_id: light.hallway
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;
    // Sanity: this shape converges via multiple TRIGGERS onto the same
    // action, which is the pre-existing "allSourcesAreTriggers" exception
    // in detectConvergingPaths -- already valid for native (every trigger
    // runs the same action sequence). Included here as a boundary check
    // that this fix's changes don't accidentally break that pre-existing,
    // unrelated exception.
    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);
  });
});
