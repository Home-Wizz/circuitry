import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Phase B item 3 (NativeStrategy structuring-coverage quality pass),
 * 2026-09-06, round 2. Found via the same empirical-audit technique used
 * for choose-chain-convergence.test.ts: NativeStrategy's own generator
 * already correctly renders an inner if/else fully nested inside an outer
 * if's true arm, where the inner if's own convergence (its true+false
 * paths reconverging) sits at a DIFFERENT nesting depth than the outer
 * if's false path -- confirmed by bypassing topology.ts's isTree gate and
 * calling NativeStrategy.generate() directly, then behaviorally verifying
 * the result. topology.ts's checkParallelConvergence originally traced a
 * converging source back to only the FIRST condition-type ancestor found,
 * so the inner if's condition was never recognized as sharing the SAME
 * overall branch structure as the outer if's condition, misclassifying
 * this as hasConvergingPaths and routing to StateMachineStrategy even
 * though native.ts could already render it as a plain nested if/else.
 * Fixed by generalizing traceToBranchCondition to climb through any
 * condition ancestor with exactly one incoming edge (see topology.ts's
 * doc comment on that function for why this climb is safe by
 * construction).
 */
describe('topology: nested if-in-if convergence (Phase B item 3, round 2)', () => {
  const transpiler = new FlowTranspiler();

  it('an if/else nested inside another if/else\'s true arm, converging with the outer else on a shared tail, is tree-shaped and rendered natively', async () => {
    const yaml = `
alias: Nested if in if
trigger:
  - platform: state
    entity_id: binary_sensor.motion
condition: []
action:
  - if:
      - condition: state
        entity_id: sun.sun
        state: below_horizon
    then:
      - if:
          - condition: numeric_state
            entity_id: sensor.illuminance
            below: 10
        then:
          - service: light.turn_on
            target:
              entity_id: light.porch
            data:
              brightness_pct: 100
        else:
          - service: light.turn_on
            target:
              entity_id: light.porch
            data:
              brightness_pct: 50
    else:
      - service: light.turn_off
        target:
          entity_id: light.porch
  - service: notify.notify
    data:
      message: "porch light adjusted"
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
    expect(yamlOut).not.toContain('current_node');
    expect(yamlOut).toContain('brightness_pct: 100');
    expect(yamlOut).toContain('brightness_pct: 50');
    expect(yamlOut).toContain('light.turn_off');
    // notify.notify must run exactly once, after the whole nested
    // if/else -- not duplicated into every branch.
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);

    const verification = verifyNativeOutput(graph, yamlOut);
    expect(verification.valid, verification.reason).toBe(true);
  });
});
