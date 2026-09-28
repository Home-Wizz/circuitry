/**
 * Shared types and classification for HA's purpose-specific ("2025.12+
 * Labs preview") trigger/condition fields — e.g.
 * `light.brightness_crossed_threshold`, `illuminance.crossed_threshold`,
 * `humidity.is_value`, `climate.is_target_humidity`, `lock.locked`.
 *
 * This file grew out of a narrow "which types have a numeric threshold"
 * question into the canonical classification for the ENTIRE dotted
 * trigger/condition catalog (packages/frontend/src/lib/triggerRecipes.ts +
 * conditionRecipes.ts), verified against live home-assistant.io
 * documentation across multiple audit passes, the latest a full
 * "Device types" trigger-catalog re-audit (parallel research passes per
 * domain cluster, each independently cross-checked, plus adversarial
 * re-verification against raw home-assistant.io markdown source rather
 * than rendered-page summaries).
 *
 * Three `options.threshold` wire shapes exist:
 * - FLAT: bare `{number}` / `{entity}` value, no `type` wrapper. **No
 *   catalog entry is currently classified this way** — see the correction
 *   below.
 * - FLAT-SIMPLE: `{ above?, below? }` — bare `above`/`below` keys directly
 *   under `threshold`, no `type`/`value` nesting. Confirmed unique to
 *   `humidifier.is_target_humidity` (its sibling `climate.is_target_humidity`
 *   uses the full TYPED shape instead — a genuine HA doc asymmetry, not an
 *   error).
 * - TYPED: `{ type: 'above'|'below'|'between'|'outside'|'any', value?,
 *   value_min?, value_max? }`. Every other threshold-bearing domain
 *   (illuminance/battery/humidity/temperature/power/moisture/air_quality/
 *   counter/media_player volume/climate targets/water_heater targets/
 *   sun.elevation/todo.incomplete). `type: 'any'` is only offered for
 *   CHANGED-mode triggers (every `*.changed`/`*_changed` trigger except
 *   `light.brightness_changed`) — see `triggerAllowsAnyThreshold`.
 *
 * CORRECTION (superseding the "FLAT" classification a prior pass gave
 * light's brightness fields and every `air_quality.is_*_value` condition):
 * a user's live HA screenshot showed `light.is_brightness` rendering the
 * same Above/Below/In range/Outside range selector as every other TYPED
 * condition — directly contradicting that classification, which had been
 * based on WebFetch summaries of the rendered home-assistant.io docs pages
 * (shown this session to be an unreliable source: a small, fast
 * summarization model, prone to dropping the one nested-object detail that
 * distinguishes FLAT from TYPED). Re-verified against the actual Python
 * source: `light/condition.py`'s `BrightnessCondition` extends
 * `EntityNumericalConditionBase`, whose `_schema` is
 * `NUMERICAL_CONDITION_SCHEMA` — `options.threshold` there is a
 * `NumericThresholdSelector` (the TYPED `type`/`value`/`value_min`/
 * `value_max` shape), never a bare number. `air_quality`'s 13 `is_*_value`
 * conditions are built via `make_entity_numerical_condition`/
 * `make_entity_numerical_condition_with_unit` — both factories, confirmed
 * in `helpers/condition.py`, return classes extending
 * `EntityNumericalConditionBase`/`EntityNumericalConditionWithUnitBase`
 * using that same `NumericThresholdSelector`-based schema. `light`'s two
 * brightness triggers (`brightness_changed`/`brightness_crossed_threshold`)
 * are likewise built on `EntityNumericalStateChangedTriggerBase`/
 * `EntityNumericalStateCrossedThresholdTriggerBase` (`helpers/trigger.py`),
 * both using `NUMERICAL_ATTRIBUTE_CHANGED_TRIGGER_SCHEMA`/
 * `NUMERICAL_ATTRIBUTE_CROSSED_THRESHOLD_SCHEMA` — again TYPED, not FLAT.
 * So every one of these is now classified TYPED (see
 * VERIFIED_TYPED_CONDITION_TYPES/VERIFIED_TYPED_TRIGGER_TYPES below); the
 * FLAT_THRESHOLD_* sets are kept (empty) rather than deleted, in case a
 * genuinely FLAT type is found in the future.
 *
 * Which of them take `options.behavior` and `options.for` is read from
 * HA's own validators, not its docs (#117): see triggerOptionFields/
 * conditionOptionFields below.
 */

export interface ThresholdNumberValue {
  number: number;
  unit_of_measurement?: string;
}

export interface ThresholdEntityValue {
  entity: string;
}

/** A single bound of a threshold — a literal number or a live entity reference. */
export type ThresholdValue = ThresholdNumberValue | ThresholdEntityValue;

export function isEntityThresholdValue(
  value: ThresholdValue | undefined
): value is ThresholdEntityValue {
  return !!value && typeof value === 'object' && 'entity' in value;
}

export function isNumberThresholdValue(
  value: ThresholdValue | undefined
): value is ThresholdNumberValue {
  return !!value && typeof value === 'object' && 'number' in value;
}

export type ThresholdCrossingType = 'above' | 'below' | 'between' | 'outside' | 'any';

export const THRESHOLD_CROSSING_TYPES: ThresholdCrossingType[] = [
  'above',
  'below',
  'between',
  'outside',
];

/** The TYPED shape's `options.threshold` value. */
export interface TypedThreshold {
  type?: ThresholdCrossingType;
  value?: ThresholdValue;
  value_min?: ThresholdValue;
  value_max?: ThresholdValue;
}

/** The FLAT-SIMPLE shape's `options.threshold` value — see `humidifier.is_target_humidity`. */
export interface SimpleThreshold {
  above?: ThresholdValue;
  below?: ThresholdValue;
}

export type ThresholdShape = 'flat' | 'flat-simple' | 'typed' | 'none';

// No catalog entry is currently confirmed FLAT — light's brightness
// fields and air_quality's `is_*_value` conditions were wrongly classified
// here by a prior pass (based on unreliable WebFetch doc summaries); all
// have since been confirmed TYPED via direct Python source (see the
// CORRECTION in this file's top doc comment) and moved to
// VERIFIED_TYPED_TRIGGER_TYPES/VERIFIED_TYPED_CONDITION_TYPES below. Kept
// as empty sets (rather than deleted) so `getTriggerThresholdShape`/
// `getConditionThresholdShape` still have a FLAT branch ready if a
// genuinely FLAT type turns up.
const FLAT_THRESHOLD_TRIGGER_TYPES = new Set<string>([]);

const FLAT_THRESHOLD_CONDITION_TYPES = new Set<string>([]);

// FLAT-SIMPLE (`{above, below}`): no type in HA 2026.9 has it. It was given
// to humidifier.is_target_humidity from HA's docs, but HA's validator reads
// that condition's threshold as TYPED like every other and refused the
// bare shape (#122). Kept (empty) with the other shapes in case one turns up.
const FLAT_SIMPLE_THRESHOLD_CONDITION_TYPES = new Set<string>([]);

// TYPED, individually fetched and confirmed from home-assistant.io. Every
// `*.changed`/`*_changed` trigger here uses the SAME typed
// `{type, value/value_min/value_max}` shape as its `crossed_threshold`
// sibling, but additionally supports `type: 'any'` (fires on any value
// change, no bound) — except `light.brightness_changed`, the one confirmed
// exception — see `triggerAllowsAnyThreshold` below and
// ThresholdTypeField.tsx's `allowAny` prop.
const VERIFIED_TYPED_TRIGGER_TYPES = new Set<string>([
  'illuminance.changed',
  'illuminance.crossed_threshold',
  'battery.level_changed',
  'battery.level_crossed_threshold',
  'humidity.changed',
  'humidity.crossed_threshold',
  'temperature.changed',
  'temperature.crossed_threshold',
  'water_heater.target_temperature_changed',
  'water_heater.target_temperature_crossed_threshold',
  // Confirmed TYPED via `EntityNumericalStateChangedTriggerBase`/
  // `EntityNumericalStateCrossedThresholdTriggerBase` in helpers/trigger.py
  // — see the CORRECTION in this file's top doc comment. Also listed
  // explicitly even though `brightness_crossed_threshold` would already
  // match the `.includes('crossed')` pattern fallback below, for clarity.
  'light.brightness_changed',
  'light.brightness_crossed_threshold',
  // climate's target_temperature/target_humidity triggers — confirmed via
  // home-assistant/core's climate/trigger.py: ClimateTargetTemperatureChangedTrigger
  // / ClimateTargetTemperatureCrossedThresholdTrigger extend
  // EntityNumericalStateChangedTriggerWithUnitBase /
  // EntityNumericalStateCrossedThresholdTriggerWithUnitBase (temperature,
  // unit-aware via TemperatureConverter); the target_humidity siblings
  // extend the same base classes without the unit wrapper (plain
  // percentage, like humidity.is_value). Previously climate had NO native
  // triggers at all here — every "Thermostat target temperature/humidity
  // changed/crossed threshold" recipe fell back to a generic numeric_state
  // trigger with no target/behavior/for, and no threshold type (above/
  // below/between/outside) selector — while the CONDITION side
  // (climate.is_target_temperature/is_target_humidity) already had full
  // native support.
  'climate.target_temperature_changed',
  'climate.target_temperature_crossed_threshold',
  'climate.target_humidity_changed',
  'climate.target_humidity_crossed_threshold',
  // power — home-assistant/core's power/trigger.py:
  // make_entity_numerical_state_changed_with_unit_trigger /
  // ..._crossed_threshold_with_unit_trigger, unit Watts.
  'power.changed',
  'power.crossed_threshold',
  // moisture (numeric %, sensor device_class `moisture`) — distinct from
  // the boolean binary_sensor `moisture.detected`/`moisture.cleared` pair
  // below, which has no threshold at all (shape 'none').
  'moisture.changed',
  'moisture.crossed_threshold',
  // media_player volume — VolumeChangedTrigger/VolumeCrossedThresholdTrigger
  // in media_player/trigger.py; the tracked value is normalized 0-100%
  // (`_get_tracked_value` multiplies the entity's 0-1 `volume_level` by
  // 100), not the raw attribute — see PERCENT_RANGE_TYPES/getThresholdUnit.
  'media_player.volume_changed',
  'media_player.volume_crossed_threshold',
  // sun.elevation_changed/crossed_threshold — home-assistant/core's
  // sun/trigger.py `_ELEVATION_CHANGED_TRIGGER_SCHEMA`/
  // `_ELEVATION_CROSSED_TRIGGER_SCHEMA`. Both are singleton triggers (no
  // user-selectable target — HA hardcodes `sun.sun` internally), like the
  // `sun.elevation` condition; see NativeTriggerFields.tsx's
  // `isSunSingleton` branch. `elevation_crossed_threshold` additionally has
  // NO `behavior` option even though it has `for` — a combination not seen
  // anywhere else in the catalog, confirmed via the source's own comment:
  // "Unlike the generic numerical triggers there is no behavior option: a
  // behavior (each/first/all) is only meaningful across multiple targeted
  // entities" (sun is always exactly one entity). See
  // `FOR_ONLY_TRIGGER_TYPES` below.
  'sun.elevation_changed',
  'sun.elevation_crossed_threshold',
  // air_quality — all 13 `*_changed`/`*_crossed_threshold` pairs, confirmed
  // via home-assistant/core's air_quality/trigger.py TRIGGERS dict (every
  // slug below appears verbatim there) and cross-checked against the
  // authoritative home-assistant.io/triggers/ index. Mirrors the
  // already-verified 13 `air_quality.is_*_value` CONDITION entries above.
  'air_quality.co2_changed',
  'air_quality.co2_crossed_threshold',
  'air_quality.co_changed',
  'air_quality.co_crossed_threshold',
  'air_quality.n2o_changed',
  'air_quality.n2o_crossed_threshold',
  'air_quality.no2_changed',
  'air_quality.no2_crossed_threshold',
  'air_quality.no_changed',
  'air_quality.no_crossed_threshold',
  'air_quality.ozone_changed',
  'air_quality.ozone_crossed_threshold',
  'air_quality.pm10_changed',
  'air_quality.pm10_crossed_threshold',
  'air_quality.pm1_changed',
  'air_quality.pm1_crossed_threshold',
  'air_quality.pm25_changed',
  'air_quality.pm25_crossed_threshold',
  'air_quality.pm4_changed',
  'air_quality.pm4_crossed_threshold',
  'air_quality.so2_changed',
  'air_quality.so2_crossed_threshold',
  'air_quality.voc_ratio_changed',
  'air_quality.voc_ratio_crossed_threshold',
  'air_quality.voc_changed',
  'air_quality.voc_crossed_threshold',
]);

/**
 * Classifies a dotted (purpose-specific) trigger type's `options.threshold`
 * shape. Anything ending in `crossed_threshold` other than light's — power,
 * etc. — is treated as TYPED by pattern match (same `_crossed_threshold`
 * naming family as the domains individually verified above). Non-threshold
 * dotted triggers (turned_on/off, lock states, ...) get 'none'.
 */
export function getTriggerThresholdShape(triggerType: string): ThresholdShape {
  if (FLAT_THRESHOLD_TRIGGER_TYPES.has(triggerType)) return 'flat';
  if (VERIFIED_TYPED_TRIGGER_TYPES.has(triggerType)) return 'typed';
  // Covers the `*_crossed_threshold` family not yet individually verified
  // (e.g. power.crossed_threshold) — HA's own naming isn't fully consistent
  // between domains here, so we match on the shared "crossed" fragment
  // rather than the exact suffix.
  if (triggerType.includes('crossed')) return 'typed';
  return 'none';
}

// TYPED, individually fetched and confirmed from home-assistant.io during
// this session's catalog-wide audit.
const VERIFIED_TYPED_CONDITION_TYPES = new Set<string>([
  'humidity.is_value',
  'climate.is_target_humidity',
  'humidifier.is_target_humidity',
  'climate.is_target_temperature',
  'battery.is_level',
  'media_player.is_volume',
  'todo.incomplete',
  'power.is_value',
  'counter.is_value',
  'moisture.is_value',
  'water_heater.is_target_temperature',
  // `sun.elevation` is TYPED too, but — uniquely among every TYPED
  // condition verified this session — HA documents it with no target (the
  // sun is a singleton) and no sibling `for` field. See
  // NativeConditionFields.tsx's sun-singleton branch, which suppresses
  // target/behavior/for for every `sun.*` condition.
  'sun.elevation',
  'illuminance.is_value',
  'temperature.is_value',
  // Confirmed TYPED via `light/condition.py`'s `BrightnessCondition(
  // EntityNumericalConditionBase)` and `EntityNumericalConditionBase._schema
  // = NUMERICAL_CONDITION_SCHEMA` (helpers/condition.py) — see the
  // CORRECTION in this file's top doc comment. A prior pass had this wrong
  // as FLAT; a user's live HA screenshot (missing Above/Below/In range/
  // Outside range selector) is what surfaced the error.
  'light.is_brightness',
  // Confirmed TYPED via `make_entity_numerical_condition`/
  // `make_entity_numerical_condition_with_unit` (helpers/condition.py) —
  // both factories return classes extending EntityNumericalConditionBase/
  // EntityNumericalConditionWithUnitBase, using the same NumericThreshold
  // Selector-based schema. A prior pass had these wrong as FLAT (see
  // CORRECTION above) — listed explicitly here rather than relying on the
  // `_value`-suffix fallback below, since that fallback used to carry an
  // (now-removed) air_quality exclusion.
  'air_quality.is_co2_value',
  'air_quality.is_co_value',
  'air_quality.is_n2o_value',
  'air_quality.is_no2_value',
  'air_quality.is_no_value',
  'air_quality.is_ozone_value',
  'air_quality.is_pm10_value',
  'air_quality.is_pm1_value',
  'air_quality.is_pm25_value',
  'air_quality.is_pm4_value',
  'air_quality.is_so2_value',
  'air_quality.is_voc_ratio_value',
  'air_quality.is_voc_value',
]);

/**
 * Classifies a dotted (purpose-specific) condition type's `options.threshold`
 * shape. Before this, ConditionFields.tsx had no branch at all for dotted
 * condition types — every purpose-specific condition rendered zero fields.
 */
export function getConditionThresholdShape(conditionType: string): ThresholdShape {
  if (FLAT_THRESHOLD_CONDITION_TYPES.has(conditionType)) return 'flat';
  if (FLAT_SIMPLE_THRESHOLD_CONDITION_TYPES.has(conditionType)) return 'flat-simple';
  if (VERIFIED_TYPED_CONDITION_TYPES.has(conditionType)) return 'typed';
  // Defensive catch-all for any current or future `_value`-suffixed dotted
  // condition not already listed above — safer than silently defaulting a
  // real value condition to 'none' (no threshold field at all) the next
  // time HA adds one of these. (A prior version of this fallback excluded
  // `air_quality.*` as supposedly FLAT despite the suffix — that
  // classification was wrong; see the CORRECTION in this file's top doc
  // comment. All 13 air_quality `_value` conditions are now listed
  // explicitly in VERIFIED_TYPED_CONDITION_TYPES above anyway, so this
  // fallback no longer needs a domain exclusion.)
  if (conditionType.endsWith('_value')) return 'typed';
  return 'none';
}

/**
 * Adds `type: 'any'` (fires on any change, no value fields) to a TYPED
 * trigger's crossing-type options — every CHANGED-mode trigger (the
 * `changed` ones in `NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES` below) EXCEPT `light.brightness_changed`,
 * the one confirmed exception (HA's own UI doesn't expose a `type: 'any'`
 * toggle for it despite it otherwise being a CHANGED-mode trigger like
 * every type below).
 */
const ALLOW_ANY_THRESHOLD_TRIGGER_TYPES = new Set<string>([
  'illuminance.changed',
  'battery.level_changed',
  'humidity.changed',
  'temperature.changed',
  'climate.target_temperature_changed',
  'climate.target_humidity_changed',
  // Directly confirmed via home-assistant.io/triggers/water_heater.target_temperature_changed/:
  // "type: any: Fires on any target temperature change."
  'water_heater.target_temperature_changed',
  // Directly confirmed via home-assistant.io/triggers/power.changed/:
  // "Fires on any power change."
  'power.changed',
  // Directly confirmed via home-assistant.io/triggers/moisture.changed/.
  'moisture.changed',
  // Directly confirmed via home-assistant.io/triggers/media_player.volume_changed/
  // (raw markdown source): "type: any - fires on any volume change".
  'media_player.volume_changed',
  // Confirmed via home-assistant/core's sun/trigger.py:
  // `_ELEVATION_CHANGED_TRIGGER_SCHEMA` uses `NumericThresholdMode.CHANGED`,
  // the same mode flag that gates `type: any` everywhere else in the catalog.
  'sun.elevation_changed',
  // air_quality's 13 `*_changed` triggers — CHANGED-mode rule applies
  // uniformly (confirmed for `air_quality.co2_changed`'s docs, consistent
  // with every other CHANGED-mode trigger in this list).
  'air_quality.co2_changed',
  'air_quality.co_changed',
  'air_quality.n2o_changed',
  'air_quality.no2_changed',
  'air_quality.no_changed',
  'air_quality.ozone_changed',
  'air_quality.pm10_changed',
  'air_quality.pm1_changed',
  'air_quality.pm25_changed',
  'air_quality.pm4_changed',
  'air_quality.so2_changed',
  'air_quality.voc_ratio_changed',
  'air_quality.voc_changed',
]);

export function triggerAllowsAnyThreshold(triggerType: string): boolean {
  return ALLOW_ANY_THRESHOLD_TRIGGER_TYPES.has(triggerType);
}

// ---------------------------------------------------------------------------
// `options.behavior` and `options.for`
// ---------------------------------------------------------------------------
//
// Read from HA 2026.9.3's own validators rather than its docs (#117):
// the tables below hold what each purpose-specific trigger and condition
// accepts there. Since HA 2026.5 a trigger's `behavior` is
// each/first/all (default each; the older `any`/`last` still load but raise
// a repair issue) and a condition's is any/all (default any), and both take
// `for`. Most of them take both; the sets below are the ones that don't.
//
// A new node never gets a `behavior` written for it: HA's own default then
// applies, which is valid in every HA version (#117 -- `behavior: each` was
// written on every new trigger, which HA refuses on the triggers below and
// which HA before 2026.5 refused on every trigger).

/** HA's behavior values since 2026.5 (its `automation_behavior` selector). */
export const TRIGGER_BEHAVIORS = ['each', 'first', 'all'];
const TRIGGER_DEFAULT_BEHAVIOR = 'each';
export const CONDITION_BEHAVIORS = ['any', 'all'];
const CONDITION_DEFAULT_BEHAVIOR = 'any';

// Triggers with no `behavior` and no `for`, whatever else they take.
const NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES = new Set<string>([
  // No options at all.
  'button.pressed',
  'counter.decremented',
  'counter.incremented',
  'doorbell.rang',
  'scene.activated',
  'select.selection_changed',
  'text.changed',
  'todo.item_added',
  'todo.item_completed',
  'todo.item_removed',
  // Every `changed` trigger of a number (its `crossed_threshold` sibling
  // takes both): helpers/trigger.py's NUMERICAL_ATTRIBUTE_CHANGED_TRIGGER_SCHEMA
  // extends ENTITY_STATE_TRIGGER_SCHEMA, not the _WITH_BEHAVIOR one.
  'light.brightness_changed',
  'illuminance.changed',
  'battery.level_changed',
  'humidity.changed',
  'temperature.changed',
  'power.changed',
  'moisture.changed',
  'media_player.volume_changed',
  'climate.target_temperature_changed',
  'climate.target_humidity_changed',
  'water_heater.target_temperature_changed',
  'sun.elevation_changed',
  'air_quality.co2_changed',
  'air_quality.co_changed',
  'air_quality.n2o_changed',
  'air_quality.no2_changed',
  'air_quality.no_changed',
  'air_quality.ozone_changed',
  'air_quality.pm10_changed',
  'air_quality.pm1_changed',
  'air_quality.pm25_changed',
  'air_quality.pm4_changed',
  'air_quality.so2_changed',
  'air_quality.voc_ratio_changed',
  'air_quality.voc_changed',
  // Their own options only: `remaining`, an offset, a phase, an event type.
  'timer.remaining_time_reached',
  'sun.dawn',
  'sun.dusk',
  'sun.solar_midnight',
  'sun.solar_noon',
  'sun.sunrise',
  'sun.sunset',
  'sun.blue_hour_started',
  'sun.blue_hour_ended',
  'sun.golden_hour_started',
  'sun.golden_hour_ended',
  'sun.midnight_sun_started',
  'sun.midnight_sun_ended',
  'sun.polar_night_started',
  'sun.polar_night_ended',
  'calendar.event_started',
  'calendar.event_ended',
  'moon.phase_changed',
  'event.received',
]);

// Triggers with `for` but no `behavior`: they have no targets to combine
// (sun/trigger.py: "a behavior (each/first/all) is only meaningful across
// multiple targeted entities").
const FOR_ONLY_TRIGGER_TYPES = new Set<string>([
  'sun.elevation_crossed_threshold',
  'zone.occupancy_detected',
  'zone.occupancy_cleared',
]);

// Conditions with no `behavior` and no `for`: the sun and the moon are
// singletons.
function conditionHasNeither(conditionType: string): boolean {
  return conditionType.startsWith('sun.') || conditionType.startsWith('moon.');
}

// Conditions with `for` but no `behavior`: a zone's occupancy is the
// zone's own, with no targets to combine.
const FOR_ONLY_CONDITION_TYPES = new Set<string>([
  'zone.occupancy_is_detected',
  'zone.occupancy_is_not_detected',
]);

/** What the property panel offers for a purpose-specific trigger's or
 * condition's `options.behavior` (its values, and the one HA uses when none
 * is written, which the panel shows then) and `options.for`. */
export interface NativeOptionFields {
  behavior?: { values: string[]; default: string };
  hasFor: boolean;
}

export function triggerOptionFields(triggerType: string): NativeOptionFields {
  if (NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES.has(triggerType)) return { hasFor: false };
  if (FOR_ONLY_TRIGGER_TYPES.has(triggerType)) return { hasFor: true };
  return { behavior: { values: TRIGGER_BEHAVIORS, default: TRIGGER_DEFAULT_BEHAVIOR }, hasFor: true };
}

export function conditionOptionFields(conditionType: string): NativeOptionFields {
  if (conditionHasNeither(conditionType)) return { hasFor: false };
  if (FOR_ONLY_CONDITION_TYPES.has(conditionType)) return { hasFor: true };
  return { behavior: { values: CONDITION_BEHAVIORS, default: CONDITION_DEFAULT_BEHAVIOR }, hasFor: true };
}

// Triggers confirmed to have NO target at all — beyond every `sun.*`
// trigger (handled separately via a `startsWith('sun.')` check, since it's
// the whole domain rather than a short explicit list): `moon.phase_changed`
// (moon phase is the same everywhere on Earth) and
// `zone.occupancy_detected`/`occupancy_cleared` (a zone's occupancy count is
// a property of the zone itself, not of any specific person/device_tracker
// — contrast with `zone.entered`/`left`, which DO target person/
// device_tracker entities and keep a normal target).
const TARGETLESS_TRIGGER_TYPES = new Set<string>([
  'moon.phase_changed',
  'zone.occupancy_detected',
  'zone.occupancy_cleared',
]);

// Conditions with no target (#118): the sun and the moon are singletons,
// and a zone's occupancy is the zone's own (its `zone` option says which).
const TARGETLESS_CONDITION_TYPES = new Set<string>(['zone.occupancy_is_detected', 'zone.occupancy_is_not_detected']);

/** True for a condition with no target at all -- see NativeConditionFields.tsx's target field, and buildConditionNodeData. */
export function conditionIsTargetless(conditionType: string): boolean {
  return (
    conditionType.startsWith('sun.') ||
    conditionType.startsWith('moon.') ||
    TARGETLESS_CONDITION_TYPES.has(conditionType)
  );
}

/** True for a trigger with no user-selectable target at all (every `sun.*` trigger, plus the few individually confirmed types in TARGETLESS_TRIGGER_TYPES) — see NativeTriggerFields.tsx's target-suppression branch. */
export function triggerIsTargetless(triggerType: string): boolean {
  return triggerType.startsWith('sun.') || TARGETLESS_TRIGGER_TYPES.has(triggerType);
}

/** The units HA takes for a threshold's number where it takes several (#119,
 * from HA 2026.9.3's numeric_threshold selectors): a number must name one
 * of them, or HA refuses the automation. Undefined where HA has one unit,
 * which is only shown. */
export function getThresholdUnits(dottedType: string): string[] | undefined {
  if (dottedType.includes('temperature')) return TEMPERATURE_UNITS;
  if (dottedType.startsWith('power.')) return POWER_UNITS;
  const gas = airQualityGas(dottedType);
  return gas ? AIR_QUALITY_UNITS[gas]?.units : undefined;
}

/** A threshold number as HA takes it (#119): with the unit it already has,
 * if HA takes that one, else `unit` (the type's default). */
export function thresholdNumber(
  number: number,
  previous: ThresholdValue | undefined,
  unit: string | undefined,
  units: string[] | undefined
): ThresholdNumberValue {
  const kept = isNumberThresholdValue(previous) ? previous.unit_of_measurement : undefined;
  const chosen = kept !== undefined && (units === undefined || units.includes(kept)) ? kept : unit;
  return { number, ...(chosen ? { unit_of_measurement: chosen } : {}) };
}

/**
 * The threshold a new node gets (#124): what the panel shows for one not
 * set -- "Any change" where the type offers it, else "Above 0" -- so the
 * node holds what the panel shows (a node created with none showed that
 * while HA refused the automation for having no threshold). Undefined for
 * a type with no threshold.
 */
export function defaultThreshold(
  kind: 'trigger' | 'condition',
  type: string
): number | TypedThreshold | undefined {
  const shape = kind === 'trigger' ? getTriggerThresholdShape(type) : getConditionThresholdShape(type);
  if (shape === 'none') return undefined;
  const zero = thresholdNumber(0, undefined, getThresholdUnit(type), getThresholdUnits(type));
  if (shape === 'flat') return 0;
  if (kind === 'trigger' && triggerAllowsAnyThreshold(type)) return { type: 'any' };
  return { type: 'above', value: zero };
}

/** The unit a new threshold number gets (and, where HA has one unit, the
 * one shown) -- one of getThresholdUnits' where there are several. */
export function getThresholdUnit(dottedType: string): string | undefined {
  if (dottedType.includes('temperature')) return '°C';
  if (dottedType.startsWith('power.')) return 'W';
  // Light's brightness fields (trigger `brightness_changed`/
  // `brightness_crossed_threshold`, condition `is_brightness`) and media
  // player volume are percentages.
  if (dottedType.startsWith('light.brightness') || dottedType === 'light.is_brightness') return '%';
  if (dottedType.startsWith('media_player.volume')) return '%';
  // sun.elevation/elevation_changed/elevation_crossed_threshold: degrees.
  if (dottedType === 'sun.elevation' || dottedType.startsWith('sun.elevation_')) return '°';
  const gas = airQualityGas(dottedType);
  return gas ? AIR_QUALITY_UNITS[gas]?.unit : undefined;
}

const TEMPERATURE_UNITS = ['°C', '°F'];
const POWER_UNITS = ['mW', 'W', 'kW', 'MW', 'GW', 'TW', 'BTU/h'];
// A Greek mu (U+03BC), as HA writes it: not the micro sign (U+00B5), which
// HA refuses.
const MICROGRAMS = '\u03bcg/m\u00b3';

// Per air_quality gas, HA's units (air_quality/trigger.py and condition.py).
const AIR_QUALITY_UNITS: Record<string, { units?: string[]; unit: string }> = {
  co2: { unit: 'ppm' },
  co: { units: ['ppb', 'ppm', 'mg/m\u00b3', MICROGRAMS], unit: MICROGRAMS },
  n2o: { unit: MICROGRAMS },
  no2: { units: ['ppb', 'ppm', MICROGRAMS], unit: MICROGRAMS },
  no: { units: ['ppb', MICROGRAMS], unit: MICROGRAMS },
  ozone: { units: ['ppb', 'ppm', MICROGRAMS], unit: MICROGRAMS },
  pm1: { unit: MICROGRAMS },
  pm10: { unit: MICROGRAMS },
  pm25: { unit: MICROGRAMS },
  pm4: { unit: MICROGRAMS },
  so2: { units: ['ppb', MICROGRAMS], unit: MICROGRAMS },
  voc: { units: [MICROGRAMS, 'mg/m\u00b3'], unit: MICROGRAMS },
  voc_ratio: { units: ['ppb', 'ppm'], unit: 'ppb' },
};

/** The gas an air_quality threshold type is about: `co` for
 * `air_quality.co_changed` and `air_quality.is_co_value` alike. */
function airQualityGas(dottedType: string): string | undefined {
  return /^air_quality\.(?:is_)?([a-z0-9_]+?)_(?:value|changed|crossed_threshold)$/.exec(dottedType)?.[1];
}

export interface ThresholdRange {
  min: number;
  max: number;
}

// 0-100% domains, individually confirmed against home-assistant.io —
// every one of these reports (or targets) a percentage. Deliberately NOT a
// blanket rule for every TYPED condition/trigger: illuminance (lux), power
// (W), temperature (°), counter (arbitrary int), the air_quality `_value`/
// `_changed`/`_crossed_threshold` entries (ppm/µg per m³/ratio — TYPED
// shape too as of the CORRECTION above, just not a percentage), and
// sun.elevation (degrees, can go negative) are all genuinely unbounded or
// non-percentage, so a hardcoded 0-100 would silently reject valid values
// for those.
const PERCENT_RANGE_TYPES = new Set<string>([
  // Directly confirmed via home-assistant.io/conditions/humidity.is_value/:
  // "For the number key, use a percentage value (0-100)."
  'humidity.is_value',
  'humidity.changed',
  'humidity.crossed_threshold',
  // Battery level is a percentage by convention across every HA battery
  // sensor/entity — the one non-negotiable percentage domain in HA itself.
  'battery.is_level',
  'battery.level_changed',
  'battery.level_crossed_threshold',
  // Humidity targets (climate, humidifier) are set as a percentage the same
  // way current humidity readings are.
  'climate.is_target_humidity',
  'humidifier.is_target_humidity',
  'climate.target_humidity_changed',
  'climate.target_humidity_crossed_threshold',
  // Moisture level (leak/soil sensors reporting a moisture percentage) —
  // both the condition and the trigger pair.
  'moisture.is_value',
  'moisture.changed',
  'moisture.crossed_threshold',
  // Volume is documented as a 0-100 percentage, NOT the 0-1 fraction HA's
  // own `media_player.volume_level` state attribute normally uses — true
  // for both the condition and the trigger pair (VolumeTriggerMixin
  // normalizes 0-1 -> 0-100 server-side).
  'media_player.is_volume',
  'media_player.volume_changed',
  'media_player.volume_crossed_threshold',
  // Light's brightness fields — see getThresholdUnit's matching entry.
  // TYPED shape as of the CORRECTION at the top of this file; still 0-100%
  // (unlike the 13 air_quality `_value` conditions, which are also TYPED
  // but genuinely unbounded — ppm/µg per m³ can go well past 100 — so they
  // deliberately have NO entry in this table).
  'light.brightness_changed',
  'light.brightness_crossed_threshold',
  'light.is_brightness',
]);

/**
 * Bounds to enforce on a TYPED threshold's number input, mirroring
 * getThresholdUnit's per-domain (not blanket) approach. Returns undefined
 * for domains with no natural upper bound (illuminance, power, temperature,
 * counter, the air_quality family, sun.elevation) — ThresholdValueField
 * already omits min/max entirely when undefined, matching HA's own UI which
 * only shows the "(0-100)" hint for percentage domains.
 */
export function getThresholdRange(dottedType: string): ThresholdRange | undefined {
  return PERCENT_RANGE_TYPES.has(dottedType) ? { min: 0, max: 100 } : undefined;
}
