import type { TriggerPlatform } from '@circuitry/shared';
import { getThresholdUnit, type TypedThreshold } from '@/lib/nativeThreshold';
import type { HassEntity } from '@/types/hass';

/**
 * Client-side catalog of "trigger recipes" per entity domain (and, where it
 * matters, device_class) — sugar over a plain `state`/`numeric_state`
 * trigger, e.g. picking "Blind opened" on a cover entity is really just
 * `{ trigger: 'state', entity_id: [...], to: 'open' }`.
 *
 * Cross-referenced against home-assistant/core (dev branch, fetched 2026-08)
 * rather than guessed, since HA actually implements this two different ways
 * depending on the domain:
 *
 *  - Newer domains (cover, light, switch, fan, lock, climate, vacuum,
 *    media_player, button, timer, schedule) register real backend "trigger
 *    platforms" — see e.g. `homeassistant/components/light/trigger.py` —
 *    each a small class with a `target` selector and translated name, found
 *    in that domain's `strings.json` under a top-level `"triggers"` key.
 *    These are NOT returned by the `device_automation/trigger/list` WS API;
 *    they're a separate `trigger_platforms/subscribe` catalog. The recipes
 *    below mirror those classes' logic (state/attribute + target value)
 *    exactly, using their real translated names.
 *  - binary_sensor and sensor have NOT been migrated to that mechanism —
 *    they still use the older per-device-class `device_trigger.py`
 *    (`ENTITY_TRIGGERS` dicts), which IS device_automation/trigger/list-
 *    based. Circuitry's "By target" results panel already fetches that
 *    API directly for entities with a device_id (see TriggerTargetPicker.tsx
 *    / hooks/useDeviceAutomation.ts) and gets the real thing automatically.
 *    The recipes below for these two domains exist for entities *without* a
 *    device link (common — many cloud/template entities aren't tied to a
 *    device registry entry, so device_automation/trigger/list returns
 *    nothing for them even though the device_class-based trigger concept
 *    still applies), and for the "By type" tab's type-first flow, which
 *    isn't scoped to a specific device to begin with. Labels are taken
 *    verbatim from binary_sensor/sensor's strings.json trigger_type text
 *    (minus the "{entity_name}" prefix, since our UI shows the target as a
 *    separate chip rather than inline in the label).
 *
 * A few additions beyond what HA's own catalog currently offers, called out
 * where they appear below: a generic "Cover" fallback for the one cover
 * device class with no dedicated trigger (damper — the other 9 all route to
 * a real `cover.<class>_closed`/`opened` or shared pseudo-domain trigger,
 * see COVER_PSEUDO_DOMAIN below), and a person/device_tracker "arrived/left
 * home" pair (neither domain has a real trigger.py yet). Both are still perfectly
 * valid `state` trigger YAML, just not literally sourced from a matching
 * backend trigger platform.
 */

export interface TriggerRecipeFields {
  /**
   * Either a legacy platform (`state`, `numeric_state`, ...) or, since HA
   * 2025.12, a purpose-specific one (`light.turned_on`, dotted domain.event
   * form) — widened from `TriggerPlatform` to plain `string` to allow the
   * latter. `buildTriggerNodeData` (lib/triggerNodeData.ts) branches on
   * whether this contains a `.` to decide which node-data shape to build:
   * legacy recipes get `entity_id`/`to`/`from`/`attribute` at the top level;
   * purpose-specific ones get `target: { entity_id }` + `options` instead
   * (see that file's 'recipe' case).
   */
  trigger: TriggerPlatform | string;
  /** Single value or list — HA's `state` trigger accepts either for `to`/`from`. */
  to?: string | string[];
  from?: string | string[];
  /** Only set for recipes that trigger off an attribute rather than the entity's own state (e.g. climate's current_temperature, timer's last_transition). */
  attribute?: string;
  /**
   * Purpose-specific-trigger-only: extra `options` beyond the `behavior`
   * every one of them gets by default (see buildTriggerNodeData) — e.g.
   * `{ threshold: { type: 'above', value: {...} } }` (TYPED) for every
   * threshold-bearing domain's `crossed_threshold`/`level_crossed`/
   * `brightness_crossed_threshold` triggers — see lib/nativeThreshold.ts.
   * The bare-number FLAT shape is kept in this union for type-level
   * symmetry with lib/nativeThreshold.ts's ThresholdShape, but no current
   * recipe seeds one — see that file's CORRECTION doc comment. `offset`/
   * `offset_type` are seeded by calendar's two required-offset recipes —
   * see lib/triggerOffsetField.ts.
   */
  options?: {
    threshold?: number | TypedThreshold;
    offset?: { hours?: number; minutes?: number; seconds?: number };
    offset_type?: 'before' | 'after';
  };
}

export interface TriggerRecipe {
  id: string;
  label: string;
  /**
   * A short sentence describing when this fires, shown beneath the label in
   * the results row (TriggerResultRow.tsx) — matches native HA's own
   * "Add trigger" dialog, which pairs every entry with one. Only set where
   * verified against the real home-assistant.io/triggers/ doc page's own
   * wording (currently light/switch/fan/lock's purpose-specific recipes,
   * see the trigger-picker-rebuild dev log) — left unset elsewhere rather
   * than inventing copy for the ~90 other recipes; the row still renders
   * fine title-only.
   */
  description?: string;
  fields: TriggerRecipeFields;
}

/**
 * One browsable "type" in the catalog — e.g. "Battery", "Blind", "Motion".
 * `heading` is what results get grouped under once entities are attached to
 * a recipe (real HA keeps binary_sensor/sensor device classes as their own
 * headings — "Battery", "Motion", "Illuminance" — rather than lumping them
 * under a generic "Binary sensor"/"Sensor" heading, but keeps cover's
 * sub-classes together under one shared "Cover" heading, matching each
 * domain's own strings.json naming). `label` is the name shown while
 * browsing/searching the catalog itself, which for cover's sub-classes is
 * the more specific name ("Blind", "Curtain", ...) even though they share a
 * heading.
 */
export interface EntityTriggerCategory {
  groupKey: string;
  domain: string;
  deviceClass?: string;
  heading: string;
  label: string;
  recipes: TriggerRecipe[];
}

export interface EntityRecipeGroup {
  groupKey: string;
  heading: string;
  recipes: TriggerRecipe[];
}

// ---------------------------------------------------------------------------
// binary_sensor — device_trigger.py + strings.json (ENTITY_TRIGGERS table)
// ---------------------------------------------------------------------------

/**
 * Exported so useTriggerCardDisplay.ts can reuse the exact same on/off
 * phrasing for a legacy `state`/to:on/off trigger card on a binary_sensor —
 * e.g. a contact sensor should read "Opened"/"Closed" on its canvas card,
 * not the generic "Turned on"/"Turned off", matching what real HA's own
 * more-info dialog shows for that device_class.
 */
export const BINARY_SENSOR_CLASSES: Record<
  string,
  { heading: string; onLabel: string; offLabel: string }
> = {
  battery: { heading: 'Battery', onLabel: 'Battery low', offLabel: 'Battery normal' },
  battery_charging: { heading: 'Charging', onLabel: 'Charging', offLabel: 'Not charging' },
  carbon_monoxide: {
    heading: 'Carbon monoxide',
    onLabel: 'Started detecting carbon monoxide',
    offLabel: 'Stopped detecting carbon monoxide',
  },
  cold: { heading: 'Cold', onLabel: 'Became cold', offLabel: 'Became not cold' },
  connectivity: { heading: 'Connectivity', onLabel: 'Connected', offLabel: 'Disconnected' },
  door: { heading: 'Door', onLabel: 'Opened', offLabel: 'Closed' },
  garage_door: { heading: 'Garage door', onLabel: 'Opened', offLabel: 'Closed' },
  gas: { heading: 'Gas', onLabel: 'Started detecting gas', offLabel: 'Stopped detecting gas' },
  heat: { heading: 'Heat', onLabel: 'Became hot', offLabel: 'Became not hot' },
  light: { heading: 'Light', onLabel: 'Started detecting light', offLabel: 'Stopped detecting light' },
  lock: { heading: 'Lock', onLabel: 'Unlocked', offLabel: 'Locked' },
  moisture: { heading: 'Moisture', onLabel: 'Became moist', offLabel: 'Became dry' },
  motion: { heading: 'Motion', onLabel: 'Started detecting motion', offLabel: 'Stopped detecting motion' },
  moving: { heading: 'Moving', onLabel: 'Started moving', offLabel: 'Stopped moving' },
  occupancy: { heading: 'Occupancy', onLabel: 'Became occupied', offLabel: 'Became not occupied' },
  opening: { heading: 'Opening', onLabel: 'Opened', offLabel: 'Closed' },
  plug: { heading: 'Plug', onLabel: 'Plugged in', offLabel: 'Unplugged' },
  power: { heading: 'Power', onLabel: 'Powered', offLabel: 'Not powered' },
  presence: { heading: 'Presence', onLabel: 'Present', offLabel: 'Not present' },
  problem: { heading: 'Problem', onLabel: 'Started detecting problem', offLabel: 'Stopped detecting problem' },
  running: { heading: 'Running', onLabel: 'Started running', offLabel: 'Stopped running' },
  safety: { heading: 'Safety', onLabel: 'Became unsafe', offLabel: 'Became safe' },
  smoke: { heading: 'Smoke', onLabel: 'Started detecting smoke', offLabel: 'Stopped detecting smoke' },
  sound: { heading: 'Sound', onLabel: 'Started detecting sound', offLabel: 'Stopped detecting sound' },
  tamper: {
    heading: 'Tamper',
    onLabel: 'Started detecting tampering',
    offLabel: 'Stopped detecting tampering',
  },
  update: { heading: 'Update', onLabel: 'Got an update available', offLabel: 'Became up-to-date' },
  vibration: {
    heading: 'Vibration',
    onLabel: 'Started detecting vibration',
    offLabel: 'Stopped detecting vibration',
  },
  window: { heading: 'Window', onLabel: 'Opened', offLabel: 'Closed' },
};

/**
 * Device classes that HAVE graduated to real purpose-specific triggers —
 * cross-referenced against home-assistant.io/triggers/ (fetched 2026-08,
 * several releases past the 2025.12 introduction of this mechanism, which
 * has kept adding more domains/device classes every release since). Note
 * the trigger *platform* prefix here is the device class itself (`door.*`,
 * `motion.*`, `battery.*`, ...), not `binary_sensor.*` — HA dispatches these
 * by domain+device_class server-side, matching both a binary_sensor with
 * that device_class here and (for battery) a plain `sensor.battery` too,
 * see SENSOR_NATIVE below. `battery_charging`/`carbon_monoxide`/`gas`/
 * `light`/`smoke` were added in the 5th catalog re-audit pass — each has a
 * confirmed home-assistant.io/triggers/ page (battery.started_charging/
 * stopped_charging; air_quality.co_detected/cleared, gas_detected/cleared,
 * smoke_detected/cleared — air_quality is the shared trigger *platform* for
 * all three gas-type binary_sensor classes, same cross-domain dispatch
 * pattern as `battery` below; illuminance.detected/cleared for `light`).
 * Device classes NOT in this table (cold, connectivity, heat, lock, moving,
 * opening, plug, power, presence, problem, running, safety, sound, tamper,
 * update) don't have a confirmed dedicated trigger page yet, so they keep
 * the plain `state`/to:on/off fallback below.
 */
const BINARY_SENSOR_NATIVE: Record<
  string,
  { onTrigger: string; onDescription: string; offTrigger: string; offDescription: string }
> = {
  battery_charging: {
    onTrigger: 'battery.started_charging',
    onDescription: 'Triggers when one or more batteries start charging.',
    offTrigger: 'battery.stopped_charging',
    offDescription: 'Triggers when one or more batteries stop charging.',
  },
  carbon_monoxide: {
    onTrigger: 'air_quality.co_detected',
    onDescription: 'Triggers when one or more sensors start detecting carbon monoxide.',
    offTrigger: 'air_quality.co_cleared',
    offDescription: 'Triggers when one or more sensors stop detecting carbon monoxide.',
  },
  gas: {
    onTrigger: 'air_quality.gas_detected',
    onDescription: 'Triggers when one or more sensors start detecting gas.',
    offTrigger: 'air_quality.gas_cleared',
    offDescription: 'Triggers when one or more sensors stop detecting gas.',
  },
  light: {
    onTrigger: 'illuminance.detected',
    onDescription: 'Triggers when one or more sensors start detecting light.',
    offTrigger: 'illuminance.cleared',
    offDescription: 'Triggers when one or more sensors stop detecting light.',
  },
  smoke: {
    onTrigger: 'air_quality.smoke_detected',
    onDescription: 'Triggers when one or more sensors start detecting smoke.',
    offTrigger: 'air_quality.smoke_cleared',
    offDescription: 'Triggers when one or more sensors stop detecting smoke.',
  },
  battery: {
    onTrigger: 'battery.became_low',
    onDescription: 'Triggers after one or more battery sensors report a low battery.',
    offTrigger: 'battery.no_longer_low',
    offDescription: 'Triggers after one or more battery sensors stop reporting a low battery.',
  },
  door: {
    onTrigger: 'door.opened',
    onDescription: 'Triggers when one or more doors open.',
    offTrigger: 'door.closed',
    offDescription: 'Triggers when one or more doors close.',
  },
  garage_door: {
    onTrigger: 'garage_door.opened',
    onDescription: 'Triggers when one or more garage doors open.',
    offTrigger: 'garage_door.closed',
    offDescription: 'Triggers when one or more garage doors close.',
  },
  moisture: {
    onTrigger: 'moisture.detected',
    onDescription: 'Triggers when one or more moisture sensors start detecting moisture.',
    offTrigger: 'moisture.cleared',
    offDescription: 'Triggers when one or more moisture sensors stop detecting moisture.',
  },
  motion: {
    onTrigger: 'motion.detected',
    onDescription: 'Triggers when one or more motion sensors start detecting motion.',
    offTrigger: 'motion.cleared',
    offDescription: 'Triggers when one or more motion sensors stop detecting motion.',
  },
  occupancy: {
    onTrigger: 'occupancy.detected',
    onDescription: 'Triggers when one or more occupancy sensors start detecting occupancy.',
    offTrigger: 'occupancy.cleared',
    offDescription: 'Triggers when one or more occupancy sensors stop detecting occupancy.',
  },
  vibration: {
    onTrigger: 'vibration.detected',
    onDescription: 'Triggers when one or more vibration sensors start detecting vibration.',
    offTrigger: 'vibration.cleared',
    offDescription: 'Triggers when one or more vibration sensors stop detecting vibration.',
  },
  window: {
    onTrigger: 'window.opened',
    onDescription: 'Triggers when one or more windows open.',
    offTrigger: 'window.closed',
    offDescription: 'Triggers when one or more windows close.',
  },
};

// ---------------------------------------------------------------------------
// sensor — device_trigger.py + strings.json (ENTITY_TRIGGERS table)
// ---------------------------------------------------------------------------

const SENSOR_CLASSES: Record<string, string> = {
  absolute_humidity: 'Absolute humidity',
  apparent_power: 'Apparent power',
  aqi: 'Air quality index',
  area: 'Area',
  atmospheric_pressure: 'Atmospheric pressure',
  battery: 'Battery',
  blood_glucose_concentration: 'Blood glucose concentration',
  carbon_monoxide: 'Carbon monoxide',
  carbon_dioxide: 'Carbon dioxide',
  conductivity: 'Conductivity',
  current: 'Current',
  data_rate: 'Data rate',
  data_size: 'Data size',
  distance: 'Distance',
  duration: 'Duration',
  energy: 'Energy',
  energy_distance: 'Energy per distance',
  energy_storage: 'Stored energy',
  frequency: 'Frequency',
  gas: 'Gas',
  humidity: 'Humidity',
  illuminance: 'Illuminance',
  irradiance: 'Irradiance',
  moisture: 'Moisture',
  monetary: 'Monetary balance',
  nitrogen_dioxide: 'Nitrogen dioxide',
  nitrogen_monoxide: 'Nitrogen monoxide',
  nitrous_oxide: 'Nitrous oxide',
  ozone: 'Ozone',
  ph: 'pH',
  pm1: 'PM1',
  pm10: 'PM10',
  pm25: 'PM2.5',
  pm4: 'PM4',
  power: 'Power',
  power_factor: 'Power factor',
  precipitation: 'Precipitation',
  precipitation_intensity: 'Precipitation intensity',
  pressure: 'Pressure',
  radon: 'Radon',
  reactive_energy: 'Reactive energy',
  reactive_power: 'Reactive power',
  signal_strength: 'Signal strength',
  sound_pressure: 'Sound pressure',
  speed: 'Speed',
  sulphur_dioxide: 'Sulphur dioxide',
  temperature: 'Temperature',
  temperature_delta: 'Temperature delta',
  volatile_organic_compounds: 'Volatile organic compounds',
  volatile_organic_compounds_parts: 'Volatile organic compounds parts',
  voltage: 'Voltage',
  volume: 'Volume',
  volume_storage: 'Stored volume',
  volume_flow_rate: 'Volume flow rate',
  water: 'Water',
  weight: 'Weight',
  wind_direction: 'Wind direction',
  wind_speed: 'Wind speed',
};

/**
 * `sensor` device classes with a confirmed native "changed"/"crossed
 * threshold" pair (home-assistant.io/triggers/), same caveat as
 * BINARY_SENSOR_NATIVE above — the trigger platform is the device class
 * itself. `battery` here is deliberately a *different* pair
 * (`battery.level_changed`/`level_crossed`) from BINARY_SENSOR_NATIVE's
 * `battery.became_low`/`no_longer_low`: HA documents both under the same
 * "Battery" page since a battery can be reported either as a numeric % (this
 * table) or a low/normal boolean (the binary_sensor table above).
 */
const SENSOR_NATIVE: Record<
  string,
  { changedTrigger: string; changedDescription: string; thresholdTrigger: string; thresholdDescription: string }
> = {
  moisture: {
    changedTrigger: 'moisture.changed',
    changedDescription: 'Triggers when one or more moisture level readings change.',
    thresholdTrigger: 'moisture.crossed_threshold',
    thresholdDescription: 'Triggers when one or more moisture level readings cross a threshold.',
  },
  // air_quality — 13 device classes sharing the `air_quality.*` trigger
  // platform (home-assistant/core's air_quality/trigger.py TRIGGERS dict),
  // same cross-domain dispatch pattern as `battery`/`moisture` above. Slug
  // abbreviations (co2, co, n2o, no2, no, ozone, pm1/4/10/25, so2, voc,
  // voc_ratio) confirmed against home-assistant.io/triggers/ index.
  carbon_dioxide: {
    changedTrigger: 'air_quality.co2_changed',
    changedDescription: 'Triggers when one or more carbon dioxide readings change.',
    thresholdTrigger: 'air_quality.co2_crossed_threshold',
    thresholdDescription: 'Triggers when one or more carbon dioxide readings cross a threshold.',
  },
  carbon_monoxide: {
    changedTrigger: 'air_quality.co_changed',
    changedDescription: 'Triggers when one or more carbon monoxide readings change.',
    thresholdTrigger: 'air_quality.co_crossed_threshold',
    thresholdDescription: 'Triggers when one or more carbon monoxide readings cross a threshold.',
  },
  nitrogen_dioxide: {
    changedTrigger: 'air_quality.no2_changed',
    changedDescription: 'Triggers when one or more nitrogen dioxide readings change.',
    thresholdTrigger: 'air_quality.no2_crossed_threshold',
    thresholdDescription: 'Triggers when one or more nitrogen dioxide readings cross a threshold.',
  },
  nitrogen_monoxide: {
    changedTrigger: 'air_quality.no_changed',
    changedDescription: 'Triggers when one or more nitrogen monoxide readings change.',
    thresholdTrigger: 'air_quality.no_crossed_threshold',
    thresholdDescription: 'Triggers when one or more nitrogen monoxide readings cross a threshold.',
  },
  nitrous_oxide: {
    changedTrigger: 'air_quality.n2o_changed',
    changedDescription: 'Triggers when one or more nitrous oxide readings change.',
    thresholdTrigger: 'air_quality.n2o_crossed_threshold',
    thresholdDescription: 'Triggers when one or more nitrous oxide readings cross a threshold.',
  },
  ozone: {
    changedTrigger: 'air_quality.ozone_changed',
    changedDescription: 'Triggers when one or more ozone readings change.',
    thresholdTrigger: 'air_quality.ozone_crossed_threshold',
    thresholdDescription: 'Triggers when one or more ozone readings cross a threshold.',
  },
  pm1: {
    changedTrigger: 'air_quality.pm1_changed',
    changedDescription: 'Triggers when one or more PM1 readings change.',
    thresholdTrigger: 'air_quality.pm1_crossed_threshold',
    thresholdDescription: 'Triggers when one or more PM1 readings cross a threshold.',
  },
  pm10: {
    changedTrigger: 'air_quality.pm10_changed',
    changedDescription: 'Triggers when one or more PM10 readings change.',
    thresholdTrigger: 'air_quality.pm10_crossed_threshold',
    thresholdDescription: 'Triggers when one or more PM10 readings cross a threshold.',
  },
  pm25: {
    changedTrigger: 'air_quality.pm25_changed',
    changedDescription: 'Triggers when one or more PM2.5 readings change.',
    thresholdTrigger: 'air_quality.pm25_crossed_threshold',
    thresholdDescription: 'Triggers when one or more PM2.5 readings cross a threshold.',
  },
  pm4: {
    changedTrigger: 'air_quality.pm4_changed',
    changedDescription: 'Triggers when one or more PM4 readings change.',
    thresholdTrigger: 'air_quality.pm4_crossed_threshold',
    thresholdDescription: 'Triggers when one or more PM4 readings cross a threshold.',
  },
  sulphur_dioxide: {
    changedTrigger: 'air_quality.so2_changed',
    changedDescription: 'Triggers when one or more sulphur dioxide readings change.',
    thresholdTrigger: 'air_quality.so2_crossed_threshold',
    thresholdDescription: 'Triggers when one or more sulphur dioxide readings cross a threshold.',
  },
  volatile_organic_compounds: {
    changedTrigger: 'air_quality.voc_changed',
    changedDescription: 'Triggers when one or more volatile organic compound readings change.',
    thresholdTrigger: 'air_quality.voc_crossed_threshold',
    thresholdDescription: 'Triggers when one or more volatile organic compound readings cross a threshold.',
  },
  volatile_organic_compounds_parts: {
    changedTrigger: 'air_quality.voc_ratio_changed',
    changedDescription: 'Triggers when one or more volatile organic compound ratio readings change.',
    thresholdTrigger: 'air_quality.voc_ratio_crossed_threshold',
    thresholdDescription: 'Triggers when one or more volatile organic compound ratio readings cross a threshold.',
  },
  battery: {
    changedTrigger: 'battery.level_changed',
    changedDescription: 'Triggers when the battery level of one or more batteries changes.',
    thresholdTrigger: 'battery.level_crossed',
    thresholdDescription: 'Triggers after one or more battery level readings cross a threshold.',
  },
  humidity: {
    changedTrigger: 'humidity.changed',
    changedDescription: 'Triggers when one or more relative humidity values change.',
    thresholdTrigger: 'humidity.crossed_threshold',
    thresholdDescription: 'Triggers when one or more relative humidity values cross a threshold.',
  },
  illuminance: {
    changedTrigger: 'illuminance.changed',
    changedDescription: 'Triggers when one or more illuminance values change.',
    thresholdTrigger: 'illuminance.crossed_threshold',
    thresholdDescription: 'Triggers when one or more illuminance values cross a threshold.',
  },
  power: {
    changedTrigger: 'power.changed',
    changedDescription: 'Triggers when one or more power values change.',
    thresholdTrigger: 'power.crossed_threshold',
    thresholdDescription: 'Triggers when one or more power values cross a threshold.',
  },
  temperature: {
    changedTrigger: 'temperature.changed',
    changedDescription: 'Triggers when one or more temperature readings change.',
    thresholdTrigger: 'temperature.crossed_threshold',
    thresholdDescription: 'Triggers when one or more temperature readings cross a threshold.',
  },
};

// Every CoverDeviceClass, with its real HA-facing display name — verified
// against the actual "Add trigger" dialog (all ten get their own specific
// "<Name> closed"/"<Name> opened" trigger row, not just a 5-class subset).
const COVER_CLASSES: Record<string, string> = {
  awning: 'Awning',
  blind: 'Blind',
  curtain: 'Curtain',
  damper: 'Damper',
  door: 'Door',
  garage: 'Garage door',
  gate: 'Gate',
  shade: 'Shade',
  shutter: 'Shutter',
  window: 'Window',
};

/**
 * `browsable` is what "By type" actually lists/searches — one row per entry.
 * `lookupOnly` exists purely so `getEntityRecipeGroup` (the "By target"
 * results panel, which already knows a specific entity's device_class) can
 * resolve the precise per-device-class recipes without those same ~10 rows
 * cluttering "By type" as near-duplicate entries. Cover is the case that
 * needs this split: real HA's own "Add trigger" dialog lists "Cover" as one
 * flat entry, and shows every device class's specific triggers (Awning
 * closed, Blind closed, Door closed, Garage door closed, ...) together the
 * moment you select it — it does not ask you to first drill into "Blind" vs
 * "Garage door" the way binary_sensor/sensor's device classes do.
 */
function buildCategories(): { browsable: EntityTriggerCategory[]; lookupOnly: EntityTriggerCategory[] } {
  const categories: EntityTriggerCategory[] = [];
  const lookupOnly: EntityTriggerCategory[] = [];

  // --- light / switch / fan (turned_on / turned_off) ---
  // Uses HA's purpose-specific triggers (2025.12+, e.g. `light.turned_on`),
  // verified against the live home-assistant.io/triggers/ docs rather than
  // the older `state`/`to: 'on'` sugar these three used before — see
  // docs/trigger-picker-rebuild.md's native-trigger-format log entry for
  // which domains got this treatment and why the rest didn't yet.
  const pluralDomainName: Record<string, string> = { light: 'lights', switch: 'switches', fan: 'fans' };
  for (const domain of ['light', 'switch', 'fan'] as const) {
    const name = domain[0].toUpperCase() + domain.slice(1);
    const plural = pluralDomainName[domain];
    categories.push({
      groupKey: domain,
      domain,
      heading: name,
      label: name,
      recipes: [
        {
          id: `${domain}_on`,
          label: `${name} turned on`,
          description: `Triggers when one or more ${plural} turn on.`,
          fields: { trigger: `${domain}.turned_on` },
        },
        {
          id: `${domain}_off`,
          label: `${name} turned off`,
          description: `Triggers when one or more ${plural} turn off.`,
          fields: { trigger: `${domain}.turned_off` },
        },
      ],
    });
  }

  // Light also gets brightness_changed / brightness_crossed_threshold —
  // verified against home-assistant.io/triggers/light.brightness_changed
  // and .../light.brightness_crossed_threshold: both are percentage-based
  // (0-100%) purpose-specific triggers with a `threshold` option, not the
  // raw 0-255 numeric_state-on-an-attribute approach used previously.
  //
  // Seeds a TYPED threshold (`{ type, value: { number, ... } }`), matching
  // the sensor_threshold recipes above — a prior pass here seeded a bare
  // number, which matched an (incorrect) FLAT classification for these two
  // triggers; see lib/nativeThreshold.ts's CORRECTION doc comment for why
  // they're TYPED like everything else.
  const lightCategory = categories.find((c) => c.groupKey === 'light');
  if (lightCategory) {
    lightCategory.recipes.push(
      {
        id: 'light_brightness_changed',
        label: 'Light brightness changed',
        description: 'Triggers when the brightness of one or more lights changes.',
        // No preset `options` — matches the sensor_changed recipes above
        // (illuminance/humidity/battery/temperature's `.changed` triggers),
        // which likewise leave `options` unset. Unlike those four,
        // `light.brightness_changed` isn't in `triggerAllowsAnyThreshold`'s
        // list (its schema's NumericThresholdMode is CHANGED but HA's own
        // UI doesn't expose a `type: 'any'` toggle for it), so there's no
        // natural default `type` to seed either — left for the user to fill
        // in via ThresholdTypeField.
        fields: { trigger: 'light.brightness_changed' },
      },
      {
        id: 'light_brightness_threshold',
        label: 'Light brightness crossed threshold',
        description: 'Triggers when the brightness of one or more lights crosses a threshold.',
        fields: {
          trigger: 'light.brightness_crossed_threshold',
          options: {
            threshold: {
              type: 'above',
              value: {
                number: 50,
                ...(getThresholdUnit('light.brightness_crossed_threshold')
                  ? { unit_of_measurement: getThresholdUnit('light.brightness_crossed_threshold') }
                  : {}),
              },
            },
          },
        },
      }
    );
  }

  // --- lock (locked / unlocked / opened / jammed) ---
  // Purpose-specific triggers — all four have their own doc page
  // (home-assistant.io/triggers/lock.locked, .../lock.unlocked,
  // .../lock.opened, .../lock.jammed).
  categories.push({
    groupKey: 'lock',
    domain: 'lock',
    heading: 'Lock',
    label: 'Lock',
    recipes: [
      {
        id: 'lock_locked',
        label: 'Lock locked',
        description: 'Triggers when one or more locks lock.',
        fields: { trigger: 'lock.locked' },
      },
      {
        id: 'lock_unlocked',
        label: 'Lock unlocked',
        description: 'Triggers when one or more locks unlock.',
        fields: { trigger: 'lock.unlocked' },
      },
      {
        id: 'lock_opened',
        label: 'Lock opened',
        description: 'Triggers when one or more locks open.',
        fields: { trigger: 'lock.opened' },
      },
      {
        id: 'lock_jammed',
        label: 'Lock jammed',
        description: 'Triggers when one or more locks jam.',
        fields: { trigger: 'lock.jammed' },
      },
    ],
  });

  // --- cover: every device class gets its own specific label, resolved
  // precisely for "By target" (lookupOnly, keyed by device_class), but
  // collapsed into ONE flat "Cover" entry for "By type" — see buildCategories()
  // doc comment above.
  // Cover trigger platforms, confirmed against home-assistant.io/triggers/
  // (5th catalog re-audit pass — a stale doc comment above claimed 5 classes
  // already had native triggers, but every one of the 10 was still on the
  // generic `state` fallback until this pass). Three shapes:
  //  - 5 classes (awning/blind/curtain/shade/shutter) get their own
  //    dedicated `cover.<class>_closed`/`<class>_opened` trigger pair.
  //  - 4 classes (door/garage/gate/window) share a pseudo-domain trigger
  //    platform keyed by a DIFFERENT name than the device_class itself —
  //    `garage` -> `garage_door.*` (not `garage.*`), the other three match
  //    their device_class verbatim (`door.*`, `gate.*`, `window.*`).
  //  - `damper` has no dedicated trigger page at all — stays on the generic
  //    `state` fallback.
  const COVER_PSEUDO_DOMAIN: Record<string, string> = {
    door: 'door',
    garage: 'garage_door',
    gate: 'gate',
    window: 'window',
  };
  const coverClassRecipes: Record<string, TriggerRecipe[]> = {};
  for (const [deviceClass, label] of Object.entries(COVER_CLASSES)) {
    let recipes: TriggerRecipe[];
    if (COVER_PSEUDO_DOMAIN[deviceClass]) {
      const pseudo = COVER_PSEUDO_DOMAIN[deviceClass];
      recipes = [
        {
          id: `cover_${deviceClass}_closed`,
          label: `${label} closed`,
          description: `Triggers when one or more ${label.toLowerCase()}s close.`,
          fields: { trigger: `${pseudo}.closed` },
        },
        {
          id: `cover_${deviceClass}_opened`,
          label: `${label} opened`,
          description: `Triggers when one or more ${label.toLowerCase()}s open.`,
          fields: { trigger: `${pseudo}.opened` },
        },
      ];
    } else if (deviceClass === 'damper') {
      // No dedicated trigger page — stays generic.
      recipes = [
        { id: `cover_${deviceClass}_closed`, label: `${label} closed`, fields: { trigger: 'state', to: 'closed' } },
        { id: `cover_${deviceClass}_opened`, label: `${label} opened`, fields: { trigger: 'state', to: 'open' } },
      ];
    } else {
      recipes = [
        {
          id: `cover_${deviceClass}_closed`,
          label: `${label} closed`,
          description: `Triggers when one or more ${label.toLowerCase()}s close.`,
          fields: { trigger: `cover.${deviceClass}_closed` },
        },
        {
          id: `cover_${deviceClass}_opened`,
          label: `${label} opened`,
          description: `Triggers when one or more ${label.toLowerCase()}s open.`,
          fields: { trigger: `cover.${deviceClass}_opened` },
        },
      ];
    }
    coverClassRecipes[deviceClass] = recipes;
    lookupOnly.push({ groupKey: `cover:${deviceClass}`, domain: 'cover', deviceClass, heading: 'Cover', label, recipes });
  }
  // Fallback for covers with no device_class set at all.
  const coverDefaultRecipes: TriggerRecipe[] = [
    { id: 'cover_closed', label: 'Cover closed', fields: { trigger: 'state', to: 'closed' } },
    { id: 'cover_opened', label: 'Cover opened', fields: { trigger: 'state', to: 'open' } },
  ];
  lookupOnly.push({
    groupKey: 'cover:default',
    domain: 'cover',
    heading: 'Cover',
    label: 'Cover',
    recipes: coverDefaultRecipes,
  });
  categories.push({
    groupKey: 'cover',
    domain: 'cover',
    heading: 'Cover',
    label: 'Cover',
    recipes: [...Object.values(coverClassRecipes).flat(), ...coverDefaultRecipes],
  });

  // --- binary_sensor: one category per device class + generic fallback ---
  for (const [deviceClass, { heading, onLabel, offLabel }] of Object.entries(BINARY_SENSOR_CLASSES)) {
    const native = BINARY_SENSOR_NATIVE[deviceClass];
    categories.push({
      groupKey: `binary_sensor:${deviceClass}`,
      domain: 'binary_sensor',
      deviceClass,
      heading,
      label: heading,
      recipes: native
        ? [
            { id: 'bs_on', label: onLabel, description: native.onDescription, fields: { trigger: native.onTrigger } },
            { id: 'bs_off', label: offLabel, description: native.offDescription, fields: { trigger: native.offTrigger } },
          ]
        : [
            { id: 'bs_on', label: onLabel, fields: { trigger: 'state', to: 'on' } },
            { id: 'bs_off', label: offLabel, fields: { trigger: 'state', to: 'off' } },
          ],
    });
  }
  categories.push({
    groupKey: 'binary_sensor:default',
    domain: 'binary_sensor',
    heading: 'Binary sensor',
    label: 'Binary sensor',
    recipes: [
      { id: 'bs_on', label: 'Turned on', fields: { trigger: 'state', to: 'on' } },
      { id: 'bs_off', label: 'Turned off', fields: { trigger: 'state', to: 'off' } },
    ],
  });

  // --- sensor: one category per device class + generic fallback ---
  for (const [deviceClass, heading] of Object.entries(SENSOR_CLASSES)) {
    const native = SENSOR_NATIVE[deviceClass];
    categories.push({
      groupKey: `sensor:${deviceClass}`,
      domain: 'sensor',
      deviceClass,
      heading,
      label: heading,
      recipes: native
        ? [
            {
              id: 'sensor_changed',
              label: `${heading} changed`,
              description: native.changedDescription,
              fields: { trigger: native.changedTrigger },
            },
            {
              id: 'sensor_threshold',
              label: `${heading} crossed threshold`,
              description: native.thresholdDescription,
              fields: {
                trigger: native.thresholdTrigger,
                // Seeds a valid, immediately-editable TYPED threshold (see
                // lib/nativeThreshold.ts) rather than leaving `options`
                // unset — NativeTriggerFields.tsx defaults an unset one to
                // `{}`, which is still valid to open and fill in, but a
                // concrete starting point (0, "above") matches how light's
                // brightness_crossed_threshold recipe below seeds its own
                // TYPED threshold.
                options: {
                  threshold: {
                    type: 'above',
                    value: { number: 0, ...(getThresholdUnit(native.thresholdTrigger) ? { unit_of_measurement: getThresholdUnit(native.thresholdTrigger) } : {}) },
                  },
                },
              },
            },
          ]
        : [
            { id: 'sensor_changed', label: `${heading} changed`, fields: { trigger: 'state' } },
            {
              id: 'sensor_threshold',
              label: `${heading} crossed threshold`,
              fields: { trigger: 'numeric_state' },
            },
          ],
    });
  }
  categories.push({
    groupKey: 'sensor:default',
    domain: 'sensor',
    heading: 'Sensor',
    label: 'Sensor',
    recipes: [
      { id: 'sensor_changed', label: 'Value changed', fields: { trigger: 'state' } },
      { id: 'sensor_threshold', label: 'Value crossed threshold', fields: { trigger: 'numeric_state' } },
    ],
  });

  // --- media_player ---
  // Converted from generic state/numeric_state fallback recipes to HA's
  // native dotted purpose-specific triggers (home-assistant.io/triggers/
  // media_player.*, 5th catalog re-audit pass) — all 9 confirmed via the
  // triggers index and media_player/trigger.py. Note media_player's
  // behavior-bearing triggers use the legacy any/first/last wire values
  // (see nativeThreshold.ts's ANY_FIRST_LAST_TRIGGER_TYPES), and volume is
  // normalized 0-100% server-side (see VERIFIED_TYPED_TRIGGER_TYPES's
  // media_player.volume_* comment) rather than the raw 0-1 `volume_level`
  // attribute this used to key off of.
  categories.push({
    groupKey: 'media_player',
    domain: 'media_player',
    heading: 'Media player',
    label: 'Media player',
    recipes: [
      {
        id: 'mp_started_playing',
        label: 'Media player started playing',
        description: 'Triggers when one or more media players start playing.',
        fields: { trigger: 'media_player.started_playing' },
      },
      {
        id: 'mp_paused_playing',
        label: 'Media player paused playing',
        description: 'Triggers when one or more media players pause playing.',
        fields: { trigger: 'media_player.paused_playing' },
      },
      {
        id: 'mp_stopped_playing',
        label: 'Media player stopped playing',
        description: 'Triggers when one or more media players stop playing.',
        fields: { trigger: 'media_player.stopped_playing' },
      },
      {
        id: 'mp_turned_on',
        label: 'Media player turned on',
        description: 'Triggers when one or more media players turn on.',
        fields: { trigger: 'media_player.turned_on' },
      },
      {
        id: 'mp_turned_off',
        label: 'Media player turned off',
        description: 'Triggers when one or more media players turn off.',
        fields: { trigger: 'media_player.turned_off' },
      },
      {
        id: 'mp_muted',
        label: 'Media player muted',
        description: 'Triggers when one or more media players mute.',
        fields: { trigger: 'media_player.muted' },
      },
      {
        id: 'mp_unmuted',
        label: 'Media player unmuted',
        description: 'Triggers when one or more media players unmute.',
        fields: { trigger: 'media_player.unmuted' },
      },
      {
        id: 'mp_volume_changed',
        label: 'Media player volume changed',
        description: 'Triggers when the volume of one or more media players changes.',
        fields: { trigger: 'media_player.volume_changed' },
      },
      {
        id: 'mp_volume_threshold',
        label: 'Media player volume crossed threshold',
        description: 'Triggers when the volume of one or more media players crosses a threshold.',
        fields: {
          trigger: 'media_player.volume_crossed_threshold',
          options: {
            threshold: {
              type: 'above',
              value: {
                number: 50,
                ...(getThresholdUnit('media_player.volume_crossed_threshold')
                  ? { unit_of_measurement: getThresholdUnit('media_player.volume_crossed_threshold') }
                  : {}),
              },
            },
          },
        },
      },
    ],
  });

  // --- climate ---
  //
  // Converted from generic state/numeric_state fallback recipes to HA's
  // native dotted purpose-specific triggers (home-assistant.io/triggers/
  // climate.*) — the condition side (climate.is_hvac_mode/is_heating/
  // is_cooling/is_drying/is_on/is_off/is_target_temperature/
  // is_target_humidity, see conditionRecipes.ts) already had full native
  // support; the trigger side was the one gap left, missing target/
  // behavior/for entirely and — for target_temperature/target_humidity —
  // the above/below/between/outside threshold-type selector, defaulting
  // instead to a bare numeric_state comparison. All 10 confirmed via
  // home-assistant.io/triggers/ (index lists exactly these 10 climate.*
  // slugs) and home-assistant/core's climate/trigger.py — see
  // lib/nativeThreshold.ts's and lib/triggerEnumField.ts's climate entries
  // for the shape/behavior/enum-field classification backing these.
  categories.push({
    groupKey: 'climate',
    domain: 'climate',
    heading: 'Climate',
    label: 'Climate',
    recipes: [
      {
        id: 'climate_mode_changed',
        label: 'Thermostat mode changed',
        description: 'Triggers when the HVAC mode of one or more thermostats changes to a specific mode.',
        fields: { trigger: 'climate.hvac_mode_changed' },
      },
      {
        id: 'climate_turned_on',
        label: 'Thermostat turned on',
        description: 'Triggers when one or more thermostats turn on, regardless of the HVAC mode.',
        fields: { trigger: 'climate.turned_on' },
      },
      {
        id: 'climate_turned_off',
        label: 'Thermostat turned off',
        description: 'Triggers when one or more thermostats turn off.',
        fields: { trigger: 'climate.turned_off' },
      },
      {
        id: 'climate_started_heating',
        label: 'Thermostat started heating',
        description: 'Triggers when one or more thermostats start actively heating.',
        fields: { trigger: 'climate.started_heating' },
      },
      {
        id: 'climate_started_cooling',
        label: 'Thermostat started cooling',
        description: 'Triggers when one or more thermostats start actively cooling.',
        fields: { trigger: 'climate.started_cooling' },
      },
      {
        id: 'climate_started_drying',
        label: 'Thermostat started drying',
        description: 'Triggers when one or more thermostats start actively drying.',
        fields: { trigger: 'climate.started_drying' },
      },
      {
        id: 'climate_target_temp_changed',
        label: 'Thermostat target temperature changed',
        description: 'Triggers when the temperature setpoint of one or more thermostats changes.',
        fields: { trigger: 'climate.target_temperature_changed' },
      },
      {
        id: 'climate_target_temp_threshold',
        label: 'Thermostat target temperature crossed threshold',
        description: 'Triggers when the temperature setpoint of one or more thermostats crosses a threshold.',
        fields: { trigger: 'climate.target_temperature_crossed_threshold' },
      },
      {
        id: 'climate_target_humidity_changed',
        label: 'Thermostat target humidity changed',
        description: 'Triggers when the target humidity of one or more thermostats changes.',
        fields: { trigger: 'climate.target_humidity_changed' },
      },
      {
        id: 'climate_target_humidity_threshold',
        label: 'Thermostat target humidity crossed threshold',
        description: 'Triggers when the target humidity of one or more thermostats crosses a threshold.',
        fields: { trigger: 'climate.target_humidity_crossed_threshold' },
      },
    ],
  });

  // --- vacuum ---
  categories.push({
    groupKey: 'vacuum',
    domain: 'vacuum',
    heading: 'Vacuum',
    label: 'Vacuum',
    recipes: [
      {
        id: 'vacuum_on',
        label: 'Vacuum On',
        description: 'Triggers the first time the vacuum starts up/turns on.',
        fields: { trigger: 'state', from: 'off', to: 'on' },
      },
      {
        id: 'vacuum_started_cleaning',
        label: 'Vacuum cleaner started cleaning',
        description: 'Triggers when one or more vacuum cleaners start cleaning.',
        fields: { trigger: 'vacuum.started_cleaning' },
      },
      {
        id: 'vacuum_paused_cleaning',
        label: 'Vacuum cleaner paused cleaning',
        description: 'Triggers when one or more vacuum cleaners pause cleaning.',
        fields: { trigger: 'vacuum.paused_cleaning' },
      },
      {
        id: 'vacuum_started_returning',
        label: 'Vacuum cleaner started returning to dock',
        description: 'Triggers when one or more vacuum cleaners start returning to their dock.',
        fields: { trigger: 'vacuum.started_returning' },
      },
      {
        id: 'vacuum_docked',
        label: 'Vacuum returned to dock',
        description: 'Triggers when one or more vacuum cleaners return to their dock.',
        fields: { trigger: 'vacuum.returned_to_dock' },
      },
      {
        id: 'vacuum_errored',
        label: 'Vacuum encountered an error',
        description: 'Triggers when one or more vacuum cleaners encounter an error.',
        fields: { trigger: 'vacuum.errored' },
      },
    ],
  });

  // --- button ---
  // Purpose-specific trigger (home-assistant.io/triggers/button.pressed/):
  // "This trigger has no additional YAML options beyond the target" — no
  // behavior, no for, no value option at all. See nativeThreshold.ts's
  // NO_OPTIONS_TRIGGER_TYPES, which already lists 'button.pressed'.
  categories.push({
    groupKey: 'button',
    domain: 'button',
    heading: 'Button',
    label: 'Button',
    recipes: [
      {
        id: 'button_pressed',
        label: 'Button pressed',
        description: 'Triggers when one or more buttons are pressed.',
        fields: { trigger: 'button.pressed' },
      },
    ],
  });

  // --- schedule ---
  // Purpose-specific triggers (home-assistant.io/triggers/schedule.block_started/,
  // .../schedule.block_ended/) — previously a generic state trigger on the
  // entity's own on/off state, missing target/behavior/for entirely.
  categories.push({
    groupKey: 'schedule',
    domain: 'schedule',
    heading: 'Schedule',
    label: 'Schedule',
    recipes: [
      {
        id: 'schedule_started',
        label: 'Schedule block started',
        description: 'Triggers when one or more schedules start an active block.',
        fields: { trigger: 'schedule.block_started' },
      },
      {
        id: 'schedule_ended',
        label: 'Schedule block ended',
        description: 'Triggers when one or more schedules end an active block.',
        fields: { trigger: 'schedule.block_ended' },
      },
    ],
  });

  // --- timer: converted to HA's native dotted purpose-specific triggers
  // (home-assistant.io/triggers/timer.*, 5th catalog re-audit pass) — all 5
  // state-transition triggers confirmed via the triggers index and
  // timer/trigger.py, replacing the previous generic `state` trigger keyed
  // off the `last_transition` attribute. `timer.remaining_time_reached` was
  // entirely missing before this pass — its only option is a required
  // `options.remaining` duration (HH:MM:SS), with no `behavior`/`for` (see
  // nativeThreshold.ts's `getTriggerBehaviorVariant`/`triggerHasFor`, and
  // lib/triggerDurationField.ts for the new required-duration-option field
  // type this needed — nothing in the existing threshold/enum classifiers
  // fit, since `remaining` isn't a numeric threshold or a mode string).
  categories.push({
    groupKey: 'timer',
    domain: 'timer',
    heading: 'Timer',
    label: 'Timer',
    recipes: [
      {
        id: 'timer_started',
        label: 'Timer started',
        description: 'Triggers when one or more timers start.',
        fields: { trigger: 'timer.started' },
      },
      {
        id: 'timer_restarted',
        label: 'Timer restarted',
        description: 'Triggers when one or more timers restart.',
        fields: { trigger: 'timer.restarted' },
      },
      {
        id: 'timer_paused',
        label: 'Timer paused',
        description: 'Triggers when one or more timers pause.',
        fields: { trigger: 'timer.paused' },
      },
      {
        id: 'timer_finished',
        label: 'Timer finished',
        description: 'Triggers when one or more timers finish.',
        fields: { trigger: 'timer.finished' },
      },
      {
        id: 'timer_cancelled',
        label: 'Timer cancelled',
        description: 'Triggers when one or more timers are cancelled.',
        fields: { trigger: 'timer.cancelled' },
      },
      {
        id: 'timer_remaining_time_reached',
        label: 'Timer remaining time reached',
        description: 'Triggers when one or more running timers reach a specific remaining duration.',
        fields: { trigger: 'timer.remaining_time_reached' },
      },
    ],
  });

  // --- person / device_tracker: no real HA trigger platform for either
  // domain yet — kept as a plain, still-valid state-trigger convenience.
  categories.push({
    groupKey: 'person',
    domain: 'person',
    heading: 'Person',
    label: 'Person',
    recipes: [
      { id: 'arrived', label: 'Arrived home', fields: { trigger: 'state', to: 'home' } },
      { id: 'left', label: 'Left home', fields: { trigger: 'state', from: 'home' } },
    ],
  });

  // --- Domains added straight from home-assistant.io/triggers/ (fetched
  // 2026-08) that weren't in the catalog at all before — none of these had
  // any Circuitry category (native or legacy), so unlike binary_sensor/sensor
  // above there's no state/numeric_state fallback to preserve, they're
  // purpose-specific triggers from the start.

  // --- alarm_control_panel ---
  categories.push({
    groupKey: 'alarm_control_panel',
    domain: 'alarm_control_panel',
    heading: 'Alarm panel',
    label: 'Alarm panel',
    recipes: [
      {
        id: 'alarm_armed',
        label: 'Alarm armed',
        description: 'Triggers when one or more alarms become armed, regardless of the mode.',
        fields: { trigger: 'alarm_control_panel.armed' },
      },
      {
        id: 'alarm_armed_away',
        label: 'Alarm armed away',
        description: 'Triggers when one or more alarms become armed in away mode.',
        fields: { trigger: 'alarm_control_panel.armed_away' },
      },
      {
        id: 'alarm_armed_home',
        label: 'Alarm armed home',
        description: 'Triggers when one or more alarms become armed in home mode.',
        fields: { trigger: 'alarm_control_panel.armed_home' },
      },
      {
        id: 'alarm_armed_night',
        label: 'Alarm armed night',
        description: 'Triggers when one or more alarms become armed in night mode.',
        fields: { trigger: 'alarm_control_panel.armed_night' },
      },
      {
        id: 'alarm_armed_vacation',
        label: 'Alarm armed vacation',
        description: 'Triggers when one or more alarms become armed in vacation mode.',
        fields: { trigger: 'alarm_control_panel.armed_vacation' },
      },
      {
        id: 'alarm_disarmed',
        label: 'Alarm disarmed',
        description: 'Triggers when one or more alarms become disarmed.',
        fields: { trigger: 'alarm_control_panel.disarmed' },
      },
      {
        id: 'alarm_triggered',
        label: 'Alarm triggered',
        description: 'Triggers when one or more alarms become triggered.',
        fields: { trigger: 'alarm_control_panel.triggered' },
      },
    ],
  });

  // --- humidifier ---
  categories.push({
    groupKey: 'humidifier',
    domain: 'humidifier',
    heading: 'Humidifier',
    label: 'Humidifier',
    recipes: [
      {
        id: 'humidifier_on',
        label: 'Humidifier turned on',
        description: 'Triggers when one or more humidifiers turn on.',
        fields: { trigger: 'humidifier.turned_on' },
      },
      {
        id: 'humidifier_off',
        label: 'Humidifier turned off',
        description: 'Triggers when one or more humidifiers turn off.',
        fields: { trigger: 'humidifier.turned_off' },
      },
      {
        id: 'humidifier_mode_changed',
        label: 'Humidifier mode changed',
        description: 'Triggers when the mode of one or more humidifiers changes.',
        fields: { trigger: 'humidifier.mode_changed' },
      },
      {
        id: 'humidifier_started_humidifying',
        label: 'Humidifier started humidifying',
        description: 'Triggers when one or more humidifiers start humidifying.',
        fields: { trigger: 'humidifier.started_humidifying' },
      },
      {
        id: 'humidifier_started_drying',
        label: 'Humidifier started drying',
        description: 'Triggers when one or more humidifiers start drying.',
        fields: { trigger: 'humidifier.started_drying' },
      },
    ],
  });

  // --- valve ---
  categories.push({
    groupKey: 'valve',
    domain: 'valve',
    heading: 'Valve',
    label: 'Valve',
    recipes: [
      {
        id: 'valve_opened',
        label: 'Valve opened',
        description: 'Triggers when one or more valves open.',
        fields: { trigger: 'valve.opened' },
      },
      {
        id: 'valve_closed',
        label: 'Valve closed',
        description: 'Triggers when one or more valves close.',
        fields: { trigger: 'valve.closed' },
      },
    ],
  });

  // --- siren ---
  categories.push({
    groupKey: 'siren',
    domain: 'siren',
    heading: 'Siren',
    label: 'Siren',
    recipes: [
      {
        id: 'siren_on',
        label: 'Siren turned on',
        description: 'Triggers when one or more sirens turn on.',
        fields: { trigger: 'siren.turned_on' },
      },
      {
        id: 'siren_off',
        label: 'Siren turned off',
        description: 'Triggers when one or more sirens turn off.',
        fields: { trigger: 'siren.turned_off' },
      },
    ],
  });

  // --- remote ---
  categories.push({
    groupKey: 'remote',
    domain: 'remote',
    heading: 'Remote',
    label: 'Remote',
    recipes: [
      {
        id: 'remote_on',
        label: 'Remote turned on',
        description: 'Triggers after one or more remotes turn on.',
        fields: { trigger: 'remote.turned_on' },
      },
      {
        id: 'remote_off',
        label: 'Remote turned off',
        description: 'Triggers after one or more remotes turn off.',
        fields: { trigger: 'remote.turned_off' },
      },
    ],
  });

  // --- select (dropdown helper) ---
  categories.push({
    groupKey: 'select',
    domain: 'select',
    heading: 'Dropdown',
    label: 'Dropdown',
    recipes: [
      {
        id: 'select_changed',
        label: 'Dropdown selection changed',
        description: 'Triggers when the selected option of one or more dropdowns changes.',
        fields: { trigger: 'select.selection_changed' },
      },
    ],
  });

  // --- text (text helper) ---
  categories.push({
    groupKey: 'text',
    domain: 'text',
    heading: 'Text',
    label: 'Text',
    recipes: [
      {
        id: 'text_changed',
        label: 'Text changed',
        description: 'Triggers when the value of one or more text entities changes.',
        fields: { trigger: 'text.changed' },
      },
    ],
  });

  // --- water_heater ---
  categories.push({
    groupKey: 'water_heater',
    domain: 'water_heater',
    heading: 'Water heater',
    label: 'Water heater',
    recipes: [
      {
        id: 'water_heater_on',
        label: 'Water heater turned on',
        description: 'Triggers when one or more water heaters turn on, regardless of the operation mode.',
        fields: { trigger: 'water_heater.turned_on' },
      },
      {
        id: 'water_heater_off',
        label: 'Water heater turned off',
        description: 'Triggers when one or more water heaters turn off.',
        fields: { trigger: 'water_heater.turned_off' },
      },
      {
        id: 'water_heater_mode_changed',
        label: 'Water heater operation mode changed',
        description: 'Triggers when the operation mode of one or more water heaters changes to a specific mode.',
        fields: { trigger: 'water_heater.operation_mode_changed' },
      },
      {
        id: 'water_heater_target_temp_changed',
        label: 'Water heater target temperature changed',
        description: 'Triggers when the temperature setpoint of one or more water heaters changes.',
        fields: { trigger: 'water_heater.target_temperature_changed' },
      },
      {
        id: 'water_heater_target_temp_threshold',
        label: 'Water heater target temperature crossed threshold',
        description: 'Triggers when the temperature setpoint of one or more water heaters crosses a threshold.',
        fields: { trigger: 'water_heater.target_temperature_crossed_threshold' },
      },
    ],
  });

  // --- scene ---
  categories.push({
    groupKey: 'scene',
    domain: 'scene',
    heading: 'Scene',
    label: 'Scene',
    recipes: [
      {
        id: 'scene_activated',
        label: 'Scene activated',
        description: 'Triggers when one or more scenes are activated.',
        fields: { trigger: 'scene.activated' },
      },
    ],
  });

  // --- counter (helper) ---
  categories.push({
    groupKey: 'counter',
    domain: 'counter',
    heading: 'Counter',
    label: 'Counter',
    recipes: [
      {
        id: 'counter_incremented',
        label: 'Counter incremented',
        description: 'Triggers when one or more counters increment.',
        fields: { trigger: 'counter.incremented' },
      },
      {
        id: 'counter_decremented',
        label: 'Counter decremented',
        description: 'Triggers when one or more counters decrement.',
        fields: { trigger: 'counter.decremented' },
      },
      {
        id: 'counter_max_reached',
        label: 'Counter reached maximum',
        description: 'Triggers when one or more counters reach their maximum value.',
        fields: { trigger: 'counter.maximum_reached' },
      },
      {
        id: 'counter_min_reached',
        label: 'Counter reached minimum',
        description: 'Triggers when one or more counters reach their minimum value.',
        fields: { trigger: 'counter.minimum_reached' },
      },
      {
        id: 'counter_reset',
        label: 'Counter reset',
        description: 'Triggers when one or more counters are reset.',
        fields: { trigger: 'counter.reset' },
      },
    ],
  });

  // --- todo (to-do list) ---
  categories.push({
    groupKey: 'todo',
    domain: 'todo',
    heading: 'To-do list',
    label: 'To-do list',
    recipes: [
      {
        id: 'todo_item_added',
        label: 'To-do item added',
        description: 'Triggers when one or more to-do items are added to a list.',
        fields: { trigger: 'todo.item_added' },
      },
      {
        id: 'todo_item_completed',
        label: 'To-do item completed',
        description: 'Triggers when one or more to-do items are marked as done.',
        fields: { trigger: 'todo.item_completed' },
      },
      {
        id: 'todo_item_removed',
        label: 'To-do item removed',
        description: 'Triggers when one or more to-do items are removed from a list.',
        fields: { trigger: 'todo.item_removed' },
      },
    ],
  });

  // --- lawn_mower ---
  categories.push({
    groupKey: 'lawn_mower',
    domain: 'lawn_mower',
    heading: 'Lawn mower',
    label: 'Lawn mower',
    recipes: [
      {
        id: 'lawn_mower_started_mowing',
        label: 'Lawn mower started mowing',
        description: 'Triggers when one or more lawn mowers start mowing.',
        fields: { trigger: 'lawn_mower.started_mowing' },
      },
      {
        id: 'lawn_mower_paused_mowing',
        label: 'Lawn mower paused mowing',
        description: 'Triggers when one or more lawn mowers pause mowing.',
        fields: { trigger: 'lawn_mower.paused_mowing' },
      },
      {
        id: 'lawn_mower_started_returning',
        label: 'Lawn mower started returning to dock',
        description: 'Triggers when one or more lawn mowers start returning to dock.',
        fields: { trigger: 'lawn_mower.started_returning' },
      },
      {
        id: 'lawn_mower_returned_to_dock',
        label: 'Lawn mower returned to dock',
        description: 'Triggers after one or more lawn mowers have returned to dock.',
        fields: { trigger: 'lawn_mower.returned_to_dock' },
      },
      {
        id: 'lawn_mower_errored',
        label: 'Lawn mower encountered an error',
        description: 'Triggers when one or more lawn mowers encounter an error.',
        fields: { trigger: 'lawn_mower.errored' },
      },
    ],
  });

  // --- calendar ---
  // `calendar.event_started`/`calendar.event_ended` (home-assistant.io/
  // triggers/ index) — explicitly requested during the 5th catalog re-audit
  // pass; previously had no category at all. Both keep a normal target
  // (`entity_id`: which calendar(s) to watch) but have no `behavior`/`for`
  // — see nativeThreshold.ts's NO_BEHAVIOR_NO_FOR_TRIGGER_TYPES. `offset` is
  // REQUIRED (unlike the optional/defaulted sun event triggers below), so a
  // zero duration is seeded here — a real, valid "fire exactly at event
  // start/end" configuration, immediately usable without the user having to
  // first discover the field is mandatory. See lib/triggerOffsetField.ts.
  categories.push({
    groupKey: 'calendar',
    domain: 'calendar',
    heading: 'Calendar',
    label: 'Calendar',
    recipes: [
      {
        id: 'calendar_event_started',
        label: 'Calendar event started',
        description: 'Triggers when one or more calendar events start.',
        fields: {
          trigger: 'calendar.event_started',
          options: { offset: { hours: 0, minutes: 0, seconds: 0 }, offset_type: 'before' },
        },
      },
      {
        id: 'calendar_event_ended',
        label: 'Calendar event ended',
        description: 'Triggers when one or more calendar events end.',
        fields: {
          trigger: 'calendar.event_ended',
          options: { offset: { hours: 0, minutes: 0, seconds: 0 }, offset_type: 'before' },
        },
      },
    ],
  });

  // --- sun ---
  // All 8 dotted `sun.*` triggers (home-assistant.io/triggers/ index) — none
  // of these existed in the catalog before this pass. Every one is a
  // singleton (HA hardcodes `sun.sun` internally, no user-selectable
  // target/behavior — see NativeTriggerFields.tsx's `isSunSingleton`
  // branch, added this pass to match NativeConditionFields.tsx's existing
  // equivalent). `elevation_changed`/`elevation_crossed_threshold` are
  // numeric (TYPED threshold, see nativeThreshold.ts); the other 6 are
  // point-in-time event triggers with an `offset`/`offset_type`
  // before/after pair instead (dawn/dusk additionally get a civil/nautical/
  // astronomical `type` selector) — see lib/triggerOffsetField.ts.
  categories.push({
    groupKey: 'sun',
    domain: 'sun',
    heading: 'Sun',
    label: 'Sun',
    recipes: [
      {
        id: 'sun_sunrise',
        label: 'Sunrise',
        description: 'Triggers at sunrise, optionally offset before or after.',
        fields: { trigger: 'sun.sunrise' },
      },
      {
        id: 'sun_sunset',
        label: 'Sunset',
        description: 'Triggers at sunset, optionally offset before or after.',
        fields: { trigger: 'sun.sunset' },
      },
      {
        id: 'sun_dawn',
        label: 'Dawn',
        description: 'Triggers at dawn (civil by default), optionally offset before or after.',
        fields: { trigger: 'sun.dawn' },
      },
      {
        id: 'sun_dusk',
        label: 'Dusk',
        description: 'Triggers at dusk (civil by default), optionally offset before or after.',
        fields: { trigger: 'sun.dusk' },
      },
      {
        id: 'sun_solar_noon',
        label: 'Solar noon',
        description: 'Triggers at solar noon, optionally offset before or after.',
        fields: { trigger: 'sun.solar_noon' },
      },
      {
        id: 'sun_solar_midnight',
        label: 'Solar midnight',
        description: 'Triggers at solar midnight, optionally offset before or after.',
        fields: { trigger: 'sun.solar_midnight' },
      },
      {
        id: 'sun_elevation_changed',
        label: 'Sun elevation changed',
        description: 'Triggers when the elevation of the sun changes.',
        fields: { trigger: 'sun.elevation_changed' },
      },
      {
        id: 'sun_elevation_threshold',
        label: 'Sun elevation crossed threshold',
        description: 'Triggers when the elevation of the sun crosses a threshold.',
        fields: {
          trigger: 'sun.elevation_crossed_threshold',
          options: {
            threshold: {
              type: 'above',
              value: {
                number: 0,
                ...(getThresholdUnit('sun.elevation_crossed_threshold')
                  ? { unit_of_measurement: getThresholdUnit('sun.elevation_crossed_threshold') }
                  : {}),
              },
            },
          },
        },
      },
    ],
  });

  // --- event ---
  // `event.received` (home-assistant.io/triggers/ index) — keeps a normal
  // target (a specific `event.*` entity, e.g. `event.front_door_doorbell`)
  // but no `behavior`/`for`; its only option is a required `event_type`
  // string/list — "the available event types depend on the target entity,"
  // so (like the mode-string enum fields) this is free-text tags rather
  // than a fixed dropdown, since Circuitry has no way to know a specific
  // event entity's valid types ahead of time. See lib/triggerEnumField.ts.
  // The legacy `event` platform (bare event_type/event_data matching, no
  // entity target at all) already exists separately in config/triggerFields.ts
  // and is untouched by this addition.
  categories.push({
    groupKey: 'event',
    domain: 'event',
    heading: 'Event',
    label: 'Event',
    recipes: [
      {
        id: 'event_received',
        label: 'Event received',
        description: 'Triggers when one or more event entities receive a specific event type.',
        fields: { trigger: 'event.received' },
      },
    ],
  });

  // --- moon ---
  // `moon.phase_changed` (home-assistant.io/triggers/ index) — a targetless
  // singleton like every `sun.*` trigger (moon phase is the same everywhere
  // on Earth), with one optional `phase` enum field (8 phases + "any",
  // default "any") — see NativeTriggerFields.tsx's `isMoonPhase` branch and
  // nativeThreshold.ts's `TARGETLESS_TRIGGER_TYPES`/`triggerIsTargetless`.
  categories.push({
    groupKey: 'moon',
    domain: 'moon',
    heading: 'Moon',
    label: 'Moon',
    recipes: [
      {
        id: 'moon_phase_changed',
        label: 'Moon phase changed',
        description: 'Triggers when the moon phase changes, optionally limited to a specific phase.',
        fields: { trigger: 'moon.phase_changed' },
      },
    ],
  });

  // --- assist_satellite ---
  // All 4 confirmed via home-assistant.io/triggers/ index and individually
  // verified (assist_satellite.started_listening's raw markdown source) to
  // use the standard target + behavior (each/first/all) + for shape, no
  // special-casing needed.
  categories.push({
    groupKey: 'assist_satellite',
    domain: 'assist_satellite',
    heading: 'Assist satellite',
    label: 'Assist satellite',
    recipes: [
      {
        id: 'assist_satellite_idle',
        label: 'Assist satellite became idle',
        description: 'Triggers when one or more Assist satellites become idle.',
        fields: { trigger: 'assist_satellite.idle' },
      },
      {
        id: 'assist_satellite_started_listening',
        label: 'Assist satellite started listening',
        description: 'Triggers when one or more Assist satellites start listening.',
        fields: { trigger: 'assist_satellite.started_listening' },
      },
      {
        id: 'assist_satellite_started_processing',
        label: 'Assist satellite started processing',
        description: 'Triggers when one or more Assist satellites start processing a response.',
        fields: { trigger: 'assist_satellite.started_processing' },
      },
      {
        id: 'assist_satellite_started_responding',
        label: 'Assist satellite started responding',
        description: 'Triggers when one or more Assist satellites start responding.',
        fields: { trigger: 'assist_satellite.started_responding' },
      },
    ],
  });

  // --- update ---
  // `update.became_available` (home-assistant.io/triggers/ index) —
  // standard target + behavior (each/first/all, default each) + for shape,
  // confirmed via raw markdown source. Distinct from binary_sensor's
  // `update` device_class category above (a plain state on/off fallback for
  // update entities exposed as a binary_sensor rather than the `update`
  // domain itself — no dedicated trigger page confirmed for that one).
  categories.push({
    groupKey: 'update',
    domain: 'update',
    heading: 'Update',
    label: 'Update',
    recipes: [
      {
        id: 'update_became_available',
        label: 'Update became available',
        description: 'Triggers when an update becomes available for one or more entities.',
        fields: { trigger: 'update.became_available' },
      },
    ],
  });

  // --- zone ---
  // All 4 confirmed via home-assistant.io/triggers/ index. `entered`/`left`
  // target person/device_tracker entities (keep behavior/for); `occupancy_
  // detected`/`occupancy_cleared` are properties of the zone itself — no
  // target, no behavior, but DO keep `for` (see nativeThreshold.ts's
  // `NO_BEHAVIOR_KEEPS_FOR_TRIGGER_TYPES`/`TARGETLESS_TRIGGER_TYPES`). All
  // four require a `zone` option identifying which zone (see
  // lib/triggerEnumField.ts).
  categories.push({
    groupKey: 'zone',
    domain: 'zone',
    heading: 'Zone',
    label: 'Zone',
    recipes: [
      {
        id: 'zone_entered',
        label: 'Entered zone',
        description: 'Triggers when one or more people or device trackers enter a zone.',
        fields: { trigger: 'zone.entered' },
      },
      {
        id: 'zone_left',
        label: 'Left zone',
        description: 'Triggers when one or more people or device trackers leave a zone.',
        fields: { trigger: 'zone.left' },
      },
      {
        id: 'zone_occupancy_detected',
        label: 'Zone occupancy detected',
        description: 'Triggers when a zone transitions from empty to occupied.',
        fields: { trigger: 'zone.occupancy_detected' },
      },
      {
        id: 'zone_occupancy_cleared',
        label: 'Zone occupancy cleared',
        description: 'Triggers when a zone transitions from occupied to empty.',
        fields: { trigger: 'zone.occupancy_cleared' },
      },
    ],
  });

  return { browsable: categories, lookupOnly };
}

const { browsable: BROWSABLE_CATEGORIES, lookupOnly: LOOKUP_ONLY_CATEGORIES } = buildCategories();

/** What "By type" lists and searches — see buildCategories()'s doc comment for why this differs from the resolution map below. */
export const ENTITY_TRIGGER_CATEGORIES: EntityTriggerCategory[] = BROWSABLE_CATEGORIES;

/**
 * Groups `ENTITY_TRIGGER_CATEGORIES` by originating domain, sorted by label
 * within each domain. Shared by TriggerTypePicker.tsx's "By type" tree and
 * WhenTriggerDialog.tsx's Miller-column modal — both need the same
 * domain -> categories map, just rendered differently (accordion tree vs.
 * cascading columns).
 */
export function groupCategoriesByDomain(): Map<string, EntityTriggerCategory[]> {
  const map = new Map<string, EntityTriggerCategory[]>();
  for (const category of ENTITY_TRIGGER_CATEGORIES) {
    const list = map.get(category.domain);
    if (list) list.push(category);
    else map.set(category.domain, [category]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return map;
}

const CATEGORIES_BY_GROUP_KEY = new Map<string, EntityTriggerCategory>(
  [...BROWSABLE_CATEGORIES, ...LOOKUP_ONLY_CATEGORIES].map((c) => [c.groupKey, c])
);

// device_tracker entities share the "Person" category/recipes.
const DOMAIN_ALIASES: Record<string, string> = { device_tracker: 'person' };

/**
 * Resolve the recipe group (heading + selectable rows) for a single entity,
 * or null when its domain/device_class isn't in the catalog yet (only the
 * generic "Entity > State" fallback applies then).
 */
export function getEntityRecipeGroup(
  entityId: string,
  entity: HassEntity | undefined
): EntityRecipeGroup | null {
  const rawDomain = entityId.split('.')[0];
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain;
  const deviceClass = entity?.attributes?.device_class as string | undefined;

  let category: EntityTriggerCategory | undefined;
  if (domain === 'cover' || domain === 'binary_sensor' || domain === 'sensor') {
    category =
      (deviceClass && CATEGORIES_BY_GROUP_KEY.get(`${domain}:${deviceClass}`)) ||
      CATEGORIES_BY_GROUP_KEY.get(`${domain}:default`);
  } else {
    category = CATEGORIES_BY_GROUP_KEY.get(domain);
  }

  if (!category) return null;
  return { groupKey: category.groupKey, heading: category.heading, recipes: category.recipes };
}
