import { useHass } from '@/contexts/HassContext';
import { entityName, nameFromEntityId } from '@/lib/entityNames';

export interface EntityTargetDisplay {
  /** The device's name when a device resolved; the entity's name otherwise. */
  label: string;
  /** Domain of the resolved entity (e.g. `light`) — used to pick a card icon via lib/domain-icons.ts. */
  domain: string | undefined;
  /** The entity's `device_class` attribute (e.g. `door`, `motion`) when set — lets card display logic pick device-class-aware phrasing (see useTriggerCardDisplay.ts's 'state' case). */
  deviceClass: string | undefined;
  /** The entity's area (its own, or its device's), for the card's context line. */
  area?: string;
}

/**
 * Shared by the trigger, condition and action cards so the label's
 * resolution order (device name > entity friendly name > raw entity_id)
 * lives in one place. The label is the name alone: every step is in the
 * same home, and the room is shown on the card.
 */
export function useNodeCardDisplay() {
  const { entities, getDeviceNameForEntity, getDeviceNameById, getAreaNameForEntity } = useHass();

  const resolveEntityTarget = (entityId: string | undefined): EntityTargetDisplay | null => {
    if (!entityId) return null;
    const domain = entityId.includes('.') ? entityId.split('.')[0] : undefined;
    const entity = entities.find((e) => e.entity_id === entityId);
    const deviceClass = entity?.attributes.device_class as string | undefined;

    const area = getAreaNameForEntity(entityId) || undefined;
    const deviceName = getDeviceNameForEntity(entityId);
    if (deviceName) {
      return { label: deviceName, domain, deviceClass, area };
    }

    // Not the area's name: on a card the label names the entity ("Turn on
    // [Hallway light]"), and an area name there reads as the whole area.
    // The area is the card's context line instead.
    return { label: entityName(entity, entityId), domain, deviceClass, area };
  };

  /** For device triggers/conditions, which carry a `device_id` but not always an `entity_id`. */
  const resolveDeviceTarget = (
    deviceId: string | undefined,
    domain: string | undefined
  ): EntityTargetDisplay | null => {
    if (!deviceId) return null;
    const deviceName = getDeviceNameById(deviceId);
    if (!deviceName) return null;
    return { label: deviceName, domain, deviceClass: undefined };
  };

  /** Several entities by name ("Hall light, Kitchen light"), never their ids. */
  const entityNames = (entityIds: readonly string[]): string =>
    entityIds.map((id) => resolveEntityTarget(id)?.label ?? nameFromEntityId(id)).join(', ');

  return { resolveEntityTarget, resolveDeviceTarget, entityNames };
}
