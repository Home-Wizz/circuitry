/**
 * Trigger-side sibling of lib/conditionEnumField.ts — HA's purpose-specific
 * ("2025.12+ Labs preview") triggers whose real "which state did it change
 * to" value isn't a threshold at all, but a device-specific mode string (or
 * list of them): `humidifier.mode_changed`'s `options.mode`,
 * `water_heater.operation_mode_changed`'s `options.operation_mode`. Before
 * this classifier existed, NativeTriggerFields.tsx had no branch for these
 * at all — target + behavior + for rendered, but the actual mode being
 * watched for was silently unconfigurable (the trigger would fire for
 * every mode change, or in `operation_mode_changed`'s case commit invalid
 * YAML missing a field HA's own docs mark `required: true`).
 *
 * Each entry was individually confirmed against home-assistant.io/triggers/
 * <type>/ during the catalog-wide functional-parity audit. Unlike the
 * condition-side family (all four of which are `string | list Required`),
 * `humidifier.mode_changed`'s `mode` is documented optional — "omit to fire
 * on any mode change" — so `required` is tracked per entry rather than
 * assumed.
 */

export type TriggerEnumFieldLabelKey = 'hvacMode' | 'mode' | 'operationMode' | 'zone' | 'eventType';

export interface TriggerEnumField {
  /** The key inside `options` this trigger's mode value lives at. */
  optionsKey: string;
  /** i18n key suffix for the field's label, under `nodes:triggers.native.enumFieldLabels`. */
  labelKey: TriggerEnumFieldLabelKey;
  /** Whether HA documents this field as required (water_heater.operation_mode_changed) vs. optional/omittable (humidifier.mode_changed — omitting means "any mode"). */
  required: boolean;
}

const TRIGGER_ENUM_FIELDS: Record<string, TriggerEnumField> = {
  // home-assistant.io/triggers/climate.hvac_mode_changed/: HVAC_MODE_CHANGED_TRIGGER_SCHEMA
  // requires a non-empty `options.hvac_mode` list (coerced to HVACMode) —
  // mirrors the condition-side climate.is_hvac_mode, which was already
  // classified as required here; the trigger side was missing entirely
  // before this, so NativeTriggerFields.tsx rendered target+behavior+for
  // but silently dropped the actual HVAC mode(s) being watched for.
  'climate.hvac_mode_changed': { optionsKey: 'hvac_mode', labelKey: 'hvacMode', required: true },
  // home-assistant.io/triggers/humidifier.mode_changed/: "mode string — the
  // mode(s) that should fire the trigger; omit to fire on any mode change."
  'humidifier.mode_changed': { optionsKey: 'mode', labelKey: 'mode', required: false },
  // home-assistant.io/triggers/water_heater.operation_mode_changed/:
  // "operation_mode string | list Required — Only modes supported by the
  // targeted water heater are valid."
  'water_heater.operation_mode_changed': {
    optionsKey: 'operation_mode',
    labelKey: 'operationMode',
    required: true,
  },
  // home-assistant.io/triggers/zone.entered/, .../zone.left/,
  // .../zone.occupancy_detected/, .../zone.occupancy_cleared/: "zone
  // string Required — The zone to trigger on/monitor." A single zone
  // identifier per HA's own schema (not a list like the mode fields above),
  // but reuses the same IdList-backed rendering — a one-item list is still
  // valid, and this avoids a bespoke single-entity-picker component for one
  // field.
  'zone.entered': { optionsKey: 'zone', labelKey: 'zone', required: true },
  'zone.left': { optionsKey: 'zone', labelKey: 'zone', required: true },
  'zone.occupancy_detected': { optionsKey: 'zone', labelKey: 'zone', required: true },
  'zone.occupancy_cleared': { optionsKey: 'zone', labelKey: 'zone', required: true },
  // home-assistant.io/triggers/event.received/: "event_type string
  // Required — One or more event types to match. The available event types
  // depend on the target entity."
  'event.received': { optionsKey: 'event_type', labelKey: 'eventType', required: true },
};

export function getTriggerEnumField(triggerType: string): TriggerEnumField | undefined {
  return TRIGGER_ENUM_FIELDS[triggerType];
}
