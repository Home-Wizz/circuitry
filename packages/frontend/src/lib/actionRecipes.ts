/**
 * Client-side catalog of "action recipes" for ThenActionDialog.tsx — the
 * Then-dialog equivalent of lib/triggerRecipes.ts/lib/conditionRecipes.ts,
 * cross-referenced against the live home-assistant.io/actions/ reference
 * page (fetched 2026-08) for the core, long-stable domains a home
 * automation actually acts on.
 *
 * Unlike triggers/conditions, HA's actions have **no** 2025.12-era
 * purpose-specific dotted format to worry about — `service: light.turn_on`
 * is the same plain `domain.service_name` shape actions have always used
 * (this predates the trigger/condition mechanism by years), so there's no
 * legacy-vs-native branch here the way triggerNodeData.ts/
 * conditionNodeData.ts have.
 *
 * Also unlike triggers/conditions, this catalog is intentionally NOT
 * exhaustive against home-assistant.io/actions/ — that page covers every
 * single integration's bespoke services (Mastodon, Ecobee, LIFX effects,
 * hundreds of them), not just the ~25 core domains a generic automation
 * targets. Scope matches what `lib/triggerRecipes.ts`/
 * `lib/conditionRecipes.ts` already cover as entity-actionable domains
 * (skips binary_sensor/sensor and their device-class variants entirely —
 * those are read-only, nothing to "do" to them).
 *
 * `data` fields (brightness, temperature, ...) are deliberately NOT part of
 * a recipe — `ActionFields.tsx` already renders those dynamically per
 * service via `useHass().getServiceDefinition()` (a live call against HA's
 * own service registry) once the node exists, the same way a trigger
 * recipe leaves `to`/`from` for the property panel and a condition recipe
 * leaves `options` for it. A recipe here only ever commits `service` +
 * `target`.
 */

export interface ActionRecipe {
  id: string;
  label: string;
  /** Real HA doc wording where available — same convention as TriggerRecipe/ConditionRecipe.description. */
  description?: string;
  /** Always `domain.service_name` — e.g. `light.turn_on`. */
  service: string;
}

export interface EntityActionCategory {
  groupKey: string;
  /** Real HA entity domain to filter/select candidate entities by in the picker's third column. */
  domain: string;
  heading: string;
  label: string;
  recipes: ActionRecipe[];
}

function buildCategories(): EntityActionCategory[] {
  const categories: EntityActionCategory[] = [];

  const push = (domain: string, heading: string, recipes: ActionRecipe[]) => {
    categories.push({ groupKey: domain, domain, heading, label: heading, recipes });
  };

  push('light', 'Light', [
    { id: 'light_turn_on', label: 'Turn on a light', description: "Turn a light on. Optionally set brightness, color, color temperature, an effect, or a transition.", service: 'light.turn_on' },
    { id: 'light_turn_off', label: 'Turn off a light', description: 'Turn a light off. Optionally fade it out with a transition, or have it flash briefly before it goes dark.', service: 'light.turn_off' },
    { id: 'light_toggle', label: 'Toggle a light', description: "Flip a light between on and off. If it's off, it turns on. If it's on, it turns off.", service: 'light.toggle' },
  ]);

  push('switch', 'Switch', [
    { id: 'switch_turn_on', label: 'Turn on switch', description: 'Turns a switch on.', service: 'switch.turn_on' },
    { id: 'switch_turn_off', label: 'Turn off switch', description: 'Turns a switch off.', service: 'switch.turn_off' },
    { id: 'switch_toggle', label: 'Toggle switch', description: 'Toggles a switch on or off.', service: 'switch.toggle' },
  ]);

  push('fan', 'Fan', [
    { id: 'fan_turn_on', label: 'Turn on fan', description: 'Turn on a fan. Optionally set the speed or preset mode at the same time.', service: 'fan.turn_on' },
    { id: 'fan_turn_off', label: 'Turn off fan', description: 'Turn off a fan.', service: 'fan.turn_off' },
    { id: 'fan_toggle', label: 'Toggle fan', description: 'Toggle a fan on or off.', service: 'fan.toggle' },
    { id: 'fan_increase_speed', label: 'Increase fan speed', description: 'Increase the speed of a fan.', service: 'fan.increase_speed' },
    { id: 'fan_decrease_speed', label: 'Decrease fan speed', description: 'Decrease the speed of a fan.', service: 'fan.decrease_speed' },
    { id: 'fan_oscillate', label: 'Oscillate fan', description: 'Control the oscillation of a fan.', service: 'fan.oscillate' },
    { id: 'fan_set_direction', label: 'Set fan direction', description: "Set a fan's rotation direction.", service: 'fan.set_direction' },
    { id: 'fan_set_preset_mode', label: 'Set fan preset mode', description: 'Set the preset mode of a fan.', service: 'fan.set_preset_mode' },
  ]);

  push('cover', 'Cover', [
    { id: 'cover_open', label: 'Open cover', description: 'Opens a cover.', service: 'cover.open_cover' },
    { id: 'cover_close', label: 'Close cover', description: 'Closes a cover.', service: 'cover.close_cover' },
    { id: 'cover_stop', label: 'Stop cover', description: 'Stops the movement of a cover.', service: 'cover.stop_cover' },
    { id: 'cover_toggle', label: 'Toggle cover', description: 'Toggles a cover open or closed.', service: 'cover.toggle' },
    { id: 'cover_set_position', label: 'Set cover position', description: 'Moves a cover to a specific position.', service: 'cover.set_cover_position' },
    { id: 'cover_open_tilt', label: 'Open cover tilt', description: 'Tilts a cover open.', service: 'cover.open_cover_tilt' },
    { id: 'cover_close_tilt', label: 'Close cover tilt', description: 'Tilts a cover closed.', service: 'cover.close_cover_tilt' },
    { id: 'cover_stop_tilt', label: 'Stop cover tilt', description: 'Stops the tilting of a cover.', service: 'cover.stop_cover_tilt' },
    { id: 'cover_set_tilt_position', label: 'Set cover tilt position', description: 'Tilts a cover to a specific position.', service: 'cover.set_cover_tilt_position' },
  ]);

  push('lock', 'Lock', [
    { id: 'lock_lock', label: 'Lock lock', description: 'Locks one or more locks.', service: 'lock.lock' },
    { id: 'lock_unlock', label: 'Unlock lock', description: 'Unlocks one or more locks.', service: 'lock.unlock' },
    { id: 'lock_open', label: 'Open lock', description: 'Unlatches one or more locks that support opening.', service: 'lock.open' },
  ]);

  push('climate', 'Climate', [
    { id: 'climate_turn_on', label: 'Turn on thermostat', description: 'Turns on a climate device.', service: 'climate.turn_on' },
    { id: 'climate_turn_off', label: 'Turn off thermostat', description: 'Turns off a climate device.', service: 'climate.turn_off' },
    { id: 'climate_toggle', label: 'Toggle thermostat', description: 'Toggles a climate device on or off.', service: 'climate.toggle' },
    { id: 'climate_set_temperature', label: 'Set thermostat target temperature', description: 'Sets the target temperature of a climate device.', service: 'climate.set_temperature' },
    { id: 'climate_set_hvac_mode', label: 'Set thermostat HVAC mode', description: 'Sets the HVAC mode of a climate device.', service: 'climate.set_hvac_mode' },
    { id: 'climate_set_preset_mode', label: 'Set thermostat preset mode', description: 'Sets the preset mode of a climate device.', service: 'climate.set_preset_mode' },
    { id: 'climate_set_fan_mode', label: 'Set thermostat fan mode', description: 'Sets the fan mode of a climate device.', service: 'climate.set_fan_mode' },
    { id: 'climate_set_swing_mode', label: 'Set thermostat swing mode', description: 'Sets the swing mode of a climate device.', service: 'climate.set_swing_mode' },
    { id: 'climate_set_humidity', label: 'Set thermostat target humidity', description: 'Sets the target humidity of a climate device.', service: 'climate.set_humidity' },
  ]);

  push('media_player', 'Media player', [
    { id: 'mp_turn_on', label: 'Turn on media player', description: 'Turns on a media player.', service: 'media_player.turn_on' },
    { id: 'mp_turn_off', label: 'Turn off media player', description: 'Turns off a media player.', service: 'media_player.turn_off' },
    { id: 'mp_toggle', label: 'Toggle media player', description: 'Toggles a media player on or off.', service: 'media_player.toggle' },
    { id: 'mp_play', label: 'Play media', description: 'Starts playback on a media player.', service: 'media_player.media_play' },
    { id: 'mp_pause', label: 'Pause media', description: 'Pauses playback on a media player.', service: 'media_player.media_pause' },
    { id: 'mp_play_pause', label: 'Play/Pause media', description: 'Toggles play and pause on a media player.', service: 'media_player.media_play_pause' },
    { id: 'mp_stop', label: 'Stop media', description: 'Stops playback on a media player.', service: 'media_player.media_stop' },
    { id: 'mp_next_track', label: 'Next track', description: 'Selects the next track on a media player.', service: 'media_player.media_next_track' },
    { id: 'mp_previous_track', label: 'Previous track', description: 'Selects the previous track on a media player.', service: 'media_player.media_previous_track' },
    { id: 'mp_volume_up', label: 'Volume up', description: 'Turns up the volume of a media player.', service: 'media_player.volume_up' },
    { id: 'mp_volume_down', label: 'Volume down', description: 'Turns down the volume of a media player.', service: 'media_player.volume_down' },
    { id: 'mp_volume_set', label: 'Set volume', description: 'Sets the volume level of a media player.', service: 'media_player.volume_set' },
    { id: 'mp_volume_mute', label: 'Mute/unmute volume', description: 'Mutes or unmutes a media player.', service: 'media_player.volume_mute' },
    { id: 'mp_select_source', label: 'Select source', description: 'Selects the input source of a media player.', service: 'media_player.select_source' },
    { id: 'mp_play_media', label: 'Play media', description: 'Plays media on a media player, such as a URL, playlist, or channel.', service: 'media_player.play_media' },
    { id: 'mp_join', label: 'Join media players', description: 'Groups media players together for synchronous playback.', service: 'media_player.join' },
  ]);

  push('vacuum', 'Vacuum', [
    { id: 'vacuum_start', label: 'Start vacuum', description: 'Starts or resumes the cleaning task.', service: 'vacuum.start' },
    { id: 'vacuum_pause', label: 'Pause vacuum', description: "Pauses the vacuum's current task.", service: 'vacuum.pause' },
    { id: 'vacuum_stop', label: 'Stop vacuum', description: "Stops the vacuum's current task.", service: 'vacuum.stop' },
    { id: 'vacuum_return_to_base', label: 'Return vacuum to dock', description: 'Sends the vacuum back to its dock.', service: 'vacuum.return_to_base' },
    { id: 'vacuum_locate', label: 'Locate vacuum', description: 'Makes the vacuum play a sound so it can be located.', service: 'vacuum.locate' },
    { id: 'vacuum_clean_spot', label: 'Vacuum clean spot', description: 'Tells the vacuum to clean a small area around its current location.', service: 'vacuum.clean_spot' },
    { id: 'vacuum_set_fan_speed', label: 'Set vacuum fan speed', description: "Sets the vacuum's fan/suction speed.", service: 'vacuum.set_fan_speed' },
  ]);

  push('humidifier', 'Humidifier', [
    { id: 'humidifier_turn_on', label: 'Turn on humidifier', description: 'Turns on a humidifier.', service: 'humidifier.turn_on' },
    { id: 'humidifier_turn_off', label: 'Turn off humidifier', description: 'Turns off a humidifier.', service: 'humidifier.turn_off' },
    { id: 'humidifier_toggle', label: 'Toggle humidifier', description: 'Toggles a humidifier on or off.', service: 'humidifier.toggle' },
    { id: 'humidifier_set_humidity', label: 'Set humidifier target humidity', description: 'Sets the target humidity of a humidifier.', service: 'humidifier.set_humidity' },
    { id: 'humidifier_set_mode', label: 'Set humidifier mode', description: 'Sets the mode of a humidifier.', service: 'humidifier.set_mode' },
  ]);

  push('valve', 'Valve', [
    { id: 'valve_open', label: 'Open valve', description: 'Opens a valve.', service: 'valve.open_valve' },
    { id: 'valve_close', label: 'Close valve', description: 'Closes a valve.', service: 'valve.close_valve' },
    { id: 'valve_stop', label: 'Stop valve', description: 'Stops the movement of a valve.', service: 'valve.stop_valve' },
    { id: 'valve_toggle', label: 'Toggle valve', description: 'Toggles a valve open or closed.', service: 'valve.toggle' },
    { id: 'valve_set_position', label: 'Set valve position', description: 'Moves a valve to a specific position.', service: 'valve.set_valve_position' },
  ]);

  push('siren', 'Siren', [
    { id: 'siren_turn_on', label: 'Turn on siren', description: 'Turns on a siren.', service: 'siren.turn_on' },
    { id: 'siren_turn_off', label: 'Turn off siren', description: 'Turns off a siren.', service: 'siren.turn_off' },
    { id: 'siren_toggle', label: 'Toggle siren', description: 'Toggles a siren on or off.', service: 'siren.toggle' },
  ]);

  push('alarm_control_panel', 'Alarm panel', [
    { id: 'alarm_arm_away', label: 'Arm alarm away', description: 'Arm an alarm control panel in away mode. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_arm_away' },
    { id: 'alarm_arm_home', label: 'Arm alarm home', description: 'Arm an alarm control panel in home mode. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_arm_home' },
    { id: 'alarm_arm_night', label: 'Arm alarm night', description: 'Arm an alarm control panel in night mode. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_arm_night' },
    { id: 'alarm_arm_vacation', label: 'Arm alarm vacation', description: 'Arm an alarm control panel in vacation mode. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_arm_vacation' },
    { id: 'alarm_arm_custom_bypass', label: 'Arm alarm with custom bypass', description: 'Arm an alarm control panel while bypassing specific zones. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_arm_custom_bypass' },
    { id: 'alarm_disarm', label: 'Disarm alarm', description: 'Disarm an alarm control panel. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_disarm' },
    { id: 'alarm_trigger', label: 'Trigger alarm', description: 'Manually trigger an alarm control panel. Optionally provide a code if your alarm panel requires one.', service: 'alarm_control_panel.alarm_trigger' },
  ]);

  push('remote', 'Remote', [
    { id: 'remote_turn_on', label: 'Turn on remote', description: 'Turns on a remote.', service: 'remote.turn_on' },
    { id: 'remote_turn_off', label: 'Turn off remote', description: 'Turns off a remote.', service: 'remote.turn_off' },
    { id: 'remote_toggle', label: 'Toggle remote', description: 'Toggles a remote on or off.', service: 'remote.toggle' },
    { id: 'remote_send_command', label: 'Send remote command', description: 'Sends a command to a remote.', service: 'remote.send_command' },
    { id: 'remote_learn_command', label: 'Learn remote command', description: 'Teaches a remote a new command.', service: 'remote.learn_command' },
  ]);

  push('select', 'Dropdown', [
    { id: 'select_select_option', label: 'Select dropdown option', description: 'Selects an option of a dropdown.', service: 'select.select_option' },
    { id: 'select_select_next', label: 'Select next option', description: 'Selects the next option of a dropdown.', service: 'select.select_next' },
    { id: 'select_select_previous', label: 'Select previous option', description: 'Selects the previous option of a dropdown.', service: 'select.select_previous' },
    { id: 'select_select_first', label: 'Select first option', description: 'Selects the first option of a dropdown.', service: 'select.select_first' },
    { id: 'select_select_last', label: 'Select last option', description: 'Selects the last option of a dropdown.', service: 'select.select_last' },
  ]);

  push('text', 'Text', [
    { id: 'text_set_value', label: 'Set text value', description: 'Sets the value of a text entity.', service: 'text.set_value' },
  ]);

  push('water_heater', 'Water heater', [
    { id: 'water_heater_turn_on', label: 'Turn on water heater', description: 'Turns on a water heater.', service: 'water_heater.turn_on' },
    { id: 'water_heater_turn_off', label: 'Turn off water heater', description: 'Turns off a water heater.', service: 'water_heater.turn_off' },
    { id: 'water_heater_toggle', label: 'Toggle water heater', description: 'Toggles a water heater on or off.', service: 'water_heater.toggle' },
    { id: 'water_heater_set_temperature', label: 'Set water heater temperature', description: 'Sets the target temperature of a water heater.', service: 'water_heater.set_temperature' },
    { id: 'water_heater_set_operation_mode', label: 'Set water heater operation mode', description: 'Sets the operation mode of a water heater.', service: 'water_heater.set_operation_mode' },
  ]);

  push('counter', 'Counter', [
    { id: 'counter_increment', label: 'Increment counter', description: 'Increases a counter by its step size.', service: 'counter.increment' },
    { id: 'counter_decrement', label: 'Decrement counter', description: 'Decreases a counter by its step size.', service: 'counter.decrement' },
    { id: 'counter_reset', label: 'Reset counter', description: 'Resets a counter to its initial value.', service: 'counter.reset' },
    { id: 'counter_set_value', label: 'Set counter value', description: 'Sets a counter to a specific value.', service: 'counter.set_value' },
  ]);

  push('todo', 'To-do list', [
    { id: 'todo_add_item', label: 'Add to-do item', description: 'Adds a new item to a to-do list.', service: 'todo.add_item' },
    { id: 'todo_update_item', label: 'Update to-do item', description: 'Updates an existing item on a to-do list.', service: 'todo.update_item' },
    { id: 'todo_remove_item', label: 'Remove to-do item', description: 'Removes an item from a to-do list.', service: 'todo.remove_item' },
    { id: 'todo_remove_completed_items', label: 'Remove completed to-do items', description: 'Removes all completed items from a to-do list.', service: 'todo.remove_completed_items' },
  ]);

  push('lawn_mower', 'Lawn mower', [
    { id: 'lawn_mower_start_mowing', label: 'Start lawn mower', description: "Starts or resumes a lawn mower's mowing task.", service: 'lawn_mower.start_mowing' },
    { id: 'lawn_mower_pause', label: 'Pause lawn mower', description: "Pauses a lawn mower's current task.", service: 'lawn_mower.pause' },
    { id: 'lawn_mower_dock', label: 'Return lawn mower to dock', description: 'Returns a lawn mower to its dock.', service: 'lawn_mower.dock' },
  ]);

  push('timer', 'Timer', [
    { id: 'timer_start', label: 'Start timer', description: 'Starts a timer.', service: 'timer.start' },
    { id: 'timer_pause', label: 'Pause timer', description: 'Pauses a timer.', service: 'timer.pause' },
    { id: 'timer_cancel', label: 'Cancel timer', description: 'Cancels a timer.', service: 'timer.cancel' },
    { id: 'timer_finish', label: 'Finish timer', description: 'Finishes a timer early.', service: 'timer.finish' },
  ]);

  push('scene', 'Scene', [
    { id: 'scene_turn_on', label: 'Activate scene', description: 'Activates a scene.', service: 'scene.turn_on' },
  ]);

  push('button', 'Button', [
    { id: 'button_press', label: 'Press button', description: 'Presses a button entity.', service: 'button.press' },
  ]);

  push('camera', 'Camera', [
    { id: 'camera_turn_on', label: 'Turn on camera', description: 'Turns on a camera.', service: 'camera.turn_on' },
    { id: 'camera_turn_off', label: 'Turn off camera', description: 'Turns off a camera.', service: 'camera.turn_off' },
    { id: 'camera_snapshot', label: 'Take camera snapshot', description: 'Takes a snapshot from a camera.', service: 'camera.snapshot' },
    { id: 'camera_record', label: 'Record camera feed', description: 'Creates a recording of a live camera feed.', service: 'camera.record' },
    { id: 'camera_enable_motion_detection', label: 'Enable camera motion detection', description: 'Enables the motion detection of a camera.', service: 'camera.enable_motion_detection' },
    { id: 'camera_disable_motion_detection', label: 'Disable camera motion detection', description: 'Disables the motion detection of a camera.', service: 'camera.disable_motion_detection' },
  ]);

  push('calendar', 'Calendar', [
    { id: 'calendar_create_event', label: 'Create calendar event', description: 'Adds a new event to a calendar.', service: 'calendar.create_event' },
  ]);

  push('ai_task', 'AI task', [
    { id: 'ai_task_generate_data', label: 'Generate data', description: 'Uses AI to run a task that generates data, such as text or structured output.', service: 'ai_task.generate_data' },
    { id: 'ai_task_generate_image', label: 'Generate image', description: 'Uses AI to generate an image from a set of instructions.', service: 'ai_task.generate_image' },
  ]);

  push('assist_satellite', 'Assist satellite', [
    { id: 'assist_satellite_announce', label: 'Announce on satellite', description: 'Announces a message on an Assist satellite.', service: 'assist_satellite.announce' },
    { id: 'assist_satellite_ask_question', label: 'Ask question on satellite', description: 'Asks a question on an Assist satellite and gets the response.', service: 'assist_satellite.ask_question' },
    { id: 'assist_satellite_start_conversation', label: 'Start conversation on satellite', description: 'Starts a conversation from an Assist satellite.', service: 'assist_satellite.start_conversation' },
  ]);

  push('conversation', 'Conversation', [
    { id: 'conversation_process', label: 'Process conversation', description: 'Sends text to a conversation agent for processing.', service: 'conversation.process' },
    { id: 'conversation_reload', label: 'Reload conversation agents', description: 'Reloads the intent configuration of conversation agents.', service: 'conversation.reload' },
  ]);

  push('date', 'Date', [
    { id: 'date_set_value', label: 'Set date value', description: 'Sets the value of a date entity.', service: 'date.set_value' },
  ]);

  push('datetime', 'Date/time', [
    { id: 'datetime_set_value', label: 'Set date/time value', description: 'Sets the value of a date/time entity.', service: 'datetime.set_value' },
  ]);

  // device_tracker has no domain-specific actions of its own (it's a
  // presence-only, read/trigger domain — see home-assistant.io/integrations/
  // device_tracker/) — included here so device tracker entities are still
  // reachable from the Action miller, via the one generic action every
  // domain supports: requesting a fresh update from the entity's platform.
  push('device_tracker', 'Device tracker', [
    { id: 'device_tracker_update_entity', label: 'Update device tracker', description: 'Requests an immediate update from a device tracker, rather than waiting for its next scheduled update.', service: 'homeassistant.update_entity' },
  ]);

  push('group', 'Group', [
    { id: 'group_set', label: 'Set group', description: 'Creates or updates an old-style group.', service: 'group.set' },
    { id: 'group_remove', label: 'Remove group', description: 'Removes an old-style group.', service: 'group.remove' },
    { id: 'group_reload', label: 'Reload groups', description: 'Reloads the groups from the YAML configuration.', service: 'group.reload' },
  ]);

  // The domains below were audited in after finding that any device/area/
  // label scope whose only actionable entities lived in one of these
  // domains showed up completely empty in the Action miller — Trigger and
  // Condition never hit this because both of those dialogs fall back to a
  // generic "State" row for any single entity, but Then has no such
  // fallback (see this file's doc comment), so an unmapped domain here
  // isn't just missing a *better* option, it's missing *every* option.
  // `update` entities in particular are extremely common (virtually every
  // ESPHome/Zigbee2MQTT device exposes one for firmware updates), so a
  // device whose other entities were all read-only sensors would show zero
  // actions at all despite genuinely having one.

  push('update', 'Update', [
    { id: 'update_install', label: 'Install update', description: 'Installs an update for a device or service.', service: 'update.install' },
    { id: 'update_skip', label: 'Skip update', description: 'Skips an available update.', service: 'update.skip' },
    { id: 'update_clear_skipped', label: 'Clear skipped update', description: 'Removes the skipped marking from an update.', service: 'update.clear_skipped' },
  ]);

  push('number', 'Number', [
    { id: 'number_set_value', label: 'Set number value', description: 'Sets the value of a number entity.', service: 'number.set_value' },
  ]);

  push('input_boolean', 'Toggle helper', [
    { id: 'input_boolean_turn_on', label: 'Turn on toggle helper', description: 'Turns on an input_boolean helper.', service: 'input_boolean.turn_on' },
    { id: 'input_boolean_turn_off', label: 'Turn off toggle helper', description: 'Turns off an input_boolean helper.', service: 'input_boolean.turn_off' },
    { id: 'input_boolean_toggle', label: 'Toggle helper', description: 'Toggles an input_boolean helper on or off.', service: 'input_boolean.toggle' },
  ]);

  push('input_button', 'Button helper', [
    { id: 'input_button_press', label: 'Press button helper', description: 'Presses an input_button helper.', service: 'input_button.press' },
  ]);

  push('input_number', 'Number helper', [
    { id: 'input_number_set_value', label: 'Set number helper value', description: 'Sets the value of an input_number helper.', service: 'input_number.set_value' },
    { id: 'input_number_increment', label: 'Increment number helper', description: 'Increments the value of an input_number helper by its step size.', service: 'input_number.increment' },
    { id: 'input_number_decrement', label: 'Decrement number helper', description: 'Decrements the value of an input_number helper by its step size.', service: 'input_number.decrement' },
  ]);

  push('input_select', 'Dropdown helper', [
    { id: 'input_select_select_option', label: 'Select dropdown helper option', description: 'Selects an option of an input_select helper.', service: 'input_select.select_option' },
    { id: 'input_select_select_next', label: 'Select next dropdown helper option', description: 'Selects the next option of an input_select helper.', service: 'input_select.select_next' },
    { id: 'input_select_select_previous', label: 'Select previous dropdown helper option', description: 'Selects the previous option of an input_select helper.', service: 'input_select.select_previous' },
    { id: 'input_select_select_first', label: 'Select first dropdown helper option', description: 'Selects the first option of an input_select helper.', service: 'input_select.select_first' },
    { id: 'input_select_select_last', label: 'Select last dropdown helper option', description: 'Selects the last option of an input_select helper.', service: 'input_select.select_last' },
  ]);

  push('input_text', 'Text helper', [
    { id: 'input_text_set_value', label: 'Set text helper value', description: 'Sets the value of an input_text helper.', service: 'input_text.set_value' },
  ]);

  push('input_datetime', 'Date/time helper', [
    { id: 'input_datetime_set_datetime', label: 'Set date/time helper value', description: 'Sets the date and/or time of an input_datetime helper.', service: 'input_datetime.set_datetime' },
  ]);

  // notify — real HA's own "Add action" dialog special-cases this one
  // service-only domain into its regular "By type" entity-domain list
  // (`ENTITY_DOMAINS_MAIN` in home-assistant/frontend's data/action.ts)
  // rather than the "Integration" catch-all, even though it has no entity
  // domain of its own the way light/switch/etc. do — see
  // ThenActionDialog.tsx's dynamically-generated Integration list, which
  // deliberately excludes 'notify' to match.
  push('notify', 'Notify', [
    { id: 'notify_send_message', label: 'Send a notification', description: 'Sends a notification through a configured notify service (mobile app, email, chat platform, ...).', service: 'notify.send_message' },
  ]);

  return categories;
}

export const ENTITY_ACTION_CATEGORIES: EntityActionCategory[] = buildCategories();

const CATEGORIES_BY_DOMAIN = new Map<string, EntityActionCategory>(
  ENTITY_ACTION_CATEGORIES.map((c) => [c.domain, c])
);

/**
 * Resolve the action category for a single entity, keyed by domain only —
 * no device_class complexity here (unlike getEntityConditionRecipeGroup):
 * actions are purely domain-scoped service calls, no purpose-specific
 * device-class-prefixed form exists for them (see this file's doc comment).
 */
export function getEntityActionCategory(entityId: string): EntityActionCategory | null {
  const domain = entityId.split('.')[0];
  return CATEGORIES_BY_DOMAIN.get(domain) ?? null;
}
