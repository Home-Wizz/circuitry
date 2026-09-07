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
 * re-verification of every "no behavior/for" and "any/first/last" claim
 * against raw home-assistant.io markdown source rather than rendered-page
 * summaries).
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
 * Separately, `options.behavior` and `options.for` turned out to be the
 * RULE across most of the catalog — present on plain boolean triggers/
 * conditions (`lock.locked`, `motion.detected`, `fan.is_on`, ...) exactly
 * as much as on threshold-bearing ones — not a threshold-only feature as
 * originally assumed. See getTriggerBehaviorVariant/triggerHasFor/
 * getConditionBehaviorVariant/conditionHasFor below, which default to
 * "present" with small, individually-confirmed exception lists, rather
 * than requiring an opt-in entry per catalog type.
 *
 * CORRECTION #2 (trigger side only, this pass): `options.behavior` and
 * `options.for` are ALSO absent — universally, not just for
 * `light.brightness_changed` — from every CHANGED-mode TYPED trigger
 * (`*.changed`/`*_changed`, as opposed to their `crossed_threshold`
 * siblings). A prior pass treated `light.brightness_changed` as a lone,
 * domain-specific exception; re-verified this pass against raw
 * home-assistant.io markdown source (not rendered-page summaries, which
 * had — ironically — shown a phantom `behavior: first` example for
 * `climate.target_temperature_changed` that its own "Options in YAML"
 * reference table directly contradicts) for illuminance/humidity/power/
 * water_heater/climate's `.changed` triggers: none document `behavior` or
 * `for` in their authoritative options table, only `threshold`. This is a
 * schema-level rule (`NUMERICAL_ATTRIBUTE_CHANGED_TRIGGER_SCHEMA` in
 * `helpers/trigger.py` extends the bare `ENTITY_STATE_TRIGGER_SCHEMA`, not
 * the `_WITH_BEHAVIOR` variant crossed_threshold triggers use), not a
 * per-domain exception — see `CHANGED_MODE_TRIGGER_TYPES` below, which
 * replaces the old single-entry `NO_BEHAVIOR_TRIGGER_TYPES`/
 * `NO_FOR_TRIGGER_TYPES` sets now that they're always the same set.
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

// FLAT-SIMPLE: confirmed unique to this one condition (adversarially
// re-verified against its sibling climate.is_target_humidity, which uses
// the full TYPED shape instead — a real asymmetry in HA's own docs, not a
// fetch error).
const FLAT_SIMPLE_THRESHOLD_CONDITION_TYPES = new Set<string>(['humidifier.is_target_humidity']);

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
  'battery.level_crossed',
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
  // `NO_BEHAVIOR_KEEPS_FOR_TRIGGER_TYPES` below.
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
 * trigger's crossing-type options — every CHANGED-mode trigger (see
 * `CHANGED_MODE_TRIGGER_TYPES` below) EXCEPT `light.brightness_changed`,
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
// `behavior` variant + `for` presence — universal defaults with exceptions
// ---------------------------------------------------------------------------
//
// A catalog-wide audit (parallel research passes covering every domain in
// triggerRecipes.ts/conditionRecipes.ts, each cross-checked with a second,
// adversarial "try to refute this" pass) found `options.behavior` and
// `options.for` are the RULE across virtually every purpose-specific
// trigger/condition — including plain boolean ones (`lock.locked`,
// `motion.detected`, `fan.is_on`, `alarm_control_panel.is_armed`, ...), not
// just threshold-bearing types as originally assumed. So the functions
// below default to "present" and carry small, individually-confirmed
// exception lists, rather than the inverse (which would need an entry for
// every one of the ~150+ catalog types). The one systematic, large-scale
// exception is CHANGED-mode triggers — see `CHANGED_MODE_TRIGGER_TYPES`
// below.

export type ThresholdBehaviorVariant = 'each-first-all' | 'any-first-last' | 'any-all' | 'none';

// Triggers confirmed to have NO options block at all (bare target only) —
// home-assistant.io explicitly states "This trigger has no additional YAML
// options" for each of these.
const NO_OPTIONS_TRIGGER_TYPES = new Set<string>([
  'counter.decremented',
  'counter.incremented',
  'scene.activated',
  'select.selection_changed',
  'text.changed',
  'todo.item_added',
  'todo.item_completed',
  'todo.item_removed',
  // Confirmed via home-assistant.io/triggers/button.pressed/: "This trigger
  // has no additional YAML options beyond the target."
  'button.pressed',
]);

/** True for a trigger with genuinely zero `options` fields — not even `behavior`/`for` — so callers can skip rendering an (empty) options section entirely. */
export function triggerHasNoOptions(triggerType: string): boolean {
  return NO_OPTIONS_TRIGGER_TYPES.has(triggerType);
}

/**
 * Every CHANGED-mode TYPED trigger (`*.changed`/`*_changed`, as opposed to
 * its `crossed_threshold` sibling) — confirmed to universally lack BOTH
 * `behavior` and `for`, not just `light.brightness_changed` as a prior pass
 * assumed. Source: `helpers/trigger.py`'s
 * `NUMERICAL_ATTRIBUTE_CHANGED_TRIGGER_SCHEMA` extends the bare
 * `ENTITY_STATE_TRIGGER_SCHEMA` (target + empty options), never the
 * `_WITH_BEHAVIOR` variant its `crossed_threshold` sibling schema
 * (`NUMERICAL_ATTRIBUTE_CROSSED_THRESHOLD_SCHEMA`) uses — a mode-level rule
 * in the schema, not a per-domain exception. Adversarially re-verified
 * against raw home-assistant.io markdown source (not rendered-page
 * summaries) for illuminance.changed, humidity.changed, power.changed,
 * water_heater.target_temperature_changed, and both climate `*_changed`
 * triggers: every one of these "Options in YAML" reference tables lists
 * `threshold` ONLY — no `behavior`, no `for` — even where a stray
 * inline YAML *example* elsewhere on the same page shows `behavior: first`
 * (confirmed to be a documentation artifact/copy-paste leftover from the
 * crossed_threshold sibling's example, not a real option; the authoritative
 * reference table is what's trusted here). Replaces the old single-entry
 * `NO_BEHAVIOR_TRIGGER_TYPES`/`NO_FOR_TRIGGER_TYPES` sets, which were
 * always identical in content and are now provably always identical in
 * principle too.
 */
const CHANGED_MODE_TRIGGER_TYPES = new Set<string>([
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
]);

// Triggers with `for` but NO `behavior` — HA's own sun/trigger.py source
// comments this explicitly for `sun.elevation_crossed_threshold`: "Unlike
// the generic numerical triggers there is no behavior option: a behavior
// (each/first/all) is only meaningful across multiple targeted entities."
// `zone.occupancy_detected`/`occupancy_cleared` share the same combination
// for a different reason — confirmed via raw home-assistant.io markdown
// source: no target at all (`behavior` has nothing to combine results
// across), but `for` IS documented ("How long the zone must stay occupied
// before the trigger fires"). Kept as one set (rather than folded into
// CHANGED_MODE_TRIGGER_TYPES/NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES, both of which
// also strip `for`) since these are the only catalog entries with this
// specific behavior/for combination.
const NO_BEHAVIOR_KEEPS_FOR_TRIGGER_TYPES = new Set<string>([
  'sun.elevation_crossed_threshold',
  'zone.occupancy_detected',
  'zone.occupancy_cleared',
]);

// `timer.remaining_time_reached` — confirmed via home-assistant.io/triggers/
// timer.remaining_time_reached/: its only documented option is a required
// `remaining` duration; no `behavior`, no `for`. Kept as its own set (like
// NO_BEHAVIOR_KEEPS_FOR_TRIGGER_TYPES above) rather than folded into
// NO_OPTIONS_TRIGGER_TYPES, since this trigger DOES have an options field
// (`remaining` — see lib/triggerDurationField.ts) and NO_OPTIONS_TRIGGER_TYPES
// asserts zero options fields exist at all.
//
// The 6 non-numeric `sun.*` event triggers (dawn/dusk/solar_midnight/
// solar_noon/sunrise/sunset) are also here — confirmed via home-assistant/
// core's sun/trigger.py (`_EVENT_TRIGGER_SCHEMA`/`_DAWN_DUSK_TRIGGER_SCHEMA`)
// and raw home-assistant.io markdown source (sun.sunrise, sun.dawn): their
// only options are `offset`/`offset_type` (dawn/dusk additionally get
// `type`: civil/nautical/astronomical) — no `behavior`, no `for`, same as
// `timer.remaining_time_reached`. See lib/triggerOffsetField.ts for the new
// field type this needed. All 6 are singleton triggers (hardcode `sun.sun`,
// no target) — see NativeTriggerFields.tsx's `isSunSingleton` branch.
// `calendar.event_started`/`calendar.event_ended` — confirmed via raw
// home-assistant.io markdown source: "Target: Yes ... Behavior/For option:
// Not present on this trigger." Unlike the sun event triggers above,
// calendar KEEPS a normal target (which calendar(s) to watch) — only
// behavior/for are absent, alongside sun's offset/offset_type shape (see
// lib/triggerOffsetField.ts).
//
// `moon.phase_changed` — confirmed via home-assistant.io/triggers/
// moon.phase_changed/: no `behavior`, no `for`, and (like the sun event
// triggers) no target at all — "This trigger does not use a target. It
// follows the moon phase, which is the same everywhere on Earth." See
// TARGETLESS_TRIGGER_TYPES below.
//
// `event.received` — confirmed via home-assistant.io/triggers/
// event.received/: only documented option is a required `event_type`
// string/list (see lib/triggerEnumField.ts); no `behavior`, no `for`. Unlike
// moon/sun, this one KEEPS a normal target (a specific `event.*` entity).
const NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES = new Set<string>([
  'timer.remaining_time_reached',
  'sun.dawn',
  'sun.dusk',
  'sun.solar_midnight',
  'sun.solar_noon',
  'sun.sunrise',
  'sun.sunset',
  'calendar.event_started',
  'calendar.event_ended',
  'moon.phase_changed',
  'event.received',
]);

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

/** True for a trigger with no user-selectable target at all (every `sun.*` trigger, plus the few individually confirmed types in TARGETLESS_TRIGGER_TYPES) — see NativeTriggerFields.tsx's target-suppression branch. */
export function triggerIsTargetless(triggerType: string): boolean {
  return triggerType.startsWith('sun.') || TARGETLESS_TRIGGER_TYPES.has(triggerType);
}

// Triggers individually confirmed (then adversarially re-verified against
// raw GitHub doc source) to use the OLDER `any`/`first`/`last` literal
// wire values instead of the far more common `each`/`first`/`all` — a
// genuine, HA-acknowledged split (home-assistant/frontend#29731: the UI
// now shows "Each/First/All" everywhere as of this feature's most recent
// rework, but not every domain's YAML literal has been migrated off the
// old any/first/last wording yet). water_heater hasn't been migrated;
// humidity/temperature's `crossed_threshold` triggers likewise still use
// the old wording. `lock.opened` was ALSO suspected of this anomaly by an
// early research pass but was disproven on adversarial re-check (a fetch
// hallucination) — it uses each/first/all like every other lock trigger.
//
// media_player's entire behavior-bearing catalog (muted/unmuted/
// paused_playing/started_playing/stopped_playing/turned_on/turned_off/
// volume_crossed_threshold) is ALSO confirmed on this list — verified
// directly against raw home-assistant.io markdown source (not a rendered
// summary) for media_player.muted and media_player.turned_on, both showing
// `behavior: {default: any, ...any/first/last...}` verbatim in the
// documented schema, unlike the generic `helpers/trigger.py` schema which
// treats `any`/`last` as deprecated aliases for `each`/`all` — media_player
// simply hasn't been migrated to the modern wording yet, same as
// water_heater.
const ANY_FIRST_LAST_TRIGGER_TYPES = new Set<string>([
  'humidity.crossed_threshold',
  'temperature.crossed_threshold',
  'water_heater.turned_on',
  'water_heater.turned_off',
  'water_heater.operation_mode_changed',
  'water_heater.target_temperature_changed',
  'water_heater.target_temperature_crossed_threshold',
  'media_player.muted',
  'media_player.unmuted',
  'media_player.paused_playing',
  'media_player.started_playing',
  'media_player.stopped_playing',
  'media_player.turned_on',
  'media_player.turned_off',
  'media_player.volume_crossed_threshold',
]);

export function getTriggerBehaviorVariant(triggerType: string): ThresholdBehaviorVariant {
  if (
    NO_OPTIONS_TRIGGER_TYPES.has(triggerType) ||
    CHANGED_MODE_TRIGGER_TYPES.has(triggerType) ||
    NO_BEHAVIOR_KEEPS_FOR_TRIGGER_TYPES.has(triggerType) ||
    NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES.has(triggerType)
  ) {
    return 'none';
  }
  if (ANY_FIRST_LAST_TRIGGER_TYPES.has(triggerType)) return 'any-first-last';
  return 'each-first-all';
}

/**
 * Conditions always use `any`/`all` — confirmed uniformly across every
 * domain audited (alarm_control_panel, lock, valve, climate, media_player,
 * vacuum, air_quality, counter, timer, ...; ~70 condition pages checked, no
 * exceptions found). Only `sun.*` conditions omit `behavior` entirely (the
 * sun is a singleton) — handled separately by NativeConditionFields.tsx's
 * `isSunSingleton` branch rather than here. Kept as a function (not a bare
 * constant) for API symmetry with getTriggerBehaviorVariant and in case a
 * future HA release introduces an exception.
 */
export function getConditionBehaviorVariant(_conditionType: string): ThresholdBehaviorVariant {
  return 'any-all';
}

export function triggerHasFor(triggerType: string): boolean {
  if (NO_OPTIONS_TRIGGER_TYPES.has(triggerType) || NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES.has(triggerType)) {
    return false;
  }
  // Every CHANGED-mode trigger lacks `for` too — see CHANGED_MODE_TRIGGER_TYPES's
  // doc comment. `sun.elevation_crossed_threshold` is the one entry that
  // lacks `behavior` but KEEPS `for` — handled by getTriggerBehaviorVariant
  // separately, not excluded here.
  return !CHANGED_MODE_TRIGGER_TYPES.has(triggerType);
}

/**
 * `sun.*` conditions are excluded by NativeConditionFields.tsx's
 * `isSunSingleton` branch before this is even consulted — not repeated here.
 * No condition-side exceptions remain.
 */
export function conditionHasFor(_conditionType: string): boolean {
  return true;
}

/** Temperature-based domains are the only ones documented with an explicit `unit_of_measurement` key (illuminance/humidity examples show a plain `{number}`). */
export function getThresholdUnit(dottedType: string): string | undefined {
  if (dottedType.startsWith('water_heater.') || dottedType.includes('temperature')) return '°';
  // HA's power fields let the user pick per-value unit_of_measurement from
  // mW/W/kW/MW/GW/TW/BTU-h; Circuitry simplifies to a single fixed unit
  // rather than building a full unit picker for this one field.
  if (dottedType === 'power.is_value' || dottedType.startsWith('power.')) return 'W';
  // Light's brightness fields (trigger `brightness_changed`/
  // `brightness_crossed_threshold`, condition `is_brightness`) are all
  // percentages — TYPED shape as of the CORRECTION at the top of this file
  // (not FLAT, as a prior pass had them), but still worth returning '%'
  // explicitly here since ThresholdTypeField/SimpleThresholdField display
  // this alongside the value input regardless of shape.
  if (dottedType.startsWith('light.brightness') || dottedType === 'light.is_brightness') return '%';
  // Media player volume is normalized to a 0-100% value (see
  // VERIFIED_TYPED_TRIGGER_TYPES's media_player.volume_* comment) —
  // separate branch from PERCENT_RANGE_TYPES since media_player.is_volume
  // (condition) already implicitly returns undefined here and relies on
  // PERCENT_RANGE_TYPES alone; kept explicit for the trigger pair so the
  // unit label actually renders.
  if (dottedType.startsWith('media_player.volume')) return '%';
  // sun.elevation/elevation_changed/elevation_crossed_threshold — degrees,
  // same unit as temperature but semantically distinct (can go negative,
  // no natural upper/lower bound tied to a physical scale).
  if (dottedType === 'sun.elevation' || dottedType.startsWith('sun.elevation_')) return '°';
  // air_quality — units per home-assistant/core's air_quality/trigger.py
  // unit converters: co2 is ppm (no converter, raw sensor unit), voc_ratio
  // is ppb, every other gas/particulate concentration is µg/m³.
  if (dottedType.startsWith('air_quality.co2_')) return 'ppm';
  if (dottedType.startsWith('air_quality.voc_ratio_')) return 'ppb';
  if (
    dottedType.startsWith('air_quality.co_') ||
    dottedType.startsWith('air_quality.n2o_') ||
    dottedType.startsWith('air_quality.no2_') ||
    dottedType.startsWith('air_quality.no_') ||
    dottedType.startsWith('air_quality.ozone_') ||
    dottedType.startsWith('air_quality.pm10_') ||
    dottedType.startsWith('air_quality.pm1_') ||
    dottedType.startsWith('air_quality.pm25_') ||
    dottedType.startsWith('air_quality.pm4_') ||
    dottedType.startsWith('air_quality.so2_') ||
    dottedType.startsWith('air_quality.voc_')
  ) {
    return 'µg/m³';
  }
  return undefined;
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
  'battery.level_crossed',
  // Humidity targets (climate) are set as a percentage the same way
  // current humidity readings are. humidifier.is_target_humidity is
  // FLAT-SIMPLE (see above) and hardcodes its own 0-100 range at the call
  // site rather than going through this table.
  'climate.is_target_humidity',
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
