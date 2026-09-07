import {
  Blend,
  Braces,
  CircleSlash,
  Clock,
  Combine,
  Gauge,
  type LucideIcon,
  MapPin,
  Radio,
  Shapes,
  Sun,
} from 'lucide-react';
import { getThresholdUnit } from '@/lib/nativeThreshold';
import type { HassEntity } from '@/types/hass';

/**
 * Client-side catalog of "condition recipes" — the AND-dialog equivalent of
 * lib/triggerRecipes.ts, built the same way: one entry per purpose-specific
 * HA condition (2025.12+ era, `condition: light.is_on` dotted domain.is_*
 * form), cross-referenced against the live home-assistant.io/conditions/
 * reference page (fetched 2026-08) rather than guessed.
 *
 * Unlike triggerRecipes.ts, this catalog does NOT synthesize a legacy
 * `state`/`numeric_state` fallback for domains without a confirmed native
 * condition — every recipe below is a genuinely real, dotted
 * purpose-specific condition straight from HA's own reference page. A
 * generic `state`-equivalent check is still available, just via the
 * AND dialog's "Blocks" section (and/or/not/template/time/trigger) rather
 * than a per-domain synthetic recipe here.
 *
 * `entityDomain` is the real HA entity domain used to filter/select
 * candidate entities in the picker's third column (`binary_sensor`,
 * `sensor`, `cover`, ...) — several condition prefixes are device-class
 * names, not entity domains (`door.is_open` tests `binary_sensor` entities
 * with `device_class: door`, not a `door.*` entity), mirroring exactly how
 * triggerRecipes.ts's BINARY_SENSOR_NATIVE/SENSOR_NATIVE tables handle the
 * same device-class-as-platform-prefix mechanic. Like WhenTriggerDialog's
 * own recipeEntities column, entities are filtered by domain only (not also
 * device_class) — matches the existing trigger picker's own simplification
 * rather than introducing a stricter rule only here.
 */

export interface ConditionRecipeFields {
  /** Always a dotted `domain.is_*`/`domain.<verb>` purpose-specific condition — e.g. `light.is_on`, `door.is_open`, `battery.is_level`. */
  condition: string;
  /** Extra `options` a handful of value-based conditions (battery.is_level, light.is_brightness, ...) accept beyond target — left for the user to fill in via the property panel after creation, same as trigger recipes' threshold options. */
  options?: Record<string, unknown>;
}

/**
 * Seeds a valid, immediately-editable TYPED threshold (see
 * lib/nativeThreshold.ts) for the `is_value`/`is_target_*`-family condition
 * recipes below, rather than leaving `options` unset — NativeConditionFields
 * defaults an unset one to `{}`, still valid to open and fill in, but a
 * concrete starting point (0, "above") matches how trigger recipes seed
 * their sensor-class thresholds in lib/triggerRecipes.ts.
 */
function defaultTypedThresholdOptions(conditionType: string): Record<string, unknown> {
  const unit = getThresholdUnit(conditionType);
  return {
    threshold: {
      type: 'above',
      value: { number: 0, ...(unit ? { unit_of_measurement: unit } : {}) },
    },
  };
}

export interface ConditionRecipe {
  id: string;
  label: string;
  /** Real HA doc wording ("Tests if/the ...") — shown beneath the label in the results row, same convention as TriggerRecipe.description. */
  description?: string;
  fields: ConditionRecipeFields;
}

/**
 * One browsable "type" in the AND catalog — e.g. "Door", "Battery", "Light".
 * `conditionPrefix` doubles as the icon lookup key (lib/domain-icons.ts) —
 * for device-class-prefixed groups (door, motion, battery, ...) that's the
 * device class name itself, not `entityDomain`, so each gets its own icon
 * rather than all collapsing to the generic binary_sensor/sensor icon.
 */
export interface EntityConditionCategory {
  groupKey: string;
  conditionPrefix: string;
  entityDomain: string;
  deviceClass?: string;
  heading: string;
  label: string;
  recipes: ConditionRecipe[];
}

function buildCategories(): EntityConditionCategory[] {
  const categories: EntityConditionCategory[] = [];

  const push = (
    conditionPrefix: string,
    entityDomain: string,
    heading: string,
    recipes: ConditionRecipe[],
    deviceClass?: string
  ) => {
    categories.push({
      groupKey: conditionPrefix,
      conditionPrefix,
      entityDomain,
      deviceClass,
      heading,
      label: heading,
      recipes,
    });
  };

  push('light', 'light', 'Light', [
    { id: 'light_is_on', label: 'Light is on', description: 'Tests if one or more lights are on.', fields: { condition: 'light.is_on' } },
    { id: 'light_is_off', label: 'Light is off', description: 'Tests if one or more lights are off.', fields: { condition: 'light.is_off' } },
    // Seeds a TYPED threshold via defaultTypedThresholdOptions, matching the
    // is_value/is_target_* recipes below — a prior pass here seeded a bare
    // `threshold: 50` number, which matched an (incorrect) FLAT
    // classification for this condition; see lib/nativeThreshold.ts's
    // CORRECTION doc comment for why it's TYPED like everything else.
    { id: 'light_is_brightness', label: 'Light brightness', description: 'Tests the brightness of one or more lights.', fields: { condition: 'light.is_brightness', options: defaultTypedThresholdOptions('light.is_brightness') } },
  ]);

  push('switch', 'switch', 'Switch', [
    { id: 'switch_is_on', label: 'Switch is on', description: 'Tests if one or more switches are on.', fields: { condition: 'switch.is_on' } },
    { id: 'switch_is_off', label: 'Switch is off', description: 'Tests if one or more switches are off.', fields: { condition: 'switch.is_off' } },
  ]);

  push('fan', 'fan', 'Fan', [
    { id: 'fan_is_on', label: 'Fan is on', description: 'Tests if one or more fans are on.', fields: { condition: 'fan.is_on' } },
    { id: 'fan_is_off', label: 'Fan is off', description: 'Tests if one or more fans are off.', fields: { condition: 'fan.is_off' } },
  ]);

  push('lock', 'lock', 'Lock', [
    { id: 'lock_is_locked', label: 'Lock is locked', description: 'Tests if one or more locks are locked.', fields: { condition: 'lock.is_locked' } },
    { id: 'lock_is_unlocked', label: 'Lock is unlocked', description: 'Tests if one or more locks are unlocked.', fields: { condition: 'lock.is_unlocked' } },
    { id: 'lock_is_open', label: 'Lock is open', description: 'Tests if one or more locks are open.', fields: { condition: 'lock.is_open' } },
    { id: 'lock_is_jammed', label: 'Lock is jammed', description: 'Tests if one or more locks are jammed.', fields: { condition: 'lock.is_jammed' } },
  ]);

  // Cover — only the 5 sub-classes HA has actually graduated to a native
  // condition for (awning/blind/curtain/shade/shutter). Damper has no
  // confirmed native condition; door/garage/gate/window cover device
  // classes are handled by the standalone door/garage_door/gate/window
  // groups below instead (see file doc comment).
  const coverSubclasses: Record<string, string> = {
    awning: 'Awning',
    blind: 'Blind',
    curtain: 'Curtain',
    shade: 'Shade',
    shutter: 'Shutter',
  };
  const coverRecipes: ConditionRecipe[] = [];
  for (const [cls, name] of Object.entries(coverSubclasses)) {
    coverRecipes.push(
      { id: `cover_${cls}_is_closed`, label: `${name} is closed`, description: `Tests if one or more ${name.toLowerCase()}s are closed.`, fields: { condition: `cover.${cls}_is_closed` } },
      { id: `cover_${cls}_is_open`, label: `${name} is open`, description: `Tests if one or more ${name.toLowerCase()}s are open.`, fields: { condition: `cover.${cls}_is_open` } }
    );
  }
  push('cover', 'cover', 'Cover', coverRecipes);

  push('door', 'binary_sensor', 'Door', [
    { id: 'door_is_closed', label: 'Door is closed', description: 'Tests if one or more doors are closed.', fields: { condition: 'door.is_closed' } },
    { id: 'door_is_open', label: 'Door is open', description: 'Tests if one or more doors are open.', fields: { condition: 'door.is_open' } },
  ], 'door');

  push('garage_door', 'binary_sensor', 'Garage door', [
    { id: 'garage_door_is_closed', label: 'Garage door is closed', description: 'Tests if one or more garage doors are closed.', fields: { condition: 'garage_door.is_closed' } },
    { id: 'garage_door_is_open', label: 'Garage door is open', description: 'Tests if one or more garage doors are open.', fields: { condition: 'garage_door.is_open' } },
  ], 'garage_door');

  // 'gate' is a cover device class (motorized gates), not a binary_sensor
  // one — HA has no binary_sensor 'gate' device class, matching how
  // triggerRecipes.ts's COVER_CLASSES table treats it.
  push('gate', 'cover', 'Gate', [
    { id: 'gate_is_closed', label: 'Gate is closed', description: 'Tests if one or more gates are closed.', fields: { condition: 'gate.is_closed' } },
    { id: 'gate_is_open', label: 'Gate is open', description: 'Tests if one or more gates are open.', fields: { condition: 'gate.is_open' } },
  ], 'gate');

  push('window', 'binary_sensor', 'Window', [
    { id: 'window_is_closed', label: 'Window is closed', description: 'Tests if one or more windows are closed.', fields: { condition: 'window.is_closed' } },
    { id: 'window_is_open', label: 'Window is open', description: 'Tests if one or more windows are open.', fields: { condition: 'window.is_open' } },
  ], 'window');

  push('valve', 'valve', 'Valve', [
    { id: 'valve_is_closed', label: 'Valve is closed', description: 'Tests if one or more valves are closed.', fields: { condition: 'valve.is_closed' } },
    { id: 'valve_is_open', label: 'Valve is open', description: 'Tests if one or more valves are open.', fields: { condition: 'valve.is_open' } },
  ]);

  push('siren', 'siren', 'Siren', [
    { id: 'siren_is_on', label: 'Siren is on', description: 'Tests if one or more sirens are on.', fields: { condition: 'siren.is_on' } },
    { id: 'siren_is_off', label: 'Siren is off', description: 'Tests if one or more sirens are off.', fields: { condition: 'siren.is_off' } },
  ]);

  push('remote', 'remote', 'Remote', [
    { id: 'remote_is_on', label: 'Remote is on', description: 'Tests if one or more remotes are on.', fields: { condition: 'remote.is_on' } },
    { id: 'remote_is_off', label: 'Remote is off', description: 'Tests if one or more remotes are off.', fields: { condition: 'remote.is_off' } },
  ]);

  push('alarm_control_panel', 'alarm_control_panel', 'Alarm panel', [
    { id: 'alarm_is_armed', label: 'Alarm is armed', description: 'Tests if one or more alarms are armed.', fields: { condition: 'alarm_control_panel.is_armed' } },
    { id: 'alarm_is_armed_away', label: 'Alarm is armed away', description: 'Tests if one or more alarms are armed in away mode.', fields: { condition: 'alarm_control_panel.is_armed_away' } },
    { id: 'alarm_is_armed_home', label: 'Alarm is armed home', description: 'Tests if one or more alarms are armed in home mode.', fields: { condition: 'alarm_control_panel.is_armed_home' } },
    { id: 'alarm_is_armed_night', label: 'Alarm is armed night', description: 'Tests if one or more alarms are armed in night mode.', fields: { condition: 'alarm_control_panel.is_armed_night' } },
    { id: 'alarm_is_armed_vacation', label: 'Alarm is armed vacation', description: 'Tests if one or more alarms are armed in vacation mode.', fields: { condition: 'alarm_control_panel.is_armed_vacation' } },
    { id: 'alarm_is_disarmed', label: 'Alarm is disarmed', description: 'Tests if one or more alarms are disarmed.', fields: { condition: 'alarm_control_panel.is_disarmed' } },
    { id: 'alarm_is_triggered', label: 'Alarm is triggered', description: 'Tests if one or more alarms are triggered.', fields: { condition: 'alarm_control_panel.is_triggered' } },
  ]);

  push('climate', 'climate', 'Climate', [
    { id: 'climate_is_cooling', label: 'Thermostat is cooling', description: 'Tests if one or more thermostats are cooling.', fields: { condition: 'climate.is_cooling' } },
    { id: 'climate_is_drying', label: 'Thermostat is drying', description: 'Tests if one or more thermostats are drying.', fields: { condition: 'climate.is_drying' } },
    { id: 'climate_is_heating', label: 'Thermostat is heating', description: 'Tests if one or more thermostats are heating.', fields: { condition: 'climate.is_heating' } },
    { id: 'climate_is_hvac_mode', label: 'Thermostat is in HVAC mode', description: 'Tests if one or more thermostats are set to a specific HVAC mode.', fields: { condition: 'climate.is_hvac_mode' } },
    { id: 'climate_is_off', label: 'Thermostat is off', description: 'Tests if one or more thermostats are off.', fields: { condition: 'climate.is_off' } },
    { id: 'climate_is_on', label: 'Thermostat is on', description: 'Tests if one or more thermostats are on.', fields: { condition: 'climate.is_on' } },
    { id: 'climate_is_target_humidity', label: 'Thermostat target humidity', description: 'Tests the target humidity of one or more thermostats.', fields: { condition: 'climate.is_target_humidity', options: defaultTypedThresholdOptions('climate.is_target_humidity') } },
    { id: 'climate_is_target_temperature', label: 'Thermostat target temperature', description: 'Tests the target temperature of one or more thermostats.', fields: { condition: 'climate.is_target_temperature', options: defaultTypedThresholdOptions('climate.is_target_temperature') } },
  ]);

  push('humidifier', 'humidifier', 'Humidifier', [
    { id: 'humidifier_is_drying', label: 'Humidifier is drying', description: 'Tests if one or more humidifiers are drying.', fields: { condition: 'humidifier.is_drying' } },
    { id: 'humidifier_is_humidifying', label: 'Humidifier is humidifying', description: 'Tests if one or more humidifiers are humidifying.', fields: { condition: 'humidifier.is_humidifying' } },
    { id: 'humidifier_is_mode', label: 'Humidifier is in mode', description: 'Tests if one or more humidifiers are set to a specific mode.', fields: { condition: 'humidifier.is_mode' } },
    { id: 'humidifier_is_off', label: 'Humidifier is off', description: 'Tests if one or more humidifiers are off.', fields: { condition: 'humidifier.is_off' } },
    { id: 'humidifier_is_on', label: 'Humidifier is on', description: 'Tests if one or more humidifiers are on.', fields: { condition: 'humidifier.is_on' } },
    { id: 'humidifier_is_target_humidity', label: 'Humidifier target humidity', description: 'Tests the target humidity of one or more humidifiers.', fields: { condition: 'humidifier.is_target_humidity', options: defaultTypedThresholdOptions('humidifier.is_target_humidity') } },
  ]);

  push('water_heater', 'water_heater', 'Water heater', [
    { id: 'water_heater_is_off', label: 'Water heater is off', description: 'Tests if one or more water heaters are off.', fields: { condition: 'water_heater.is_off' } },
    { id: 'water_heater_is_on', label: 'Water heater is on', description: 'Tests if one or more water heaters are on.', fields: { condition: 'water_heater.is_on' } },
    { id: 'water_heater_is_operation_mode', label: 'Water heater operation mode', description: 'Tests if one or more water heaters are set to a specific operation mode.', fields: { condition: 'water_heater.is_operation_mode' } },
    { id: 'water_heater_is_target_temperature', label: 'Water heater target temperature', description: 'Tests the temperature setpoint of one or more water heaters.', fields: { condition: 'water_heater.is_target_temperature' } },
  ]);

  push('media_player', 'media_player', 'Media player', [
    { id: 'mp_is_muted', label: 'Media player is muted', description: 'Tests if one or more media players are muted.', fields: { condition: 'media_player.is_muted' } },
    { id: 'mp_is_not_playing', label: 'Media player is not playing', description: 'Tests if one or more media players are not playing.', fields: { condition: 'media_player.is_not_playing' } },
    { id: 'mp_is_off', label: 'Media player is off', description: 'Tests if one or more media players are off.', fields: { condition: 'media_player.is_off' } },
    { id: 'mp_is_on', label: 'Media player is on', description: 'Tests if one or more media players are on.', fields: { condition: 'media_player.is_on' } },
    { id: 'mp_is_paused', label: 'Media player is paused', description: 'Tests if one or more media players are paused.', fields: { condition: 'media_player.is_paused' } },
    { id: 'mp_is_playing', label: 'Media player is playing', description: 'Tests if one or more media players are playing.', fields: { condition: 'media_player.is_playing' } },
    { id: 'mp_is_unmuted', label: 'Media player is not muted', description: 'Tests if one or more media players are not muted.', fields: { condition: 'media_player.is_unmuted' } },
    { id: 'mp_is_volume', label: 'Media player volume', description: 'Tests the volume of one or more media players.', fields: { condition: 'media_player.is_volume' } },
  ]);

  push('vacuum', 'vacuum', 'Vacuum', [
    { id: 'vacuum_is_cleaning', label: 'Vacuum cleaner is cleaning', description: 'Passes when the vacuum cleaner is cleaning.', fields: { condition: 'vacuum.is_cleaning' } },
    { id: 'vacuum_is_docked', label: 'Vacuum cleaner is docked', description: 'Passes when the vacuum cleaner is docked.', fields: { condition: 'vacuum.is_docked' } },
    { id: 'vacuum_is_encountering_an_error', label: 'Vacuum cleaner is encountering an error', description: 'Passes when the vacuum cleaner is in an error state.', fields: { condition: 'vacuum.is_encountering_an_error' } },
    { id: 'vacuum_is_paused', label: 'Vacuum cleaner is paused', description: 'Passes when the vacuum cleaner is paused.', fields: { condition: 'vacuum.is_paused' } },
    { id: 'vacuum_is_returning', label: 'Vacuum cleaner is returning', description: 'Passes when the vacuum cleaner is returning to the dock.', fields: { condition: 'vacuum.is_returning' } },
  ]);

  push('lawn_mower', 'lawn_mower', 'Lawn mower', [
    { id: 'lawn_mower_is_docked', label: 'Lawn mower is docked', description: 'Tests if one or more lawn mowers are docked.', fields: { condition: 'lawn_mower.is_docked' } },
    { id: 'lawn_mower_is_encountering_an_error', label: 'Lawn mower is encountering an error', description: 'Tests if one or more lawn mowers are encountering an error.', fields: { condition: 'lawn_mower.is_encountering_an_error' } },
    { id: 'lawn_mower_is_mowing', label: 'Lawn mower is mowing', description: 'Tests if one or more lawn mowers are mowing.', fields: { condition: 'lawn_mower.is_mowing' } },
    { id: 'lawn_mower_is_paused', label: 'Lawn mower is paused', description: 'Tests if one or more lawn mowers are paused.', fields: { condition: 'lawn_mower.is_paused' } },
    { id: 'lawn_mower_is_returning', label: 'Lawn mower is returning', description: 'Tests if one or more lawn mowers are returning to the dock.', fields: { condition: 'lawn_mower.is_returning' } },
  ]);

  push('select', 'select', 'Dropdown', [
    { id: 'select_is_option_selected', label: 'Dropdown option is selected', description: 'Tests if one or more dropdowns have a specific option selected.', fields: { condition: 'select.is_option_selected' } },
  ]);

  push('text', 'text', 'Text', [
    { id: 'text_is_equal_to', label: 'Text is equal to', description: 'Tests if one or more text entities are equal to a specified value.', fields: { condition: 'text.is_equal_to' } },
  ]);

  push('counter', 'counter', 'Counter', [
    { id: 'counter_is_value', label: 'Counter value', description: 'Tests the value of one or more counters.', fields: { condition: 'counter.is_value' } },
  ]);

  push('todo', 'todo', 'To-do list', [
    { id: 'todo_all_completed', label: 'All to-do items completed', description: 'Tests if all to-do items are completed in one or more to-do lists.', fields: { condition: 'todo.all_completed' } },
    { id: 'todo_incomplete', label: 'Incomplete to-do items', description: 'Tests the number of incomplete to-do items in one or more to-do lists.', fields: { condition: 'todo.incomplete' } },
  ]);

  push('schedule', 'schedule', 'Schedule', [
    { id: 'schedule_is_on', label: 'Schedule is on', description: 'Tests if one or more schedule blocks are currently active.', fields: { condition: 'schedule.is_on' } },
    { id: 'schedule_is_off', label: 'Schedule is off', description: 'Tests if one or more schedule blocks are currently not active.', fields: { condition: 'schedule.is_off' } },
  ]);

  push('timer', 'timer', 'Timer', [
    { id: 'timer_is_active', label: 'Timer is active', description: 'Tests if one or more timers are active.', fields: { condition: 'timer.is_active' } },
    { id: 'timer_is_idle', label: 'Timer is idle', description: 'Tests if one or more timers are idle.', fields: { condition: 'timer.is_idle' } },
    { id: 'timer_is_paused', label: 'Timer is paused', description: 'Tests if one or more timers are paused.', fields: { condition: 'timer.is_paused' } },
  ]);

  push('update', 'update', 'Update', [
    { id: 'update_is_available', label: 'Update is available', description: 'Tests if one or more updates are available.', fields: { condition: 'update.is_available' } },
    { id: 'update_is_not_available', label: 'Update is not available', description: 'Tests if one or more updates are not available.', fields: { condition: 'update.is_not_available' } },
  ]);

  push('assist_satellite', 'assist_satellite', 'Assist satellite', [
    { id: 'satellite_is_idle', label: 'Satellite is idle', description: 'Tests if one or more Assist satellites are idle.', fields: { condition: 'assist_satellite.is_idle' } },
    { id: 'satellite_is_listening', label: 'Satellite is listening', description: 'Tests if one or more Assist satellites are listening for a voice command.', fields: { condition: 'assist_satellite.is_listening' } },
    { id: 'satellite_is_processing', label: 'Satellite is processing', description: 'Tests if one or more Assist satellites are processing a voice command.', fields: { condition: 'assist_satellite.is_processing' } },
    { id: 'satellite_is_responding', label: 'Satellite is responding', description: 'Tests if one or more Assist satellites are playing back a response.', fields: { condition: 'assist_satellite.is_responding' } },
  ]);

  push('calendar', 'calendar', 'Calendar', [
    { id: 'calendar_is_event_active', label: 'Calendar event is active', description: 'Tests if one or more calendars have an active event.', fields: { condition: 'calendar.is_event_active' } },
  ]);

  // --- binary_sensor device-class-prefixed conditions ---
  push('motion', 'binary_sensor', 'Motion', [
    { id: 'motion_is_detected', label: 'Motion is detected', description: 'Tests if one or more motion sensors are detecting motion.', fields: { condition: 'motion.is_detected' } },
    { id: 'motion_is_not_detected', label: 'Motion is not detected', description: 'Tests if one or more motion sensors are not detecting motion.', fields: { condition: 'motion.is_not_detected' } },
  ], 'motion');

  push('occupancy', 'binary_sensor', 'Occupancy', [
    { id: 'occupancy_is_detected', label: 'Occupancy is detected', description: 'Tests if one or more occupancy sensors are reporting a space as occupied.', fields: { condition: 'occupancy.is_detected' } },
    { id: 'occupancy_is_not_detected', label: 'Occupancy is not detected', description: 'Tests if one or more occupancy sensors are reporting a space as not occupied.', fields: { condition: 'occupancy.is_not_detected' } },
  ], 'occupancy');

  push('vibration', 'binary_sensor', 'Vibration', [
    { id: 'vibration_is_detected', label: 'Vibration is detected', description: 'Tests if one or more vibration sensors are detecting vibration.', fields: { condition: 'vibration.is_detected' } },
    { id: 'vibration_is_not_detected', label: 'Vibration is not detected', description: 'Tests if one or more vibration sensors are not detecting vibration.', fields: { condition: 'vibration.is_not_detected' } },
  ], 'vibration');

  push('moisture', 'binary_sensor', 'Moisture', [
    { id: 'moisture_is_detected', label: 'Moisture is detected', description: 'Tests if one or more moisture sensors are detecting moisture.', fields: { condition: 'moisture.is_detected' } },
    { id: 'moisture_is_not_detected', label: 'Moisture is not detected', description: 'Tests if one or more moisture sensors are not detecting moisture.', fields: { condition: 'moisture.is_not_detected' } },
    { id: 'moisture_is_value', label: 'Moisture level', description: 'Tests if a moisture content value is above a threshold, below a threshold, or in a range of values.', fields: { condition: 'moisture.is_value', options: defaultTypedThresholdOptions('moisture.is_value') } },
  ], 'moisture');

  // --- battery: shares the same "is_low/is_charging" boolean-style checks
  // as a binary_sensor device_class, but also a numeric "is_level" — HA
  // dispatches this condition against both binary_sensor.battery and
  // sensor.battery entities; binary_sensor picked here as the default
  // filter domain since is_low (the first-listed, most common check) is
  // fundamentally boolean, matching BINARY_SENSOR_NATIVE's equivalent
  // trigger-side choice.
  push('battery', 'binary_sensor', 'Battery', [
    { id: 'battery_is_charging', label: 'Battery is charging', description: 'Tests if one or more battery-powered devices are charging.', fields: { condition: 'battery.is_charging' } },
    { id: 'battery_is_not_charging', label: 'Battery is not charging', description: 'Tests if one or more battery-powered devices are not charging.', fields: { condition: 'battery.is_not_charging' } },
    { id: 'battery_is_low', label: 'Battery is low', description: 'Tests if one or more batteries are reporting a low charge.', fields: { condition: 'battery.is_low' } },
    { id: 'battery_is_not_low', label: 'Battery is not low', description: 'Tests if one or more batteries are not reporting a low charge.', fields: { condition: 'battery.is_not_low' } },
    { id: 'battery_is_level', label: 'Battery level', description: 'Tests if a battery level is above a threshold, below a threshold, or in a range of values.', fields: { condition: 'battery.is_level' } },
  ], 'battery');

  // --- sensor device-class-prefixed value conditions ---
  push('humidity', 'sensor', 'Humidity', [
    { id: 'humidity_is_value', label: 'Relative humidity', description: 'Tests the relative humidity of one or more entities.', fields: { condition: 'humidity.is_value', options: defaultTypedThresholdOptions('humidity.is_value') } },
  ], 'humidity');

  push('illuminance', 'sensor', 'Illuminance', [
    { id: 'illuminance_is_detected', label: 'Light level is detected', description: 'Tests if one or more light sensors are detecting light.', fields: { condition: 'illuminance.is_detected' } },
    { id: 'illuminance_is_not_detected', label: 'Light level is not detected', description: 'Tests if one or more light sensors are not detecting light.', fields: { condition: 'illuminance.is_not_detected' } },
    { id: 'illuminance_is_value', label: 'Illuminance', description: 'Tests the illuminance of one or more entities.', fields: { condition: 'illuminance.is_value', options: defaultTypedThresholdOptions('illuminance.is_value') } },
  ], 'illuminance');

  push('power', 'sensor', 'Power', [
    { id: 'power_is_value', label: 'Power value', description: 'Tests the power value of one or more entities.', fields: { condition: 'power.is_value', options: defaultTypedThresholdOptions('power.is_value') } },
  ], 'power');

  push('temperature', 'sensor', 'Temperature', [
    { id: 'temperature_is_value', label: 'Temperature value', description: 'Tests if a temperature value is above a threshold, below a threshold, or in a range of values.', fields: { condition: 'temperature.is_value', options: defaultTypedThresholdOptions('temperature.is_value') } },
  ], 'temperature');

  // --- air_quality: its own (legacy-adjacent but still current) entity
  // domain, not a binary_sensor/sensor device class.
  push('air_quality', 'air_quality', 'Air quality', [
    { id: 'aq_co2_value', label: 'Carbon dioxide value', description: 'Tests the carbon dioxide level of one or more entities.', fields: { condition: 'air_quality.is_co2_value' } },
    { id: 'aq_co_cleared', label: 'Carbon monoxide cleared', description: 'Tests if one or more carbon monoxide sensors are cleared.', fields: { condition: 'air_quality.is_co_cleared' } },
    { id: 'aq_co_detected', label: 'Carbon monoxide detected', description: 'Tests if one or more carbon monoxide sensors are detecting carbon monoxide.', fields: { condition: 'air_quality.is_co_detected' } },
    { id: 'aq_co_value', label: 'Carbon monoxide value', description: 'Tests the carbon monoxide level of one or more entities.', fields: { condition: 'air_quality.is_co_value' } },
    { id: 'aq_gas_cleared', label: 'Gas cleared', description: 'Tests if one or more gas sensors are cleared.', fields: { condition: 'air_quality.is_gas_cleared' } },
    { id: 'aq_gas_detected', label: 'Gas detected', description: 'Tests if one or more gas sensors are detecting gas.', fields: { condition: 'air_quality.is_gas_detected' } },
    { id: 'aq_n2o_value', label: 'Nitrous oxide value', description: 'Tests the nitrous oxide level of one or more entities.', fields: { condition: 'air_quality.is_n2o_value' } },
    { id: 'aq_no2_value', label: 'Nitrogen dioxide value', description: 'Tests the nitrogen dioxide level of one or more entities.', fields: { condition: 'air_quality.is_no2_value' } },
    { id: 'aq_no_value', label: 'Nitrogen monoxide value', description: 'Tests the nitrogen monoxide level of one or more entities.', fields: { condition: 'air_quality.is_no_value' } },
    { id: 'aq_ozone_value', label: 'Ozone value', description: 'Tests the ozone level of one or more entities.', fields: { condition: 'air_quality.is_ozone_value' } },
    { id: 'aq_pm10_value', label: 'PM10 value', description: 'Tests the PM10 level of one or more entities.', fields: { condition: 'air_quality.is_pm10_value' } },
    { id: 'aq_pm1_value', label: 'PM1 value', description: 'Tests the PM1 level of one or more entities.', fields: { condition: 'air_quality.is_pm1_value' } },
    { id: 'aq_pm25_value', label: 'PM2.5 value', description: 'Tests the PM2.5 level of one or more entities.', fields: { condition: 'air_quality.is_pm25_value' } },
    { id: 'aq_pm4_value', label: 'PM4 value', description: 'Tests the PM4 level of one or more entities.', fields: { condition: 'air_quality.is_pm4_value' } },
    { id: 'aq_smoke_cleared', label: 'Smoke cleared', description: 'Tests if one or more smoke sensors are cleared.', fields: { condition: 'air_quality.is_smoke_cleared' } },
    { id: 'aq_smoke_detected', label: 'Smoke detected', description: 'Tests if one or more smoke sensors are detecting smoke.', fields: { condition: 'air_quality.is_smoke_detected' } },
    { id: 'aq_so2_value', label: 'Sulphur dioxide value', description: 'Tests the sulphur dioxide level of one or more entities.', fields: { condition: 'air_quality.is_so2_value' } },
    { id: 'aq_voc_ratio_value', label: 'Volatile organic compounds ratio value', description: 'Tests the volatile organic compounds ratio of one or more entities.', fields: { condition: 'air_quality.is_voc_ratio_value' } },
    { id: 'aq_voc_value', label: 'Volatile organic compounds value', description: 'Tests the volatile organic compounds level of one or more entities.', fields: { condition: 'air_quality.is_voc_value' } },
  ]);

  return categories;
}

export const ENTITY_CONDITION_CATEGORIES: EntityConditionCategory[] = buildCategories();

/**
 * Groups ENTITY_CONDITION_CATEGORIES by `conditionPrefix`, sorted by label —
 * the "Device types" column of AndConditionDialog.tsx's root just needs a
 * flat, alphabetically-organized list, one row per category (no
 * light/switch/fan-style "always 2+ categories under one domain" grouping
 * the trigger picker needs, since every condition prefix here is already
 * its own distinct category — kept as a Map for symmetry with
 * triggerRecipes.ts's groupCategoriesByDomain anyway, in case a future
 * domain needs it).
 */
export function groupConditionCategoriesByPrefix(): Map<string, EntityConditionCategory[]> {
  const map = new Map<string, EntityConditionCategory[]>();
  for (const category of ENTITY_CONDITION_CATEGORIES) {
    const list = map.get(category.conditionPrefix);
    if (list) list.push(category);
    else map.set(category.conditionPrefix, [category]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return map;
}

const CATEGORIES_BY_GROUP_KEY = new Map<string, EntityConditionCategory>(
  ENTITY_CONDITION_CATEGORIES.map((c) => [c.groupKey, c])
);

// device_tracker shares no condition category of its own (zone conditions
// are out of scope for this catalog, see file doc comment) — no alias table
// needed here, unlike triggerRecipes.ts's person/device_tracker one.

/**
 * Resolve the condition recipe group for a single entity, keyed by its
 * domain/device_class — the AND-dialog equivalent of
 * triggerRecipes.ts's getEntityRecipeGroup, used by the "By target" results
 * column.
 */
export function getEntityConditionRecipeGroup(
  entityId: string,
  entity: HassEntity | undefined
): EntityConditionCategory | null {
  const domain = entityId.split('.')[0];
  const deviceClass = entity?.attributes?.device_class as string | undefined;

  if ((domain === 'binary_sensor' || domain === 'sensor' || domain === 'cover') && deviceClass) {
    const byDeviceClass = CATEGORIES_BY_GROUP_KEY.get(deviceClass);
    if (byDeviceClass && byDeviceClass.entityDomain === domain) return byDeviceClass;
  }
  const byDomain = CATEGORIES_BY_GROUP_KEY.get(domain);
  if (byDomain && byDomain.entityDomain === domain) return byDomain;
  return null;
}

// ---------------------------------------------------------------------------
// "Blocks" — the AND dialog's structural and generic conditions: logic
// (and/or/not), the generic state/numeric_state/sun/zone conditions (the
// fallback referenced in this file's top doc comment, for anything not
// covered by a purpose-specific recipe above), template, time, and
// trigger-by-id. Each commits immediately (no target/entity picker step —
// entity_id/zone/etc. are left for the property panel), unlike every
// domain-specific recipe above.
// ---------------------------------------------------------------------------

export interface ConditionBlock {
  key: string;
  label: string;
  description: string;
  /** The literal `data` a new condition node gets when this block is picked — always a minimal, valid-YAML starting point the property panel can then fill in further. */
  data: Record<string, unknown>;
}

export const CONDITION_BLOCKS: ConditionBlock[] = [
  {
    key: 'and',
    label: 'And',
    description: 'Passes only when every one of its own sub-conditions passes.',
    data: { condition: 'and', conditions: [] },
  },
  {
    key: 'or',
    label: 'Or',
    description: 'Passes when any one of its own sub-conditions passes.',
    data: { condition: 'or', conditions: [] },
  },
  {
    key: 'not',
    label: 'Not',
    description: 'Passes only when none of its own sub-conditions pass.',
    data: { condition: 'not', conditions: [] },
  },
  {
    key: 'state',
    label: 'State',
    description: 'Tests if an entity is (or is not) in a specific state — the generic form behind every domain-specific recipe above.',
    data: { condition: 'state', entity_id: '', state: '' },
  },
  {
    key: 'numeric_state',
    label: 'Numeric State',
    description: "Tests an entity's numeric state or attribute against an above/below threshold.",
    data: { condition: 'numeric_state', entity_id: '' },
  },
  {
    key: 'sun',
    label: 'Sun',
    description: 'Tests the current position of the sun, before or after sunrise/sunset (with an optional offset).',
    data: { condition: 'sun', after: 'sunset' },
  },
  {
    key: 'zone',
    label: 'Zone',
    description: 'Tests if a device_tracker or person entity is currently inside a zone.',
    data: { condition: 'zone', entity_id: '', zone: '' },
  },
  {
    key: 'template',
    label: 'Template',
    description: 'Passes when a Jinja2 template evaluates to true.',
    data: { condition: 'template', value_template: '' },
  },
  {
    key: 'time',
    label: 'Time',
    description: 'Passes only during a specific time window or on specific weekdays.',
    data: { condition: 'time' },
  },
  {
    key: 'trigger',
    label: 'Trigger',
    description: 'Passes only when the automation was started by a specific trigger (matched by its id).',
    data: { condition: 'trigger', id: '' },
  },
];

// Per-block icon for AndConditionDialog.tsx's BlocksColumn — was a single
// icon prop shared by every row (defaulting to the generic Blocks glyph),
// reported directly by the user as the And/Or/Not/State/... section all
// rendering identically, the same root cause already fixed for
// ThenActionDialog.tsx's own Blocks column (see actionBlocks.ts's
// getActionBlockIcon). `sun`/`time`/`trigger` reuse the exact icons already
// used elsewhere in this app for the same concept (Sun/Clock/Radio, all
// already imported into AndConditionDialog.tsx and matching Home Assistant's
// own condition.ts CONDITION_COLLECTIONS icons — mdiWeatherSunny/
// mdiClockOutline — where HA defines one; `state`'s Shapes mirrors HA's
// mdiShape for its generic "entity" condition group). HA's own
// condition.ts doesn't define icons for and/or/not/zone/template/trigger,
// so those are picked here for a clear, mutually-distinct look instead.
const CONDITION_BLOCK_ICONS: Record<string, LucideIcon> = {
  and: Combine, // HA has no icon for this — logic building block
  or: Blend, // HA has no icon for this — logic building block
  not: CircleSlash, // HA has no icon for this — logic building block
  state: Shapes, // HA: mdiShape (its generic "entity" condition group)
  numeric_state: Gauge,
  sun: Sun, // HA: mdiWeatherSunny
  zone: MapPin,
  template: Braces,
  time: Clock, // HA: mdiClockOutline
  trigger: Radio, // matches nodeTypeCatalog.ts's own 'trigger' node icon
};

export function getConditionBlockIcon(block: ConditionBlock): LucideIcon {
  return CONDITION_BLOCK_ICONS[block.key] ?? Shapes;
}

// ---------------------------------------------------------------------------
// "Sun" — the AND dialog's "By type" > "Sun" category. Verified directly
// against home-assistant/core's homeassistant/components/sun/condition.py
// (fetched 2026-08): the sun integration registers 8 purpose-built dotted
// `sun.is_*`/`sun.elevation` conditions (CONDITIONS dict, minus its "_" entry
// which is the bare legacy `condition: sun` before/after form — that one
// stays reachable through CONDITION_BLOCKS' own 'sun' entry above, unrelated
// to this category). None of the 8 take a target — the sun is a singleton
// (`sun.sun`), so every one of these commits immediately on selection, the
// same way a ConditionBlock does, rather than routing through the
// entity-target picker every other By-type category uses.
// ---------------------------------------------------------------------------

export const SUN_CONDITIONS: ConditionBlock[] = [
  {
    key: 'sun_is_up',
    label: 'Sun is up',
    description: 'Tests if the sun is up.',
    data: { condition: 'sun.is_up' },
  },
  {
    key: 'sun_is_set',
    label: 'Sun is set',
    description: 'Tests if the sun is set.',
    data: { condition: 'sun.is_set' },
  },
  {
    key: 'sun_is_ascending',
    label: 'Sun is ascending',
    description: 'Tests if the sun is ascending.',
    data: { condition: 'sun.is_ascending' },
  },
  {
    key: 'sun_is_descending',
    label: 'Sun is descending',
    description: 'Tests if the sun is descending.',
    data: { condition: 'sun.is_descending' },
  },
  {
    key: 'sun_elevation',
    label: 'Sun elevation',
    description: "Tests the sun's elevation against a threshold you set.",
    data: { condition: 'sun.elevation', options: {} },
  },
  {
    key: 'sun_is_night',
    label: 'It is night',
    description: 'Tests if it is night.',
    data: { condition: 'sun.is_night' },
  },
  {
    key: 'sun_is_morning_twilight',
    label: 'It is morning twilight',
    description: 'Tests if it is morning twilight, optionally of a specific type.',
    data: { condition: 'sun.is_morning_twilight', options: { type: 'any' } },
  },
  {
    key: 'sun_is_evening_twilight',
    label: 'It is evening twilight',
    description: 'Tests if it is evening twilight, optionally of a specific type.',
    data: { condition: 'sun.is_evening_twilight', options: { type: 'any' } },
  },
];
