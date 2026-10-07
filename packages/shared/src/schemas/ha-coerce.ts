import { haBoolean } from './base';

/**
 * An automation read the way Home Assistant's validators read it before it
 * runs: the scalar values HA coerces (`continue_on_error: "yes"`,
 * `alias: 5`, `enabled: 0`, `wait_template: 5`, `timeout: true`,
 * `conditions: null`, ...) in the type HA turns them into. Circuitry read
 * these keys only in that type, so it dropped a value written another way
 * (an `enabled: 0` step ran, a `continue_on_error: "yes"` no longer caught
 * errors), rewrote it (`stop: 5` became `stop: ""`, `wait_template: 5` an
 * empty step HA refuses) or refused the automation (`value_template: 5`,
 * `conditions: null`), and the checkers read them the same way (#144).
 * Applied where an automation's YAML is read: the import, the behavior
 * checkers, the test interpreter.
 *
 * Every rule is a validator of HA 2026.9.3's config_validation or of the
 * trigger platform's own schema, named beside it, and each spelling was
 * checked against a real Home Assistant. A value HA wouldn't take is left
 * as written, for whatever reads it next to refuse or warn about. No key
 * is added or removed, a single item where HA takes a list stays a single
 * item, and `null` where HA takes a list is an empty one.
 */
export function haCoerceAutomation(config: Record<string, unknown>): Record<string, unknown> {
  // The automation's own `alias` and `description` (automation/config.py: cv.string).
  const out = apply(config, { alias: text, description: text });
  for (const key of ['triggers', 'trigger']) {
    if (key in out) out[key] = triggers(out[key]);
  }
  for (const key of ['conditions', 'condition']) {
    if (key in out) out[key] = conditions(out[key]);
  }
  for (const key of ['actions', 'action', 'sequence']) {
    if (key in out) out[key] = steps(out[key]);
  }
  return out;
}

/**
 * Python's `str()`, which `cv.string` and `cv.template` call on any scalar:
 * `True`/`False`, a number as Python writes it. A float written with a
 * whole value (`1.0`) is read by the YAML loader as the number 1, so it
 * becomes "1" where HA has "1.0"; nothing tells the two apart after the
 * load.
 */
export function pythonStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value !== 'number') return undefined;
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  if (Number.isInteger(value) || Math.abs(value) >= 1e-4) return String(value);
  // Python writes small floats in exponent form with at least two exponent
  // digits (1e-05); JavaScript only below 1e-6, and with one (1e-7).
  return value.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
}

type Coercion = (value: unknown) => unknown;

/** `cv.string`, `cv.template`: any scalar, as text. */
const text: Coercion = (value) => pythonStr(value) ?? value;
/** `vol.Any(None, cv.string)`: null stays null. */
const textOrNull: Coercion = (value) => (value === null ? null : text(value));
/** `cv.boolean`; also `enabled:`'s `vol.Any(cv.boolean, cv.template)`, where
 * what `cv.boolean` doesn't take is a template, left as written. */
const boolean: Coercion = (value) => haBoolean(value) ?? value;
/** `cv.positive_time_period_template`, `vol.Coerce(float)`: a boolean is 1 or 0 (`float(True)`). */
const number: Coercion = (value) => (typeof value === 'boolean' ? Number(value) : value);
/** A service step's own `entity_id:` (`cv.comp_entity_ids`): null is `none`
 * (its `vol.Lower` makes "none" of it, HA's "no entities"), which the step
 * then targets in place of its `target:`. */
const entityIds: Coercion = (value) => (value === null ? 'none' : value);
/** `cv.ensure_list`: null is an empty list. */
const list: Coercion = (value) => (value === null ? [] : value);
/** `vol.All(cv.ensure_list, [cv.string])`, `[cv.template]`: null is an empty list, each item text. */
const textList: Coercion = (value) =>
  value === null ? [] : Array.isArray(value) ? value.map(text) : text(value);

type Rules = Record<string, Coercion>;

function apply(item: Record<string, unknown>, rules: Rules): Record<string, unknown> {
  const out = { ...item };
  for (const [key, coerce] of Object.entries(rules)) {
    if (key in out) out[key] = coerce(out[key]);
  }
  return out;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** One item or a list of them, each coerced; anything else as it is. */
function mapItems(value: unknown, coerce: (item: unknown) => unknown): unknown {
  return Array.isArray(value) ? value.map(coerce) : isMapping(value) ? coerce(value) : value;
}

// ------------------------------------------------------------- triggers

/** TRIGGER_BASE_SCHEMA: `alias` and `id` are `str` there (no coercion). */
const TRIGGER_BASE: Rules = { enabled: boolean };

/** Each platform's own TRIGGER_SCHEMA. */
const TRIGGER_RULES: Record<string, Rules> = {
  state: { for: number },
  numeric_state: { for: number, value_template: text, above: number, below: number },
  template: { for: number, value_template: text },
  event: { event_type: textList },
  time: { at: list, weekday: list },
  webhook: { webhook_id: text, allowed_methods: list },
  persistent_notification: { update_type: list },
  tag: { tag_id: textList, device_id: textList },
  conversation: { command: textList },
  geo_location: { source: text },
};

/** TRIGGER_SCHEMA, `cv.ensure_list` of triggers. */
const triggers: Coercion = (value) => mapItems(list(value), coerceTrigger);

function coerceTrigger(trigger: unknown): unknown {
  if (!isMapping(trigger)) return trigger;
  const platform = trigger.trigger ?? trigger.platform;
  const own = typeof platform === 'string' ? TRIGGER_RULES[platform] : undefined;
  return apply(trigger, { ...TRIGGER_BASE, ...own });
}

// ----------------------------------------------------------- conditions

/** CONDITION_BASE_SCHEMA. */
const CONDITION_BASE: Rules = { alias: text, enabled: boolean };

/** CONDITIONS_SCHEMA, `vol.All(cv.ensure_list, [CONDITION_SCHEMA])`. */
const conditions: Coercion = (value) => mapItems(list(value), coerceCondition);

const CONDITION_RULES: Record<string, Rules> = {
  and: { conditions },
  or: { conditions },
  not: { conditions },
  template: { value_template: text },
  numeric_state: { value_template: text, above: number, below: number },
  trigger: { id: textList },
  time: { weekday: list },
  state: { for: number },
};

function coerceCondition(condition: unknown): unknown {
  if (!isMapping(condition)) return condition;
  const type = condition.condition;
  if (Array.isArray(type)) {
    // `condition: [...]`, shorthand for an `and` of them.
    return { ...apply(condition, CONDITION_BASE), condition: type.map(coerceCondition) };
  }
  const own =
    typeof type === 'string'
      ? CONDITION_RULES[type]
      : // The `and:`/`or:`/`not:` shorthand.
        { and: conditions, or: conditions, not: conditions };
  return apply(condition, { ...CONDITION_BASE, ...own });
}

// ---------------------------------------------------------------- steps

/** The step's type, as config_validation's determine_script_action picks it. */
const STEP_TYPES = [
  'delay',
  'wait_template',
  'condition',
  'and',
  'or',
  'not',
  'event',
  'device_id',
  'scene',
  'repeat',
  'choose',
  'wait_for_trigger',
  'variables',
  'if',
  'action',
  'service',
  'service_template',
  'stop',
  'parallel',
  'sequence',
  'set_conversation_response',
] as const;

/** The base schema every step shares (`continue_on_error` included). */
const STEP_BASE: Rules = { alias: text, continue_on_error: boolean, enabled: boolean };

/** SCRIPT_SCHEMA, `vol.All(cv.ensure_list, [...])`: null is no steps. */
const steps: Coercion = (value) => mapItems(list(value), coerceStep);

const repeat: Coercion = (value) =>
  isMapping(value)
    ? apply(value, { while: conditions, until: conditions, sequence: steps })
    : value;

/** A Choose's options (`cv.ensure_list`), each with an alias, conditions and a sequence. */
const options: Coercion = (value) =>
  mapItems(list(value), (option) =>
    isMapping(option) ? apply(option, { alias: text, conditions, sequence: steps }) : option
  );

/** A parallel's branches (`cv.ensure_list`), each a step (a `sequence:` group
 * among them) or a list of steps. */
const branches: Coercion = (value) =>
  value === null
    ? []
    : Array.isArray(value)
      ? value.map((branch) => (Array.isArray(branch) ? branch.map(coerceStep) : coerceStep(branch)))
      : coerceStep(value);

const STEP_RULES: Partial<Record<(typeof STEP_TYPES)[number], Rules>> = {
  delay: { delay: number },
  event: { event: text },
  action: { entity_id: entityIds },
  service: { entity_id: entityIds },
  service_template: { entity_id: entityIds },
  wait_template: { wait_template: text, timeout: number, continue_on_timeout: boolean },
  repeat: { repeat },
  choose: { choose: options, default: steps },
  wait_for_trigger: {
    wait_for_trigger: triggers,
    timeout: number,
    continue_on_timeout: boolean,
  },
  if: { if: conditions, then: steps, else: steps },
  stop: { stop: textOrNull, error: boolean },
  parallel: { parallel: branches },
  sequence: { sequence: steps },
  set_conversation_response: { set_conversation_response: textOrNull },
};

function coerceStep(step: unknown): unknown {
  if (!isMapping(step)) return step;
  const type = STEP_TYPES.find((key) => key in step);
  if (type === 'condition' || type === 'and' || type === 'or' || type === 'not') {
    return coerceCondition(step);
  }
  return apply(step, { ...STEP_BASE, ...(type ? STEP_RULES[type] : undefined) });
}
