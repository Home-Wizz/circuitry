import type { ConditionType } from '@circuitry/shared';
import type { FieldConfig } from './triggerFields';

/**
 * Static field configurations for condition types.
 * Mirrors the structure of triggerFields.ts for consistency.
 * Device conditions use dynamic fields from the API.
 */
export const CONDITION_TYPE_FIELDS: Record<ConditionType, FieldConfig[]> = {
  // State condition: checks if entity is in a specific state
  state: [
    {
      name: 'entity_id',
      label: 'Entity',
      type: 'entity',
      required: true,
      multiple: true,
      description: 'The entity to check',
    },
    {
      name: 'state',
      label: 'State',
      type: 'text',
      required: true,
      placeholder: 'e.g., on, off, home',
      description: 'The state value to check for',
    },
    {
      name: 'attribute',
      label: 'Attribute (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., brightness, temperature',
      description: 'Check a specific attribute instead of the state',
    },
    {
      name: 'for',
      label: 'For Duration (optional)',
      type: 'duration',
      required: false,
      placeholder: '00:05:00',
      description: 'How long the condition must be true',
    },
  ],

  // Numeric state condition: checks if entity value is within range
  numeric_state: [
    {
      name: 'entity_id',
      label: 'Entity',
      type: 'entity',
      required: true,
      multiple: true,
      description: 'The sensor entity to check',
    },
    {
      name: 'above',
      label: 'Above (optional)',
      type: 'number_or_entity',
      required: false,
      placeholder: 'Minimum value',
      description: 'Condition is true when value > this — a fixed number, or another entity’s live value',
    },
    {
      name: 'below',
      label: 'Below (optional)',
      type: 'number_or_entity',
      required: false,
      placeholder: 'Maximum value',
      description: 'Condition is true when value < this — a fixed number, or another entity’s live value',
    },
    {
      name: 'attribute',
      label: 'Attribute (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., brightness, temperature',
      description: 'Check a specific attribute instead of the state',
    },
    {
      name: 'value_template',
      label: 'Value Template (optional)',
      type: 'template',
      required: false,
      placeholder: 'e.g., {{ state.attributes.temperature }}',
      description: 'Template to extract the numeric value to compare, instead of the entity’s own state',
    },
    // No `for` here — unlike the numeric_state TRIGGER (which does support
    // `for`), real HA's Numeric state CONDITION has no `for` option; the
    // official docs (home-assistant.io/docs/scripts/conditions/#numeric-state-condition)
    // list entity_id/above/below/value_template/attribute only and note
    // `for` is exclusive to the State condition. Verified against two
    // independent sources (the docs page directly, and a home-assistant/core
    // schema lookup) before removing what had been a real bug: this field
    // used to be included here and would produce YAML voluptuous rejects at
    // HA's config-validation step for anyone who set it.
  ],

  // Template condition: evaluates a Jinja2 template
  template: [
    {
      name: 'value_template',
      label: 'Value Template',
      type: 'template',
      required: true,
      placeholder: '{{ states("sensor.temperature") | float > 20 }}',
      description: 'Template that should evaluate to true/false',
    },
  ],

  // Time condition: checks if current time is within a window. HA's after/
  // before also accept a time helper (input_datetime), a time entity, or a
  // "timestamp" device-class sensor instead of a fixed clock time
  // (home-assistant.io/docs/scripts/conditions/#time-condition) — same
  // free-text-or-entity pattern already used for the time trigger's `at`
  // field (config/triggerFields.ts), reused here rather than a fixed-only
  // <input type="time">.
  time: [
    {
      name: 'after',
      label: 'After (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., 15:00:00 or input_datetime.house_silent_hours_start',
      description: 'Condition is true after this time (HH:MM:SS or an entity reference)',
    },
    {
      name: 'before',
      label: 'Before (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., 02:00:00 or input_datetime.house_silent_hours_end',
      description: 'Condition is true before this time (HH:MM:SS or an entity reference)',
    },
    {
      name: 'weekday',
      label: 'Weekday (optional)',
      type: 'select',
      required: false,
      multiple: true,
      description: 'Days of the week when condition is true',
      options: [
        { value: 'mon', label: 'Monday' },
        { value: 'tue', label: 'Tuesday' },
        { value: 'wed', label: 'Wednesday' },
        { value: 'thu', label: 'Thursday' },
        { value: 'fri', label: 'Friday' },
        { value: 'sat', label: 'Saturday' },
        { value: 'sun', label: 'Sunday' },
      ],
    },
  ],

  // Sun condition: checks sun position (above/below horizon)
  sun: [
    {
      name: 'after',
      label: 'After',
      type: 'select',
      required: false,
      description: 'Condition is true after this sun event',
      options: [
        { value: 'sunrise', label: 'Sunrise' },
        { value: 'sunset', label: 'Sunset' },
      ],
    },
    {
      name: 'after_offset',
      label: 'After Offset (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., -00:30:00',
      description: 'Time offset for the after event',
    },
    {
      name: 'before',
      label: 'Before',
      type: 'select',
      required: false,
      description: 'Condition is true before this sun event',
      options: [
        { value: 'sunrise', label: 'Sunrise' },
        { value: 'sunset', label: 'Sunset' },
      ],
    },
    {
      name: 'before_offset',
      label: 'Before Offset (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., +01:00:00',
      description: 'Time offset for the before event',
    },
  ],

  // Zone condition: checks if entity is in a zone. HA supports testing
  // multiple entities at once — "The condition will pass if all entities
  // are in the specified zone" (home-assistant.io/docs/scripts/conditions/
  // #zone-condition) — same multi-entity pattern as state/numeric_state.
  // `zone` and `state` are alternate ways to specify the target zone(s):
  // `zone` is a single fixed zone every entity must be in, while `state`
  // takes a list of zones and passes if the entity is in *any* of them
  // (same OR-match role `state`'s list form plays for the `state`
  // condition) — confirmed directly against the doc's "Testing if an entity
  // is matching a set of possible zones" example, which uses `state` with
  // no `zone` key at all. Neither is marked required here since they're
  // alternates, not both-required.
  zone: [
    {
      name: 'entity_id',
      label: 'Entity',
      type: 'entity',
      required: true,
      multiple: true,
      description: 'Person or device tracker(s) to monitor',
    },
    {
      name: 'zone',
      label: 'Zone (optional)',
      type: 'zone',
      required: false,
      placeholder: 'zone.home',
      description: 'A single zone every entity must be in — alternative to "Any Of These Zones" below',
    },
    {
      name: 'state',
      label: 'Any Of These Zones (optional)',
      type: 'zone',
      required: false,
      multiple: true,
      description: 'Passes if the entity is in any zone from this list — alternative to a single fixed Zone above',
    },
    {
      name: 'for',
      label: 'For Duration (optional)',
      type: 'duration',
      required: false,
      placeholder: '00:05:00',
      description: 'How long the entity must be in the zone',
    },
  ],

  // Trigger condition: checks which trigger fired
  trigger: [
    {
      name: 'id',
      label: 'Trigger ID(s)',
      type: 'text',
      required: true,
      multiple: true,
      placeholder: 'e.g., arriving, leaving',
      description: 'The ID(s) of the trigger(s) to match',
    },
  ],

  // Device condition: uses dynamic fields from API
  device: [],

  // Logical group types: handled by ConditionGroupEditor
  and: [],
  or: [],
  not: [],
};

/**
 * Get field configuration for a condition type
 */
export function getConditionFields(conditionType: ConditionType): FieldConfig[] {
  return CONDITION_TYPE_FIELDS[conditionType] || [];
}

/**
 * Get default values for a condition type based on field configurations
 */
export function getConditionDefaults(conditionType: ConditionType): Record<string, unknown> {
  const fields = getConditionFields(conditionType);
  const defaults: Record<string, unknown> = { condition: conditionType };

  for (const field of fields) {
    if (field.default !== undefined) {
      defaults[field.name] = field.default;
    }
  }

  // Logical group types need an empty conditions array
  if (isLogicalGroupType(conditionType)) {
    defaults.conditions = [];
  }

  return defaults;
}

/**
 * Check if a condition type uses device automation API
 */
export function usesDeviceAutomationForCondition(conditionType: ConditionType): boolean {
  return conditionType === 'device';
}

/**
 * Check if a condition type is a logical group type
 */
export function isLogicalGroupType(conditionType: ConditionType): boolean {
  return conditionType === 'and' || conditionType === 'or' || conditionType === 'not';
}

/**
 * Every field name any condition editor can write onto a condition node's
 * data, across every condition "shape" — not just CONDITION_TYPE_FIELDS'
 * own legacy flat types (state/numeric_state/time/...), but also the fields
 * NativeConditionFields.tsx writes for purpose-specific dotted conditions
 * (`target`, `options` — the latter holds inline threshold state, e.g.
 * `options.threshold`) and the fields DeviceConditionFields.tsx writes for
 * device conditions (`device_id`, `domain`, `subtype`, `type`).
 *
 * Single authoritative list so every place that reconfigures an existing
 * condition node from one type to another can clear the *previous* type's
 * fields before applying the new ones, instead of each maintaining its own
 * partial list that silently drifts out of sync with new condition shapes
 * as they're added (which is exactly how this bug happened: `options` and
 * `target` were added for native conditions well after
 * ConditionFields.tsx's own handleConditionTypeChange was written against
 * CONDITION_TYPE_FIELDS alone). Concretely reported: reconfiguring an
 * If/Else's condition from a purpose-specific type with a threshold (which
 * sets `options.threshold`) to the legacy "Time" type left the stale
 * `options` object in place, and HA's own config validator rejects it
 * outright at save time — "extra keys not allowed @ ...['options']" —
 * since `options` isn't a real key on the `time` condition schema.
 */
export function getAllConditionFieldNames(): string[] {
  const legacyFieldNames = Object.values(CONDITION_TYPE_FIELDS).flatMap((fields) =>
    fields.map((f) => f.name)
  );
  const nativeAndDeviceFieldNames = ['target', 'options', 'device_id', 'domain', 'subtype', 'type'];
  return Array.from(new Set([...legacyFieldNames, ...nativeAndDeviceFieldNames]));
}
