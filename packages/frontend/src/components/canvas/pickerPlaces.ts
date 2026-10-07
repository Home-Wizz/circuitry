import { Home, Layers, Tag } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { NavRow, NavSection, TargetPickerRow } from '@/components/canvas/PickerColumns';
import {
  allEntityIds,
  buildDeviceScope,
  buildUnassignedGroups,
  HELPER_DOMAINS,
  type DeviceGroup,
  type EntityScope,
  getEntityName,
  groupByDevice,
  type SelectedScope,
  type UnassignedGroups,
} from '@/components/panels/node-fields/TriggerTargetPicker';
import {
  type AreaRegistryEntry,
  type FloorRegistryEntry,
  type LabelRegistryEntry,
  useHass,
} from '@/contexts/HassContext';
import { useIntegrationManifests } from '@/hooks/useIntegrationManifests';
import { useStableEntityList } from '@/hooks/useStableEntityList';
import { getDomainColor } from '@/lib/domain-colors';
import { entityPickerIcon, getPickerIcon, type PickerIcon } from '@/components/nodes/StepIcon';
import type { HassEntity } from '@/types/hass';

/**
 * The places the When, And and Then pickers browse by -- areas (under their
 * floors), devices, labels and the unassigned entities -- and the rows and
 * columns for them, which are the same in all three pickers.
 */

export interface AreaGroup extends EntityScope {
  area: AreaRegistryEntry;
  /** Its config and diagnostic entities (SelectedScope.secondaryEntityIds). */
  secondaryEntityIds: string[];
}
export interface LabelGroup extends EntityScope {
  label: LabelRegistryEntry;
  secondaryEntityIds: string[];
}
export interface FloorGroup {
  /** null: the areas on no floor ("Other areas", as HA calls them). */
  floor: FloorRegistryEntry | null;
  areas: AreaGroup[];
}

export interface PickerPlaces {
  /** The automation-relevant entities (no config/diagnostic or hidden ones). */
  entities: HassEntity[];
  areaGroups: AreaGroup[];
  floorGroups: FloorGroup[];
  labelGroups: LabelGroup[];
  /** Every device, alphabetically. */
  allDeviceGroups: DeviceGroup[];
  unassignedGroups: UnassignedGroups;
}

/** The columns these rows open; every picker's own column type has them. */
export type PlaceColumn =
  | { kind: 'areaChildren'; areaLabel: string; scope: EntityScope }
  | { kind: 'deviceChildren'; group: DeviceGroup }
  | { kind: 'targetResults'; scope: SelectedScope };

export type PushPlaceColumn = (atIndex: number, column: PlaceColumn, key: string) => void;

/** The translated labels the place rows use. */
export interface PlaceLabels {
  home: string;
  otherAreas: string;
  unassignedOption: (key: 'entities' | 'helpers' | 'devices' | 'services') => string;
}

/** Entities as a tick list's rows, by name. */
export function entityTargetRows(entities: HassEntity[]): TargetPickerRow[] {
  return entities
    .slice()
    .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
    .map((entity) => ({
      entityId: entity.entity_id,
      label: getEntityName(entity),
      icon: entityPickerIcon(entity),
      color: getDomainColor(entityDomain(entity)),
    }));
}

/** A device's icon and color: its first entity's. */
export function deviceGroupIcon(group: DeviceGroup): PickerIcon {
  return entityPickerIcon(group.entities[0]);
}
export function deviceGroupColor(group: DeviceGroup) {
  return getDomainColor(group.entities[0]?.entity_id.split('.')[0]);
}
const entityDomain = (entity: HassEntity) => entity.entity_id.split('.')[0];

/** The places, from the entities the picker was given. */
export function usePickerPlaces(allEntities: HassEntity[]): PickerPlaces {
  const {
    areas,
    floors,
    getAreaIdForEntity,
    getDeviceIdForEntity,
    getDeviceNameById,
    isAutomationRelevantEntity,
    labels,
    getLabelIdsForEntity,
    isSecondaryEntity,
    getDeviceInfo,
  } = useHass();
  // Which integrations are helpers, as HA classes them (`manifest/list`);
  // until they've come, or without HA, the helper domains HA ships.
  const { manifests, fetchManifests } = useIntegrationManifests();
  useEffect(() => {
    void fetchManifests();
  }, [fetchManifests]);
  // Stabilized first (see useStableEntityList): the grouping below doesn't
  // recompute on every entity-state tick.
  const stable = useStableEntityList(allEntities);
  const entities = useMemo(
    () => stable.filter((e) => isAutomationRelevantEntity(e.entity_id)),
    [stable, isAutomationRelevantEntity]
  );
  // The config and diagnostic ones, kept apart: only the types HA lets
  // reach them list them (a room's battery, #177).
  const secondary = useMemo(
    () => (isSecondaryEntity ? stable.filter((e) => isSecondaryEntity(e.entity_id)) : []),
    [stable, isSecondaryEntity]
  );

  const areaGroups = useMemo(
    () =>
      areas
        .map((area) => ({
          area,
          ...withSecondary(
            groupByDevice(
              entities.filter((e) => getAreaIdForEntity(e.entity_id) === area.area_id),
              getDeviceIdForEntity,
              getDeviceNameById
            ),
            secondary,
            getDeviceIdForEntity
          ),
          secondaryEntityIds: secondaryIds(
            secondary,
            (id) => getAreaIdForEntity(id) === area.area_id
          ),
        }))
        .filter(
          (g) =>
            g.deviceGroups.length > 0 ||
            g.standaloneEntities.length > 0 ||
            g.secondaryEntityIds.length > 0
        ),
    [areas, entities, secondary, getAreaIdForEntity, getDeviceIdForEntity, getDeviceNameById]
  );

  const floorGroups = useMemo((): FloorGroup[] => {
    const known = floors ?? [];
    const onFloor = (floorId: string | null) =>
      areaGroups.filter((g) =>
        floorId === null
          ? !g.area.floor_id || !known.some((f) => f.floor_id === g.area.floor_id)
          : g.area.floor_id === floorId
      );
    return [
      ...known.map((floor) => ({ floor, areas: onFloor(floor.floor_id) })),
      { floor: null, areas: onFloor(null) },
    ].filter((g) => g.areas.length > 0);
  }, [floors, areaGroups]);

  const labelGroups = useMemo(
    () =>
      labels
        .map((label) => {
          const has = (id: string) => getLabelIdsForEntity(id).includes(label.label_id);
          return {
            label,
            ...withSecondary(
              groupByDevice(
                entities.filter((e) => has(e.entity_id)),
                getDeviceIdForEntity,
                getDeviceNameById
              ),
              secondary,
              getDeviceIdForEntity
            ),
            secondaryEntityIds: secondaryIds(secondary, has),
          };
        })
        .filter(
          (g) =>
            g.deviceGroups.length > 0 ||
            g.standaloneEntities.length > 0 ||
            g.secondaryEntityIds.length > 0
        ),
    [labels, entities, secondary, getLabelIdsForEntity, getDeviceIdForEntity, getDeviceNameById]
  );

  const byDevice = useMemo(
    () =>
      withSecondary(
        groupByDevice(entities, getDeviceIdForEntity, getDeviceNameById),
        secondary,
        getDeviceIdForEntity
      ),
    [entities, secondary, getDeviceIdForEntity, getDeviceNameById]
  );

  const unassignedGroups = useMemo(() => {
    // A device is unassigned when it has no area of its own (and isn't
    // disabled), as HA's target tree has it; without the registry, when no
    // area lists it.
    const inAreas = new Set(areaGroups.flatMap((g) => g.deviceGroups.map((d) => d.deviceId)));
    const ungroupedDevices = byDevice.deviceGroups.filter((g) => {
      const info = getDeviceInfo?.(g.deviceId);
      return info ? !info.isDisabled && !info.areaId : !inAreas.has(g.deviceId);
    });
    const unassignedStandalone = byDevice.standaloneEntities.filter(
      (e) => !getAreaIdForEntity(e.entity_id)
    );
    const known = manifests && Object.keys(manifests).length > 0 ? manifests : null;
    const isHelper = (e: HassEntity) => {
      const domain = entityDomain(e) ?? '';
      return known ? known[domain]?.integration_type === 'helper' : HELPER_DOMAINS.has(domain);
    };
    const isService = (deviceId: string) => getDeviceInfo?.(deviceId)?.isService ?? false;
    return buildUnassignedGroups(ungroupedDevices, unassignedStandalone, isHelper, isService);
  }, [areaGroups, byDevice, getAreaIdForEntity, getDeviceInfo, manifests]);

  return {
    entities,
    areaGroups,
    floorGroups,
    labelGroups,
    allDeviceGroups: byDevice.deviceGroups,
    unassignedGroups,
  };
}

/** The ids of the config and diagnostic entities that pass `keep`. */
function secondaryIds(secondary: readonly HassEntity[], keep: (entityId: string) => boolean) {
  return secondary.map((e) => e.entity_id).filter(keep);
}

/** A scope's devices with their config and diagnostic entities. */
function withSecondary(
  scope: EntityScope,
  secondary: readonly HassEntity[],
  deviceOf: (entityId: string) => string | null
): EntityScope {
  return {
    ...scope,
    deviceGroups: scope.deviceGroups.map((group) => {
      const ids = secondaryIds(secondary, (id) => deviceOf(id) === group.deviceId);
      return ids.length > 0 ? { ...group, secondaryEntityIds: ids } : group;
    }),
  };
}

/** A room's (or label's) types, every entity in it at once. */
function roomScope(
  key: string,
  label: string,
  scope: EntityScope & { secondaryEntityIds: string[] },
  areaId?: string
): SelectedScope {
  return {
    key,
    label,
    deviceIds: scope.deviceGroups.map((g) => g.deviceId),
    entityIds: allEntityIds(scope),
    ...(scope.secondaryEntityIds.length > 0
      ? { secondaryEntityIds: scope.secondaryEntityIds }
      : {}),
    room: { label, areaId },
  };
}

/** An area's row: opens its types, grouped by category. */
export function areaRow(group: AreaGroup, atIndex: number, push: PushPlaceColumn): NavRow {
  const { area } = group;
  const open = () =>
    push(
      atIndex,
      {
        kind: 'targetResults',
        scope: roomScope(`area::${area.area_id}`, area.name, group, area.area_id),
      },
      area.area_id
    );
  return {
    key: area.area_id,
    label: area.name,
    icon: getPickerIcon('homeassistant', Home),
    color: getDomainColor('zones'),
    onSelect: open,
    onDrill: open,
  };
}

/** A label's row, like an area's. */
export function labelRow(group: LabelGroup, atIndex: number, push: PushPlaceColumn): NavRow {
  const { label } = group;
  const open = () =>
    push(
      atIndex,
      { kind: 'targetResults', scope: roomScope(`label::${label.label_id}`, label.name, group) },
      label.label_id
    );
  return {
    key: label.label_id,
    label: label.name,
    icon: getPickerIcon('tag', Tag),
    color: getDomainColor('labels'),
    onSelect: open,
    onDrill: open,
  };
}

/** Home's sections: the areas, under their floors' names (when there are
 * floors), the first section headed "Home". */
export function homeSections(
  places: PickerPlaces,
  atIndex: number,
  push: PushPlaceColumn,
  labels: PlaceLabels
): NavSection[] {
  const hasFloors = places.floorGroups.some((g) => g.floor !== null);
  return places.floorGroups.map((group, i) => ({
    ...(i === 0 ? { title: labels.home } : {}),
    ...(hasFloors ? { subtitle: group.floor?.name ?? labels.otherAreas } : {}),
    rows: group.areas.map((g) => areaRow(g, atIndex, push)),
  }));
}

/** A device's row: its triggers/conditions/actions; the chevron, its entities. */
export function deviceRow(group: DeviceGroup, atIndex: number, push: PushPlaceColumn): NavRow {
  return {
    key: group.deviceId,
    label: group.name,
    icon: deviceGroupIcon(group),
    color: deviceGroupColor(group),
    onSelect: () =>
      push(
        atIndex,
        { kind: 'targetResults', scope: buildDeviceScope(group.deviceId, group) },
        group.deviceId
      ),
    onDrill: () => push(atIndex, { kind: 'deviceChildren', group }, group.deviceId),
  };
}

/** An entity's row: what it can do. */
export function entityRow(
  entity: HassEntity,
  deviceId: string | null,
  atIndex: number,
  push: PushPlaceColumn
): NavRow {
  return {
    key: entity.entity_id,
    label: getEntityName(entity),
    icon: entityPickerIcon(entity),
    color: getDomainColor(entityDomain(entity)),
    onSelect: () =>
      push(
        atIndex,
        {
          kind: 'targetResults',
          scope: {
            key: `entity::${entity.entity_id}`,
            label: getEntityName(entity),
            deviceIds: deviceId ? [deviceId] : [],
            entityIds: [entity.entity_id],
            singleEntityId: entity.entity_id,
          },
        },
        entity.entity_id
      ),
  };
}

/** The Devices column: every device in an area, under its area's name. */
export function devicesSections(
  places: PickerPlaces,
  atIndex: number,
  push: PushPlaceColumn
): NavSection[] {
  return places.areaGroups
    .filter((g) => g.deviceGroups.length > 0)
    .map((g) => ({
      subtitle: g.area.name,
      rows: g.deviceGroups.map((d) => deviceRow(d, atIndex, push)),
    }));
}

/** A place's column (Unassigned's lists): its devices and entities. */
export function placeRows(
  column: Extract<PlaceColumn, { kind: 'areaChildren' }>,
  atIndex: number,
  push: PushPlaceColumn
): NavRow[] {
  return [
    ...column.scope.deviceGroups.map((g) => deviceRow(g, atIndex, push)),
    ...column.scope.standaloneEntities.map((e) => entityRow(e, null, atIndex, push)),
  ];
}

/**
 * A type picked from a room's or a device's types: its entities ticked in a
 * list when there are several, or when the room itself can be the target
 * (the list's first line, "Anything in <room>"); one entity is picked at once.
 */
export function routeScopePick(
  scope: SelectedScope,
  entityIds: string[],
  takesArea: boolean,
  handlers: {
    pick: (entityIds: string[]) => void;
    tick: (entityIds: string[], areaId?: string) => void;
  }
): void {
  const areaId = takesArea ? scope.room?.areaId : undefined;
  if (entityIds.length > 1 || areaId) handlers.tick(entityIds, areaId);
  else handlers.pick(entityIds);
}

/** A device's entities. */
export function deviceEntityRows(
  group: DeviceGroup,
  atIndex: number,
  push: PushPlaceColumn
): NavRow[] {
  return group.entities.map((e) => entityRow(e, group.deviceId, atIndex, push));
}

/** Unassigned's four rows: its entities, helpers, devices and services. */
export function unassignedRows(
  places: PickerPlaces,
  atIndex: number,
  push: PushPlaceColumn,
  labels: PlaceLabels
): NavRow[] {
  return (['entities', 'helpers', 'devices', 'services'] as const).map((key) => ({
    key,
    label: labels.unassignedOption(key),
    icon: getPickerIcon(key, Layers),
    color: getDomainColor(key),
    onDrill: () =>
      push(
        atIndex,
        {
          kind: 'areaChildren',
          areaLabel: labels.unassignedOption(key),
          scope: places.unassignedGroups[key],
        },
        key
      ),
  }));
}

/** Search's places: the areas, devices and entities whose names match. */
export function searchPlaceSections(
  places: PickerPlaces,
  query: string,
  atIndex: number,
  push: PushPlaceColumn,
  titles: { areas: string; devices: string; entities: string }
): NavSection[] {
  const q = query.toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  // Subtitles, not titles: search's sections don't fold.
  return [
    {
      subtitle: titles.areas,
      rows: places.areaGroups
        .filter((g) => matches(g.area.name))
        .map((g) => areaRow(g, atIndex, push)),
    },
    {
      subtitle: titles.devices,
      rows: places.allDeviceGroups
        .filter((g) => matches(g.name))
        .slice(0, 50)
        .map((g) => deviceRow(g, atIndex, push)),
    },
    {
      subtitle: titles.entities,
      rows: places.entities
        .filter((e) => matches(getEntityName(e)) || matches(e.entity_id))
        .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
        .slice(0, 100)
        .map((e) => entityRow(e, null, atIndex, push)),
    },
  ];
}
