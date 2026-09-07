/**
 * Canonical boolean-equivalence engine for Home Assistant condition objects.
 *
 * Behavioral-equivalence verification (see verifyNativeOutput.ts's doc
 * comment) needs to answer one question exactly: does this condition
 * expression evaluate to the same true/false outcome, for every possible
 * world, as that other condition expression -- regardless of how
 * NativeStrategy chose to *nest* and/or/not wrappers around the same
 * underlying atomic tests (combining sequential single-condition nodes into
 * one `and:`, promoting a false-handle-only condition to `not:`, folding
 * multiple condition nodes that converge into one `or:`, ...). A
 * hand-written set of nesting-rewrite rules (flatten nested and/and,
 * flatten nested or/or, push not() inward, ...) can always miss a
 * rewriting NativeStrategy adds later -- exactly the "ongoing maintenance
 * tax" the maintainer rejected option (a), teach-the-comparator-every-transform, over.
 *
 * A truth table sidesteps that entirely. Two boolean formulas over the same
 * set of underlying yes/no facts (HA's atomic condition types -- state,
 * numeric_state, template, time, zone, sun, device, trigger, ...) are
 * logically identical if and only if they evaluate the same for every
 * possible combination of those underlying facts. That is the actual
 * mathematical definition of boolean-formula equivalence, not an
 * approximation of it, so it needs no maintenance when NativeStrategy's
 * nesting choices change. Automations have realistically small condition
 * counts (the fixture suite's largest boolean expression has well under a
 * dozen atomic leaves), so brute-force truth-table enumeration is cheap.
 *
 * and/or/not's exact semantics below are taken directly from Home
 * Assistant's own implementation
 * (homeassistant/helpers/condition.py -- AndConditionChecker,
 * OrConditionChecker, NotConditionChecker classes on the `dev` branch,
 * checked 2026-09-06), not assumed from memory:
 *   - and: false as soon as any sub-condition is false, else true.
 *   - or: true as soon as any sub-condition is true, else false.
 *   - not: false as soon as any sub-condition is TRUE, else true --
 *     i.e. `not(list)` === `NOT(OR(list))`, NOT `NOT(AND(list))`. This
 *     matches the condition's own doc line, "Passes if all embedded
 *     conditions are not true" (every one of them individually not-true),
 *     not "not all of them are true" (which would allow one to be true).
 *
 * A disabled condition (`enabled: false`) -- of ANY type, including a
 * whole and:/or:/not: group, not just a leaf -- "behaves as if it were
 * removed" (home-assistant.io/docs/scripts/conditions/). Verified this
 * isn't just docs-page prose by reading the actual implementation
 * (2026-09-06): `condition.async_from_config` checks `enabled` generically,
 * before dispatching on condition type, and swaps in a
 * DisabledConditionChecker that always returns `None` (not `True` or
 * `False`) for the whole config. That `None` then flows into whichever
 * combinator holds it: AndConditionChecker/`_test_conditions` (used
 * identically for and:'s own list AND for every implicit-AND list HA
 * coerces a bare condition/if:/while:/until: value into) only fails on a
 * sub-result `is False` -- `None` never triggers that, so a disabled
 * member can never make an AND-context list false, exactly as if it had
 * been deleted from the list (i.e. `const:true`). OrConditionChecker only
 * succeeds on a sub-result `is True` -- `None` never triggers that either,
 * so a disabled member can never make an OR-context list (or not:'s own
 * inner OR list) true, exactly as if deleted from that list (i.e.
 * `const:false`). This is why `parseConditionExpr` below takes a `context`
 * parameter: the correct constant a disabled condition collapses to is
 * always the identity element of whichever list it's embedded in.
 */

export type BoolExpr =
  | { op: 'leaf'; key: string }
  | { op: 'and'; args: BoolExpr[] }
  | { op: 'or'; args: BoolExpr[] }
  | { op: 'not'; arg: BoolExpr }
  | { op: 'const'; value: boolean };

/**
 * Strips Circuitry-internal (`_`-prefixed) and purely-cosmetic (`alias`,
 * and an explicit `enabled: true`) fields from a raw HA condition object,
 * recursively sorts every object's keys, and normalizes an `id` field's
 * single-element-array form down to a scalar (mirrors NativeStrategy's own
 * mapCondition id-normalization -- HA's trigger-condition `id` can
 * round-trip as either shape and both mean the same thing). `alias` is
 * dropped because HA documents it purely as a human-readable trace/log
 * label with no effect on evaluation. `enabled: true` is dropped because
 * it's behaviorally identical to `enabled` being absent -- HA's own check
 * is `if not enabled:` (see this file's top doc comment), so only a
 * literal `false` does anything; a bare `enabled: false` never reaches
 * this function at all any more (parseConditionExpr intercepts it before
 * ever building a leaf), and a non-boolean `enabled` (e.g. a template
 * string) is deliberately left in place, since its exact value IS
 * behaviorally significant and can't be resolved statically. Without this,
 * two otherwise-identical conditions that differ only in whether `enabled:
 * true` was written out explicitly would compare as different leaves --
 * the exact same class of false-mismatch `alias`-stripping already exists
 * to prevent.
 *
 * The result is a stable JSON string used as a leaf's identity: two leaf
 * conditions compare as the same underlying fact if and only if this
 * normalization produces byte-identical output for both.
 */
export function normalizeAtomicCondition(value: unknown): string {
  return JSON.stringify(sortForCompare(stripCosmeticFields(value)));
}

function stripCosmeticFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripCosmeticFields);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key, v]) => key !== 'alias' && !key.startsWith('_') && !(key === 'enabled' && v === true)
    );
    const out: Record<string, unknown> = {};
    for (const [key, v] of entries) {
      if (key === 'id' && Array.isArray(v) && v.length === 1) {
        out[key] = v[0];
      } else {
        out[key] = stripCosmeticFields(v);
      }
    }
    return out;
  }
  return value;
}

function sortForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForCompare);
  }
  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = sortForCompare((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Parses a raw HA "conditions" value -- a single condition object, a bare
 * template-shorthand string, or an array (HA's own implicit-AND shorthand
 * for a list of conditions, used by `conditions:`, `if:`, `while:`,
 * `until:`, and a `choose` case's own `conditions:`) -- into a BoolExpr.
 * `and`/`or`/`not` recurse into their own nested `conditions:` list;
 * everything else (state, numeric_state, template, time, zone, sun,
 * device, trigger, ...) is an atomic leaf, identified by
 * normalizeAtomicCondition.
 *
 * `context` says which kind of list `raw` is currently a member of --
 * `'and'` for a conjunctive list (an implicit-AND list, or and:'s own
 * `conditions:`) or `'or'` for a disjunctive one (or:'s own `conditions:`,
 * or not:'s own `conditions:`, since not(list) === NOT(OR(list))). Every
 * caller outside this file calls with the default: a bare condition node,
 * or a raw `if:`/`while:`/`until:`/`condition:`/choose-case-`conditions:`
 * value, is always itself an implicit-AND context (see this file's top
 * doc comment for why a bare single condition is no different here --
 * HA's own `_test_conditions` combinator treats it exactly like a
 * one-element AND list). Only this function's own and:/or:/not: recursion
 * ever passes a non-default context, to the direct members of that
 * group's own `conditions:` list.
 */
export function parseConditionExpr(raw: unknown, context: 'and' | 'or' = 'and'): BoolExpr {
  if (raw === undefined || raw === null) {
    // No condition at all passes trivially -- matches HA's own behavior for
    // an empty/absent conditions list (nothing to gate on).
    return { op: 'const', value: true };
  }
  if (typeof raw === 'string') {
    // Bare-template shorthand: a `conditions:`/`if:` entry can be a plain
    // template string instead of a `condition: template` object.
    return { op: 'leaf', key: normalizeAtomicCondition({ condition: 'template', value_template: raw }) };
  }
  if (Array.isArray(raw)) {
    if (raw.length === 1) return parseConditionExpr(raw[0], context);
    // A bare array is HA's own implicit-AND shorthand -- its members are
    // always an AND list regardless of the context this array itself sits
    // in (that context only matters for how this whole array, if it were
    // disabled, would collapse -- see the `enabled` check below, which
    // this array-of-conditions shape can't carry itself since `enabled`
    // only ever appears on a condition *object*, never in the array
    // shorthand).
    return { op: 'and', args: raw.map((r) => parseConditionExpr(r, 'and')) };
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;

    // A disabled condition -- of ANY type, including a whole and:/or:/not:
    // group, not just a leaf -- "behaves as if it were removed" (see this
    // file's top doc comment for the full source-verified reasoning).
    // Checked generically here, before dispatching on condition type,
    // matching HA's own async_from_config order. Only a literal `false`
    // disables (a template-valued `enabled` can't be resolved statically,
    // so it's left as an ordinary, unresolved leaf field instead -- see
    // normalizeAtomicCondition's doc comment).
    if (obj.enabled === false) {
      return { op: 'const', value: context === 'and' };
    }

    const type = obj.condition;
    if (type === 'and') {
      return { op: 'and', args: asArray(obj.conditions).map((c) => parseConditionExpr(c, 'and')) };
    }
    if (type === 'or') {
      return { op: 'or', args: asArray(obj.conditions).map((c) => parseConditionExpr(c, 'or')) };
    }
    if (type === 'not') {
      // See doc comment above: not(list) === NOT(OR(list)), per HA's own
      // NotConditionChecker source, not NOT(AND(list)) -- so a disabled
      // member of not:'s own list collapses the same way an or:'s does.
      return {
        op: 'not',
        arg: { op: 'or', args: asArray(obj.conditions).map((c) => parseConditionExpr(c, 'or')) },
      };
    }
    return { op: 'leaf', key: normalizeAtomicCondition(obj) };
  }
  return { op: 'const', value: true };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

/** Every distinct leaf key referenced anywhere in the expression. */
export function collectLeafKeys(expr: BoolExpr, out: Set<string> = new Set()): Set<string> {
  switch (expr.op) {
    case 'leaf':
      out.add(expr.key);
      return out;
    case 'not':
      return collectLeafKeys(expr.arg, out);
    case 'and':
    case 'or':
      for (const arg of expr.args) collectLeafKeys(arg, out);
      return out;
    case 'const':
      return out;
  }
}

function evalExpr(expr: BoolExpr, assignment: ReadonlyMap<string, boolean>): boolean {
  switch (expr.op) {
    case 'const':
      return expr.value;
    case 'leaf':
      // A leaf key absent from the assignment can only happen when it
      // appears on just one side of a comparison (the two expressions
      // reference genuinely different underlying facts) -- assignment
      // always covers the union of both sides' leaves, so this is only
      // reached for a key that truly isn't in either formula's own
      // variable set, which can't happen given how callers build it.
      return assignment.get(expr.key) ?? false;
    case 'not':
      return !evalExpr(expr.arg, assignment);
    case 'and':
      return expr.args.every((a) => evalExpr(a, assignment));
    case 'or':
      return expr.args.some((a) => evalExpr(a, assignment));
  }
}

/** Above this many distinct leaves, brute-force truth-table enumeration
 * (2^N rows) stops being "cheap" -- no real automation has come close to
 * this in the fixture suite, so hitting it is itself a signal something
 * unexpected is going on, and the caller treats it as inconclusive
 * (verification fails closed -- see verifyNativeOutput's "biased toward
 * false positives over false negatives" rule). */
export const MAX_TRUTH_TABLE_LEAVES = 20;

export interface BoolCompareResult {
  equivalent: boolean;
  reason?: string;
}

/**
 * Exact logical equivalence of two boolean expressions, by brute-force
 * truth table over the union of both expressions' leaf conditions. Two
 * expressions are equivalent if and only if every assignment of the shared
 * leaves produces the same result for both -- including an assignment that
 * sets a leaf appearing in only one expression, which is exactly how a
 * real behavioral difference (one side checking a condition the other
 * doesn't) gets caught: that leaf being true in one world and not
 * mattering to the other side will produce a mismatched pair of outcomes
 * for some row, unless it truly is logically redundant.
 */
export function boolExprEquivalent(a: BoolExpr, b: BoolExpr): BoolCompareResult {
  const leaves = [...new Set([...collectLeafKeys(a), ...collectLeafKeys(b)])];

  if (leaves.length > MAX_TRUTH_TABLE_LEAVES) {
    return {
      equivalent: false,
      reason: `too many distinct conditions (${leaves.length}) to verify exhaustively -- failing closed`,
    };
  }

  const rows = 1 << leaves.length;
  for (let row = 0; row < rows; row++) {
    const assignment = new Map<string, boolean>();
    for (let i = 0; i < leaves.length; i++) {
      assignment.set(leaves[i], (row & (1 << i)) !== 0);
    }
    const av = evalExpr(a, assignment);
    const bv = evalExpr(b, assignment);
    if (av !== bv) {
      const world = leaves.map((l, i) => `${l}=${(row & (1 << i)) !== 0}`).join(', ');
      return {
        equivalent: false,
        reason: `condition expressions diverge when {${world}}: original evaluates to ${av}, candidate to ${bv}`,
      };
    }
  }
  return { equivalent: true };
}
