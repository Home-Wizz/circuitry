/**
 * Home Assistant action/condition shape type-guards and small condition-type
 * helpers shared by both YamlParser format parsers (standard-automation and
 * state-machine). Extracted from YamlParser.ts (the 2026-09-25 file-decomposition
 * work) as a pure move -- no logic changed, only relocated -- so both
 * `action-block-parser.ts`'s parseActions/parseChooseBlock/parseIfBlock and
 * `state-machine-format-parser.ts`'s parseStateMachineChooseBlock can import
 * these instead of duplicating them.
 */
import type { ConditionNode, HACondition, HADelay, HAWait } from '@circuitry/shared';

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

/** Returns true if the action is an if/then/else block */
export function isIfThenAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'if' in action &&
    Array.isArray((action as Record<string, unknown>).if) &&
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
export function resolveConditionType(
  rawType: string | undefined,
  fallback: ValidConditionType
): ValidConditionType | string {
  if (!rawType) return fallback;
  if (rawType.includes('.')) return rawType;
  return VALID_CONDITIONS.includes(rawType as ValidConditionType)
    ? (rawType as ValidConditionType)
    : fallback;
}

/**
 * Nested condition type (supports recursive nesting)
 */
export type NestedCondition = NonNullable<ConditionNode['data']['conditions']>[number];

/**
 * Transform an array of Home Assistant conditions to internal format
 */
export function transformConditions(conditions: HACondition[]): NestedCondition[] {
  return conditions.map((c) => transformToNestedCondition(c));
}

/**
 * Transform Home Assistant condition format to internal nested condition format
 * HA uses 'condition' field, internal schema uses 'condition'
 * Recursively handles nested conditions for and/or/not
 */
export function transformToNestedCondition(condition: HACondition): NestedCondition {
  // Use spread pattern to preserve unknown properties from custom integrations
  const { condition: conditionField, conditions, ...rest } = condition;
  const validatedType = resolveConditionType(conditionField, 'template');

  // Recursively transform nested conditions if present
  const nestedConditions = Array.isArray(conditions) ? transformConditions(conditions) : undefined;

  return {
    ...rest, // Preserve extra properties (including weekday, after, before, etc.)
    condition: validatedType,
    conditions: nestedConditions,
  };
}
