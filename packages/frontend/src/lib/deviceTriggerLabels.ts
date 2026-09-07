import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import type { HassEntity } from '@/types/hass';

/**
 * The bits of a device_automation item (trigger, action, OR condition — see
 * useDeviceAutomation.ts's DeviceTrigger/DeviceAction/DeviceCondition) that
 * the label/composite-value logic below actually needs. Triggers have an
 * extra `platform` field and conditions have an extra `condition` field this
 * doesn't care about, so all three satisfy this shape.
 */
interface DeviceAutomationItem {
  domain: string;
  type: string;
  subtype?: string;
  entity_id?: string;
}

/**
 * Build the composite value used as a Select/CommandItem option value for a
 * device trigger or device action. Format: type[::subtype][::entity_id].
 *
 * Shared between DeviceTriggerFields (the plain "Device" platform's trigger
 * dropdown), the trigger "By target" picker's results panel, and the action
 * miller's device-action rows — all render the same shape of
 * `device_automation` trigger/action list API response, so they need the
 * same way to uniquely key/identify each entry.
 */
export function buildCompositeValue(item: DeviceAutomationItem): string {
  const parts = [item.type];
  if (item.subtype) parts.push(item.subtype);
  if (item.entity_id) parts.push(item.entity_id);
  return parts.join('::');
}

function resolvePlaceholders(
  template: string,
  item: DeviceAutomationItem,
  entities: HassEntity[],
  deviceName: string | null,
  subtypeLabel?: string
): string {
  let result = template;
  if (result.includes('{entity_name}')) {
    const entity = item.entity_id ? entities.find((e) => e.entity_id === item.entity_id) : undefined;
    const entityName = (entity?.attributes?.friendly_name as string) || deviceName || item.entity_id || '';
    result = result.replace(/\{entity_name\}/g, entityName);
  }
  if (result.includes('{subtype}') && subtypeLabel) {
    result = result.replace(/\{subtype\}/g, subtypeLabel);
  }
  if (result.includes('{device_name}') && deviceName) {
    result = result.replace(/\{device_name\}/g, deviceName);
  }
  return result;
}

/**
 * Resolve a device trigger or device action's human-readable label from HA's
 * own `device_automation` translation category (fetched via
 * useTranslations()), falling back to the raw `type`/`subtype` strings when
 * no translation is available (e.g. custom-integration device automations
 * that don't ship one). `category` selects which translation key family to
 * read — `trigger_type`/`trigger_subtype` vs. `action_type`/
 * `action_subtype` — matching HA's own `device_automation.<category>_type.*`
 * naming for each of trigger/condition/action.
 *
 * Some integrations' type templates embed the subtype label *inline* rather
 * than as a separate field — e.g. ZHA's remote-button triggers translate to
 * things like `"{subtype}" pressed`, where `{subtype}` is meant to be
 * replaced with the resolved subtype label ("Button 1", "On", ...).
 * Previously that placeholder was left untouched, showing literal
 * "{subtype}" text. When the template doesn't reference `{subtype}` at all,
 * fall back to appending ": <subtype label>" — but skip that when it would
 * just repeat the type label (e.g. a raw un-translated type/subtype pair
 * that happen to be the same string, which otherwise rendered as a
 * confusing "Device offline: device_offline" row).
 */
export function getDeviceAutomationLabel(
  category: 'trigger' | 'action' | 'condition',
  item: DeviceAutomationItem,
  translations: Record<string, string>,
  entities: HassEntity[],
  deviceName: string | null
): string {
  const typeTemplate =
    translations[`component.${item.domain}.device_automation.${category}_type.${item.type}`] ?? item.type;

  let subtypeLabel: string | undefined;
  if (item.subtype) {
    const subtypeKey = `component.${item.domain}.device_automation.${category}_subtype.${item.subtype}`;
    subtypeLabel = resolvePlaceholders(translations[subtypeKey] ?? item.subtype, item, entities, deviceName);
  }

  const typeLabel = resolvePlaceholders(typeTemplate, item, entities, deviceName, subtypeLabel);

  if (
    subtypeLabel &&
    !typeTemplate.includes('{subtype}') &&
    subtypeLabel.trim().toLowerCase() !== typeLabel.trim().toLowerCase()
  ) {
    return `${typeLabel}: ${subtypeLabel}`;
  }

  return typeLabel;
}

/** Thin wrapper kept for existing trigger call sites — see getDeviceAutomationLabel. */
export function getTriggerLabel(
  trigger: DeviceTrigger,
  translations: Record<string, string>,
  entities: HassEntity[],
  deviceName: string | null
): string {
  return getDeviceAutomationLabel('trigger', trigger, translations, entities, deviceName);
}
