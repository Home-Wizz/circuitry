/**
 * Classification for HA's purpose-specific ("2025.12+ Labs preview")
 * conditions whose real value-to-check isn't a threshold at all, but a
 * device-specific mode/option string (or list of them) — e.g.
 * `climate.is_hvac_mode`'s `options.hvac_mode`, `select.is_option_selected`'s
 * `options.option`. Before this classifier existed, NativeConditionFields.tsx
 * had no branch for these at all: getConditionThresholdShape correctly
 * returned 'none' for them (they're not thresholds), so the panel rendered
 * only target + behavior — completely missing the actual value being
 * checked, the single most important field on the condition.
 *
 * Every one of these accepts a `string | list` of mode/option strings and,
 * per home-assistant.io, is device-specific ("Only the modes available on
 * the targeted device are shown") — there's no fixed universal enum to
 * offer, so Circuitry renders a free-form chip list (IdList) rather than a
 * static <select>, letting the user type the exact mode/option string(s)
 * their device supports instead of guessing at a hardcoded list that could
 * be wrong for their hardware.
 *
 * Each entry was individually confirmed against home-assistant.io/
 * conditions/<type>/ during the follow-up functional-parity audit — not
 * pattern-matched — since the field name genuinely differs per domain
 * (`hvac_mode`, `mode`, `operation_mode`, `option`), unlike the threshold
 * family's consistently-named `threshold`.
 */

/**
 * i18n key suffixes under `nodes:conditions.native.enumFieldLabels` — kept as
 * a literal union (rather than `string`) so `t(\`...enumFieldLabels.${labelKey}\`)`
 * type-checks against i18next's generated key set at the call site.
 */
export type ConditionEnumFieldLabelKey = 'hvacMode' | 'mode' | 'operationMode' | 'option' | 'zone';

export interface ConditionEnumField {
  /** The key inside `options` this condition's mode/option value lives at. */
  optionsKey: string;
  /** i18n key suffix for the field's label, under `nodes:conditions.native.enumFieldLabels`. */
  labelKey: ConditionEnumFieldLabelKey;
  /**
   * Whether home-assistant.io documents this field as `Required` — used by
   * AndConditionDialog.tsx's `handleSelectRecipeConfigurable` to decide
   * whether picking this recipe needs a config step before committing
   * (mirrors lib/triggerEnumField.ts's identical `required` flag). A
   * required field with no sensible default (e.g. `select.is_option_selected`
   * without an option) would otherwise commit a condition that always
   * evaluates false. (`humidifier.is_mode` was treated as optional, as
   * HA's docs have it; HA's validator requires it -- #122.)
   */
  required: boolean;
}

const CONDITION_ENUM_FIELDS: Record<string, ConditionEnumField> = {
  // home-assistant.io/conditions/climate.is_hvac_mode/: "hvac_mode string | list Required"
  'climate.is_hvac_mode': { optionsKey: 'hvac_mode', labelKey: 'hvacMode', required: true },
  // humidifier.is_mode: HA's docs don't mark `mode` required, but HA
  // 2026.9.3's validator refuses the condition without it (#122).
  'humidifier.is_mode': { optionsKey: 'mode', labelKey: 'mode', required: true },
  // home-assistant.io/conditions/water_heater.is_operation_mode/: "operation_mode string | list Required"
  'water_heater.is_operation_mode': {
    optionsKey: 'operation_mode',
    labelKey: 'operationMode',
    required: true,
  },
  // home-assistant.io/conditions/select.is_option_selected/: "option string | list Required"
  'select.is_option_selected': { optionsKey: 'option', labelKey: 'option', required: true },
  // zone/condition.py (HA 2026.9): each takes the zone(s) to test, a
  // required `zone` list of zone entities (#122: the panel had no field).
  'zone.in_zone': { optionsKey: 'zone', labelKey: 'zone', required: true },
  'zone.not_in_zone': { optionsKey: 'zone', labelKey: 'zone', required: true },
  'zone.occupancy_is_detected': { optionsKey: 'zone', labelKey: 'zone', required: true },
  'zone.occupancy_is_not_detected': { optionsKey: 'zone', labelKey: 'zone', required: true },
};

export function getConditionEnumField(conditionType: string): ConditionEnumField | undefined {
  return CONDITION_ENUM_FIELDS[conditionType];
}

/**
 * `text.is_equal_to`'s `options.value` is a SINGLE required string (no list
 * form, unlike the enum family above) — home-assistant.io/conditions/
 * text.is_equal_to/: "value string Required". Kept as its own tiny
 * classifier rather than shoehorned into the enum-field table above, since
 * it needs a plain text input, not an IdList.
 */
const CONDITION_SINGLE_VALUE_FIELDS = new Set<string>(['text.is_equal_to']);

export function hasConditionSingleValueField(conditionType: string): boolean {
  return CONDITION_SINGLE_VALUE_FIELDS.has(conditionType);
}
