import { z } from 'zod';
import { isOpaqueStepData } from './nodes';

/**
 * Validation schemas for node data.
 * These are used for real-time validation in the UI, separate from the
 * structural schemas used for parsing.
 */

/**
 * Wait node validation (decision D3; the audit after bug #65, checked in a
 * real HA 2026.9.3). A wait needs `wait_template` or `wait_for_trigger` --
 * without either HA can't tell what the step is. HA accepts a blank
 * template and an empty trigger list, so those are warnings (they used to
 * block saving). A wait with only a timeout isn't a wait: use a Delay node.
 */
export const WaitNodeValidationSchema = z
  .object({})
  .passthrough()
  .superRefine((data, ctx) => {
    const { error, warn } = reporter(ctx, [], data);
    const template = data.wait_template;
    const triggers = data.wait_for_trigger;
    if (typeof template === 'string') {
      if (isBlank(template)) warn('errors:validation.wait.templateEmpty', 'wait_template');
    } else if (Array.isArray(triggers)) {
      if (triggers.length === 0) warn('errors:validation.wait.triggersEmpty', 'wait_for_trigger');
    } else {
      error('errors:validation.wait.templateOrTriggerRequired', '_root');
    }
  });

/**
 * Action node validation - requires one of:
 *   - service in domain.service format (service call action), or
 *   - event string (fire event action), or
 *   - stop string (stop action — see below), or
 *   - an opaque repeat object (repeat.count / repeat.while / repeat.until)
 */
export const ActionNodeValidationSchema = z
  .object({
    service: z.string().optional(),
    event: z.string().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    // A step Circuitry doesn't know, kept exactly as written (bug #57):
    // nothing here to check; Home Assistant checks it.
    if (isOpaqueStepData(data)) return;
    // Opaque repeat nodes (repeat.count / repeat.while / repeat.until) are valid without service/event
    if (data.repeat !== null && typeof data.repeat === 'object') return;

    // Stop actions (`stop: "<message>"` + optional `error: true/false`) are
    // a third valid action shape alongside service/event — HA's own "Stop"
    // action ends the automation/script, optionally with a message and/or
    // marking it an error. An empty string ("") is a legitimate stop
    // reason (real HA UI defaults new Stop actions to it), so this only
    // checks the field's presence/type, not its content — mirroring
    // ActionFields.tsx's own `actionType = stopMessage !== undefined ?
    // 'stop' : ...` test. Before this check, EVERY stop action failed this
    // schema (neither `service` nor `event` is ever set on one), so any
    // flow containing a Stop node — e.g. the Else branch of an If/Then/Else
    // — could never be saved.
    if (typeof data.stop === 'string') return;

    // `set_conversation_response` is its own step type; HA accepts any text,
    // "" included. It used to be refused for having no service, so an
    // automation with one couldn't be saved (the audit after bug #65).
    if (typeof data.set_conversation_response === 'string') return;

    const { error, warn } = reporter(ctx, [], data);
    const hasEvent = typeof data.event === 'string' && data.event.trim() !== '';
    const hasService = typeof data.service === 'string' && data.service.trim() !== '';

    // `event: ""` fires an event with an empty name: HA accepts it, so only
    // a warning (it used to block saving).
    if (!hasService && typeof data.event === 'string' && !hasEvent) {
      warn('errors:validation.action.eventEmpty', 'event');
      return;
    }
    if (!hasEvent && !hasService) {
      error('errors:validation.action.serviceOrEventRequired', 'service');
      return;
    }
    if (hasService && !data.service!.includes('.')) {
      error('errors:validation.action.serviceFormat', 'service');
    }
  });

/**
 * Checks a trigger the way Home Assistant does (decision D3; the audit that
 * followed bug #65, checked in a real HA 2026.9.3). Errors only for what HA refuses;
 * warnings for what HA accepts but is almost always a blank left by
 * mistake. It used to block a blank event type, template, webhook id or
 * tag id and an empty entity list, and refused an event type given as a
 * list, all of which HA accepts. Accepts `platform:`, the older key.
 */
function checkTrigger(data: Record<string, unknown>, ctx: IssueContext): void {
  const report = reporter(ctx, [], data);
  const { error, warn } = report;
  const type = typeof data.trigger === 'string' ? data.trigger : data.platform;
  if (typeof type !== 'string' || type.trim() === '') {
    error('errors:validation.trigger.platformRequired', 'trigger');
    return;
  }
  // Required, and HA refuses it blank. An empty list is refused too,
  // unless `emptyListMessage` is given: HA accepts it then (a warning).
  const requireFilled = (field: string, message: string, emptyListMessage?: string) => {
    const v = data[field];
    if (isMissing(v) || blankIn(v)) error(message, field);
    else if (isEmptyList(v)) {
      if (emptyListMessage) warn(emptyListMessage, field);
      else error(message, field);
    }
  };
  // Required, but HA accepts it blank: only a warning then.
  const requireSet = (field: string, message: string, emptyMessage: string) => {
    if (isMissing(data[field])) error(message, field);
    else if (blankValue(data[field])) warn(emptyMessage, field);
  };
  const entities = (message: string) =>
    checkEntities(data.entity_id, report, message, 'errors:validation.trigger.entityEmpty');

  switch (type) {
    case 'state':
      entities('errors:validation.trigger.entityRequired.state');
      break;
    case 'numeric_state':
      entities('errors:validation.trigger.entityRequired.numericState');
      checkBounds(data, report, 'trigger');
      break;
    case 'event':
      requireSet(
        'event_type',
        'errors:validation.trigger.eventTypeRequired',
        'errors:validation.trigger.eventTypeEmpty'
      );
      break;
    case 'time':
      requireFilled(
        'at',
        'errors:validation.trigger.timeRequired',
        'errors:validation.trigger.timeEmpty'
      );
      break;
    case 'mqtt':
      requireFilled('topic', 'errors:validation.trigger.mqttTopicRequired');
      break;
    case 'webhook':
      requireSet(
        'webhook_id',
        'errors:validation.trigger.webhookIdRequired',
        'errors:validation.trigger.webhookIdEmpty'
      );
      break;
    case 'device':
      requireFilled('device_id', 'errors:validation.trigger.deviceRequired');
      break;
    case 'zone':
      entities('errors:validation.trigger.entityRequired.zone');
      requireFilled('zone', 'errors:validation.trigger.zoneRequired');
      break;
    case 'sun':
      requireFilled('event', 'errors:validation.trigger.sunEventRequired');
      break;
    case 'homeassistant':
      requireFilled('event', 'errors:validation.trigger.haEventRequired');
      break;
    case 'template':
      requireSet(
        'value_template',
        'errors:validation.trigger.templateRequired',
        'errors:validation.trigger.templateEmpty'
      );
      break;
    case 'tag':
      requireSet(
        'tag_id',
        'errors:validation.trigger.tagIdRequired',
        'errors:validation.trigger.tagIdEmpty'
      );
      break;
    case 'geo_location':
      requireSet(
        'source',
        'errors:validation.trigger.sourceRequired',
        'errors:validation.trigger.sourceEmpty'
      );
      requireFilled('zone', 'errors:validation.trigger.zoneRequired');
      requireFilled('event', 'errors:validation.trigger.geoEventRequired');
      break;
    case 'conversation':
      requireFilled('command', 'errors:validation.trigger.commandRequired');
      break;
    // HA refuses a time pattern with none of hours/minutes/seconds, and a
    // calendar trigger without its calendar (#122: checked with HA
    // 2026.9.3's validators).
    case 'time_pattern':
      if (['hours', 'minutes', 'seconds'].every((f) => isMissing(data[f]) || blankValue(data[f]))) {
        error('errors:validation.trigger.timePatternRequired', 'hours');
      }
      break;
    case 'calendar':
      requireFilled('entity_id', 'errors:validation.trigger.calendarRequired');
      break;
    // 'persistent_notification' has no required fields -- omitting
    // notification_id/update_type is valid and means "any notification,
    // any update type" per HA's docs.
  }
}

/** Trigger node validation: see checkTrigger. */
export const TriggerNodeValidationSchema = z
  .object({})
  .passthrough()
  .superRefine((data, ctx) => checkTrigger(data, ctx));

/**
 * Delay node validation - requires delay value.
 */
export const DelayNodeValidationSchema = z
  .object({
    // The object member previously had no fields defined (`z.object({})`),
    // which — without `.passthrough()` on this inner schema — silently
    // stripped any hours/minutes/seconds/etc the user actually set before
    // the refine below ever saw them, so "has any duration field" could
    // never be checked no matter what was fixed downstream. Real HA delay
    // objects allow days/hours/minutes/seconds/milliseconds, each a number
    // or a template string.
    // A number is seconds (`delay: 5`, `delay: 1.5`), as HA reads it.
    delay: z.union([
      z.string(),
      z.number(),
      z.object({
        days: z.union([z.number(), z.string()]).optional(),
        hours: z.union([z.number(), z.string()]).optional(),
        minutes: z.union([z.number(), z.string()]).optional(),
        seconds: z.union([z.number(), z.string()]).optional(),
        milliseconds: z.union([z.number(), z.string()]).optional(),
      }),
    ]),
  })
  .passthrough()
  .refine(
    (data) => {
      if (typeof data.delay === 'string') {
        return data.delay.trim() !== '';
      }
      // HA refuses a negative period ("Time period should be positive").
      if (typeof data.delay === 'number') {
        return data.delay >= 0;
      }
      // Object-based delay is valid only if it actually has a duration
      // field set to something non-empty — an empty `delay: {}` previously
      // passed this check (the refine's object branch always `return true`)
      // and would reach Home Assistant as nonsensical, immediately-rejected
      // YAML despite the UI reporting the node as fully valid.
      return Object.values(data.delay).some((v) => v !== undefined && v !== null && v !== '');
    },
    {
      message: 'errors:validation.delay.valueRequired',
      path: ['delay'],
    }
  );

type IssueContext = { addIssue: (issue: z.core.$ZodRawIssue) => void };

/**
 * How every node check reports (decision D3, bug #65): an error is
 * something Home Assistant refuses, so it blocks saving; a warning is
 * something HA accepts but is almost always a blank field left by mistake,
 * so it's shown and saving goes ahead.
 */
function reporter(ctx: IssueContext, at: (string | number)[], input: unknown) {
  return {
    error: (message: string, field: string) =>
      ctx.addIssue({ code: 'custom', message, path: [...at, field], input }),
    warn: (message: string, field: string) =>
      ctx.addIssue({
        code: 'custom',
        message,
        path: [...at, field],
        input,
        params: { severity: 'warning' },
      }),
  };
}

type Report = ReturnType<typeof reporter>;

const isBlank = (v: unknown): boolean => typeof v === 'string' && v.trim() === '';
const isMissing = (v: unknown): boolean => v === undefined || v === null;
const isEmptyList = (v: unknown): boolean => Array.isArray(v) && v.length === 0;
/** A blank string, or a list holding one: what HA refuses in a required field. */
const blankIn = (v: unknown): boolean => isBlank(v) || (Array.isArray(v) && v.some(isBlank));
/** An entity HA refuses: none, or a blank string (a blank in a list too). */
const entityRefused = (v: unknown): boolean => isMissing(v) || blankIn(v);
/** Set but blank: "", a list that's empty or holds a "". */
const blankValue = (v: unknown): boolean => blankIn(v) || isEmptyList(v);

/**
 * `entity_id` of a trigger or condition: HA refuses none or a blank one; it
 * accepts an empty list (which then matches nothing), so that's a warning.
 */
function checkEntities(value: unknown, report: Report, message: string, emptyMessage: string) {
  if (entityRefused(value)) report.error(message, 'entity_id');
  else if (isEmptyList(value)) report.warn(emptyMessage, 'entity_id');
}

/**
 * `above`/`below` of a numeric_state trigger or condition: HA needs at
 * least one, and refuses one that's set but blank ("expected float").
 */
function checkBounds(data: Record<string, unknown>, report: Report, kind: 'trigger' | 'condition') {
  for (const bound of ['above', 'below']) {
    if (isBlank(data[bound])) report.error(`errors:validation.${kind}.boundEmpty`, bound);
  }
  if (isMissing(data.above) && isMissing(data.below)) {
    report.error(`errors:validation.${kind}.boundRequired`, 'above');
  }
}

/** What the editor knows of the connected Home Assistant, where a check
 * depends on its version. */
export interface ValidationEnv {
  /** `hass.config.version`, e.g. "2026.10.0". Unknown: checks that
   * depend on it take the older HA's side (never stricter than HA). */
  haVersion?: string;
}

/** Whether a Home Assistant version string ("2026.10.0", "2026.10.0b1",
 * "2026.10.0.dev2026...") is the given release or later. */
export function haVersionAtLeast(version: string, year: number, month: number): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return y > year || (y === year && mo >= month);
}

/** An input helper's entity id, as HA 2026.10 matches a State condition's
 * `state` against it (config_validation.INPUT_ENTITY_ID). */
const INPUT_ENTITY_ID =
  /^input_(?:select|text|number|boolean|datetime)\.(?!.+__)(?!_)[\da-z_]+(?<!_)$/;

/** Why Home Assistant 2026.10 and later refuse a `for` on a State
 * condition: with an attribute, with anything but one state, or with a
 * state naming an input helper (`for` times the entity's last change of
 * one state; config_validation.STATE_CONDITION_SCHEMA). Older HA runs all
 * three. */
export type StateForRefusal = 'attribute' | 'states' | 'helper';

/** Why a `for` can't be used on this condition, whether or not it has one:
 * the panel offers none then (bug #182). Null for anything but a State
 * condition. */
export function stateForBlocked(c: Readonly<Record<string, unknown>>): StateForRefusal | null {
  if (c.condition !== 'state') return null;
  if (c.attribute !== undefined) return 'attribute';
  let state = c.state;
  if (Array.isArray(state)) {
    if (state.length !== 1) return 'states';
    state = state[0];
  }
  return typeof state === 'string' && INPUT_ENTITY_ID.test(state) ? 'helper' : null;
}

/** Why HA 2026.10 and later refuse this condition's `for`, or null (it has
 * none, or HA takes it). */
export function stateForRefusal(c: Readonly<Record<string, unknown>>): StateForRefusal | null {
  return c.for === undefined || c.for === null ? null : stateForBlocked(c);
}

/** A State condition's `for` that HA 2026.10 refuses (bug #182): an error
 * there, a warning on an older or unknown HA, which runs it (it stops
 * working once HA updates). */
function checkStateFor(c: Record<string, unknown>, report: Report, env: ValidationEnv) {
  const refusal = stateForRefusal(c);
  if (!refusal) return;
  if (env.haVersion && haVersionAtLeast(env.haVersion, 2026, 10)) {
    report.error(`errors:validation.condition.forRefused.${refusal}`, 'for');
  } else {
    report.warn(`errors:validation.condition.forRefusedLater.${refusal}`, 'for');
  }
}

/**
 * Checks one condition the way Home Assistant does (decision D3: never
 * stricter than HA; bug #65). An error is something HA refuses -- the
 * automation couldn't be saved or loaded -- so it blocks saving. A warning
 * is something HA accepts but is almost always a blank field left by
 * mistake (`state: ""` only matches an empty state; an empty template is
 * always false); it's shown, and saving goes ahead. What HA refuses and
 * accepts was checked in a real HA 2026.9.3. Groups are checked all the way down: a blank entity inside an
 * `or` is refused by HA the same as one at the top.
 */
function checkCondition(
  data: unknown,
  ctx: IssueContext,
  at: (string | number)[],
  env: ValidationEnv = {}
): void {
  // A template string shorthand, or anything else that isn't an object:
  // HA reads it, nothing to check here.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const c = data as Record<string, unknown>;
  const report = reporter(ctx, at, c);
  const { error, warn } = report;
  const entities = (message: string) =>
    checkEntities(c.entity_id, report, message, 'errors:validation.condition.entityEmpty');

  if (typeof c.condition !== 'string' || c.condition.trim() === '') {
    if (at.length === 0) error('errors:validation.condition.typeRequired', 'condition');
    return;
  }
  switch (c.condition) {
    case 'state':
      entities('errors:validation.condition.entityRequired.state');
      if (c.state === undefined) error('errors:validation.condition.stateRequired', 'state');
      else if (isBlank(c.state)) warn('errors:validation.condition.stateEmpty', 'state');
      checkStateFor(c, report, env);
      break;

    case 'numeric_state':
      entities('errors:validation.condition.entityRequired.numericState');
      checkBounds(c, report, 'condition');
      break;

    case 'time':
      // HA needs one of after/before/weekday and refuses a blank one. An
      // empty weekday list it accepts, and the condition is then never true.
      if (isMissing(c.after) && isMissing(c.before) && isMissing(c.weekday)) {
        error('errors:validation.condition.timeRequired', 'after');
      }
      for (const field of ['after', 'before', 'weekday']) {
        if (blankIn(c[field])) error('errors:validation.condition.timeBlank', field);
      }
      if (isEmptyList(c.weekday)) warn('errors:validation.condition.weekdayEmpty', 'weekday');
      break;

    case 'trigger':
      if (isMissing(c.id)) error('errors:validation.condition.triggerIdRequired', 'id');
      else if (blankValue(c.id)) {
        warn('errors:validation.condition.triggerIdEmpty', 'id');
      }
      break;

    case 'template':
      if (isMissing(c.value_template)) {
        error('errors:validation.condition.templateRequired', 'value_template');
      } else if (isBlank(c.value_template)) {
        warn('errors:validation.condition.templateEmpty', 'value_template');
      }
      break;

    case 'zone':
      entities('errors:validation.condition.entityRequired.zone');
      if (isMissing(c.zone) || isBlank(c.zone)) {
        error('errors:validation.condition.zoneRequired', 'zone');
      }
      break;

    case 'device':
      if (isMissing(c.device_id) || isBlank(c.device_id)) {
        error('errors:validation.condition.deviceRequired', 'device_id');
      }
      break;

    case 'or':
    case 'and':
    case 'not': {
      if (!Array.isArray(c.conditions)) {
        error('errors:validation.condition.groupConditionsRequired', 'conditions');
      } else if (c.conditions.length === 0) {
        warn('errors:validation.condition.groupEmpty', 'conditions');
      } else {
        c.conditions.forEach((nested, i) => {
          checkCondition(nested, ctx, [...at, 'conditions', i], env);
        });
      }
      break;
    }
  }
}

/**
 * Condition node validation: see checkCondition. Every other field passes
 * through unchecked (Home Assistant checks them).
 */
export function conditionNodeValidationSchema(env: ValidationEnv = {}) {
  return z
    .object({})
    .passthrough()
    .superRefine((data, ctx) => checkCondition(data, ctx, [], env));
}
export const ConditionNodeValidationSchema = conditionNodeValidationSchema();

/**
 * SetVariables node validation (decision D3): HA requires `variables:` but
 * accepts an empty map, so an empty one is a warning (it used to block
 * saving).
 */
export const SetVariablesNodeValidationSchema = z
  .object({})
  .passthrough()
  .superRefine((data, ctx) => {
    const { error, warn } = reporter(ctx, [], data);
    const variables = data.variables;
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      error('errors:validation.setVariables.atLeastOne', 'variables');
    } else if (Object.keys(variables).length === 0) {
      warn('errors:validation.setVariables.empty', 'variables');
    }
  });

/**
 * Map node types to their validation schemas.
 * Returns undefined for node types without specific validation.
 */
export function getNodeValidationSchema(nodeType: string): z.ZodSchema | undefined {
  switch (nodeType) {
    case 'wait':
      return WaitNodeValidationSchema;
    case 'action':
      return ActionNodeValidationSchema;
    case 'trigger':
      return TriggerNodeValidationSchema;
    case 'delay':
      return DelayNodeValidationSchema;
    case 'condition':
      return ConditionNodeValidationSchema;
    case 'set_variables':
      return SetVariablesNodeValidationSchema;
    default:
      return undefined;
  }
}

/**
 * Validation error structure
 */
export interface NodeValidationError {
  path: string[];
  message: string;
  /** A warning: shown on the node, but it doesn't block saving (bug #65). */
  severity?: 'warning';
}

/**
 * Validate node data against its schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateNodeData(
  nodeType: string,
  data: Record<string, unknown>,
  env: ValidationEnv = {}
): NodeValidationError[] {
  const schema =
    nodeType === 'condition'
      ? conditionNodeValidationSchema(env)
      : getNodeValidationSchema(nodeType);
  if (!schema) {
    return []; // No validation schema for this node type
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    ...(issue.code === 'custom' && issue.params?.severity === 'warning'
      ? { severity: 'warning' as const }
      : {}),
  }));
}
