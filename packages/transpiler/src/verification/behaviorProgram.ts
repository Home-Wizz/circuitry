import { type BoolExpr, boolExprEquivalent, normalizeAtomicCondition } from './boolean';

/**
 * A "behavior program": what an automation actually DOES, expressed at the
 * level of Home Assistant's own execution grammar (sequential steps,
 * if/then/else, parallel, repeat) with every combinator condition
 * (and/or/not) already reduced to a BoolExpr (see boolean.ts) rather than
 * left as nested condition objects -- so two programs that differ only in
 * how NativeStrategy chose to *group* the same underlying conditions (one
 * `and:` vs. two chained ifs; a `choose:` chain vs. nested if/else; two
 * condition nodes converging into one `or:`; a leading condition promoted
 * to the automation's root `conditions:` block) compare as identical
 * programs. This is intentionally NOT a 1:1 mirror of native.ts's own
 * shape-recognition code (choose-chain detection, OR-pattern detection,
 * leading-condition promotion, ...): see extractFromGraph.ts and
 * extractFromYaml.ts's own doc comments for why each side is built
 * independently from HA's documented execution grammar instead.
 *
 * `alias` and `enabled: true` never appear on a BStep -- both are
 * documented by HA as non-behavioral (a trace/log label, and the schema
 * default respectively) and are stripped by whichever extractor produces
 * the step. `enabled: false` DOES appear (a disabled step is skipped at
 * runtime, so it is behavioral) and `continue_on_error` DOES appear
 * (changes whether a failure aborts the rest of the sequence).
 */
export type BProgram = BStep[];

export type BStep =
  | { k: 'action'; call: Record<string, unknown> }
  | { k: 'if'; cond: BoolExpr; then: BProgram; else: BProgram }
  | { k: 'parallel'; branches: BProgram[] }
  | {
      k: 'repeat';
      mode: 'while' | 'until' | 'count';
      test?: BoolExpr; // while/until
      count?: string; // count -- normalized to a string so `5` and `"5"` compare equal
      body: BProgram;
    };

export interface CompareResult {
  equal: boolean;
  /** Human-readable path + explanation of the first mismatch found, e.g. `actions[2].then[0]: ...`. */
  reason?: string;
}

/** Deep-equality for a normalized action-call payload (plain JSON-shaped data, no BoolExpr inside). */
function actionCallEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Tries every way of pairing up two equal-length lists of branch programs
 * (parallel branches have no meaningful order -- HA runs them
 * concurrently) and accepts if ANY pairing makes every matched pair
 * equal. Branch counts in real automations are small (checked against the
 * fixture suite -- never more than a handful in one `parallel:` block), so
 * trying all permutations is cheap; this is the same "exact, not
 * heuristic" preference as boolean.ts's truth-table approach, applied to
 * branch identity instead of condition identity.
 */
function branchesEquivalent(a: BProgram[], b: BProgram[]): CompareResult {
  if (a.length !== b.length) {
    return { equal: false, reason: `parallel branch count changed: ${a.length} -> ${b.length}` };
  }
  const n = a.length;
  const usedB = new Array<boolean>(n).fill(false);

  function tryMatch(i: number): boolean {
    if (i === n) return true;
    for (let j = 0; j < n; j++) {
      if (usedB[j]) continue;
      if (programsEquivalent(a[i], b[j]).equal) {
        usedB[j] = true;
        if (tryMatch(i + 1)) return true;
        usedB[j] = false;
      }
    }
    return false;
  }

  if (tryMatch(0)) return { equal: true };
  return {
    equal: false,
    reason: `no way to match up the ${n} parallel branch(es) between original and candidate`,
  };
}

/**
 * Structural equivalence of two behavior programs. Sequential steps must
 * match in order (HA runs a `sequence:`/`actions:` list strictly in
 * order); parallel branches match as a set (see branchesEquivalent);
 * if/repeat conditions match by exact boolean-logical equivalence (see
 * boolean.ts), not textual/structural equality, so a same-meaning
 * regrouping of and/or/not never produces a false mismatch.
 *
 * Both inputs are run through normalizeProgram first (see its doc comment)
 * -- structural step-by-step comparison alone isn't enough to recognize
 * NativeStrategy's AND-chain folding (two sequential single-path
 * conditions collapsed into one `if:` with an implicit-AND array):
 * `if(c1) then=[if(c2) then=T else=E] else=E` and `if(c1 AND c2) then=T
 * else=E` are two different TREE SHAPES for the exact same behavior, and
 * no amount of leaf-condition-equivalence checking alone can see that
 * without first rebalancing the tree the same way.
 */
export function programsEquivalent(a: BProgram, b: BProgram, path = 'root'): CompareResult {
  const na = normalizeProgram(a);
  const nb = normalizeProgram(b);
  if (na.length !== nb.length) {
    return {
      equal: false,
      reason: `${path}: step count changed (${na.length} -> ${nb.length})`,
    };
  }
  for (let i = 0; i < na.length; i++) {
    const stepPath = `${path}[${i}]`;
    const r = stepEquivalent(na[i], nb[i], stepPath);
    if (!r.equal) return r;
  }
  return { equal: true };
}

/**
 * Rebalances a program so that a nested-if-with-matching-else collapses
 * into one if with an AND-combined condition -- the tree-shape counterpart
 * to boolean.ts's leaf-level and/or/not normalization. Applied recursively
 * (into then/else/repeat bodies/parallel branches) and repeatedly at each
 * level (a 3+ condition AND-chain folds one level at a time), so a chain
 * of any length collapses to a single if with all conditions ANDed
 * together, matching what NativeStrategy's own AND-chain builder produces
 * in one step.
 *
 * The "matching else" check (canonicalProgramKey equality) is a plain
 * structural comparison, not a full recursive behavioral-equivalence
 * check -- deliberately conservative: failing to recognize a valid fold
 * only costs a spurious StateMachineStrategy fallback (never a missed
 * real mismatch), consistent with this gate's "biased toward false
 * positives over false negatives" rule (see verifyNativeOutput.ts).
 */
export function normalizeProgram(program: BProgram): BProgram {
  let result = dropNoOpSteps(program.map(normalizeStep));

  // Factor out a common trailing continuation that both branches of an
  // `if` step share, splitting it back out into sibling steps that follow
  // the (now shorter) if -- the array-level counterpart to normalizeStep's
  // per-step folding above. extractFromYaml.ts's parseActionSequence (and
  // its desugarChoose helper) deliberately thread "the rest of the
  // sequence" into *every* branch a step creates, mirroring how HA falls
  // through to the next action regardless of which branch ran; native.ts,
  // by contrast, renders a trailing action after an `if:`/`choose:` block
  // as a separate subsequent top-level step, which extractFromGraph.ts
  // preserves as-is. Both are the exact same behavior -- "run this branch,
  // then unconditionally run the rest" -- just encoded as nested-with-
  // duplication vs. flat-with-a-sibling. Left unhandled, that came through
  // as a false `step count changed (2 -> 1)` mismatch the first time the
  // verification gate was wired into FlowTranspiler and exercised a
  // multi-trigger automation (found 2026-09-06). The suffix match is exact
  // structural equality (canonicalProgramKey), not a full recursive
  // behavioral check -- same deliberately-conservative tradeoff as the
  // AND-chain fold above: missing a valid factor only costs a spurious
  // fallback, never a false accept.
  let changed = true;
  while (changed) {
    changed = false;
    const next: BProgram = [];
    for (const step of result) {
      if (step.k === 'if') {
        const n = commonSuffixLength(step.then, step.else);
        if (n > 0) {
          const suffix = step.then.slice(step.then.length - n);
          const then = step.then.slice(0, step.then.length - n);
          const elseProgram = step.else.slice(0, step.else.length - n);
          // Re-run the per-step fold on the trimmed if -- removing the
          // shared suffix can expose a new AND-fold/swap opportunity (e.g.
          // `then` becomes empty).
          next.push(normalizeStep({ k: 'if', cond: step.cond, then, else: elseProgram }), ...suffix);
          changed = true;
          continue;
        }
      }
      next.push(step);
    }
    result = dropNoOpSteps(next);
  }

  return result;
}

/**
 * Phase 5 (2026-09-26): steps that do nothing, whichever way they go. An
 * `if` with nothing in either branch only evaluates a condition (HA
 * conditions have no side effects); a `parallel` whose every branch is
 * empty runs nothing. Such steps appear once disabled steps are dropped
 * (extractFromYaml.ts/extractFromGraph.ts): HA's disabled if-block and a
 * graph's if whose contents are each disabled are the same no-op. Empty
 * parallel branches are dropped too. Loops are left alone: an empty `while`
 * still spins until its condition changes.
 */
function dropNoOpSteps(program: BProgram): BProgram {
  const out: BProgram = [];
  for (const step of program) {
    if (step.k === 'if' && step.then.length === 0 && step.else.length === 0) continue;
    if (step.k === 'parallel') {
      const branches = step.branches.filter((b) => b.length > 0);
      if (branches.length === 0) continue;
      out.push(branches.length === step.branches.length ? step : { k: 'parallel', branches });
      continue;
    }
    out.push(step);
  }
  return out;
}

/**
 * How many trailing elements of `a` and `b` are structurally identical
 * (via canonicalProgramKey), scanning from the end and stopping at the
 * first mismatch or the shorter array's length. Used only to decide
 * whether normalizeProgram's continuation-factoring applies.
 */
function commonSuffixLength(a: BProgram, b: BProgram): number {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    canonicalProgramKey(a[a.length - 1 - n]) === canonicalProgramKey(b[b.length - 1 - n])
  ) {
    n++;
  }
  return n;
}

function normalizeStep(step: BStep): BStep {
  if (step.k === 'if') {
    let then = normalizeProgram(step.then);
    let elseProgram = normalizeProgram(step.else);
    let cond = step.cond;

    // Run the AND-chain fold and the then/else swap (see each block's own
    // comment) to a FIXED POINT, not just once each in sequence -- a swap
    // can expose a new fold opportunity (an inverted bare condition, once
    // swapped, may now have the same else as its own parent) and, in
    // principle, a fold could expose a new swap opportunity too. A chain
    // that mixes true-only and false-only condition nodes (e.g. a
    // false-handle-only condition immediately followed by a true-handle-
    // only one) needs BOTH transformations interleaved to reach the same
    // canonical shape NativeStrategy's root-conditions promotion produces in
    // one step -- doing each exactly once was found (via the pre-existing
    // "root conditions promotion" test suite, once the verification gate
    // was wired into FlowTranspiler and started flagging real mismatches)
    // to under-fold exactly that mixed-chain case. Termination: each
    // iteration either strictly reduces nesting depth (a fold) or strictly
    // moves content from else into then while zeroing else (a swap) on a
    // finite tree, so this cannot loop forever.
    let changed = true;
    while (changed) {
      changed = false;

      while (
        then.length === 1 &&
        then[0].k === 'if' &&
        canonicalProgramKey(then[0].else) === canonicalProgramKey(elseProgram)
      ) {
        const inner = then[0];
        cond = { op: 'and', args: [cond, inner.cond] };
        then = inner.then;
        changed = true;
      }

      // Canonicalize "if C then [] else B" (B non-empty) into "if NOT C then
      // B else []" -- a plain boolean identity, not a NativeStrategy shaping
      // choice: the two are behaviorally identical (when C is false-branch-
      // only content, negating C and swapping the branches changes nothing
      // about what runs when). NativeStrategy is free to either keep a
      // condition as-is with an empty true-branch, or invert it and swap
      // branches so the real content lands in `then` -- both extractors'
      // natural encodings of "gate the rest of the sequence on a condition"
      // need to compare equal regardless of which shape either one happens
      // to produce.
      if (then.length === 0 && elseProgram.length > 0) {
        cond = { op: 'not', arg: cond };
        then = elseProgram;
        elseProgram = [];
        changed = true;
      }
    }

    return { k: 'if', cond, then, else: elseProgram };
  }
  if (step.k === 'parallel') {
    return { k: 'parallel', branches: step.branches.map(normalizeProgram) };
  }
  if (step.k === 'repeat') {
    return { ...step, body: normalizeProgram(step.body) };
  }
  return step;
}

/** Canonical JSON key for a (sub-)program, with and/or argument order
 * normalized (sorted) so two structurally-equivalent-but-reordered ASTs
 * produce the identical key -- used only to decide whether normalizeStep's
 * AND-fold applies, not as the final equivalence check (that's
 * boolExprEquivalent's exact truth-table comparison). */
function canonicalProgramKey(value: unknown): string {
  return JSON.stringify(canonicalizeForKey(value));
}

function canonicalizeForKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForKey);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ((obj.op === 'and' || obj.op === 'or') && Array.isArray(obj.args)) {
      const args = obj.args.map(canonicalizeForKey);
      args.sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : JSON.stringify(x) > JSON.stringify(y) ? 1 : 0));
      return { op: obj.op, args };
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = canonicalizeForKey(obj[key]);
    return out;
  }
  return value;
}

function stepEquivalent(a: BStep, b: BStep, path: string): CompareResult {
  if (a.k !== b.k) {
    return { equal: false, reason: `${path}: step kind changed ("${a.k}" -> "${b.k}")` };
  }

  if (a.k === 'action' && b.k === 'action') {
    if (!actionCallEqual(a.call, b.call)) {
      return {
        equal: false,
        reason: `${path}: action content changed: ${JSON.stringify(a.call)} -> ${JSON.stringify(b.call)}`,
      };
    }
    return { equal: true };
  }

  if (a.k === 'if' && b.k === 'if') {
    const condCheck = boolExprEquivalent(a.cond, b.cond);
    if (!condCheck.equivalent) {
      return { equal: false, reason: `${path}.cond: ${condCheck.reason}` };
    }
    const thenCheck = programsEquivalent(a.then, b.then, `${path}.then`);
    if (!thenCheck.equal) return thenCheck;
    return programsEquivalent(a.else, b.else, `${path}.else`);
  }

  if (a.k === 'parallel' && b.k === 'parallel') {
    const r = branchesEquivalent(a.branches, b.branches);
    if (!r.equal) return { equal: false, reason: `${path}: ${r.reason}` };
    return { equal: true };
  }

  if (a.k === 'repeat' && b.k === 'repeat') {
    if (a.mode !== b.mode) {
      return { equal: false, reason: `${path}: repeat mode changed ("${a.mode}" -> "${b.mode}")` };
    }
    if (a.mode === 'count') {
      if (a.count !== b.count) {
        return { equal: false, reason: `${path}: repeat count changed (${a.count} -> ${b.count})` };
      }
    } else {
      const testCheck = boolExprEquivalent(a.test!, b.test!);
      if (!testCheck.equivalent) {
        return { equal: false, reason: `${path}.test: ${testCheck.reason}` };
      }
    }
    return programsEquivalent(a.body, b.body, `${path}.body`);
  }

  return { equal: false, reason: `${path}: unreachable step kind mismatch` };
}

/**
 * Normalizes an action-family step's data into the plain-JSON shape
 * compared by actionCallEqual: strips Circuitry-internal (`_`-prefixed)
 * fields, drops `alias` (cosmetic, see this file's top doc comment), drops
 * an `enabled: true` (schema default, behaviorally identical to omitting
 * the field) while keeping `enabled: false` (behavioral -- a disabled step
 * never runs), and recursively sorts keys so property order never causes a
 * false mismatch. Reused identically by extractFromGraph.ts (on a node's
 * `data`) and extractFromYaml.ts (on a parsed action-step object), so both
 * sides normalize a service call/device action/delay/wait/set_variables
 * step exactly the same way.
 */
export function normalizeActionData(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (key === 'alias') continue;
    if (key === 'enabled' && value === true) continue;
    cleaned[key] = value;
  }
  return sortKeysDeep(cleaned) as Record<string, unknown>;
}

export { normalizeAtomicCondition };
