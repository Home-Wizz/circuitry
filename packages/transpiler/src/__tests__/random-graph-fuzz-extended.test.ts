import { describe, expect, it } from 'vitest';
import { dump as yamlDump } from 'js-yaml';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { NativeStrategy } from '../strategies/native';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Extended randomized-graph fuzzer (Phase B "maximal integration stress
 * test", round 2 -- transpiler-specific deep pass, 2026-09-06).
 *
 * random-graph-fuzz.test.ts (Phase B item 3, now on its 3rd internal round
 * of fixes) covers a deliberately bounded construct set: state/numeric_state
 * conditions only, service/delay actions only, state triggers only, depth
 * capped at 2-3, sequences/branches capped at 2-3. This file goes wider
 * WITHOUT touching that file's own history/bug-tracking comments (see its
 * own doc comment for bug #12/#13's story) -- it targets exactly the
 * construct types and structural depths that fuzzer's own generator never
 * produces, using the SAME full pipeline (YamlParser.parse ->
 * analyzeTopology -> FlowTranspiler.transpile -> verifyNativeOutput) and
 * the SAME "no way to match up N parallel branch(es)" known-gap bucket
 * (documented at length in random-graph-fuzz.test.ts; not re-explained
 * here):
 *
 *   - Conditions: nested and/or/not wrapping (up to depth 2), template,
 *     zone, sun, and time conditions -- none of which the original fuzzer
 *     ever generates (it only ever emits bare state/numeric_state leaves).
 *   - Actions: wait_template, wait_for_trigger (with its own nested
 *     trigger list), variables (set_variables), and stop -- the four
 *     "special" action shapes validator.ts explicitly carves out
 *     alongside service/delay, never exercised by the original fuzzer at
 *     all.
 *   - Triggers: numeric_state, time, event, template, and sun triggers
 *     mixed in alongside state triggers (the original fuzzer's only kind).
 *   - Structural depth raised: recursion depth 3-4 (was 2-3) -- deeper
 *     nesting than the original fuzzer's generator ever reaches, though
 *     sequence length (up to 3), parallel branches (2-3), choose cases
 *     (1-2), and trigger count (1-2) are kept at the ORIGINAL fuzzer's own
 *     widths rather than raised further. An initial attempt at depth 3-5 +
 *     wider sequences/branches/cases produced average graphs of 40-100+
 *     nodes that blew well past a 60s per-suite-run budget at N=150 -- NOT
 *     a hang or a single pathological input (isolated via per-stage
 *     timing instrumentation: no individual parse/analyze/transpile/
 *     verify call for any one graph ever exceeded ~200ms; the cost was
 *     purely the aggregate volume of many large graphs run hundreds of
 *     times), just ordinary superlinear cost growth with graph size. Dialed
 *     back to this level to keep the suite fast and reliable; chasing the
 *     exact scaling curve further is out of scope for this pass.
 *
 * Bug #17 (found and FIXED 2026-09-06, this file's first real run):
 * parseFailures started at 58/150 (38.7%) -- far higher than the original
 * fuzzer's near-zero rate, and every failure's error message was the same
 * shape: "Edge ... from condition node must have sourceHandle 'true' or
 * 'false', got: undefined". Root-caused via a minimal hand-written repro
 * (an if/else whose else: opens with a parallel: block) down to
 * YamlParser.ts's parallel-block handling inside parseActions: its two
 * recursive parseActions calls (one per branch shape -- an array sequence
 * or a single action) forwarded `conditionNodeIds` but never
 * `falsePathConditionIds`, unlike every other recursive call site in the
 * file (parseChooseBlock, the repeat-body calls). A parallel: block
 * sitting as the very first action after a condition's FALSE path (an
 * else:, a choose default:, a while/until false-exit) had no way to tell
 * its own branch-entry-edge wiring that the source was a false-path
 * source, so every one of that parallel's branch-entry edges got
 * sourceHandle left undefined instead of 'false' -- a construct
 * combination (parallel as the immediate first item of a false/else
 * branch) the original fuzzer, lacking `parallel` used this way at all
 * combined with the new special-action types, never exercised. Fixed by
 * forwarding falsePathConditionIds into both recursive calls -- see
 * YamlParser.ts's own comment at the fix site. Re-run: parseFailures
 * dropped to 29/150 (19.3%).
 *
 * Round 3 (2026-09-07, "aggressively work on the parser and the
 * verification gate... maximal stress test for these"): the remaining
 * ~19% (29/150) was root-caused via a live diagnostic dump of the exact
 * failing node/edge structure (not guessed from the error message alone)
 * and turned out to be a DIFFERENT, distinct bug family from #17 --
 * YamlParser.ts's repeat.while/until/count body-closing code picked
 * "the last body node" via an ad-hoc heuristic (scan the body's own edges
 * for a node with no further outgoing edge, take the array-last match)
 * instead of using `bodyResult.terminalNodeIds` -- the value
 * parseActions() already computes and returns for exactly this question,
 * and the same value the parallel-block handling already trusts for the
 * identical purpose. That heuristic silently picked the WRONG node
 * whenever a loop body's real trailing statement was itself a nested
 * loop/if/parallel (e.g. a repeat.while ending in a nested repeat.count
 * had its back-edge wired from the INNER loop's own counter-check
 * condition straight to the OUTER loop's header, bypassing the outer
 * loop's real body and producing a condition-sourced edge with no
 * sourceHandle at all -- the same rejection symptom as bug #17, a
 * structurally different cause). Fixed in all three repeat kinds (while's
 * back-edge, until's body-closing edge, count's increment edge) by
 * switching to `bodyResult.terminalNodeIds` with correct true/false
 * handle assignment per terminal, and by forwarding
 * `falsePathConditionIds` into all three repeat body-parsing calls for
 * consistency with every other recursive call site (only until's had real
 * exposure; while/count's forwarding closes a latent inconsistency rather
 * than a proven live bug).
 *
 * That parser fix alone regressed two previously-passing tests
 * (bug14-repeat-count-parallel-body.test.ts's while+parallel-body
 * regression guard, and repeat-roundtrip.test.ts's loop-in-if/else-in-loop
 * fixture) by making topology.ts's `hasBranchingRepeatBody`/
 * `hasConvergenceAtLoopCondition` checks -- which blanket-flagged ANY
 * loop condition receiving 2+ back-edges as an unrepresentable "branching
 * repeat body" -- newly trip on graphs that are now MORE complete (every
 * branch of a loop's own trailing if/else/parallel correctly gets its own
 * back-edge) but were previously under-wired (only one arbitrary branch's
 * back-edge ever existed, silently dropping the rest, which is exactly
 * the class of bug this whole fix pass is about eliminating). Root-caused
 * against strategy-selection.test.ts's own dangerous fixture (a manually
 * rewired edge from one loop's condition onto an unrelated, independent
 * loop's condition) to confirm what the check is ACTUALLY protecting
 * against: an edge from something outside the loop's own body reaching
 * its condition, not "the loop's own body has 2+ legitimate internal
 * branches that each naturally complete and continue the loop." Fixed
 * topology.ts to distinguish the two by checking whether every back-edge
 * source is a genuine descendant of the condition's own TRUE-handle body
 * entry (reachable via forward-only traversal) -- narrowly scoped to the
 * "condition is the back-edge TARGET" shape (repeat.while) that's
 * actually proven safe; the "condition is the back-edge SOURCE" shape
 * (repeat.until) is left exactly as conservative as before, with no
 * concrete evidence yet that it needs the same relaxation. Verified
 * against the two regressed tests (both pass again), the full transpiler
 * suite (408/408, zero regressions elsewhere), and specifically against
 * strategy-selection.test.ts's dangerous rewired-convergence fixture
 * (still correctly rejected -- confirms the relaxation didn't open the
 * door to the real danger this check exists for).
 *
 * Result: parseFailures 29/150 (19.3%) -> 0/150, reconfirmed at 0/500 in
 * a one-off widened run (not the permanently-committed N, to keep this
 * suite fast) -- the parser now matches the transpiler's own near-zero
 * failure rate on this fuzzer's full construct range. crashes stayed at 0
 * throughout. `knownParallelConvergenceGaps` and `gaps` both rose
 * (11/68 and 26/24 respectively across the two fuzzers at their
 * post-fix N) -- expected and benign: graphs that previously either
 * failed to parse at all or were structurally incomplete now correctly
 * reach further into topology/strategy selection, surfacing more
 * instances of the SEPARATE, pre-existing, already-deferred 3+-branch
 * nested-parallel state-machine gap (tracked, not touched this round per
 * explicit instruction) and more native-vs-state-machine coverage
 * opportunities (safe, non-corrupting, just not yet optimized) -- neither
 * bucket represents a new correctness problem.
 */

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(777333);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const chance = (p: number) => rng() < p;

const ENTITIES = ['light.a', 'light.b', 'light.c', 'climate.main', 'switch.x'];
const SENSORS = ['sensor.temp', 'sensor.illuminance', 'sensor.humidity'];
const BINARY_SENSORS = ['binary_sensor.motion', 'binary_sensor.occupancy', 'binary_sensor.door'];
const BOOLEANS = ['input_boolean.a', 'input_boolean.b', 'input_boolean.c'];
const ZONES = ['zone.home', 'zone.work'];
const PERSON = ['person.owner'];

let actionCounter = 0;

function randomLeafCondition(): Record<string, unknown> {
  const kind = pick(['state', 'numeric_state', 'numeric_state', 'template', 'zone', 'sun', 'time']);
  switch (kind) {
    case 'numeric_state': {
      const useBoth = chance(0.3);
      const c: Record<string, unknown> = { condition: 'numeric_state', entity_id: pick(SENSORS) };
      if (useBoth) {
        c.above = 10 + Math.floor(rng() * 20);
        c.below = 40 + Math.floor(rng() * 20);
      } else {
        c[pick(['above', 'below'])] = 10 + Math.floor(rng() * 30);
      }
      return c;
    }
    case 'template':
      return { condition: 'template', value_template: `{{ states('${pick(SENSORS)}') | float > ${Math.floor(rng() * 50)} }}` };
    case 'zone':
      return { condition: 'zone', entity_id: pick(PERSON), zone: pick(ZONES) };
    case 'sun':
      return { condition: 'sun', after: pick(['sunset', 'sunrise']) };
    case 'time':
      return { condition: 'time', after: '08:00:00', before: '22:00:00' };
    default:
      return { condition: 'state', entity_id: pick(BOOLEANS), state: pick(['on', 'off']) };
  }
}

function randomCondition(depth = 0): Record<string, unknown> {
  if (depth >= 2 || chance(0.6)) return randomLeafCondition();
  const kind = pick(['and', 'or', 'not']);
  if (kind === 'not') {
    return { condition: 'not', conditions: [randomCondition(depth + 1)] };
  }
  const count = 2 + Math.floor(rng() * 2);
  const conditions = [];
  for (let i = 0; i < count; i++) conditions.push(randomCondition(depth + 1));
  return { condition: kind, conditions };
}

function randomServiceAction(): Record<string, unknown> {
  actionCounter++;
  return {
    service: pick(['light.turn_on', 'light.turn_off', 'climate.set_hvac_mode', 'notify.notify']),
    data: { _n: actionCounter },
    target: { entity_id: pick(ENTITIES) },
  };
}

function randomTriggerObject(): Record<string, unknown> {
  const kind = pick(['state', 'state', 'numeric_state', 'time', 'event', 'template', 'sun']);
  switch (kind) {
    case 'numeric_state':
      return { platform: 'numeric_state', entity_id: pick(SENSORS), above: 10 + Math.floor(rng() * 30) };
    case 'time':
      return { platform: 'time', at: '07:30:00' };
    case 'event':
      return { platform: 'event', event_type: 'circuitry_fuzz_event' };
    case 'template':
      return { platform: 'template', value_template: `{{ states('${pick(SENSORS)}') == 'unavailable' }}` };
    case 'sun':
      return { platform: 'sun', event: pick(['sunset', 'sunrise']) };
    default:
      return { platform: 'state', entity_id: pick(BINARY_SENSORS), to: pick(['on', 'off']) };
  }
}

/** One of the four "special" action shapes validator.ts carves out
 * alongside service/delay -- never generated by the original fuzzer. */
function randomSpecialAction(): Record<string, unknown> {
  const kind = pick(['wait_template', 'wait_for_trigger', 'variables', 'stop']);
  switch (kind) {
    case 'wait_template':
      return { wait_template: `{{ states('${pick(SENSORS)}') | float > 10 }}`, timeout: '00:00:30' };
    case 'wait_for_trigger': {
      const n = 1 + Math.floor(rng() * 2);
      const triggers = [];
      for (let i = 0; i < n; i++) triggers.push(randomTriggerObject());
      return { wait_for_trigger: triggers, timeout: '00:01:00' };
    }
    case 'variables':
      return { variables: { fuzz_var: Math.floor(rng() * 100), other: pick(['a', 'b', 'c']) } };
    default:
      return { stop: `Fuzz stop ${Math.floor(rng() * 1000)}` };
  }
}

function randomAction(): Record<string, unknown> {
  return chance(0.75) ? randomServiceAction() : randomSpecialAction();
}

function randomSequence(depth: number, maxLen = 4): unknown[] {
  const len = 1 + Math.floor(rng() * maxLen);
  const seq: unknown[] = [];
  for (let i = 0; i < len; i++) seq.push(randomStatement(depth));
  return seq;
}

function randomStatement(depth: number): unknown {
  if (depth <= 0) return randomAction();
  const options = ['action', 'action', 'action', 'if', 'choose', 'parallel'];
  if (depth >= 1) options.push('repeat');
  const kind = pick(options);

  switch (kind) {
    case 'if': {
      const hasElse = chance(0.7);
      const stmt: Record<string, unknown> = {
        if: [randomCondition()],
        then: randomSequence(depth - 1, 3),
      };
      if (hasElse) stmt.else = randomSequence(depth - 1, 3);
      return stmt;
    }
    case 'choose': {
      const numCases = 1 + Math.floor(rng() * 2); // 1..2 (same width as original -- see depth comment in randomAutomation for why)
      const choose = [];
      for (let i = 0; i < numCases; i++) {
        choose.push({ conditions: [randomCondition()], sequence: randomSequence(depth - 1, 3) });
      }
      const stmt: Record<string, unknown> = { choose };
      if (chance(0.6)) stmt.default = randomSequence(depth - 1, 3);
      return stmt;
    }
    case 'parallel': {
      const numBranches = 2 + Math.floor(rng() * 2); // 2..3 (same width as original -- see depth comment in randomAutomation for why)
      const branches = [];
      for (let i = 0; i < numBranches; i++) branches.push(randomStatement(depth - 1));
      return { parallel: branches };
    }
    case 'repeat': {
      const repeatKind = pick(['while', 'until', 'count']);
      const body = randomSequence(depth - 1, 3);
      if (repeatKind === 'count') {
        return { repeat: { count: 1 + Math.floor(rng() * 3), sequence: body } };
      }
      return { repeat: { [repeatKind]: [randomCondition()], sequence: body } };
    }
    default:
      return randomAction();
  }
}

function randomAutomation(seedIdx: number): string {
  const numTriggers = 1 + Math.floor(rng() * 2); // 1..2 (same as original -- trigger COUNT isn't the axis this file widens)
  const triggers = [];
  for (let i = 0; i < numTriggers; i++) triggers.push(randomTriggerObject());
  // Depth 3..4 (original: 2..3) -- deeper nesting than the original fuzzer ever reaches,
  // dialed back from an initial 3..5/seq-4/branches-4 attempt that made average graphs
  // (40-100+ nodes) expensive enough to blow past a 60s suite-wide budget at N=150 --
  // not a hang or any single pathological input (isolated via per-stage timing: no
  // individual parse/analyze/transpile/verify call ever exceeded ~200ms), just the
  // ordinary cost of many-dozens-of-nodes graphs run hundreds of times. Kept at this
  // still-deeper-than-original level rather than chasing the exact sub-linear-vs-
  // super-linear scaling curve, which is out of scope for this pass.
  const actions = randomSequence(3 + Math.floor(rng() * 2), 3);
  const automation = {
    alias: `Extended Fuzz ${seedIdx}`,
    trigger: triggers,
    action: actions,
    mode: 'single',
  };
  return yamlDump(automation, { lineWidth: -1 });
}

describe('FUZZ: extended randomized graph battery (maximal integration stress test, round 2, transpiler-specific)', () => {
  const transpiler = new FlowTranspiler();
  const parser = new YamlParser();

  const isKnownParallelConvergenceGap = (message: string): boolean =>
    /no way to match up the \d+ parallel branch\(es\)/.test(message);

  it(
    'runs N wider/deeper random automations (nested and/or/not, wait/wait_for_trigger/variables/stop, more trigger types) through the full pipeline',
    async () => {
    const N = 400;
    const crashes: string[] = [];
    const knownParallelConvergenceGaps: string[] = [];
    const gaps: string[] = [];
    const unexpectedWarnings: string[] = [];
    let parseFailures = 0;
    let treeCount = 0;
    let smCount = 0;

    for (let i = 0; i < N; i++) {
      actionCounter = 0;
      const y = randomAutomation(i);
      let parsed;
      try {
        parsed = await parser.parse(y);
      } catch (e) {
        crashes.push(`[${i}] parse THREW: ${e instanceof Error ? e.stack : e}\nYAML:\n${y}`);
        continue;
      }
      if (!parsed.success || !parsed.graph) {
        parseFailures++;
        continue;
      }
      const graph = parsed.graph;

      let analysis;
      try {
        analysis = transpiler.analyzeTopology(graph);
      } catch (e) {
        crashes.push(`[${i}] analyzeTopology THREW: ${e instanceof Error ? e.stack : e}\nYAML:\n${y}`);
        continue;
      }

      let result;
      try {
        result = transpiler.transpile(graph);
      } catch (e) {
        crashes.push(`[${i}] transpile THREW: ${e instanceof Error ? e.stack : e}\nYAML:\n${y}`);
        continue;
      }

      if (!result.success) {
        const message = JSON.stringify(result.errors);
        if (isKnownParallelConvergenceGap(message)) {
          knownParallelConvergenceGaps.push(`[${i}] ${message}\nYAML:\n${y}`);
        } else {
          crashes.push(`[${i}] transpile FAILED (auto-select should always succeed): ${message}\nYAML:\n${y}`);
        }
        continue;
      }

      const actualStrategy = (result.yaml ?? '').includes('current_node') ? 'state-machine' : 'native';
      if (actualStrategy === 'native') treeCount++;
      else smCount++;

      if ((result.warnings ?? []).length > 0) {
        unexpectedWarnings.push(`[${i}] warnings=${JSON.stringify(result.warnings)}\nYAML:\n${y}`);
      }

      if (!analysis.isTree) {
        try {
          const native = new NativeStrategy();
          const genResult = native.generate(graph, analysis);
          const yamlContent = (genResult as any).automation ?? (genResult as any).script;
          const rawYaml = yamlDump(yamlContent, { lineWidth: -1, quotingType: '"', forceQuotes: false });
          const verification = verifyNativeOutput(graph, rawYaml);
          if (verification.valid) {
            gaps.push(`[${i}] isTree=false but native.generate()+verify says VALID -- possible coverage gap.\nYAML:\n${y}`);
          }
        } catch (e) {
          // native.generate() throwing on a non-tree graph is expected/fine.
        }
      }
    }

    console.log(`=== EXTENDED FUZZ SUMMARY ===`);
    console.log(`N=${N} parseFailures=${parseFailures} tree(native)=${treeCount} state-machine=${smCount}`);
    console.log(
      `crashes=${crashes.length} knownParallelConvergenceGaps=${knownParallelConvergenceGaps.length} gaps=${gaps.length} unexpectedWarnings=${unexpectedWarnings.length}`
    );
    if (knownParallelConvergenceGaps.length > 0) {
      console.log('=== KNOWN PARALLEL-CONVERGENCE GAPS (pre-existing, not a new discovery) ===');
      console.log(knownParallelConvergenceGaps.slice(0, 3).join('\n---\n'));
    }
    if (crashes.length > 0) {
      console.log('=== CRASHES / UNEXPLAINED FAILURES ===');
      console.log(crashes.slice(0, 5).join('\n---\n'));
    }
    if (gaps.length > 0) {
      console.log('=== GAPS ===');
      console.log(gaps.slice(0, 5).join('\n---\n'));
    }
    if (unexpectedWarnings.length > 0) {
      console.log('=== UNEXPECTED WARNINGS (sample) ===');
      console.log(unexpectedWarnings.slice(0, 5).join('\n---\n'));
    }

    // parseFailures is now asserted to 0 (round 3, 2026-09-07): the
    // repeat-loop body-closing bug family that caused all of the previous
    // 19.3% failure rate is fixed (see this file's doc comment) and
    // reconfirmed at 0/500 in a widened one-off run, not just this
    // committed N. Asserting it directly (rather than only reporting it)
    // makes this fuzzer catch a future regression in that guarantee, the
    // same way `crashes` already does.
    expect(parseFailures, `parseFailures should be 0, see console summary above`).toBe(0);
    expect(crashes.length, crashes.join('\n---\n')).toBe(0);
    },
    90000
  );
});
