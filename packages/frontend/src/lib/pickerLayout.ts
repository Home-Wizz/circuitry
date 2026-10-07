import type { TriggerPlatform } from '@circuitry/shared';

/**
 * Where each kind of pick sits in the When, And and Then pickers' first
 * column. The order is the same in all three: Blocks (And and Then), Home
 * (the areas, under their floors), Devices, Device types, Non-device types,
 * and a "Home Assistant" section (Unassigned, Labels, Generic,
 * Integrations). Device types and the purpose of each group follow HA's own
 * "Add trigger / condition / action" dialog (HA 2026.9). Every trigger
 * platform and condition block is placed exactly once (picker-layout.test).
 */

/** Trigger platforms under Non-device types › Time (HA's Time group, which
 * also holds the calendar). */
export const TRIGGER_TIME_PLATFORMS: TriggerPlatform[] = ['time', 'time_pattern', 'calendar'];
/** Under Non-device types › Sun. */
export const TRIGGER_SUN_PLATFORMS: TriggerPlatform[] = ['sun'];
/** Under Non-device types › Events and templates. */
export const TRIGGER_EVENT_PLATFORMS: TriggerPlatform[] = [
  'template',
  'webhook',
  'tag',
  'conversation',
  'event',
  'geo_location',
  'persistent_notification',
  'homeassistant',
];
/** Under Home Assistant › Generic, beside Device. */
export const TRIGGER_GENERIC_PLATFORMS: TriggerPlatform[] = ['state', 'numeric_state'];
/** Under Home Assistant › Integrations. */
export const TRIGGER_INTEGRATION_PLATFORMS: TriggerPlatform[] = ['mqtt'];
/** Classic platforms listed with a device type's own triggers, as HA lists
 * them (the Zone trigger with the zone triggers). */
export const TRIGGER_DOMAIN_PLATFORMS: Readonly<Record<string, TriggerPlatform[]>> = {
  zone: ['zone'],
};
/** The device trigger platform: Home Assistant › Generic › Device (a device,
 * then its own triggers). */
export const TRIGGER_DEVICE_PLATFORM: TriggerPlatform = 'device';

/** Catalog domains (trigger categories' `domain`, condition categories'
 * `conditionPrefix`) under Non-device types › Time, and › Sun. */
export const TIME_CATEGORY_DOMAINS: ReadonlySet<string> = new Set(['calendar', 'schedule']);
export const SUN_CATEGORY_DOMAINS: ReadonlySet<string> = new Set(['sun']);

/** Condition blocks: And, Or and Not are the Blocks; the rest sit where HA
 * lists them. */
export const CONDITION_LOGIC_BLOCKS = ['and', 'or', 'not'] as const;
/** Under Non-device types, beside Time and Sun. */
export const CONDITION_NON_DEVICE_BLOCKS = ['template', 'trigger'] as const;
/** Under Home Assistant › Generic, beside Device. */
export const CONDITION_GENERIC_BLOCKS = ['state', 'numeric_state'] as const;
/** Classic blocks listed with a group's own conditions: the Time condition
 * under Time, the Sun condition with the sun conditions, the Zone condition
 * with the zone conditions. */
export const CONDITION_GROUPED_BLOCKS: Readonly<Record<string, string>> = {
  time: 'time',
  sun: 'sun',
  zone: 'zone',
};

/** Action blocks HA lists as a type of its own rather than a block: under
 * Non-device types. */
export const ACTION_NON_DEVICE_BLOCKS: ReadonlySet<string> = new Set(['fire_event']);

/** A category HA's descriptions brought that belongs to no entity domain
 * the catalog has (a new integration's): under Home Assistant ›
 * Integrations, as HA lists it. */
export const isIntegrationCategory = (groupKey: string): boolean =>
  groupKey.startsWith('discovered:');

/** The 1-3 rule: a group of three or fewer is listed inline under its name;
 * a bigger one is one row that opens it. */
export const INLINE_GROUP_MAX = 3;
