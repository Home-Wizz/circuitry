import type { TriggerPlatform } from '@circuitry/shared';
import type { SelectorType } from '@/hooks/useDeviceAutomation';

/**
 * Configuration for a trigger field
 */
export interface FieldConfig {
  name: string;
  label: string;
  type: SelectorType;
  required: boolean;
  multiple?: boolean;
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  domain?: string;
}

/**
 * Static field configurations for non-device trigger platforms
 * Device triggers use dynamic fields from the API
 */
export const TRIGGER_PLATFORM_FIELDS: Record<TriggerPlatform, FieldConfig[]> = {
  // State trigger: fires when entity changes state
  state: [
    {
      name: 'entity_id',
      label: 'Entity',
      type: 'entity',
      required: true,
      multiple: true,
      description: 'The entity to monitor for state changes',
    },
    {
      name: 'to',
      label: 'To State',
      type: 'text',
      required: false,
      placeholder: 'e.g., on, off, home',
      description: 'The target state to trigger on',
    },
    {
      name: 'from',
      label: 'From State',
      type: 'text',
      required: false,
      placeholder: 'e.g., off',
      description: 'Only trigger when transitioning from this state',
    },
    // not_from/not_to are declared here (rather than only in
    // StateTriggerFields.tsx) purely so their names flow into
    // clearAllTriggerFields' clear-list, the same reasoning as 'at'/'weekday'
    // above for the time platform — StateTriggerFields.tsx renders its own
    // dedicated UI for these rather than going through DynamicFieldRenderer.
    {
      name: 'not_from',
      label: 'Not From State (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., off',
      description: 'Trigger unless transitioning from this state — cannot combine with From State',
    },
    {
      name: 'not_to',
      label: 'Not To State (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., on',
      description: 'Trigger unless transitioning to this state — cannot combine with To State',
    },
    {
      name: 'attribute',
      label: 'Attribute (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., current_temperature',
      description: 'Watch an attribute instead of the entity’s own state',
    },
    {
      name: 'for',
      label: 'For Duration (optional)',
      type: 'duration',
      required: false,
      placeholder: 'e.g., 00:05:00',
      description: 'State must be stable for this duration',
    },
  ],

  // Numeric state trigger: fires when entity numeric value crosses threshold
  numeric_state: [
    {
      name: 'entity_id',
      label: 'Entity',
      type: 'entity',
      required: true,
      multiple: true,
      description: 'The sensor entity to monitor',
    },
    {
      name: 'attribute',
      label: 'Attribute (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., current_temperature',
      description: 'Watch an attribute instead of the entity’s own state',
    },
    {
      name: 'above',
      label: 'Above',
      type: 'number_or_entity',
      required: false,
      placeholder: 'e.g., 20',
      description: 'Trigger when value goes above this threshold — a fixed number, or another entity’s live value',
    },
    {
      name: 'below',
      label: 'Below',
      type: 'number_or_entity',
      required: false,
      placeholder: 'e.g., 30',
      description: 'Trigger when value goes below this threshold — a fixed number, or another entity’s live value',
    },
    {
      name: 'value_template',
      label: 'Value Template (optional)',
      type: 'template',
      required: false,
      placeholder: 'e.g., {{ state.attributes.temperature }}',
      description: 'Template to extract numeric value from entity',
    },
    {
      name: 'for',
      label: 'For Duration (optional)',
      type: 'duration',
      required: false,
      placeholder: 'e.g., 00:05:00',
      description: 'Value must be stable for this duration',
    },
  ],

  // Time trigger: fires at specific time. `at` (which accepts a fixed time
  // string, an entity reference, an { entity_id, offset } mapping, or a list
  // mixing those) doesn't fit this static one-field-one-widget system —
  // TriggerFields.tsx special-cases 'time' to TimeTriggerFields.tsx instead,
  // mirroring how 'state' is special-cased to StateTriggerFields.tsx. These
  // entries stay declared (rather than removed) purely so their names keep
  // flowing into clearAllTriggerFields' "every field any platform could set"
  // clear-list and getTriggerFields('time') keeps a real label/description
  // for TimeTriggerFields.tsx to look up, the same way StateTriggerFields.tsx
  // reuses getTriggerFields('state') for its 'for'/'attribute' fields.
  time: [
    {
      name: 'at',
      label: 'At (time)',
      type: 'text',
      required: true,
      placeholder: 'e.g., 07:00:00 or input_datetime.wake_up',
      description: 'Time to trigger (HH:MM:SS or entity reference)',
    },
    {
      name: 'weekday',
      label: 'Weekday (optional)',
      type: 'select',
      required: false,
      multiple: true,
      description: 'Days of the week when the trigger is active',
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

  // Time pattern trigger: fires at regular intervals
  time_pattern: [
    {
      name: 'hours',
      label: 'Hours',
      type: 'text',
      required: false,
      placeholder: 'e.g., */2 (every 2 hours)',
      description: 'Hour pattern (cron-style)',
    },
    {
      name: 'minutes',
      label: 'Minutes',
      type: 'text',
      required: false,
      placeholder: 'e.g., /5 (every 5 minutes)',
      description: 'Minute pattern (cron-style)',
    },
    {
      name: 'seconds',
      label: 'Seconds',
      type: 'text',
      required: false,
      placeholder: 'e.g., 0',
      description: 'Second pattern (cron-style)',
    },
  ],

  // Event trigger: fires when specific event occurs
  event: [
    {
      name: 'event_type',
      label: 'Event Type',
      type: 'text',
      required: true,
      multiple: true,
      placeholder: 'e.g., zha_event, call_service',
      description: 'The type(s) of event to listen for — triggers if any match',
    },
    {
      name: 'event_data',
      label: 'Event Data (optional)',
      type: 'object',
      required: false,
      description: 'Filter events by data fields (JSON object)',
    },
    // HA's own UI exposes this as "Limit to events triggered by" — a user
    // picker writing to the YAML `context.user_id` field (confirmed via
    // home-assistant.io/triggers/event/: "In the UI, only user selection is
    // available" for the `context` option). Stored here as a flat
    // `context_user_id` field rather than the raw nested `context: {
    // user_id }` shape non-visual editors would use, matching every other
    // flattened-for-editing field in this table — the transpiler is
    // responsible for nesting it back into `context` on save.
    {
      name: 'context_user_id',
      label: 'Limit to Events Triggered By (optional)',
      type: 'user',
      required: false,
      description: 'Only trigger for events fired by this user',
    },
  ],

  // MQTT trigger: fires when MQTT message received
  mqtt: [
    {
      name: 'topic',
      label: 'Topic',
      type: 'text',
      required: true,
      placeholder: 'e.g., home/bedroom/temperature',
      description: 'MQTT topic to subscribe to',
    },
    {
      name: 'payload',
      label: 'Payload (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., ON',
      description: 'Only trigger on this specific payload',
    },
    {
      name: 'value_template',
      label: 'Value Template (optional)',
      type: 'template',
      required: false,
      placeholder: 'e.g., {{ value_json.state }}',
      description: 'Process the message before matching it against Payload',
    },
    {
      name: 'encoding',
      label: 'Encoding (optional)',
      type: 'text',
      required: false,
      placeholder: 'utf-8',
      description: "Payload decoding — defaults to 'utf-8'; use an empty value for binary payloads",
    },
  ],

  // Webhook trigger: fires when webhook is called
  webhook: [
    {
      name: 'webhook_id',
      label: 'Webhook ID',
      type: 'text',
      required: true,
      placeholder: 'e.g., my_webhook',
      description: 'Unique identifier for this webhook',
    },
    {
      name: 'allowed_methods',
      label: 'Allowed Methods (optional)',
      type: 'select',
      required: false,
      multiple: true,
      description: 'HTTP methods that may call this webhook — defaults to POST and PUT',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'HEAD', label: 'HEAD' },
      ],
    },
    {
      name: 'local_only',
      label: 'Local Only (optional)',
      type: 'boolean',
      required: false,
      description: 'Restrict this webhook to devices on the same network as Home Assistant',
    },
  ],

  // Sun trigger: fires at sunrise/sunset
  sun: [
    {
      name: 'event',
      label: 'Event',
      type: 'select',
      required: true,
      description: 'Trigger at sunrise or sunset',
      options: [
        { value: 'sunrise', label: 'Sunrise' },
        { value: 'sunset', label: 'Sunset' },
      ],
      default: 'sunset',
    },
    {
      name: 'offset',
      label: 'Offset (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., -00:30:00',
      description: 'Time offset before (-) or after (+) the event',
    },
  ],

  // Zone trigger: fires when device enters/leaves zone
  zone: [
    {
      name: 'entity_id',
      label: 'Person/Device',
      type: 'entity',
      required: true,
      multiple: true,
      description: 'The person or device tracker to monitor',
    },
    {
      name: 'zone',
      label: 'Zone',
      type: 'zone',
      required: true,
      placeholder: 'e.g., zone.home',
      description: 'The zone entity to monitor',
    },
    {
      name: 'event',
      label: 'Event',
      type: 'select',
      required: true,
      description: 'Trigger on enter or leave',
      options: [
        { value: 'enter', label: 'Enter' },
        { value: 'leave', label: 'Leave' },
      ],
      default: 'enter',
    },
  ],

  // Template trigger: fires when template evaluates to true
  template: [
    {
      name: 'value_template',
      label: 'Value Template',
      type: 'template',
      required: true,
      placeholder: 'e.g., {{ is_state("light.bedroom", "on") }}',
      description: 'Template that evaluates to true/false',
    },
    {
      name: 'for',
      label: 'For Duration (optional)',
      type: 'duration',
      required: false,
      placeholder: 'e.g., 00:05:00',
      description: 'Template must be true for this duration',
    },
  ],

  // Home Assistant trigger: fires on HA events (start/shutdown)
  homeassistant: [
    {
      name: 'event',
      label: 'Event',
      type: 'select',
      required: true,
      description: 'Home Assistant lifecycle event',
      options: [
        { value: 'start', label: 'Start' },
        { value: 'shutdown', label: 'Shutdown' },
      ],
      default: 'start',
    },
  ],

  // Device trigger: uses dynamic fields from API
  // This is handled separately with device automation API
  device: [],

  // Calendar trigger: fires relative to calendar events
  calendar: [
    {
      name: 'entity_id',
      label: 'Calendar',
      type: 'entity',
      required: true,
      domain: 'calendar',
      description: 'The calendar entity to monitor',
    },
    {
      name: 'event',
      label: 'Event',
      type: 'select',
      required: true,
      description: 'Trigger at event start or end',
      options: [
        { value: 'start', label: 'Start' },
        { value: 'end', label: 'End' },
      ],
      default: 'start',
    },
    {
      name: 'offset',
      label: 'Offset (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., -00:30:00',
      description: 'Time offset before (-) or after (+) the event',
    },
  ],

  // Tag trigger: fires when an NFC tag is scanned
  tag: [
    {
      name: 'tag_id',
      label: 'Tag ID(s)',
      type: 'text',
      required: true,
      multiple: true,
      placeholder: 'e.g., A7-6B-90-5F',
      description: 'The scanned tag ID(s) to match',
    },
    {
      name: 'device_id',
      label: 'Reader Device (optional)',
      type: 'text',
      required: false,
      multiple: true,
      placeholder: 'e.g., 0e19cd3cf2b311ea88f469a7512c307d',
      description: 'Restrict to tag(s) scanned by a specific reader device',
    },
  ],

  // Geolocation trigger: fires when an entity appears in or disappears from a zone
  geo_location: [
    {
      name: 'source',
      label: 'Source',
      type: 'text',
      required: true,
      placeholder: 'e.g., nsw_rural_fire_service_feed',
      description: 'The geo_location platform providing the entity',
    },
    {
      name: 'zone',
      label: 'Zone',
      type: 'zone',
      required: true,
      placeholder: 'e.g., zone.bushfire_alert_zone',
      description: 'The zone entity to monitor',
    },
    {
      name: 'event',
      label: 'Event',
      type: 'select',
      required: true,
      description: 'Trigger on enter or leave',
      options: [
        { value: 'enter', label: 'Enter' },
        { value: 'leave', label: 'Leave' },
      ],
      default: 'enter',
    },
  ],

  // Persistent notification trigger: fires when a persistent_notification is added/removed/updated
  persistent_notification: [
    {
      name: 'notification_id',
      label: 'Notification ID (optional)',
      type: 'text',
      required: false,
      placeholder: 'e.g., invalid_config',
      description: 'Limit to a specific notification — otherwise triggers for any notification ID',
    },
    {
      name: 'update_type',
      label: 'Update Type (optional)',
      type: 'select',
      required: false,
      multiple: true,
      description: 'Limit to these update types — otherwise triggers for all of them',
      options: [
        { value: 'added', label: 'Added' },
        { value: 'removed', label: 'Removed' },
        { value: 'updated', label: 'Updated' },
        { value: 'current', label: 'Current' },
      ],
    },
  ],

  // Conversation (sentence) trigger: fires when Assist matches a sentence
  conversation: [
    {
      name: 'command',
      label: 'Sentence(s)',
      type: 'text',
      required: true,
      multiple: true,
      placeholder: "e.g., [it's ]party time",
      description: 'Sentence template(s) to match, spoken to Assist',
    },
  ],
};

/**
 * Get field configuration for a trigger platform. Accepts plain `string`
 * (not just `TriggerPlatform`) so purpose-specific platforms like
 * `light.turned_on` (see lib/triggerRecipes.ts) can be passed through too —
 * they simply aren't in `TRIGGER_PLATFORM_FIELDS` (that table only covers
 * the legacy platforms' static fields; purpose-specific ones use the
 * target/options field UI instead, see NativeTriggerFields.tsx), so this
 * returns `[]` for them exactly like any other unrecognized value.
 */
export function getTriggerFields(platform: string): FieldConfig[] {
  return (TRIGGER_PLATFORM_FIELDS as Record<string, FieldConfig[]>)[platform] || [];
}

/**
 * Get default values for a trigger platform based on field configurations
 */
export function getTriggerDefaults(platform: string): Record<string, unknown> {
  const fields = getTriggerFields(platform);
  const defaults: Record<string, unknown> = { trigger: platform };

  for (const field of fields) {
    if (field.default !== undefined) {
      defaults[field.name] = field.default;
    }
  }

  return defaults;
}

/**
 * Check if a trigger platform uses device automation API
 */
export function usesDeviceAutomation(platform: TriggerPlatform): boolean {
  return platform === 'device';
}
