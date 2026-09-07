import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Phase B item 3 (NativeStrategy structuring-coverage quality pass),
 * 2026-09-06, round 3 -- found via a stress-test battery of synthetic
 * "hard" shapes exercised against the transpiler after rounds 1/2 (see
 * choose-chain-convergence.test.ts / nested-if-convergence.test.ts) left
 * no known gaps in the real-world fixture corpus.
 *
 * A trigger fanning out directly into 2+ parallel branches that converge
 * on the same downstream action used to build each branch independently
 * and unbounded (buildSequenceFromNode, no stop point), instead of
 * detecting the shared convergence and emitting it once after the
 * `parallel:` block -- exactly the class of bug buildFanOut's own
 * findConvergencePoint/buildSequenceUntilNode machinery already exists to
 * prevent (bug #12's fix, applied elsewhere in this file). This specific
 * call site (native.ts's "Multiple paths from triggers - use parallel"
 * branch) had never been switched over to reuse it, so it silently
 * duplicated the convergent action into EVERY parallel branch -- a real
 * behavior change (the action, e.g. a single notify.notify, would fire
 * once per branch instead of once total), not just an output-quality
 * issue. Confirmed via direct bypass of topology.ts's isTree gate before
 * the fix (native.generate() produced two `notify.notify` calls, one per
 * branch, sharing a YAML anchor since js-yaml auto-anchors the now-
 * identical duplicated object) and the real `transpiler.transpile()`
 * pipeline's own verification gate correctly caught it (`actions: step
 * count changed (2 -> 1)`) and fell back to state-machine with a warning
 * -- so no corruption ever reached a real save, but the fallback was
 * unnecessary for what native.ts can now render directly. Fixed by
 * reusing buildFanOut (which already has this exact convergence-detection
 * built in) instead of the branch's own narrower, unbounded reimplementation.
 */
describe('topology: parallel fan-out convergence (Phase B item 3, round 3)', () => {
  const transpiler = new FlowTranspiler();

  it('two parallel branches directly off a trigger, converging on a shared trailing action, run that action exactly once', async () => {
    const yaml = `
alias: Parallel converge
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - parallel:
      - service: light.turn_on
        target: { entity_id: light.a }
      - service: light.turn_on
        target: { entity_id: light.b }
  - service: notify.notify
    data: { message: "done" }
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
    expect(yamlOut).toContain('parallel:');
    expect(yamlOut).toContain('light.a');
    expect(yamlOut).toContain('light.b');
    // The shared tail action must run exactly once, after the parallel
    // block -- not once per branch.
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);

    const verification = verifyNativeOutput(graph, yamlOut);
    expect(verification.valid, verification.reason).toBe(true);
  });
});
