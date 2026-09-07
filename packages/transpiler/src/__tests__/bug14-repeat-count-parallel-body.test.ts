import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Bug #14 (2026-09-06, found while investigating why topology.ts's isTree
 * classifier routed some native-representable graphs to state-machine
 * unnecessarily -- Phase B item 3's "51 coverage-gap candidates").
 *
 * YamlParser.ts's `repeat.count` decompile wired the loop's back-edge as
 * `condition →(true)→ bodyResult.nodes[0]` -- the first node CREATED while
 * parsing the body. That's only the same node as the body's true entry
 * when the body's first (and only) statement is a single action. When the
 * body's first statement is itself a `parallel:` block, `bodyResult.nodes[0]`
 * is just ONE arbitrary sibling of that parallel (whichever branch happened
 * to be parsed first), with no edge of its own back to the other siblings.
 * Two compounding problems followed from this:
 *
 *  1. topology.ts's `findBackEdges` (plain DFS ancestor-detection) could not
 *     recognize this edge as a back-edge at all: by the time the walk
 *     reached it (via the OTHER siblings' path through the increment/
 *     condition nodes), the arbitrarily-chosen sibling had already been
 *     fully visited and popped off the DFS stack via the forward direction
 *     (through the fan-out source), so the edge looked like an ordinary
 *     cross-edge rather than a genuine loop-closer. `detectConvergingPaths`
 *     then correctly (given the bad input) flagged the resulting 2-in-edge
 *     convergence as unrecognized, forcing state-machine even though
 *     NativeStrategy could render the loop correctly.
 *  2. Forcing NativeStrategy anyway (bypassing topology.ts, as the
 *     investigation into item 1 above did) reveals the DEEPER bug: since
 *     the loop only "closes" onto one sibling, NativeStrategy's own
 *     repeat-body reconstruction (`collectNodesUntil` seeded from that one
 *     sibling) never traverses the OTHER two -- decompiling back to
 *     `repeat: { count: N, sequence: [<one branch only>] }`, silently
 *     dropping the rest, on every iteration after the first.
 *
 * Fixed by making the back-edge target the loop's own init `set_variables`
 * node instead (YamlParser.ts) -- the node whose OWN forward edges already
 * fan out to every one of the body's first-step branches, exactly as real
 * first-iteration execution already does. That single redirect fixes both
 * problems: the edge becomes a genuine DFS-detectable back-edge (its target
 * is now a true ancestor in the traversal), and it gives NativeStrategy
 * (native.ts's `detectRepeatPatterns`/`buildRepeatBlock`) and the
 * independent verification oracle (extractFromGraph.ts's `detectLoops`) an
 * unambiguous, single anchor to seed the FULL body reconstruction from --
 * both fixed in lockstep (matching this codebase's "duplicate the rule, not
 * the code" convention for native.ts vs. its verification oracle).
 *
 * NOT extended to `repeat.until`: unlike `count`, `until` has no dedicated
 * init node to redirect to (its body is parsed directly from whatever
 * preceded the repeat action, with no synthetic anchor in between) -- and
 * the graph-structural workaround attempted for it (tracing the back-edge
 * target's own predecessor for a "genuine parallel fan-out" and expanding
 * to its full sibling set) was reverted the same day after the fuzzer
 * caught it corrupting a DIFFERENT, unrelated class of automation:
 * `detectRepeatPatterns`/`buildRepeatBlock` is also reused as
 * state-machine.ts's `nativeSubBuilder`, for rendering a plain `repeat:`
 * block embedded inside one of ITS OWN generated states -- entirely
 * outside topology.ts's isTree gate. There, an until-loop's siblings are
 * ALSO independently reachable as ordinary branches of whatever outer
 * fan-out precedes the loop, so expanding bodyEntryNodeIds made them render
 * TWICE (once as loop-body content, once as sibling top-level actions),
 * turning several previously-successful state-machine transpiles (e.g.
 * Fuzz-83/251: ordinary top-level `repeat.until` blocks, no `repeat.count`
 * anywhere) into hard, unrecoverable failures. `repeat.until` with a
 * `parallel:`-first body remains a known, verification-caught,
 * safely-falls-back-to-state-machine gap (see the last test below and
 * random-graph-fuzz.test.ts's `isKnownParallelConvergenceGap` doc comment).
 * `repeat.while` was already unaffected either way: it always closes onto
 * the header CONDITION node (never a body sibling), which is an
 * unambiguous, always-correct anchor regardless of what the body's first
 * step looks like.
 */
describe('repeat.count with a parallel-first body (bug #14)', () => {
  const transpiler = new FlowTranspiler();
  const parser = new YamlParser();

  it('a repeat.count loop whose body opens with a 3-branch parallel round-trips natively with all 3 branches intact', async () => {
    const yaml = `
alias: Count with parallel body
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
action:
  - parallel:
      - delay:
          seconds: 5
      - repeat:
          count: 2
          sequence:
            - parallel:
                - delay:
                    seconds: 3
                - delay:
                    seconds: 1
                - delay:
                    seconds: 5
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);
    expect(analysis.recommendedStrategy).toBe('native');

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';

    expect(yamlOut).not.toMatch(/current_node/); // must stay on NativeStrategy, no fallback needed
    expect(yamlOut).toMatch(/count:\s*2/);
    // All three body branches must survive inside repeat.sequence, still
    // wrapped in their own parallel -- not flattened, not dropped.
    expect(yamlOut.match(/seconds: 3/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 1/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 5/g) ?? []).toHaveLength(2); // the outer branch's delay(5) + the body's own delay(5)
    // The init node's one-time counter assignment must never leak into
    // repeat.sequence as if it were loop-body content.
    expect(yamlOut).not.toMatch(/_repeat_counter/);

    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('a repeat.count loop whose body opens with a 2-branch parallel (no outer wrapping) round-trips natively', async () => {
    const yaml = `
alias: Count with parallel body, no outer wrap
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      count: 3
      sequence:
        - parallel:
            - service: light.turn_on
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

    expect(yamlOut).not.toMatch(/current_node/);
    expect(yamlOut).toMatch(/count:\s*3/);
    expect(yamlOut).toMatch(/light\.turn_on/);
    expect(yamlOut.match(/seconds: 2/g) ?? []).toHaveLength(1);
    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('a repeat.while loop with a parallel-first body was already correct and stays correct (regression guard)', async () => {
    const yaml = `
alias: While with parallel body
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      while:
        - condition: state
          entity_id: input_boolean.c
          state: 'off'
      sequence:
        - parallel:
            - delay:
                seconds: 3
            - delay:
                seconds: 1
            - delay:
                seconds: 5
mode: single
`;
    const parsed = await parser.parse(yaml);
    const graph = parsed.graph!;
    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);
    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).not.toMatch(/current_node/);
    expect(yamlOut.match(/seconds: 3/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 1/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/seconds: 5/g) ?? []).toHaveLength(1);
    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('a repeat.until loop with a parallel-first body is a known gap: topology keeps it off NativeStrategy and it still transpiles successfully via state-machine', async () => {
    const yaml = `
alias: Until with parallel body
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      until:
        - condition: numeric_state
          entity_id: sensor.illuminance
          above: 35
      sequence:
        - parallel:
            - delay:
                seconds: 3
            - delay:
                seconds: 1
            - delay:
                seconds: 5
mode: single
`;
    const parsed = await parser.parse(yaml);
    const graph = parsed.graph!;
    const analysis = transpiler.analyzeTopology(graph);
    // Still correctly kept off native -- see this file's top-of-suite
    // comment for why `until` couldn't get the same fix `count` did.
    expect(analysis.isTree).toBe(false);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(result.yaml ?? '').toMatch(/current_node/); // confirms state-machine was actually used
  });

  it('an ordinary automation with multiple independent repeat.until blocks (no parallel body, no repeat.count) is unaffected (regression guard for Fuzz-83/251)', async () => {
    // Reproduces the exact shape the fuzzer caught regressing when the
    // until-pattern sibling-expansion fix was (briefly) also applied to
    // native.ts: none of these loops have a parallel-first body, so this
    // must transpile successfully however state-machine.ts's internal
    // nativeSubBuilder happens to touch detectRepeatPatterns/buildRepeatBlock
    // while rendering them.
    const yaml = `
alias: Fuzz 83 regression guard
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
action:
  - repeat:
      until:
        - condition: numeric_state
          entity_id: sensor.humidity
          above: 20
      sequence:
        - service: light.turn_off
          target:
            entity_id: climate.main
        - if:
            - condition: state
              entity_id: input_boolean.c
              state: 'on'
          then:
            - service: climate.set_hvac_mode
              target:
                entity_id: light.c
  - delay:
      seconds: 2
  - parallel:
      - delay:
          seconds: 3
      - repeat:
          until:
            - condition: numeric_state
              entity_id: sensor.temp
              below: 28
          sequence:
            - service: light.turn_off
              target:
                entity_id: light.c
      - repeat:
          until:
            - condition: numeric_state
              entity_id: sensor.humidity
              above: 30
          sequence:
            - service: climate.set_hvac_mode
              target:
                entity_id: light.b
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;
    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
  });
});
