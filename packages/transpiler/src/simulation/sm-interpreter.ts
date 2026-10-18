import { haBoolean as cvBoolean, haCoerceAutomation } from '@circuitry/shared';
import { load as yamlLoad } from 'js-yaml';

const CONTAINER_KEYS = new Set([
  'sequence',
  'alias',
  'enabled',
  'continue_on_error',
  'note',
  'metadata',
]);

/**
 * A small interpreter for the subset of Home Assistant script YAML that
 * Circuitry emits, so tests can check what a compiled automation actually
 * DOES when run, not just its shape (Phase 4, 2026-09-26). The verification
 * gate compares output against the graph; that can't see a bug where the
 * graph convention and HA's runtime disagree (bug #23: a count loop's
 * state-machine rendering reset its counter every iteration and never
 * finished).
 *
 * Supported: actions/service calls, delay, wait_template / wait_for_trigger
 * (recorded as steps, not waited on), stop, condition steps, variables
 * (literals and `{{ ... }}` with names, numbers, strings,
 * + - < <= > >= == !=, and/or/not; anything else is stored as its raw
 * text), if/then/else, choose/default, repeat (count/while/until), parallel
 * (branches run one after another -- only the set of actions is compared),
 * the automation's own top-level `conditions:`, and and/or/not with HA's
 * disabled-condition rules. Anything else throws, so a test never silently
 * passes on something it didn't understand.
 *
 * Leaf conditions (state, numeric_state, sun, time, zone, a template that
 * reads entity states, ...) are resolved one of two ways:
 * - `{ states }`: evaluated against a fixed map (state / numeric_state only).
 *   An entity missing from the map (or a non-numeric state for
 *   numeric_state) is an error, as in HA, with HA's rules for it (bug #63):
 *   a condition list stops at the first error; and/or/not raise it after
 *   checking the rest; `if`/choose/while/a condition step/the top-level
 *   `conditions:` treat it as false, but `repeat: until` stops the loop.
 * - `{ seed }`: each evaluation of a given condition returns the next value
 *   of a pseudo-random sequence keyed by (seed, that condition's canonical
 *   content, how many times it has been evaluated so far). Two programs
 *   that evaluate the same conditions in the same order see the same
 *   values, and a `while`/`until` loop on a sensor terminates. A template
 *   over variables only (the state machine's `current_node`, a count
 *   loop's counter) is always computed, never randomized.
 */

export interface RunResult {
  /** One entry per executed service call / delay, e.g. `light.turn_on light.a`. */
  trace: string[];
  /** False when `maxSteps` ran out first (almost certainly an infinite loop). */
  finished: boolean;
  /** HA aborted the run: with `haRepeatLimit`, a while/until loop having
   * gone round REPEAT_TERMINATE_ITERATIONS times (#129); or a step failed
   * (#144: a service call whose data isn't a mapping). */
  aborted?: boolean;
}

/** HA's script.py: a `repeat: while/until` aborts the run after this many
 * rounds (a `count` loop has no limit). */
export const REPEAT_TERMINATE_ITERATIONS = 10000;

export interface RuntimeOptions {
  /** Abort the run as HA does when a while/until loop goes round
   * REPEAT_TERMINATE_ITERATIONS times (#129). Off by default: the fuzzers
   * skip runs that don't finish within their step budget instead. */
  haRepeatLimit?: boolean;
}

/**
 * Fixed entity states (optionally with `triggerIdx`, which isn't an entity:
 * entity ids always have a dot), or a seed for random leaf values.
 */
export type Inputs = Record<string, string | number> | { seed: number; triggerIdx?: number };

type Env = { vars: Record<string, unknown> };

export class StepLimit extends Error {}

/** HA's ConditionError: a condition that can't be evaluated. */
class CondError extends Error {}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (key === 'alias' || key.startsWith('_') || (key === 'enabled' && v === true)) continue;
      out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

/** FNV-1a over a string, mapped to [0, 1). */
function hashUnit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 4294967296;
}

export function runAutomation(
  yamlText: string,
  inputs: Inputs = {},
  maxSteps = 5000,
  options: RuntimeOptions = {}
): RunResult {
  return createRuntime(
    // Values HA coerces read as HA reads them (#144).
    haCoerceAutomation(yamlLoad(yamlText) as Record<string, unknown>),
    inputs,
    maxSteps,
    options
  ).run();
}

/** What graph-interpreter.ts runs a graph's steps with: the same leaf
 * semantics (service calls, conditions, variables, errors) as a YAML run. */
export interface Runtime {
  trace: string[];
  /** Counts one step; throws StepLimit past `maxSteps`. */
  tick: () => void;
  /** Runs one HA step (throws StopSignal on `stop`). */
  runStep: (step: Record<string, unknown>) => void;
  /** HA's _test_conditions: true, false, or null when it can't be evaluated. */
  testConditions: (cond: unknown) => boolean | null;
  /** The automation's own run: its top-level conditions, then its actions. */
  run: () => RunResult;
}

export function createRuntime(
  config: Record<string, unknown>,
  inputs: Inputs = {},
  maxSteps = 5000,
  { haRepeatLimit = false }: RuntimeOptions = {}
): Runtime {
  const isSeeded =
    typeof inputs.seed === 'number' &&
    Object.keys(inputs).every((k) => k === 'seed' || k === 'triggerIdx');
  const seed = isSeeded ? (inputs.seed as number) : null;
  const triggerIdx = String((inputs as { triggerIdx?: number }).triggerIdx ?? 0);
  const states = (seed === null ? { ...inputs } : {}) as Record<string, string | number>;
  delete states.triggerIdx;
  const readCounts = new Map<string, number>();
  const trace: string[] = [];
  const topVars = { ...((config.variables as Record<string, unknown>) ?? {}) };
  delete topVars._circuitry_metadata;
  // `trigger.idx` is the index of the trigger that fired, as a string (HA),
  // and `trigger.id` its `id:`, which defaults to that same index.
  const triggerList = (config.triggers ?? config.trigger ?? []) as Record<string, unknown>[];
  const firedTrigger = Array.isArray(triggerList) ? triggerList[Number(triggerIdx)] : undefined;
  const triggerId =
    firedTrigger && firedTrigger.id !== undefined ? String(firedTrigger.id) : triggerIdx;
  const env: Env = { vars: { ...topVars, trigger: { idx: triggerIdx, id: triggerId } } };
  let steps = 0;
  // A parallel branch runs to its own share of the remaining steps, so a
  // branch that loops forever doesn't keep its siblings from running (HA
  // runs them at the same time).
  const branchLimits: number[] = [];

  const tick = () => {
    steps++;
    if (steps > maxSteps) throw new StepLimit();
    if (branchLimits.length > 0 && steps > branchLimits[branchLimits.length - 1]) {
      throw new BranchLimit();
    }
  };

  function evalExpr(expr: string): unknown {
    const tokens =
      expr.match(/"[^"]*"|'[^']*'|\d+(?:\.\d+)?|[A-Za-z_][\w.]*|==|!=|<=|>=|[<>+\-(),[\]]/g) ?? [];
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    function primary(): unknown {
      const t = next();
      if (t === undefined) throw new Error(`template: unexpected end in ${expr}`);
      if (t === '(') {
        const v = orExpr();
        if (next() !== ')') throw new Error(`template: missing ) in ${expr}`);
        return v;
      }
      if (t === 'not') return !truthy(primary());
      // A list literal (the state machine's `pass_nodes + [current_node]`, #129).
      if (t === '[') {
        const items: unknown[] = [];
        while (peek() !== ']') {
          items.push(orExpr());
          if (peek() === ',') next();
          else if (peek() !== ']') throw new Error(`template: expected , or ] in ${expr}`);
        }
        next();
        return items;
      }
      if (/^["']/.test(t)) return t.slice(1, -1);
      if (/^\d/.test(t)) return Number(t);
      if (t === 'true' || t === 'True') return true;
      if (t === 'false' || t === 'False') return false;
      // `is_state('e', 'v')` and `states('e')` read the fixed states (a
      // missing entity: is_state is false, states is 'unknown', as in HA).
      // In seeded mode a template reading states is a random leaf instead.
      if ((t === 'is_state' || t === 'states') && peek() === '(' && seed === null) {
        next();
        const args: unknown[] = [primary()];
        while (peek() === ',') {
          next();
          args.push(primary());
        }
        if (next() !== ')') throw new Error(`template: missing ) in ${expr}`);
        const entity = String(args[0]);
        const value = entity in states ? String(states[entity]) : undefined;
        if (t === 'states') return value ?? 'unknown';
        return value !== undefined && value === String(args[1]);
      }
      let value: unknown = env.vars;
      for (const part of t.split('.')) {
        if (value === null || typeof value !== 'object' || !(part in (value as object))) {
          throw new Error(`template: undefined name ${t}`);
        }
        value = (value as Record<string, unknown>)[part];
      }
      return value;
    }
    function additive(): unknown {
      let v = primary();
      while (peek() === '+' || peek() === '-') {
        const op = next();
        const r = primary();
        if (op === '+' && Array.isArray(v) && Array.isArray(r)) v = [...v, ...r];
        else v = op === '+' ? Number(v) + Number(r) : Number(v) - Number(r);
      }
      return v;
    }
    function comparison(): unknown {
      const l = additive();
      const op = peek();
      if (op === 'in') {
        next();
        const r = additive();
        if (!Array.isArray(r)) throw new Error(`template: \`in\` needs a list in ${expr}`);
        return r.some((x) => String(x) === String(l));
      }
      if (op && ['==', '!=', '<', '<=', '>', '>='].includes(op)) {
        next();
        const r = additive();
        switch (op) {
          case '==':
            return String(l) === String(r);
          case '!=':
            return String(l) !== String(r);
          case '<':
            return Number(l) < Number(r);
          case '<=':
            return Number(l) <= Number(r);
          case '>':
            return Number(l) > Number(r);
          default:
            return Number(l) >= Number(r);
        }
      }
      return l;
    }
    function andExpr(): unknown {
      let v = comparison();
      while (peek() === 'and') {
        next();
        const r = comparison();
        v = truthy(v) && truthy(r);
      }
      return v;
    }
    function orExpr(): unknown {
      let v = andExpr();
      while (peek() === 'or') {
        next();
        const r = andExpr();
        v = truthy(v) || truthy(r);
      }
      return v;
    }
    const result = orExpr();
    if (i !== tokens.length) throw new Error(`template: unsupported syntax in ${expr}`);
    return result;
  }

  function truthy(v: unknown): boolean {
    return (
      v === true ||
      (typeof v === 'number' && v !== 0) ||
      (typeof v === 'string' && v !== '' && v !== 'false')
    );
  }

  /** A template condition passes only when it renders `true`, any case
   * (condition.py, async_template: `value.lower() == "true"`): `1`, `on`,
   * `yes` or `25` don't. The interpreter check found it reading them as
   * true on the schema-generated cases. */
  function templateIsTrue(v: unknown): boolean {
    return String(v).trim().toLowerCase() === 'true';
  }

  /** A template `enabled:` (bug #70): HA renders it with its literals parsed
   * (`True`, `False`, `None`, numbers) and skips the step or condition when
   * the result is falsy (script.py, condition.py: `if not enabled`), so
   * `off` or `no` is a non-empty string and enables it. */
  function isDisabled(item: Record<string, unknown>): boolean {
    if (item.enabled === false) return true;
    if (typeof item.enabled !== 'string') return false;
    const value = renderValue(item.enabled);
    if (typeof value !== 'string') return !value;
    const text = value.trim();
    if (text === 'False' || text === 'None' || text === '') return true;
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text) === 0;
    return text === '[]' || text === '{}' || text === '()';
  }

  /** cv.comp_entity_ids: a list, or a comma-separated string (`all` kept). */
  function entityList(value: unknown): string[] {
    const rendered = renderValue(value);
    if (typeof rendered === 'string') {
      return rendered
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
    }
    return Array.isArray(rendered) ? rendered.flatMap(entityList) : [];
  }

  /** The entity ids a service call targets, joined, or undefined. */
  function callTarget(step: Record<string, unknown>): string | undefined {
    if (step.entity_id !== undefined) return entityList(step.entity_id).join(',');
    const target = renderValue(step.target);
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      const ids = (target as Record<string, unknown>).entity_id;
      if (ids !== undefined) return entityList(ids).join(',');
    }
    const dataIds = (step.data as Record<string, unknown> | undefined)?.entity_id;
    return dataIds === undefined ? undefined : entityList(dataIds).join(',');
  }

  function renderValue(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const whole = value.match(/^\s*\{\{(.*)\}\}\s*$/s);
    if (whole) return evalExpr(whole[1]);
    const ifTemplate = value.match(/^\{%\s*if (.+?)\s*%\}(.*)$/s);
    if (ifTemplate) {
      // `{% if A %}x{% elif B %}y{% else %}z{% endif %}` with plain-text branches.
      const parts = value.split(/\{%\s*(if|elif|else|endif)\s*(.*?)\s*%\}/);
      for (let k = 1; k < parts.length; k += 3) {
        const kw = parts[k];
        const cond = parts[k + 1];
        const text = parts[k + 2];
        if (kw === 'endif') break;
        if (kw === 'else' || truthy(evalExpr(cond))) return text;
      }
      return '';
    }
    if (value.includes('{{') || value.includes('{%'))
      throw new Error(`template: unsupported ${value}`);
    return value;
  }

  /** A seeded leaf's next value -- see the file doc comment. */
  function randomLeaf(c: Record<string, unknown>): boolean {
    const key = JSON.stringify(canonical(c));
    const n = readCounts.get(key) ?? 0;
    readCounts.set(key, n + 1);
    return hashUnit(`${seed}|${key}|${n}`) < 0.5;
  }

  /** true / false, or null for a disabled condition (HA: "as if removed",
   * i.e. the identity of whichever and/or list holds it). */
  /** HA's and/or/not: every member is checked; an error is raised after
   * the rest, unless a member already decided the result. */
  function evalGroup(members: unknown[], decides: (v: boolean | null) => boolean): boolean {
    let failed = false;
    for (const x of members) {
      try {
        if (decides(evalCondition(x))) return true;
      } catch (e) {
        if (!(e instanceof CondError)) throw e;
        failed = true;
      }
    }
    if (failed) throw new CondError();
    return false;
  }

  function evalCondition(cond: unknown): boolean | null {
    // A list stops at the first false, and an error goes straight up.
    if (Array.isArray(cond)) return cond.every((c) => evalCondition(c) !== false);
    if (typeof cond === 'string') return templateIsTrue(renderValue(cond));
    const c = withoutShorthand(cond as Record<string, unknown>);
    if (isDisabled(c)) return null;
    switch (c.condition) {
      case 'and':
        return !evalGroup(asList(c.conditions), (v) => v === false);
      case 'or':
        return evalGroup(asList(c.conditions), (v) => v === true);
      case 'not':
        return !evalGroup(asList(c.conditions), (v) => v === true);
      case 'trigger': {
        // Which trigger fired is an input, not a sensor read: true when its
        // id is one of `id` (a single id or a list; HA).
        const ids = Array.isArray(c.id) ? c.id.map(String) : [String(c.id)];
        return ids.includes(triggerId);
      }
      case 'template': {
        if (
          seed !== null &&
          /states\(|state_attr\(|is_state\(|now\(/.test(String(c.value_template))
        ) {
          return randomLeaf(c);
        }
        if (seed === null) return templateIsTrue(renderValue(c.value_template));
        try {
          return templateIsTrue(renderValue(c.value_template));
        } catch {
          // A template this interpreter can't evaluate (trigger.payload,
          // filters, ...) is an opaque sensor read: a seeded leaf.
          return randomLeaf(c);
        }
      }
      default:
        break;
    }
    if (seed !== null) return randomLeaf(c);
    // Fixed states: only what's modelled here is evaluated; anything else
    // (an attribute, `for:`, `match: any`, a bound given as an entity, a
    // value template) throws, so a check never passes on a reading HA
    // wouldn't make.
    const unmodelled = ['attribute', 'for', 'match', 'value_template'].filter((k) => k in c);
    if (unmodelled.length > 0) {
      throw new Error(`condition not supported with fixed states: ${JSON.stringify(c)}`);
    }
    // HA reads a list of entities as "all of them" (the default `match: all`).
    const entityIds = Array.isArray(c.entity_id) ? c.entity_id.map(String) : [String(c.entity_id)];
    switch (c.condition) {
      case 'state': {
        const wanted = Array.isArray(c.state) ? c.state.map(String) : [String(c.state)];
        return entityIds.every((id) => {
          if (!(id in states)) throw new CondError();
          return wanted.includes(String(states[id]));
        });
      }
      case 'numeric_state': {
        const bound = (b: unknown) => {
          if (b === undefined) return undefined;
          const n = Number(b);
          if (Number.isNaN(n)) {
            throw new Error(`numeric_state bound not supported with fixed states: ${String(b)}`);
          }
          return n;
        };
        const above = bound(c.above);
        const below = bound(c.below);
        return entityIds.every((id) => {
          const v = Number(states[id]);
          if (!(id in states) || Number.isNaN(v)) throw new CondError();
          if (above !== undefined && !(v > above)) return false;
          if (below !== undefined && !(v < below)) return false;
          return true;
        });
      }
      default:
        throw new Error(`condition not supported without a seed: ${JSON.stringify(c)}`);
    }
  }

  /** HA's _test_conditions: true, false, or null when a condition can't be
   * evaluated. */
  function testConditions(cond: unknown): boolean | null {
    try {
      return evalCondition(cond) !== false;
    } catch (e) {
      if (e instanceof CondError) return null;
      throw e;
    }
  }

  function checkCondition(cond: unknown): boolean {
    return testConditions(cond) === true;
  }

  /** The state machine's error guard on an until test (bug #63): an `else:`
   * holding only `if: [{condition: not, conditions: <the same test>}]`,
   * then (false) / else (error). It re-reads the test right away, which HA
   * does within the same step; modelled as the same reading, not a new one
   * (a seeded leaf would otherwise draw its next value). */
  function errorGuardOf(step: Record<string, unknown>): Record<string, unknown> | null {
    const branch = step.else;
    if (!Array.isArray(branch) || branch.length !== 1) return null;
    const guard = branch[0] as Record<string, unknown>;
    const test = Array.isArray(guard?.if) ? guard.if : null;
    if (!test || test.length !== 1) return null;
    const inner = test[0] as Record<string, unknown>;
    if (inner?.condition !== 'not') return null;
    const outer = Array.isArray(step.if) ? step.if : [step.if];
    return JSON.stringify(canonical(inner.conditions)) === JSON.stringify(canonical(outer))
      ? guard
      : null;
  }

  /** HA's `ensure_list`: one item where a list goes is a list of one. */
  const asList = (value: unknown): unknown[] =>
    value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

  /** One list of steps -- the automation's own, an if's or a Choose's
   * branch, a parallel branch, a `sequence:` group, one pass of a loop.
   * HA runs each as a script of its own, and a condition step that doesn't
   * pass ends that script only (script.py: `_ConditionFail` is caught by
   * the sub-script's own run); the steps after the block it sits in still
   * run, and a loop goes on to its next pass. `stop` ends everything. Bug
   * #78: this used to end the whole run. */
  function runSequence(steps: unknown): void {
    try {
      for (const step of asList(steps)) runStep(step as Record<string, unknown>);
    } catch (e) {
      if (!(e instanceof ConditionFail)) throw e;
    }
  }

  function runStep(step: Record<string, unknown>): void {
    tick();
    if (isDisabled(step)) return;
    if ('variables' in step) {
      for (const [k, v] of Object.entries(step.variables as Record<string, unknown>)) {
        try {
          env.vars[k] = renderValue(v);
        } catch {
          env.vars[k] = v; // a template this interpreter can't evaluate: keep its text
        }
      }
      return;
    }
    if ('action' in step || 'service' in step) {
      // As HA prepares the call (helpers/service.py): the service name and
      // the target rendered, a step's own `entity_id:` in place of the
      // target's, entity ids split on commas (cv.comp_entity_ids). Found
      // when the interpreter check first ran the schema-generated cases.
      const service = renderValue(step.action ?? step.service);
      // HA renders `data:`/`data_template:` and refuses a result that isn't a
      // mapping ("Error rendering data template: Result is not a
      // Dictionary", helpers/service.py): the step fails, which ends the run,
      // or with `continue_on_error: true` is passed over (#144's coerced
      // cases, `data: 5`, found the interpreter calling the service).
      // A template this interpreter can't evaluate (a mapping written as
      // one, `{{ {'brightness': 5} }}`) is taken to give a mapping.
      for (const key of ['data', 'data_template'] as const) {
        if (!(key in step) || isMapping(step[key])) continue;
        let rendered: unknown;
        try {
          rendered = renderValue(step[key]);
        } catch {
          continue;
        }
        if (isMapping(rendered)) continue;
        if (step.continue_on_error === true) return;
        throw new ScriptAbort();
      }
      const n = (step.data as Record<string, unknown> | undefined)?._n;
      trace.push([service, callTarget(step), n].filter((x) => x !== undefined).join(' '));
      return;
    }
    if ('delay' in step) {
      trace.push(`delay ${JSON.stringify(step.delay)}`);
      return;
    }
    // Other leaf steps that only do something: a device action, firing an
    // event, a conversation response, a scene. Recorded whole, so any
    // change to their content shows up.
    const isDeviceAction =
      'device_id' in step && 'domain' in step && 'type' in step && !('condition' in step);
    if (
      isDeviceAction ||
      'event' in step ||
      'set_conversation_response' in step ||
      'scene' in step
    ) {
      trace.push(`step ${JSON.stringify(canonical(step))}`);
      return;
    }
    if ('if' in step) {
      const result = testConditions(step.if);
      const guard = errorGuardOf(step);
      if (result === true) runSequence(step.then);
      else if (guard) runSequence(result === false ? guard.then : guard.else);
      else runSequence(step.else);
      return;
    }
    if ('choose' in step) {
      for (const option of asList(step.choose) as Record<string, unknown>[]) {
        if (checkCondition(option.conditions)) {
          runSequence(option.sequence);
          return;
        }
      }
      runSequence(step.default);
      return;
    }
    if ('parallel' in step) {
      const branches = asList(step.parallel);
      let cut = false;
      // A branch that stops the script (`stop:`), or fails (a step erroring,
      // #144), doesn't stop the others: HA gathers every branch and raises
      // the first failure after (script.py, _async_step_parallel). Found by
      // the interpreter check on the schema-generated cases.
      let stopped: StopSignal | ScriptAbort | null = null;
      branches.forEach((branch, k) => {
        const share = Math.floor((maxSteps - steps) / (branches.length - k));
        branchLimits.push(Math.min(steps + share, branchLimits.at(-1) ?? maxSteps));
        try {
          // A bare list is HA's shorthand for a `sequence:` branch
          // (config_validation's _parallel_sequence_action).
          // A branch of one step is a script of its own too.
          // A mapping with `sequence:` is a branch container: HA runs its
          // `sequence` unless `enabled` is a false boolean, and ignores
          // its `continue_on_error` and an `enabled` template (bug #94).
          if (Array.isArray(branch)) runSequence(branch);
          else {
            const b = branch as Record<string, unknown>;
            const container = 'sequence' in b && Object.keys(b).every((k) => CONTAINER_KEYS.has(k));
            if (!container) runSequence([b]);
            else if (cvBoolean(b.enabled) !== false) runSequence(b.sequence);
          }
        } catch (e) {
          if (e instanceof StopSignal || e instanceof ScriptAbort) stopped ??= e;
          else if (e instanceof BranchLimit) cut = true;
          else throw e;
        } finally {
          branchLimits.pop();
        }
      });
      // HA goes on only when every branch is done: a branch that never
      // finishes means nothing after the parallel runs (and, inside another
      // parallel, that this branch never finishes either) -- and a stop in
      // another branch is never raised.
      if (cut) throw new BranchLimit();
      if (stopped) throw stopped;
      return;
    }
    if ('sequence' in step) {
      runSequence(step.sequence);
      return;
    }
    if ('repeat' in step) {
      const r = step.repeat as Record<string, unknown>;
      if (r.count !== undefined) {
        // HA coerces the count to a whole number (`vol.Coerce(int)`:
        // 2.5 runs twice; bug #73).
        // Each pass counts as a step, so a loop with nothing in its body
        // still ends at the step limit instead of hanging the interpreter
        // (found by the construct-by-position table, H2.3).
        const n = Math.trunc(Number(renderValue(r.count)));
        for (let k = 0; k < n; k++) {
          tick();
          runSequence(r.sequence);
        }
      } else if (r.while !== undefined) {
        for (let round = 1; checkCondition(r.while); round++) {
          // HA: round 10,001 aborts the run instead of starting.
          if (haRepeatLimit && round > REPEAT_TERMINATE_ITERATIONS) throw new ScriptAbort();
          tick();
          runSequence(r.sequence);
        }
      } else if (r.until !== undefined) {
        // HA stops an until loop when its test can't be evaluated too.
        for (let round = 1; ; round++) {
          tick();
          runSequence(r.sequence);
          if (testConditions(r.until) !== false) break;
          // HA: a 10,000th round still not done aborts the run.
          if (haRepeatLimit && round >= REPEAT_TERMINATE_ITERATIONS) throw new ScriptAbort();
        }
      } else {
        throw new Error(`repeat not supported: ${JSON.stringify(r)}`);
      }
      return;
    }
    // `error: true` aborts the run (script.py raises _AbortScript; #157's
    // loop limit stops with it, as HA's own repeat limit aborts).
    if ('stop' in step) throw cvBoolean(step.error) === true ? new ScriptAbort() : new StopSignal();
    if ('wait_template' in step || 'wait_for_trigger' in step) {
      // `platform:` is HA's older name for a trigger's `trigger:` key.
      const triggers = asList(step.wait_for_trigger).map((t) => {
        const { platform, ...rest } = t as Record<string, unknown>;
        return platform !== undefined && rest.trigger === undefined
          ? { ...rest, trigger: platform }
          : t;
      });
      const recorded = 'wait_for_trigger' in step ? { ...step, wait_for_trigger: triggers } : step;
      trace.push(`wait ${JSON.stringify(canonical(recorded))}`);
      return;
    }
    if ('condition' in withoutShorthand(step)) {
      // A condition step (or HA's `and:`/`or:`/`not:` shorthand for one)
      // that doesn't pass ends the list it is in (see runSequence).
      if (!checkCondition(step)) throw new ConditionFail();
      return;
    }
    throw new Error(`step not supported: ${JSON.stringify(step)}`);
  }

  function run(): RunResult {
    try {
      // An automation's own top-level `conditions:` gate the whole run.
      const rootConditions = config.conditions ?? config.condition;
      if (rootConditions !== undefined && !checkCondition(rootConditions))
        return { trace, finished: true };
      runSequence(config.actions ?? config.action ?? config.sequence);
    } catch (e) {
      if (e instanceof StepLimit || e instanceof BranchLimit) return { trace, finished: false };
      if (e instanceof ScriptAbort) return { trace, finished: true, aborted: true };
      if (!(e instanceof StopSignal)) throw e;
    }
    return { trace, finished: true };
  }

  return { trace, tick, runStep, testConditions, run };
}

/** HA's condition shorthands (config_validation's
 * expand_condition_shorthand): `{and|or|not: [...]}` with at most
 * alias/enabled/note beside it, and `{condition: [...]}` (an and). This
 * interpreter's own reading, independent of the parser's and the gate's. */
function withoutShorthand(c: Record<string, unknown>): Record<string, unknown> {
  if (!('conditions' in c) && !('condition' in c)) {
    for (const key of ['and', 'or', 'not']) {
      if (
        key in c &&
        Object.keys(c).every((k) => k === key || ['alias', 'enabled', 'note'].includes(k))
      ) {
        const { [key]: inner, ...rest } = c;
        return { ...rest, condition: key, conditions: inner };
      }
    }
  }
  if (Array.isArray(c.condition)) {
    const { condition: inner, ...rest } = c;
    return { ...rest, condition: 'and', conditions: inner };
  }
  return c;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export class StopSignal extends Error {}

/** HA's _AbortScript: the run ended by the repeat limit (#129). */
class ScriptAbort extends Error {}

/** A condition step that didn't pass (HA's `_ConditionFail`). */
class ConditionFail extends Error {}

/** A parallel branch used up its share of the steps (see `branchLimits`). */
class BranchLimit extends Error {}
