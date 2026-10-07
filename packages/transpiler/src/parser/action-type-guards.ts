/**
 * Home Assistant action/condition shape type-guards and small condition-type
 * helpers shared by both YamlParser format parsers (standard-automation and
 * state-machine). Extracted from YamlParser.ts (the 2026-09-25 file-decomposition
 * work) as a pure move -- no logic changed, only relocated -- so both
 * `action-block-parser.ts`'s parseActions/parseChooseBlock/parseIfBlock and
 * `state-machine-format-parser.ts`'s parseStateMachineChooseBlock can import
 * these instead of duplicating them.
 */
import {
  type ConditionNode,
  type HACondition,
  type HADelay,
  type HAWait,
  haBoolean,
} from '@circuitry/shared';

// Type guards for Home Assistant objects

/** Returns true if the action is a delay node */
export function isDelayAction(action: unknown): action is HADelay {
  return (
    typeof action === 'object' &&
    action !== null &&
    'delay' in action &&
    (typeof (action as Record<string, unknown>).delay === 'string' ||
      typeof (action as Record<string, unknown>).delay === 'number' ||
      (typeof (action as Record<string, unknown>).delay === 'object' &&
        (action as Record<string, unknown>).delay !== null))
  );
}

/** Returns true if the action is a wait node */
export function isWaitAction(action: unknown): action is HAWait {
  return (
    typeof action === 'object' &&
    action !== null &&
    ('wait_template' in action || 'wait_for_trigger' in action)
  );
}

/** Returns true if the action is a choose block */
export function isChooseAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'choose' in action;
}

/** Returns true if the action is a parallel block */
export function isParallelAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'parallel' in action &&
    Array.isArray((action as Record<string, unknown>).parallel)
  );
}

/**
 * Returns true if the action is an if/then/else block. HA accepts `if:` as
 * one condition, a list or a template string (bug #59), so only the keys
 * decide.
 */
export function isIfThenAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'if' in action &&
    'then' in action &&
    Array.isArray((action as Record<string, unknown>).then)
  );
}

/** Returns true if the action is a service or action call */
export function isServiceAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    (typeof (action as Record<string, unknown>).service === 'string' ||
      typeof (action as Record<string, unknown>).action === 'string')
  );
}

/** Returns true if the action is an inline condition (guard) in the action sequence */
export function isConditionAction(action: unknown): action is HACondition {
  return (
    typeof action === 'object' &&
    action !== null &&
    'condition' in action &&
    typeof (action as Record<string, unknown>).condition === 'string'
  );
}

/**
 * Returns true if the action is HA's `and:`/`or:`/`not:` shorthand used as a
 * condition step (bug #59): `- or: [...]` in an action list is a condition
 * check in HA (config_validation's ACTIONS_MAP), not an unknown step. Keys
 * HA would pick first (`delay`, `wait_template`, `condition`) win, as in HA.
 */
export function isConditionShorthandAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    !Array.isArray(action) &&
    !('condition' in action) &&
    !('delay' in action) &&
    !('wait_template' in action) &&
    CONDITION_SHORTHAND_KEYS.some((key) => key in action)
  );
}

const CONDITION_SHORTHAND_KEYS = ['and', 'or', 'not'] as const;
/** Keys HA's shorthand schemas allow next to the shorthand key (CONDITION_BASE_SCHEMA). */
const CONDITION_BASE_KEYS = new Set(['alias', 'enabled', 'note']);

/**
 * One condition, with Home Assistant's shorthands expanded exactly the way HA
 * expands them (bug #59; HA's config_validation `expand_condition_shorthand`
 * and `dynamic_template_condition`, checked against HA 2026.9.3):
 * - a string is a template condition: `"{{ ... }}"` becomes
 *   `{condition: template, value_template: "{{ ... }}"}`;
 * - `{and|or|not: [...]}` (with at most `alias`/`enabled` beside it, and no
 *   `conditions:`) becomes `{condition: and|or|not, conditions: [...]}`;
 * - `{condition: [...]}` (a list) becomes `{condition: and, conditions: [...]}`;
 * - an and/or/not group's `conditions:` given one item is a list of one;
 * - the same inside every nested `conditions:` list.
 * Anything else is returned unchanged.
 */
export function expandConditionShorthand(value: unknown): unknown {
  if (typeof value === 'string') return { condition: 'template', value_template: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  let out: Record<string, unknown> = { ...value };
  if (!('conditions' in out)) {
    const shorthandKey = CONDITION_SHORTHAND_KEYS.find(
      (key) =>
        key in out &&
        Object.keys(out).every((other) => other === key || CONDITION_BASE_KEYS.has(other))
    );
    if (shorthandKey) {
      const { [shorthandKey]: inner, ...rest } = out;
      out = { condition: shorthandKey, conditions: toList(inner), ...rest };
    } else if (Array.isArray(out.condition)) {
      const { condition: inner, ...rest } = out;
      out = { condition: 'and', conditions: inner, ...rest };
    }
  }
  // An and/or/not group's `conditions:` may be one condition or a template
  // string instead of a list (HA's `ensure_list`); it used to fail the
  // import, and nested in another group it was written back as HA refuses
  // (bug #91).
  if (out.conditions !== undefined && out.conditions !== null && !Array.isArray(out.conditions)) {
    if (CONDITION_SHORTHAND_KEYS.some((key) => key === out.condition)) {
      out.conditions = toList(out.conditions);
    }
  }
  if (Array.isArray(out.conditions)) {
    out.conditions = out.conditions.map(expandConditionShorthand);
  }
  return out;
}

/**
 * A condition list as HA reads it (`conditions:`, `if:`, `while:`,
 * `until:`, a Choose case's `conditions:`): one item or a list, each item
 * expanded (bug #59).
 */
export function conditionList(value: unknown): unknown[] {
  return toList(value).map(expandConditionShorthand);
}

/** HA's `ensure_list`: nothing is an empty list, one item a list of one. */
export function toList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * An action list with every nested action list in the list form, the way
 * Home Assistant reads it (its SCRIPT_SCHEMA and the action schemas'
 * `ensure_list`). HA accepts one action where a list is expected: `then:`,
 * `else:`, `default:`, a Choose case's or a group's `sequence:`,
 * `repeat.sequence`, `parallel:` (each branch one action, a list, or a
 * `sequence:` group), `choose:` itself (one case) and `wait_for_trigger:`
 * (one trigger). Circuitry's parser used to read only lists there: a
 * single-action `then:` or `parallel:` became `unknown.unknown`, a loop
 * whose `sequence:` was one action disappeared, and a single
 * `wait_for_trigger` became an empty step (bugs #62, #67). Only non-list
 * values are wrapped; nothing else changes.
 */
export function normalizeActionLists(actions: unknown[]): unknown[] {
  return actions.map(normalizeActionListsIn);
}

function normalizeActionListsIn(action: unknown): unknown {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return action;
  const out: Record<string, unknown> = { ...action };
  for (const key of ['then', 'else', 'default', 'sequence'] as const) {
    if (out[key] !== undefined && out[key] !== null) {
      out[key] = normalizeActionLists(toList(out[key]));
    }
  }
  if (out.repeat && typeof out.repeat === 'object' && !Array.isArray(out.repeat)) {
    const repeat: Record<string, unknown> = { ...out.repeat };
    if (repeat.sequence !== undefined && repeat.sequence !== null) {
      repeat.sequence = normalizeActionLists(toList(repeat.sequence));
    }
    out.repeat = repeat;
  }
  if (out.choose !== undefined && out.choose !== null) {
    out.choose = toList(out.choose).map((choice) => {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return choice;
      const c: Record<string, unknown> = { ...choice };
      if (c.sequence !== undefined && c.sequence !== null) {
        c.sequence = normalizeActionLists(toList(c.sequence));
      }
      return c;
    });
  }
  if (out.parallel !== undefined && out.parallel !== null) {
    // A branch may be one action, a `sequence:` group or a bare list
    // (run as a sequence, bug #56).
    out.parallel = toList(out.parallel).map((branch) =>
      Array.isArray(branch)
        ? normalizeActionLists(branch)
        : normalizeActionListsIn(parallelBranchContainer(branch))
    );
  }
  if (out.wait_for_trigger !== undefined && out.wait_for_trigger !== null) {
    out.wait_for_trigger = toList(out.wait_for_trigger);
  }
  return out;
}

const PARALLEL_CONTAINER_KEYS = new Set([
  'sequence',
  'alias',
  'enabled',
  'continue_on_error',
  'note',
  'metadata',
]);

/**
 * A `parallel:` branch written as a mapping with a `sequence:` key, the
 * way HA reads it: as a branch container (config_validation's
 * _SCRIPT_PARALLEL_SCHEMA tries that schema first), which runs its
 * `sequence` as the branch and keeps only its `alias` and an `enabled`
 * that is a boolean (script.py, _async_prep_parallel_scripts). Its
 * `continue_on_error` and an `enabled` template are ignored; the parser
 * used to read them as a `sequence:` step's own, so a branch HA runs was
 * skipped (bug #94). Returned as the `sequence:` step that runs the same;
 * any other branch is returned unchanged.
 */
function parallelBranchContainer(branch: unknown): unknown {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch) || !('sequence' in branch)) {
    return branch;
  }
  const container = branch as Record<string, unknown>;
  // Any other key: not a container HA accepts; left for the parser to read.
  if (!Object.keys(container).every((key) => PARALLEL_CONTAINER_KEYS.has(key))) return branch;
  const step: Record<string, unknown> = { sequence: container.sequence };
  if (container.alias !== undefined) step.alias = container.alias;
  if (haBoolean(container.enabled) === false) step.enabled = false;
  return step;
}

/**
 * The action list without steps that do nothing, the way Home Assistant
 * would run it (bug #78). In a nested list -- an if's or a Choose's
 * branch, a `sequence:` group, a loop's body, a parallel branch -- a
 * condition step with nothing after it does nothing: when it doesn't pass
 * it ends a list that was ending anyway (HA runs each nested list as its
 * own script). An if with nothing in either branch does nothing either
 * (conditions have no side effects), a `condition: trigger` one included,
 * and so does a parallel whose branches all do nothing (#138), unless its
 * `enabled:` is a template (kept as written, bug #70). Removed from
 * the innermost lists out, so a branch that held only such steps is an
 * empty branch, and every block reads it the way it reads an empty one.
 * Needs the lists normalizeActionLists makes.
 */
export function withoutNoOpSteps(actions: unknown[], nested = false): unknown[] {
  const out = actions
    .map(stepWithoutNoOps)
    .filter((step) => step !== NO_OP_STEP && !isNoOpIf(step));
  while (nested && out.length > 0 && isConditionStepAction(out[out.length - 1])) out.pop();
  return out;
}

function isConditionStepAction(action: unknown): boolean {
  return (
    isConditionAction(action) || isConditionListAction(action) || isConditionShorthandAction(action)
  );
}

/** What stepWithoutNoOps returns for a step that does nothing at all. */
const NO_OP_STEP = Symbol('no-op step');

/** A Choose case that runs nothing when it's the one that passes. */
function isEmptyCase(option: unknown): boolean {
  return (
    !!option &&
    typeof option === 'object' &&
    !Array.isArray(option) &&
    toList((option as Record<string, unknown>).sequence).length === 0
  );
}

function isNoOpIf(step: unknown): boolean {
  if (!isIfThenAction(step) || typeof step.enabled === 'string') return false;
  // A `condition: trigger` if does nothing either (bug #105: kept, a
  // routed one ended the run it passed for).
  return toList(step.then).length === 0 && toList(step.else).length === 0;
}

function stepWithoutNoOps(step: unknown): unknown {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
  const out: Record<string, unknown> = { ...step };
  for (const key of ['then', 'else', 'default', 'sequence'] as const) {
    if (Array.isArray(out[key])) out[key] = withoutNoOpSteps(out[key] as unknown[], true);
  }
  if (out.repeat && typeof out.repeat === 'object' && !Array.isArray(out.repeat)) {
    const repeat: Record<string, unknown> = { ...out.repeat };
    if (Array.isArray(repeat.sequence)) repeat.sequence = withoutNoOpSteps(repeat.sequence, true);
    out.repeat = repeat;
  }
  if (Array.isArray(out.choose)) {
    out.choose = out.choose.map((choice) => {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return choice;
      const c: Record<string, unknown> = { ...choice };
      if (Array.isArray(c.sequence)) c.sequence = withoutNoOpSteps(c.sequence, true);
      return c;
    });
    // With no default, a last case that runs nothing does nothing either
    // way (bug #104): whether it passes or not, what follows the Choose
    // runs next. The parser gave such a case no way on when it passed, so
    // the automation stopped there. Dropped from the end, and a Choose
    // left with no case at all is dropped too. (A template `enabled:`
    // keeps the block as written.)
    if (toList(out.default).length === 0 && typeof out.enabled !== 'string') {
      const cases = [...(out.choose as unknown[])];
      const hadCases = cases.length > 0;
      while (cases.length > 0 && isEmptyCase(cases[cases.length - 1])) cases.pop();
      if (hadCases && cases.length === 0) return NO_OP_STEP;
      out.choose = cases;
    }
  }
  if (Array.isArray(out.parallel)) {
    out.parallel = out.parallel.map((branch) => {
      if (Array.isArray(branch)) return withoutNoOpSteps(branch, true);
      const kept = stepWithoutNoOps(branch);
      return kept === NO_OP_STEP ? [] : kept;
    });
    // A parallel whose branches all run nothing (`parallel: []` included,
    // which HA takes; a `null` branch is an empty one to HA) does nothing
    // either. Kept, a loop body or a Choose default of such blocks made no
    // node: the loop was lost, the default went nowhere (#138).
    if (
      typeof out.enabled !== 'string' &&
      (out.parallel as unknown[]).every((branch) => toList(branch).length === 0)
    ) {
      return NO_OP_STEP;
    }
  }
  return out;
}

/**
 * True for a block (`if:`, `choose:`, `parallel:`, `repeat:` or a
 * `sequence:` group) whose `enabled:` is a template. HA renders it when it
 * reaches the block and skips the whole block when it's false; the canvas
 * has no single node for a block to hold that on, so such a block is kept
 * exactly as written, as an opaque step (bug #70).
 */
export function isTemplateEnabledBlock(action: unknown): action is Record<string, unknown> {
  return (
    !!action &&
    typeof action === 'object' &&
    typeof (action as Record<string, unknown>).enabled === 'string' &&
    (isIfThenAction(action) ||
      isChooseAction(action) ||
      isParallelAction(action) ||
      isRepeatAction(action) ||
      isSequenceAction(action))
  );
}

/**
 * Returns true if the action is the "list of conditions" shorthand for an
 * inline condition guard — `condition: [cond1, cond2, ...]` — which HA treats
 * as an implicit AND of the listed conditions, stopping the sequence if any
 * evaluate false. Distinct from isConditionAction, whose `condition` value is
 * always a single type-discriminator string (e.g. 'state', 'and').
 */
export function isConditionListAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'condition' in action &&
    Array.isArray((action as Record<string, unknown>).condition)
  );
}

/**
 * Returns true if the action is a plain "Grouping actions" building block —
 * a nested sequence run as one unit (`sequence: [...]`) — as opposed to a
 * repeat body or a parallel branch, which also carry a `sequence` key but are
 * matched by their own more specific guards first.
 */
export function isSequenceAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'sequence' in action &&
    Array.isArray((action as Record<string, unknown>).sequence) &&
    !('repeat' in action) &&
    !('parallel' in action)
  );
}

/** Returns true if the action is a variables block */
export function isVariablesAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'variables' in action &&
    typeof (action as Record<string, unknown>).variables === 'object' &&
    // Make sure it's not mistaken for other action types that might have variables
    !('service' in action) &&
    !('action' in action) &&
    !('delay' in action) &&
    !('wait_template' in action) &&
    !('choose' in action) &&
    !('if' in action)
  );
}

/** Returns true if the action is a set_conversation_response action */
export function isSetConversationResponseAction(
  action: unknown
): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'set_conversation_response' in action;
}

/** Returns true if the action is a stop action */
export function isStopAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'stop' in action;
}

/** Returns true if the action is a repeat block */
export function isRepeatAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'repeat' in action &&
    typeof (action as Record<string, unknown>).repeat === 'object' &&
    (action as Record<string, unknown>).repeat !== null
  );
}

/**
 * True for a `repeat: count` block whose count the counter loop can't
 * express: anything but a whole number of 1 or more (a number, or a
 * string of digits). HA runs the body no times for 0 or less, rounds a
 * non-integer down and renders a template; the counter loop (init, body,
 * increment, test `counter < N`) runs the body before its first test and
 * only reads a literal whole number, so such a block is kept exactly as
 * written, as an opaque step (bug #73). Making those loops editable is
 * left for later.
 */
export function isUnexpandableCountRepeat(action: unknown): action is Record<string, unknown> {
  if (!isRepeatAction(action)) return false;
  const repeat = action.repeat as Record<string, unknown>;
  if (!('count' in repeat) || 'while' in repeat || 'until' in repeat || 'for_each' in repeat) {
    return false;
  }
  const count = repeat.count;
  if (typeof count === 'number') return !(Number.isInteger(count) && count >= 1);
  if (typeof count === 'string') return !/^\s*\d+\s*$/.test(count) || Number(count) < 1;
  return true;
}

/** Keys HA's own schemas drop (`vol.Remove`): not written back, and no
 * reason to keep a step as written. */
const REMOVED_BY_HA = new Set(['note', 'metadata']);

export const isMapping = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * True for a step HA accepts that the node it would become can't hold
 * whole, so it is kept exactly as written, as an opaque step (H5.1's
 * schema-generated cases, 2026-09-27; decision D3):
 * - a block with `continue_on_error: true` (bug #88): HA catches the
 *   errors of every step inside it, and the canvas has no node for the
 *   block to hold that on;
 * - a service call whose `target`, `data` or `data_template` is a
 *   template string instead of a mapping (bug #89: it was dropped, and the
 *   service ran with no target);
 * - an event with `event_data_template` or a non-mapping `event_data`
 *   (bug #90: dropped), a `variables` or `set_conversation_response` step
 *   with any key its node doesn't hold (`continue_on_error`, ...), and a
 *   `variables` step whose value isn't names and values (`null`, a list:
 *   #139, it failed the graph's schema or became `{}`; HA refuses it, as
 *   it refuses the source);
 * - a `choose:` with no options, or with an always-true option (`conditions:
 *   []`) that has another option or a default after it (bug #98, found by
 *   the H1 audit): HA runs the first option that passes, so nothing after
 *   an always-true one ever runs. The parser folded such an option into
 *   the default, which ran it only when every other option failed (or
 *   dropped it, with a warning, when there was a default), and a choose
 *   with no options couldn't be imported after a block with several ways
 *   out. An always-true last option with no default is still the default.
 * - a `choose:` with an option that isn't a mapping (`choose: [null]`):
 *   HA refuses it, as it refuses the source; the option was dropped, so a
 *   choose HA refuses was written as one it runs, or as a step that
 *   couldn't be saved (#146).
 * - a `stop:` whose reason isn't text (`stop: null`, which HA takes): the
 *   Stop node holds text, and it was written as `stop: ""` (#144);
 * - an `if:` with no conditions (`if: []`, and `if: null`, an empty list
 *   to HA), which always runs its `then`: the canvas has no If without a
 *   test, and the import failed with an internal error (#145).
 */
export function isStepKeptAsWritten(action: unknown): action is Record<string, unknown> {
  if (!isMapping(action)) return false;
  const step = action as Record<string, unknown>;
  if (isChooseAction(action)) {
    const options = toList(step.choose);
    if (options.length === 0 || !options.every(isMapping)) return true;
    const always = options.findIndex(
      (option) =>
        isMapping(option) &&
        conditionList((option as Record<string, unknown>).conditions).length === 0
    );
    if (always !== -1 && (always < options.length - 1 || toList(step.default).length > 0)) {
      return true;
    }
  }
  const onlyKeys = (keys: string[]) =>
    Object.keys(step).every((key) => keys.includes(key) || REMOVED_BY_HA.has(key));
  if (
    step.continue_on_error === true &&
    (isIfThenAction(action) ||
      isChooseAction(action) ||
      isParallelAction(action) ||
      isRepeatAction(action) ||
      isSequenceAction(action))
  ) {
    return true;
  }
  if (isServiceAction(action)) {
    return ['target', 'data', 'data_template'].some(
      (key) => step[key] !== undefined && step[key] !== null && !isMapping(step[key])
    );
  }
  if (isEventAction(action)) {
    return (
      !onlyKeys(['event', 'event_data', 'alias', 'enabled', 'continue_on_error']) ||
      (step.event_data !== undefined && !isMapping(step.event_data))
    );
  }
  if (isSetConversationResponseAction(action)) {
    return (
      !onlyKeys(['set_conversation_response', 'alias', 'enabled']) ||
      typeof step.set_conversation_response !== 'string'
    );
  }
  if (isVariablesAction(action)) {
    return !onlyKeys(['variables', 'alias', 'enabled']) || !isMapping(step.variables);
  }
  if (isStopAction(action)) return typeof step.stop !== 'string';
  if (isIfThenAction(action)) return conditionList(step.if).length === 0;
  return false;
}

/**
 * True for a `parallel:` with one branch that sets `wait` (a wait step
 * anywhere in it). HA keeps `wait` to the parallel branch it was set in
 * (script_variables.py, assign_parallel_protected), so after the block
 * `wait` is what it was before it. The canvas has no parallel of one
 * branch -- it's drawn as the branch's steps in line, where `wait` carries
 * on -- so such a block is kept exactly as written, as an opaque step
 * (bug #81).
 */
export function isWaitScopedParallel(action: unknown): action is Record<string, unknown> {
  if (!isParallelAction(action)) return false;
  const branches = toList(action.parallel);
  return branches.length === 1 && setsWait(branches[0]);
}

function setsWait(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(setsWait);
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return 'wait_template' in obj || 'wait_for_trigger' in obj || Object.values(obj).some(setsWait);
}

/** Returns true if the action is an event firing action */
export function isEventAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'event' in action &&
    typeof (action as Record<string, unknown>).event === 'string'
  );
}

/**
 * Valid condition types for Home Assistant
 */
export const VALID_CONDITIONS = [
  'state',
  'numeric_state',
  'template',
  'time',
  'sun',
  'zone',
  'and',
  'or',
  'not',
  'device',
  'trigger',
] as const;

export type ValidConditionType = (typeof VALID_CONDITIONS)[number];

/**
 * Resolves a raw `condition:` string from imported YAML to what Circuitry should
 * store as a condition node's `data.condition`.
 *
 * VALID_CONDITIONS above only covers the legacy, non-dotted condition kinds
 * (state, numeric_state, sun, time, ...). HA 2024.8+ also has "purpose-
 * specific" dotted condition types — `condition: sun.is_up`, `condition:
 * light.is_on`, `condition: climate.is_cooling`, etc. — which are a
 * completely different, open-ended namespace (any `domain.is_*`/`domain.
 * all_*` string a component chooses to register), so they can never be
 * enumerated in a fixed allowlist the way the legacy kinds are.
 *
 * Every call site below used to run the raw type through
 * `VALID_CONDITIONS.includes(...)` unconditionally and silently fall back to
 * 'template' for anything not in that closed list — which meant every
 * dotted condition lost its real type on import and showed up as a generic,
 * unconfigured "Template" node (confirmed via a real user automation whose
 * saved YAML had `condition: sun.is_up` / `condition: sun.is_night` and
 * parsed back as `condition: template` both times). That data loss was
 * needless: HAConditionSchema's own `condition` field (packages/shared/src/
 * schemas/ha-schemas.ts) is a plain `z.string()` with no such restriction,
 * and ConditionNode.tsx's card display already has first-class handling for
 * a dotted `data.condition` (`isDottedCondition`/`dottedPhrase`) — only this
 * parser-side gate didn't know dotted types existed yet.
 *
 * A dotted type (contains a literal '.') is passed through completely
 * unvalidated instead of being checked against VALID_CONDITIONS, matching
 * ConditionNode.tsx's own `data.condition.includes('.')` test elsewhere in
 * the codebase for "is this a purpose-specific condition".
 */
export function resolveConditionType(rawType: unknown): string {
  // Any type HA accepts is kept as written (decision D3, bug #58): HA
  // accepts condition platforms beyond the built-in list (`zone`, `sun`,
  // an integration's own), and rewriting an unknown one into `template`
  // or `numeric_state` changed what the automation does. A condition with
  // no type at all is one HA rejects (shorthands are expanded before this,
  // bug #59), so the import stops instead of guessing one.
  if (typeof rawType !== 'string' || rawType === '') {
    throw new Error(`A condition has no condition type, which Home Assistant rejects.`);
  }
  return rawType;
}

/**
 * Nested condition type (supports recursive nesting)
 */
export type NestedCondition = NonNullable<ConditionNode['data']['conditions']>[number];

/**
 * Transform an array of Home Assistant conditions to internal format
 */
export function transformConditions(conditions: unknown[]): NestedCondition[] {
  // Expanded here too (bug #59): a nested item may be a shorthand.
  return conditions.map((c) =>
    transformToNestedCondition(expandConditionShorthand(c) as HACondition)
  );
}

/**
 * Transform Home Assistant condition format to internal nested condition format
 * HA uses 'condition' field, internal schema uses 'condition'
 * Recursively handles nested conditions for and/or/not
 */
export function transformToNestedCondition(condition: HACondition): NestedCondition {
  // Use spread pattern to preserve unknown properties from custom integrations
  const { condition: conditionField, conditions, ...rest } = condition;
  const validatedType = resolveConditionType(conditionField);

  // Recursively transform nested conditions if present
  const nestedConditions = Array.isArray(conditions) ? transformConditions(conditions) : undefined;

  return {
    ...rest, // Preserve extra properties (including weekday, after, before, etc.)
    condition: validatedType,
    conditions: nestedConditions,
  };
}
