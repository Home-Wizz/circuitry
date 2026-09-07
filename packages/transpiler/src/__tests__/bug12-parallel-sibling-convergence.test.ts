import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Bug #12 (2026-09-06, found via the randomized fuzzer, Phase B item 3
 * round 3). When 2+ branches of a fan-out (a `parallel:` block, or an
 * if/then vs if/else pair, or a choose-chain's cases, or a trigger's own
 * multiple direct targets) each independently reach an IDENTICAL SHARED
 * SET of 2+ further downstream nodes -- and neither of those two nodes is
 * itself reachable from the other (true siblings, not one dominating the
 * other) -- there is no single "the" convergence point. Every one of
 * native.ts's convergence-detection call sites (findConvergencePoint,
 * used by buildFanOut/buildFanOutUntilNode/buildSequenceUntilNode's
 * multi-outgoing-edge case/the choose-chain builder/the if-then-else
 * builder), plus state-machine.ts's buildFanOutFromTargets and
 * generateParallelEntryBlocks (via findConvergencePointForBranches), used
 * to pick ONE of the two siblings arbitrarily (a tie broken only by BFS
 * iteration order) and treat it as if it were the sole continuation --
 * silently dropping or duplicating its sibling, corrupting the rendered
 * YAML's actual behavior (verified via direct bypass: the corrupted
 * output failed verifyNativeOutput/verifyStateMachineOutput, so
 * transpile() at least failed safely rather than shipping wrong YAML, but
 * a huge class of ordinary "two things run in parallel, then two MORE
 * things run in parallel" automations couldn't transpile at all).
 *
 * Fixed by replacing the single-node contract with findConvergenceSet
 * (native.ts) / its mirror in extractFromGraph.ts and
 * extractStateMachineFromGraph.ts (the independent verification oracles,
 * which had the IDENTICAL bug -- fixing native.ts/state-machine.ts alone
 * did not move the fuzzer's failure count until the oracles were fixed
 * too), which returns the full minimal/undominated set of shared
 * convergence nodes. Every call site that used to treat "the" convergence
 * point as a single scalar now recurses on a genuine 2+ member sibling
 * set instead of arbitrarily picking one -- see buildFanOut's,
 * buildFanOutUntilNode's, and buildFanOutFromTargets' own doc comments
 * for the exact recursive-splice mechanics.
 */
describe('parallel-into-parallel sibling convergence (bug #12)', () => {
  const transpiler = new FlowTranspiler();
  const parser = new YamlParser();

  it('two parallel branches that both fan into the SAME two further nodes render as two sequential parallel blocks, not corrupted/dropped output', async () => {
    const yaml = `
alias: Sibling convergence top-level
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - parallel:
      - delay:
          seconds: 1
      - delay:
          seconds: 2
  - parallel:
      - service: light.turn_on
        target:
          entity_id: light.a
      - delay:
          seconds: 5
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    // Every action must appear exactly once -- the corrupted output either
    // dropped one of the second parallel's two branches or duplicated it
    // into the first parallel's own branches.
    expect(yamlOut.match(/light\.turn_on/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 5/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 1/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 2/g) ?? []).toHaveLength(1);
    expect(yamlOut).not.toMatch(/current_node/); // must stay on NativeStrategy, no fallback needed
    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('an if/then and if/else that both continue into the SAME two-branch parallel block render correctly, not merged/duplicated', async () => {
    // The exact shape the fuzzer found (Fuzz 32): the "then" branch (a
    // single delay) and the "else" branch (a delay + its own inner
    // parallel) both continue into the SAME shared two-branch parallel
    // block after the if/then/else finishes.
    const yaml = `
alias: If-else sibling convergence
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - if:
      - condition: numeric_state
        entity_id: sensor.humidity
        below: 25
    then:
      - delay:
          seconds: 3
    else:
      - delay:
          seconds: 4
      - parallel:
          - delay:
              seconds: 2
          - service: notify.notify
            target:
              entity_id: light.a
  - parallel:
      - service: climate.set_hvac_mode
        target:
          entity_id: light.a
      - delay:
          seconds: 2
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';

    // The "then" branch must be just the bare delay(3) -- no spurious
    // singleton `parallel:` wrapper leaking the shared continuation's
    // sibling into it (the exact corruption this bug produced).
    expect(yamlOut).not.toMatch(/parallel:\s*\n\s*-\s*delay:\s*\n\s*seconds:\s*2\s*\n\s*then:/);
    expect(yamlOut.match(/climate\.set_hvac_mode/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);
    // Two independent delay(2) actions in this graph (one in the else's
    // own inner parallel, one in the shared outer parallel) -- both must
    // appear exactly once each, never duplicated via a shared object
    // reference re-emitted into both branches.
    expect(yamlOut.match(/seconds: 2/g) ?? []).toHaveLength(2);
    expect(yamlOut).not.toMatch(/current_node/); // must stay on NativeStrategy, no fallback needed
    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('a trigger whose own two direct targets both fan into the SAME two further nodes still transpiles via state-machine (sibling-aware generateParallelEntryBlocks/buildFanOutFromTargets)', async () => {
    // Two triggers force topology.ts to reject the tree strategy
    // (divergent trigger paths), so this exercises
    // generateParallelEntryBlocks (a trigger's own multiple direct
    // targets) with a genuine 2-member sibling convergence set: both
    // delay(1) and delay(2) independently fan into the SAME shared
    // {light.turn_on, delay(5)} pair.
    const yaml = `
alias: Multi-trigger sibling fanout
trigger:
  - platform: state
    entity_id: binary_sensor.motion
  - platform: state
    entity_id: binary_sensor.door
action:
  - parallel:
      - delay:
          seconds: 1
      - delay:
          seconds: 2
  - parallel:
      - service: light.turn_on
        target:
          entity_id: light.a
      - delay:
          seconds: 5
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(false);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).toMatch(/current_node/); // confirms state-machine was actually exercised

    const { verifyStateMachineOutput } = await import('../verification/verifyStateMachineOutput');
    const verification = verifyStateMachineOutput(graph, yamlOut);
    expect(verification.valid, verification.reason).toBe(true);

    // Both trigger entries' own synthetic parallel-entry choose-cases must
    // be present (not collapsed/dropped), and every individual node this
    // sibling pair could independently converge through mid-flow
    // (light.turn_on's own dispatch state, the shared delay(5)'s own
    // dispatch state) must exist too.
    expect(yamlOut).toMatch(/__parallel_trigger_0/);
    expect(yamlOut).toMatch(/__parallel_trigger_1/);
    expect(yamlOut).toMatch(/light\.turn_on/);
  });
});
