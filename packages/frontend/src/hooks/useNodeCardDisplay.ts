import { useHass } from '@/contexts/HassContext';

export interface EntityTargetDisplay {
  /** "{device or area name} - {home name}" when a device resolved; area/entity name alone otherwise. */
  label: string;
  /** Domain of the resolved entity (e.g. `light`) — used to pick a card icon via lib/domain-icons.ts. */
  domain: string | undefined;
  /** The entity's `device_class` attribute (e.g. `door`, `motion`) when set — lets card display logic pick device-class-aware phrasing (see useTriggerCardDisplay.ts's 'state' case). */
  deviceClass: string | undefined;
}

/**
 * Shared by TriggerNode.tsx and ActionNode.tsx to build
 * device-name-plus-home-name card titles — "{device name} - {home name}"
 * rather than a raw entity_id — so the resolution order (device name >
 * area name > entity friendly name > raw entity_id) and the "home name"
 * (HA's own instance name, the `location_name` shown throughout HA's own
 * UI) only live in one place.
 */
export function useNodeCardDisplay() {
  const { hass, entities, getDeviceNameForEntity, getDeviceNameById, getAreaNameForEntity } = useHass();
  const homeName = hass?.config?.location_name;

  const withHomeSuffix = (name: string) => (homeName ? `${name} - ${homeName}` : name);

  const resolveEntityTarget = (entityId: string | undefined): EntityTargetDisplay | null => {
    if (!entityId) return null;
    const domain = entityId.includes('.') ? entityId.split('.')[0] : undefined;
    const entity = entities.find((e) => e.entity_id === entityId);
    const deviceClass = entity?.attributes.device_class as string | undefined;

    const deviceName = getDeviceNameForEntity(entityId);
    if (deviceName) {
      return { label: withHomeSuffix(deviceName), domain, deviceClass };
    }

    const areaName = getAreaNameForEntity(entityId);
    if (areaName) {
      return { label: areaName, domain, deviceClass };
    }

    const friendlyName = entity?.attributes.friendly_name as string | undefined;
    return { label: friendlyName || entityId, domain, deviceClass };
  };

  /** For device triggers/conditions, which carry a `device_id` but not always an `entity_id`. */
  const resolveDeviceTarget = (
    deviceId: string | undefined,
    domain: string | undefined
  ): EntityTargetDisplay | null => {
    if (!deviceId) return null;
    const deviceName = getDeviceNameById(deviceId);
    if (!deviceName) return null;
    return { label: withHomeSuffix(deviceName), domain, deviceClass: undefined };
  };

  return { resolveEntityTarget, resolveDeviceTarget, homeName };
}
