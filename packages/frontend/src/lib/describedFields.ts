import type { NodeValidationError } from '@circuitry/shared';
import { getConditionEnumField, hasConditionSingleValueField } from '@/lib/conditionEnumField';
import {
  describedThresholdShape,
  type NativeDescription,
  type NativeFieldDescription,
  resolveOptionFields,
} from '@/lib/nativeDescriptions';
import { targetIssues } from '@/lib/nativeRequired';
import { getSunPeriodField } from '@/lib/sunPeriodField';
import { getTriggerDurationField } from '@/lib/triggerDurationField';
import { getTriggerEnumField } from '@/lib/triggerEnumField';
import { getTriggerOffsetField } from '@/lib/triggerOffsetField';
import { isEmptyValue, isRecord } from '@/lib/utils';

/**
 * The options of a purpose-specific trigger or condition the panel has an
 * editor of its own for (NativeTriggerFields, NativeConditionFields: the
 * same lookups they render from). For a type discovered from HA's
 * descriptions, every other field HA describes is rendered by HA's own
 * selector (DescribedOptionFields), so it can be set in the panel the way
 * HA's editor sets it.
 */
export function handledTriggerOptions(
  type: string,
  description: NativeDescription | null | undefined
): Set<string> {
  const { behavior, hasFor } = resolveOptionFields('trigger', type, description);
  const enumField = getTriggerEnumField(type);
  const duration = getTriggerDurationField(type);
  const offset = getTriggerOffsetField(type);
  return new Set([
    ...(behavior ? ['behavior'] : []),
    ...(hasFor ? ['for'] : []),
    ...(describedThresholdShape('trigger', type, description) !== 'none' ? ['threshold'] : []),
    ...(enumField ? [enumField.optionsKey] : []),
    ...(duration ? [duration.optionsKey] : []),
    ...(offset ? ['offset', 'offset_type'] : []),
    ...(offset?.hasTwilightType ? ['type'] : []),
    ...(type === 'moon.phase_changed' ? ['phase'] : []),
    ...(getSunPeriodField(type) ? ['period'] : []),
  ]);
}

export function handledConditionOptions(
  type: string,
  description: NativeDescription | null | undefined
): Set<string> {
  const { behavior, hasFor } = resolveOptionFields('condition', type, description);
  const enumField = getConditionEnumField(type);
  const twilight = type === 'sun.is_morning_twilight' || type === 'sun.is_evening_twilight';
  return new Set([
    ...(behavior ? ['behavior'] : []),
    ...(hasFor ? ['for'] : []),
    ...(describedThresholdShape('condition', type, description) !== 'none' ? ['threshold'] : []),
    ...(enumField ? [enumField.optionsKey] : []),
    ...(hasConditionSingleValueField(type) ? ['value'] : []),
    ...(type === 'moon.is_phase' ? ['phase'] : []),
    ...(getSunPeriodField(type) ? ['period'] : []),
    ...(twilight ? ['type'] : []),
  ]);
}

/** The fields HA describes for a type that the panel has no editor of its
 * own for, in HA's order: each with the selector HA renders it with. */
export function describedExtraFields(
  description: NativeDescription | null | undefined,
  handled: ReadonlySet<string>
): [string, NativeFieldDescription & { selector: Record<string, unknown> }][] {
  return Object.entries(description?.fields ?? {}).filter(
    (entry): entry is [string, NativeFieldDescription & { selector: Record<string, unknown> }] =>
      !handled.has(entry[0]) && isRecord(entry[1].selector)
  );
}

/** A described field the user must give: HA requires it and has no
 * default to fill in. */
export function describedFieldNeeded(field: NativeFieldDescription): boolean {
  return field.required === true && field.default === undefined;
}

/** An issue for each field among `fields` HA requires with no default to
 * fill in, that the node's options leave empty. */
function neededFieldIssues(
  fields: [string, NativeFieldDescription][],
  data: Record<string, unknown>
): NodeValidationError[] {
  const options = isRecord(data.options) ? data.options : {};
  return fields
    .filter(([key, field]) => describedFieldNeeded(field) && isEmptyValue(options[key]))
    .map(([key]) => ({
      path: ['options', key],
      message: 'errors:validation.native.optionRequired',
    }));
}

/**
 * What the editor flags on a node of a type discovered from HA's
 * descriptions (one the panel's tables don't know): its target, where HA
 * describes one, and each option HA requires with no default to fill in --
 * the checks nativeNodeIssues makes from the tables for the catalog's own
 * types.
 */
export function describedNodeIssues(
  description: NativeDescription,
  data: Record<string, unknown>
): NodeValidationError[] {
  return [
    ...(description.target === undefined ? [] : targetIssues(data.target)),
    ...neededFieldIssues(Object.entries(description.fields ?? {}), data),
    ...olderBoundIssues(description, data),
  ];
}

/** For one of the catalog's own types, what the editor flags beyond the
 * tables' checks: each field the connected HA describes that the panel has
 * no editor of its own for (an older HA's threshold bounds) and requires
 * with no default to fill in. */
export function describedExtraIssues(
  kind: 'trigger' | 'condition',
  type: string,
  description: NativeDescription,
  data: Record<string, unknown>
): NodeValidationError[] {
  const handled =
    kind === 'trigger'
      ? handledTriggerOptions(type, description)
      : handledConditionOptions(type, description);
  return [
    ...neededFieldIssues(describedExtraFields(description, handled), data),
    ...olderBoundIssues(description, data),
  ];
}

/**
 * An HA from before the threshold rework (2026.2's climate, humidifier and
 * light triggers) checks their bounds beyond what it describes (its
 * helpers/trigger.py): `threshold_type` is required (with no default
 * there), above needs `lower_limit`, below
 * needs `upper_limit`, between and outside need both; and a lower bound
 * above the upper one (`above` over `below`, `lower_limit` over
 * `upper_limit`) is refused.
 */
function olderBoundIssues(
  description: NativeDescription,
  data: Record<string, unknown>
): NodeValidationError[] {
  const fields = description.fields ?? {};
  const options = isRecord(data.options) ? data.options : {};
  const issues: NodeValidationError[] = [];
  if ('threshold_type' in fields) {
    const kind = options.threshold_type;
    // Required, and HA's validator fills no default in (its description's
    // default is only the form's).
    if (isEmptyValue(kind)) {
      issues.push({
        path: ['options', 'threshold_type'],
        message: 'errors:validation.native.optionRequired',
      });
    }
    const needs =
      kind === 'above'
        ? ['lower_limit']
        : kind === 'below'
          ? ['upper_limit']
          : kind === 'between' || kind === 'outside'
            ? ['lower_limit', 'upper_limit']
            : [];
    for (const key of needs) {
      if (isEmptyValue(options[key])) {
        issues.push({ path: ['options', key], message: 'errors:validation.native.optionRequired' });
      }
    }
  }
  for (const [low, high] of [
    ['above', 'below'],
    ['lower_limit', 'upper_limit'],
  ] as const) {
    if (!(low in fields && high in fields)) continue;
    const a = boundNumber(options[low]);
    const b = boundNumber(options[high]);
    if (a !== undefined && b !== undefined && a > b) {
      issues.push({ path: ['options', high], message: 'errors:validation.native.boundsReversed' });
    }
  }
  return issues;
}

/** A bound's number: a plain number, or HA's number-or-entity choice
 * (`{ active_choice: 'number', number }`); an entity bound has none. */
function boundNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (isRecord(value) && value.active_choice === 'number' && typeof value.number === 'number') {
    return value.number;
  }
  return undefined;
}

/** What a new node of the type starts with for the fields the panel has no
 * editor of its own for: each one HA requires that has a default. HA's own
 * editor fills those in; HA's validator doesn't always (2026.2's
 * `threshold_type`), so a node left without one would be refused. */
export function describedFieldDefaults(
  kind: 'trigger' | 'condition',
  type: string,
  description: NativeDescription
): Record<string, unknown> {
  const handled =
    kind === 'trigger'
      ? handledTriggerOptions(type, description)
      : handledConditionOptions(type, description);
  return Object.fromEntries(
    describedExtraFields(description, handled)
      .filter(([, field]) => field.required === true && field.default !== undefined)
      .map(([key, field]) => [key, field.default])
  );
}
