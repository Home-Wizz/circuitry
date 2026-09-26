import { describe, expect, it } from 'vitest';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';
import { verifyStateMachineOutput } from '../verification/verifyStateMachineOutput';

/**
 * Adversarial SOUNDNESS fuzzer for the verification gate (Phase B "maximal
 * integration stress test", round 3, 2026-09-07 -- "aggressively work on
 * ... the verification gate").
 *
 * Every prior fuzzer in this codebase (random-graph-fuzz*.test.ts,
 * canvas-block-fuzz.test.ts, etc.) tests the verification gate only as a
 * JUDGE of the generator: it feeds random graphs through the real
 * pipeline and checks that transpile() either succeeds with genuinely
 * correct output or fails loudly. None of that ever tests the JUDGE
 * ITSELF for soundness -- whether verifyNativeOutput/
 * verifyStateMachineOutput can ever be fooled into calling two things
 * equivalent that are NOT. That's a real, previously-unverified blind
 * spot: every bug this project has found and fixed in the verification
 * gate (e.g. bug #12's oracle-side fix, which needed the SAME fix as
 * native.ts's own bug before the fuzzer's failure count moved at all) was
 * found because the gate was too CONSERVATIVE (a false negative -- it
 * rejected something that was actually fine). A false POSITIVE -- the
 * gate accepting output that is actually wrong -- is the dangerous
 * direction, since it would let a real generator bug ship silently, and
 * nothing so far has specifically hunted for that.
 *
 * Technique: mutation testing. For N random automations, get a REAL,
 * already-verified-correct transpile via the actual pipeline (transpile()
 * only returns success:true after its own strategy's output already
 * passed verifyNativeOutput/verifyStateMachineOutput -- see
 * FlowTranspiler.ts), then apply small, deliberately behavior-changing
 * mutations directly to the CORRECT candidate YAML (parsed generically as
 * a JS object via js-yaml, mutated, redumped) while leaving the ORIGINAL
 * graph untouched -- exactly simulating "the generator produced slightly
 * wrong output" without needing to know anything about HOW a generator
 * bug might look. Every mutation category here is chosen to be
 * universally behavior-changing under this codebase's OWN documented
 * equivalence contract (behaviorProgram.ts: "sequential steps must match
 * in order", boolean.ts: exact truth-table equivalence over the
 * condition's actual operands) regardless of the specific graph shape it
 * lands on:
 *
 *   - Remove one step from any sequence/array of 2+ items (changes step
 *     count -- always caught by "sequential steps must match in order"
 *     unless the array is cosmetic, which is why arrays under known
 *     cosmetic keys like `data`/`target`'s own sub-object literals aren't
 *     walked as sequences -- see isStepArray below).
 *   - Flip a numeric_state condition's above/below bound by a large,
 *     unambiguous offset (500) -- always changes the condition's actual
 *     truth-table operand.
 *   - Toggle a state condition's `state:` value between two different
 *     literal strings it wasn't already using.
 *   - Flip an and:/or: combinator to the other (or:/and:) -- always
 *     changes boolean semantics whenever the sub-conditions aren't
 *     already identical, which the random generator guarantees in
 *     practice (distinct random leaves).
 *   - Change a service call's `service:` string to a different,
 *     plausible-looking HA service.
 *   - Change a service call's `target.entity_id` to a different entity.
 *
 * For each mutation, valid:true from the corresponding verify function is
 * a genuine SOUNDNESS bug (false positive) -- recorded with full
 * before/after YAML for investigation. A crash (thrown exception) inside
 * a verify call is tracked separately from a false positive, since a
 * verify function crashing on a structurally-still-valid mutated YAML
 * would itself be a robustness bug in the gate, distinct from a soundness
 * one.
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

let rng = mulberry32(24681012);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const chance = (p: number) => rng() < p;

const ENTITIES = ['light.a', 'light.b', 'light.c', 'climate.main', 'switch.x'];
const SENSORS = ['sensor.temp', 'sensor.illuminance', 'sensor.humidity'];
const BINARY_SENSORS = ['binary_sensor.motion', 'binary_sensor.occupancy', 'binary_sensor.door'];
const BOOLEANS = ['input_boolean.a', 'input_boolean.b', 'input_boolean.c'];

let actionCounter = 0;

function randomLeafCondition(): Record<string, unknown> {
  const kind = pick(['state', 'numeric_state', 'numeric_state']);
  if (kind === 'numeric_state') {
    const c: Record<string, unknown> = { condition: 'numeric_state', entity_id: pick(SENSORS) };
    c[pick(['above', 'below'])] = 10 + Math.floor(rng() * 30);
    return c;
  }
  return { condition: 'state', entity_id: pick(BOOLEANS), state: pick(['on', 'off']) };
}

function randomCondition(): Record<string, unknown> {
  if (chance(0.6)) return randomLeafCondition();
  const kind = pick(['and', 'or']);
  const count = 2 + Math.floor(rng() * 2);
  // Dedup by content (round 2, 2026-09-07 -- found via this fuzzer's own
  // first run): with this small a SENSORS/BOOLEANS pool, randomLeafCondition
  // can legitimately roll the exact same leaf twice for the same and/or
  // group by chance. That is NOT a mutation-testing false positive when it
  // happens -- and(A, A), or(A, A), and a lone A are genuinely, truth-
  // table-provably the SAME boolean formula, so a mutation that removes
  // one duplicate copy, or flips and<->or between two duplicate copies,
  // really is behaviorally equivalent and boolExprEquivalent (boolean.ts)
  // is CORRECT to accept it -- confirmed by hand-tracing the very first
  // "false positive" this fuzzer ever reported back to exactly this
  // degenerate shape. That's a fuzzer-generator artifact, not a gate
  // soundness bug, so it's fixed here (at generation time) rather than by
  // special-casing degenerate mutations in collectMutations -- a
  // mutation's "should be rejected" premise is only valid when every leaf
  // in the group is genuinely distinct to begin with.
  const conditions: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  while (conditions.length < count && attempts < 30) {
    attempts++;
    const leaf = randomLeafCondition();
    const key = JSON.stringify(leaf);
    if (seen.has(key)) continue;
    seen.add(key);
    conditions.push(leaf);
  }
  // Pool exhaustion fallback: extremely unlikely at count<=3 against this
  // pool size, but fail safe rather than ever emit a duplicate.
  if (conditions.length < 2) return randomLeafCondition();
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

function randomSequence(depth: number, maxLen = 3): unknown[] {
  const len = 1 + Math.floor(rng() * maxLen);
  const seq: unknown[] = [];
  for (let i = 0; i < len; i++) seq.push(randomStatement(depth));
  return seq;
}

function randomStatement(depth: number): unknown {
  if (depth <= 0) return randomServiceAction();
  // 'parallel' and 'repeat' added (round 3.5, 2026-09-07): the original
  // generator here deliberately excluded both, to keep mutation testing
  // legible while the gate's first-ever soundness fuzz got off the
  // ground -- but that also meant the ONE class of structure this same
  // round's actual code changes touched (topology.ts's loop back-edge /
  // internal-vs-external-convergence handling, YamlParser.ts's repeat
  // body-closing fix) was never exercised by this fuzzer at all. Adding
  // both here, including letting a repeat's own body end in a nested
  // if/parallel/repeat (via the ordinary randomSequence/randomStatement
  // recursion below) -- exactly the shape that was silently mis-wired
  // before this round's parser fix -- so the adversarial mutation testing
  // now covers the surface that actually changed.
  const options = ['action', 'action', 'if', 'choose', 'parallel', 'repeat'];
  const kind = pick(options);
  switch (kind) {
    case 'if': {
      const hasElse = chance(0.7);
      const stmt: Record<string, unknown> = {
        if: [randomCondition()],
        then: randomSequence(depth - 1, 2),
      };
      if (hasElse) stmt.else = randomSequence(depth - 1, 2);
      return stmt;
    }
    case 'choose': {
      const numCases = 1 + Math.floor(rng() * 2);
      const choose = [];
      for (let i = 0; i < numCases; i++) {
        choose.push({ conditions: [randomCondition()], sequence: randomSequence(depth - 1, 2) });
      }
      const stmt: Record<string, unknown> = { choose };
      if (chance(0.6)) stmt.default = randomSequence(depth - 1, 2);
      return stmt;
    }
    case 'parallel': {
      const numBranches = 2 + Math.floor(rng() * 2);
      const branches = Array.from({ length: numBranches }, () => randomSequence(depth - 1, 2));
      return { parallel: branches };
    }
    case 'repeat': {
      const mode = pick(['while', 'until', 'count']);
      const body = randomSequence(depth - 1, 2);
      if (mode === 'count') {
        return { repeat: { count: 1 + Math.floor(rng() * 3), sequence: body } };
      }
      return { repeat: { [mode]: [randomCondition()], sequence: body } };
    }
    default:
      return randomServiceAction();
  }
}

function randomAutomation(seedIdx: number): string {
  const numTriggers = 1 + Math.floor(rng() * 2);
  const triggers = [];
  for (let i = 0; i < numTriggers; i++) {
    triggers.push({ platform: 'state', entity_id: pick(BINARY_SENSORS) });
  }
  const actions = randomSequence(2 + Math.floor(rng() * 2), 3);
  const automation = {
    alias: `Adversarial Fuzz ${seedIdx}`,
    trigger: triggers,
    action: actions,
    mode: 'single',
  };
  return yamlDump(automation, { lineWidth: -1 });
}

// ---- Mutation engine ----

type Mutation = { describe: string; apply: () => boolean };

/** Keys whose array VALUE represents a literal data payload, not a step
 * sequence or a condition list -- must not be treated as a "remove one
 * step" candidate (e.g. a list value inside `data:` for a specific
 * service call, which has no sequential-step semantics at all). */
const NON_SEQUENCE_ARRAY_KEYS = new Set(['entity_id', 'area_id', 'device_id']);

function collectMutations(root: unknown): Mutation[] {
  const mutations: Mutation[] = [];

  function walk(node: unknown, parentKey: string | undefined): void {
    if (Array.isArray(node)) {
      if (node.length >= 2 && !(parentKey && NON_SEQUENCE_ARRAY_KEYS.has(parentKey))) {
        for (let i = 0; i < node.length; i++) {
          const idx = i;
          mutations.push({
            describe: `remove item ${idx} from array under "${parentKey}" (len ${node.length})`,
            apply: () => {
              node.splice(idx, 1);
              return true;
            },
          });
        }
      }
      for (const item of node) walk(item, parentKey);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;

      if (obj.repeat && typeof obj.repeat === 'object') {
        const repeatObj = obj.repeat as Record<string, unknown>;
        if (typeof repeatObj.count === 'number') {
          mutations.push({
            describe: `bump repeat.count by 3`,
            apply: () => {
              repeatObj.count = (repeatObj.count as number) + 3;
              return true;
            },
          });
        }
      }
      if (obj.condition === 'numeric_state') {
        for (const boundKey of ['above', 'below'] as const) {
          if (typeof obj[boundKey] === 'number') {
            mutations.push({
              describe: `bump numeric_state.${boundKey} by 500`,
              apply: () => {
                obj[boundKey] = (obj[boundKey] as number) + 500;
                return true;
              },
            });
          }
        }
      }
      if (obj.condition === 'state' && typeof obj.state === 'string') {
        const original = obj.state as string;
        const alt = original === 'on' ? 'off' : original === 'off' ? 'on' : `${original}_mutated`;
        mutations.push({
          describe: `toggle state condition: ${original} -> ${alt}`,
          apply: () => {
            obj.state = alt;
            return true;
          },
        });
      }
      if (obj.condition === 'and' || obj.condition === 'or') {
        const flipped = obj.condition === 'and' ? 'or' : 'and';
        mutations.push({
          describe: `flip ${obj.condition}: -> ${flipped}:`,
          apply: () => {
            obj.condition = flipped;
            return true;
          },
        });
      }
      if (typeof obj.service === 'string') {
        const original = obj.service as string;
        const candidates = [
          'light.turn_on',
          'light.turn_off',
          'climate.set_hvac_mode',
          'notify.notify',
          'switch.toggle',
        ].filter((s) => s !== original);
        mutations.push({
          describe: `change service ${original} -> ${candidates[0]}`,
          apply: () => {
            obj.service = candidates[0];
            return true;
          },
        });
        const target = obj.target as Record<string, unknown> | undefined;
        if (target && typeof target.entity_id === 'string') {
          const originalEntity = target.entity_id as string;
          const altEntities = ENTITIES.filter((e) => e !== originalEntity);
          mutations.push({
            describe: `change target.entity_id ${originalEntity} -> ${altEntities[0]}`,
            apply: () => {
              target.entity_id = altEntities[0];
              return true;
            },
          });
        }
      }

      for (const [key, value] of Object.entries(obj)) {
        // `_circuitry_metadata` is Circuitry's own bookkeeping (canvas
        // positions, and for state-machine output the fan-out and marker
        // hints the decompiler uses). HA never runs it, so a change there
        // is not a behavior change the gate should catch.
        if (key === '_circuitry_metadata') continue;
        walk(value, key);
      }
    }
  }

  walk(root, undefined);
  return mutations;
}

describe('FUZZ: verification gate adversarial soundness (maximal integration stress test, round 3)', () => {
  const transpiler = new FlowTranspiler();
  const parser = new YamlParser();

  it(
    'mutation-tests verifyNativeOutput/verifyStateMachineOutput for false positives',
    async () => {
    const N = 1000;
    const MUTATIONS_PER_GRAPH = 5;

    const falsePositives: string[] = [];
    const crashes: string[] = [];
    const baselineFailures: string[] = [];
    let totalMutationsTried = 0;
    let totalGraphsUsable = 0;
    let parseFailCount = 0;
    let transpileFailCount = 0;
    const transpileFailReasons: string[] = [];

    for (let i = 0; i < N; i++) {
      actionCounter = 0;
      const y = randomAutomation(i);
      const parsed = await parser.parse(y);
      if (!parsed.success || !parsed.graph) {
        parseFailCount++;
        continue;
      }
      const graph = parsed.graph;

      let result;
      try {
        result = transpiler.transpile(graph);
      } catch (e) {
        crashes.push(`[${i}] transpile THREW: ${e instanceof Error ? e.stack : e}`);
        continue;
      }
      if (!result.success || !result.yaml) {
        transpileFailCount++;
        if (transpileFailReasons.length < 5) {
          transpileFailReasons.push(`[${i}] ${JSON.stringify((result as { errors?: unknown }).errors ?? result)}`.slice(0, 300));
        }
        continue;
      }

      const isStateMachine = result.yaml.includes('current_node');
      const verifyFn = isStateMachine ? verifyStateMachineOutput : verifyNativeOutput;

      // Sanity check: the real, unmutated output must itself verify as
      // valid -- if this ever fails, transpile() has a contract violation
      // (it should never return success:true without the output already
      // having passed this exact check), which would invalidate every
      // mutation result below, so it's tracked and reported separately.
      let baseline: { valid: boolean; reason?: string };
      try {
        baseline = verifyFn(graph, result.yaml);
      } catch (e) {
        crashes.push(`[${i}] baseline verify THREW: ${e instanceof Error ? e.stack : e}`);
        continue;
      }
      if (!baseline.valid) {
        baselineFailures.push(
          `[${i}] transpile() returned success:true but its own output fails ${isStateMachine ? 'verifyStateMachineOutput' : 'verifyNativeOutput'}: ${baseline.reason}\nYAML:\n${result.yaml}`
        );
        continue;
      }

      totalGraphsUsable++;

      let parsedYamlObj: unknown;
      try {
        parsedYamlObj = yamlLoad(result.yaml);
      } catch {
        continue;
      }

      const mutations = collectMutations(parsedYamlObj);
      if (mutations.length === 0) continue;

      // Try up to MUTATIONS_PER_GRAPH distinct random mutations for this graph.
      const tried = new Set<number>();
      const attempts = Math.min(MUTATIONS_PER_GRAPH, mutations.length);
      for (let m = 0; m < attempts; m++) {
        let idx = Math.floor(rng() * mutations.length);
        let guard = 0;
        while (tried.has(idx) && guard < mutations.length) {
          idx = (idx + 1) % mutations.length;
          guard++;
        }
        tried.add(idx);

        const mutation = mutations[idx];
        const clone = JSON.parse(JSON.stringify(parsedYamlObj));
        // Re-collect mutations against the CLONE so `apply()` mutates the
        // clone, not the shared parsedYamlObj (collectMutations closes
        // over whatever object it walked).
        const cloneMutations = collectMutations(clone);
        if (idx >= cloneMutations.length) continue;
        const applied = cloneMutations[idx].apply();
        if (!applied) continue;

        let mutatedYaml: string;
        try {
          mutatedYaml = yamlDump(clone, { lineWidth: -1 });
        } catch {
          continue;
        }

        totalMutationsTried++;
        let verdict: { valid: boolean; reason?: string };
        try {
          verdict = verifyFn(graph, mutatedYaml);
        } catch (e) {
          crashes.push(
            `[${i}] verify THREW on mutation "${mutation.describe}": ${e instanceof Error ? e.stack : e}\nOriginal YAML:\n${result.yaml}\nMutated YAML:\n${mutatedYaml}`
          );
          continue;
        }
        if (verdict.valid) {
          falsePositives.push(
            `[${i}] FALSE POSITIVE (${isStateMachine ? 'state-machine' : 'native'}) -- mutation "${mutation.describe}" was accepted as equivalent.\nOriginal (correct) YAML:\n${result.yaml}\nMutated (should-be-rejected) YAML:\n${mutatedYaml}`
          );
        }
      }
    }

    console.log('=== VERIFICATION GATE ADVERSARIAL FUZZ SUMMARY ===');
    console.log(
      `N=${N} usableGraphs=${totalGraphsUsable} mutationsTried=${totalMutationsTried} falsePositives=${falsePositives.length} crashes=${crashes.length} baselineFailures=${baselineFailures.length} parseFailCount=${parseFailCount} transpileFailCount=${transpileFailCount}`
    );
    if (transpileFailReasons.length > 0) {
      console.log('=== SAMPLE TRANSPILE FAILURE REASONS ===');
      console.log(transpileFailReasons.join('\n---\n'));
    }
    if (baselineFailures.length > 0) {
      console.log('=== BASELINE FAILURES (transpile succeeded but own output fails its own gate) ===');
      console.log(baselineFailures.slice(0, 3).join('\n---\n'));
    }
    if (crashes.length > 0) {
      console.log('=== CRASHES ===');
      console.log(crashes.slice(0, 5).join('\n---\n'));
    }
    if (falsePositives.length > 0) {
      console.log('=== FALSE POSITIVES (soundness bugs) ===');
      console.log(falsePositives.slice(0, 10).join('\n---\n'));
    }

    expect(baselineFailures, baselineFailures.slice(0, 3).join('\n---\n')).toHaveLength(0);
    expect(crashes, crashes.slice(0, 3).join('\n---\n')).toHaveLength(0);
    expect(falsePositives, falsePositives.slice(0, 5).join('\n---\n')).toHaveLength(0);
    },
    120000
  );
});
