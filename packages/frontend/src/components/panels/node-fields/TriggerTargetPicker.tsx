import type { TriggerPlatform } from '@circuitry/shared';
import { ChevronRight, Clock, Search, Sun, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { useHass } from '@/contexts/HassContext';
import { useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import { useStableEntityList } from '@/hooks/useStableEntityList';
import { useTranslations } from '@/hooks/useTranslations';
import { getDomainColor } from '@/lib/domain-colors';
import { getDomainIcon } from '@/lib/domain-icons';
import { buildCompositeValue, getTriggerLabel } from '@/lib/deviceTriggerLabels';
import { getEntityRecipeGroup, type TriggerRecipe } from '@/lib/triggerRecipes';
import { cn } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';
import { TriggerResultRow } from './TriggerResultRow';

/**
 * The "By target" tab of the trigger picker (see TriggerTypePicker.tsx),
 * built to mirror Home Assistant's own Add Trigger dialog: a Home > Area >
 * Device > Entity tree (plus Time & Sun and Unassigned), with a results
 * panel below driven by the real `device_automation/trigger/list` API (the
 * same one DeviceTriggerFields already uses for the plain "Device" trigger
 * platform) — so the trigger choices shown are genuinely what the selected
 * target supports, not a hand-maintained guess.
 *
 * Every branch is directly selectable, not just leaf entities: clicking an
 * area or a device aggregates results across everything under it (matching
 * HA's own dialog, where selecting "Master Bedroom" shows every trigger any
 * device in that room supports, grouped by domain), while clicking a single
 * entity narrows results down to just that entity.
 *
 * Laid out as a vertical stack (tree above, results below) rather than
 * side-by-side columns — Circuitry's properties panel is a few hundred
 * pixels wide at most, nowhere near HA's full-width dialog, so a two-column
 * split would leave each side too cramped to read.
 */

/**
 * Exported alongside the picker for reuse by WhenTriggerDialog.tsx (the
 * Miller-column "+Add > When" modal) — that component builds its own
 * column-based navigation over the same area/device/entity data, but shares
 * this grouping logic and the results panel below rather than
 * reimplementing either.
 */
export function getEntityName(entity: HassEntity): string {
  return (entity.attributes.friendly_name as string) || entity.entity_id;
}

export interface DeviceGroup {
  deviceId: string;
  name: string;
  entities: HassEntity[];
}

export interface EntityScope {
  deviceGroups: DeviceGroup[];
  standaloneEntities: HassEntity[];
}

export function groupByDevice(
  entitiesInScope: HassEntity[],
  getDeviceIdForEntity: (entityId: string) => string | null,
  getDeviceNameById: (deviceId: string) => string | null
): EntityScope {
  const deviceMap = new Map<string, DeviceGroup>();
  const standaloneEntities: HassEntity[] = [];

  for (const entity of entitiesInScope) {
    const deviceId = getDeviceIdForEntity(entity.entity_id);
    if (!deviceId) {
      standaloneEntities.push(entity);
      continue;
    }
    const existing = deviceMap.get(deviceId);
    if (existing) {
      existing.entities.push(entity);
    } else {
      deviceMap.set(deviceId, {
        deviceId,
        name: getDeviceNameById(deviceId) ?? deviceId,
        entities: [entity],
      });
    }
  }

  const deviceGroups = Array.from(deviceMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  standaloneEntities.sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)));
  return { deviceGroups, standaloneEntities };
}

/**
 * What's currently selected in the tree, in terms the results panel needs:
 * which device(s) to fetch triggers for, and which entity_ids the results
 * should be narrowed down to. `singleEntityId` is only set when the
 * selection is exactly one entity — that's what unlocks the generic
 * "Entity > State" fallback row, which doesn't make sense for an
 * area/device-wide selection spanning multiple entities.
 */
export interface SelectedScope {
  key: string;
  label: string;
  deviceIds: string[];
  entityIds: string[];
  singleEntityId?: string;
}

export function allEntityIds(scope: EntityScope): string[] {
  return [
    ...scope.deviceGroups.flatMap((g) => g.entities.map((e) => e.entity_id)),
    ...scope.standaloneEntities.map((e) => e.entity_id),
  ];
}

/**
 * Builds a device selection's SelectedScope — but when the device reduces to
 * exactly one (already automation-relevant-filtered) entity, flattens it
 * into that entity's own scope (`singleEntityId` set) instead of a
 * device-wide one. Matches real HA's own "By target" dialog, which shows a
 * single-entity device as that entity directly rather than a device node you
 * drill into, and — since TargetResultsPanel only shows entity-less
 * device_automation events (raw button presses, "device offline", ...) for
 * non-single-entity scopes — keeps those irrelevant-to-this-one-entity rows
 * out of the results. Exported so WhenTriggerDialog.tsx's Miller-column
 * modal builds device scopes the same way rather than re-deriving this.
 */
export function buildDeviceScope(key: string, group: DeviceGroup): SelectedScope {
  const singleEntityId = group.entities.length === 1 ? group.entities[0]?.entity_id : undefined;
  return {
    key: `device::${key}`,
    label: group.name,
    deviceIds: [group.deviceId],
    entityIds: group.entities.map((e) => e.entity_id),
    singleEntityId,
  };
}

/**
 * HA's dedicated "helper" entity domains (Settings > Devices & services >
 * Helpers) — used by buildUnassignedGroups below to split "Unassigned" into
 * its own Entities/Helpers/Devices/Services subcategories, matching real
 * HA's own Settings > Entities filter chips. Not exhaustive of every
 * helper-*like* entity (utility_meter/derivative/min_max/threshold/... are
 * helpers too, but they surface as sensor/binary_sensor/etc. entities with
 * no dedicated domain of their own to filter on) — just the domains that
 * exist *only* as helpers, the same "helper" set HA's own frontend uses for
 * its Helpers page (home-assistant/frontend's HELPERS_CRUD domain list).
 */
export const HELPER_DOMAINS = new Set([
  'input_boolean',
  'input_button',
  'input_datetime',
  'input_number',
  'input_select',
  'input_text',
  'counter',
  'timer',
  'schedule',
]);

export interface UnassignedGroups {
  entities: EntityScope;
  helpers: EntityScope;
  devices: EntityScope;
  services: EntityScope;
}

/**
 * Splits the old flat "Unassigned" list (area-less devices + area-less
 * standalone entities) into the four subcategories real HA's own Settings >
 * Entities page groups things into — Entities, Helpers, Devices, Service —
 * per direct user request. Exported so WhenTriggerDialog.tsx/
 * AndConditionDialog.tsx/ThenActionDialog.tsx all build this split the same
 * way instead of each re-deriving it.
 *
 * - `devices` is `ungroupedDevices` unchanged (devices with no area).
 * - `helpers` is pulled from *every* automation-relevant entity, not just
 *   the already area-less ones — helpers are inherently area-less as a
 *   concept in real HA (there's no "assign a room" option for them), so
 *   scoping this to unassignedStandaloneEntities would miss any helper a
 *   user *did* assign an area to (HA still lets you set one, it just isn't
 *   meaningful the way it is for a physical device).
 * - `entities` is what's left of unassignedStandaloneEntities once helper
 *   domains are pulled out.
 * - `services` is the exact old combined list, kept byte-for-byte — per
 *   explicit user direction that this subcategory should just be a
 *   relabeled copy of the previous single-list "Unassigned" behavior, not a
 *   new derivation.
 */
export function buildUnassignedGroups(
  allEntities: HassEntity[],
  ungroupedDevices: DeviceGroup[],
  unassignedStandaloneEntities: HassEntity[]
): UnassignedGroups {
  const helperEntities = allEntities
    .filter((e) => HELPER_DOMAINS.has(e.entity_id.split('.')[0]))
    .slice()
    .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)));
  const pureEntities = unassignedStandaloneEntities.filter(
    (e) => !HELPER_DOMAINS.has(e.entity_id.split('.')[0])
  );

  return {
    entities: { deviceGroups: [], standaloneEntities: pureEntities },
    helpers: { deviceGroups: [], standaloneEntities: helperEntities },
    devices: { deviceGroups: ungroupedDevices, standaloneEntities: [] },
    services: { deviceGroups: ungroupedDevices, standaloneEntities: unassignedStandaloneEntities },
  };
}

interface TriggerTargetPickerProps {
  entities: HassEntity[];
  onSelectPlatform: (platform: TriggerPlatform) => void;
  onSelectEntityTarget: (entityId: string) => void;
  onSelectDeviceTrigger: (trigger: DeviceTrigger) => void;
  onSelectRecipe: (entityIds: string[], recipe: TriggerRecipe) => void;
}

export function TriggerTargetPicker({
  entities: allEntities,
  onSelectPlatform,
  onSelectEntityTarget,
  onSelectDeviceTrigger,
  onSelectRecipe,
}: TriggerTargetPickerProps) {
  const { t } = useTranslation(['nodes']);
  const { areas, getAreaIdForEntity, getDeviceIdForEntity, getDeviceNameById, isAutomationRelevantEntity } =
    useHass();
  // Keeps `config`/`diagnostic`-category and hidden entities (auto-generated
  // "Identify" buttons, signal strength sensors, firmware update entities,
  // ...) out of the tree/results entirely — matching HA's own automation
  // editor, which excludes them from trigger suggestions for the same
  // reason: they're real entities but not meaningful automation targets, and
  // showing them just produces confusing noise under an otherwise-relevant
  // device (see docs/trigger-picker-rebuild.md's card-redesign log entry).
  // Stabilized via useStableEntityList — see its own doc comment — so the
  // area/device tree/grouping below doesn't recompute on every live
  // entity-state tick (was causing multi-second freezes while browsing,
  // confirmed from a user screen recording of the sibling Miller dialogs).
  const stableAllEntities = useStableEntityList(allEntities);
  const entities = useMemo(
    () => stableAllEntities.filter((e) => isAutomationRelevantEntity(e.entity_id)),
    [stableAllEntities, isAutomationRelevantEntity]
  );
  const [search, setSearch] = useState('');
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedScope | null>(null);

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ): void => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const areaGroups = useMemo(() => {
    return areas
      .map((area) => {
        const areaEntities = entities.filter((e) => getAreaIdForEntity(e.entity_id) === area.area_id);
        const scope = groupByDevice(areaEntities, getDeviceIdForEntity, getDeviceNameById);
        return { area, ...scope };
      })
      .filter((g) => g.deviceGroups.length > 0 || g.standaloneEntities.length > 0);
  }, [areas, entities, getAreaIdForEntity, getDeviceIdForEntity, getDeviceNameById]);

  const unassignedScope = useMemo(() => {
    const unassignedEntities = entities.filter((e) => !getAreaIdForEntity(e.entity_id));
    return groupByDevice(unassignedEntities, getDeviceIdForEntity, getDeviceNameById);
  }, [entities, getAreaIdForEntity, getDeviceIdForEntity, getDeviceNameById]);

  const normalizedSearch = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedSearch) return null;
    return entities
      .filter(
        (e) =>
          getEntityName(e).toLowerCase().includes(normalizedSearch) ||
          e.entity_id.toLowerCase().includes(normalizedSearch)
      )
      .slice(0, 100)
      .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)));
  }, [entities, normalizedSearch]);

  // Selecting an area or device (clicking its label, as opposed to just its
  // chevron) always expands it too, so the same click both populates the
  // results panel and reveals what's underneath for further drilling —
  // matching HA's own dialog.
  const selectArea = (areaId: string, label: string, scope: EntityScope) => {
    setExpandedAreas((prev) => new Set(prev).add(areaId));
    setSelected({
      key: `area::${areaId}`,
      label,
      deviceIds: scope.deviceGroups.map((g) => g.deviceId),
      entityIds: allEntityIds(scope),
    });
  };

  const selectDevice = (deviceKey: string, group: DeviceGroup) => {
    setExpandedDevices((prev) => new Set(prev).add(deviceKey));
    setSelected(buildDeviceScope(deviceKey, group));
  };

  const selectEntity = (entity: HassEntity) => {
    const deviceId = getDeviceIdForEntity(entity.entity_id);
    setSelected({
      key: `entity::${entity.entity_id}`,
      label: getEntityName(entity),
      deviceIds: deviceId ? [deviceId] : [],
      entityIds: [entity.entity_id],
      singleEntityId: entity.entity_id,
    });
  };

  const renderDeviceGroup = (group: DeviceGroup, key: string) => {
    const isExpanded = expandedDevices.has(key);
    const isSelected = selected?.key === `device::${key}`;
    return (
      <div key={key}>
        <div
          className={cn(
            'flex w-full items-center gap-1 rounded text-sm',
            isSelected && 'bg-muted text-foreground'
          )}
        >
          <button
            type="button"
            onClick={() => toggleSet(setExpandedDevices, key)}
            className="shrink-0 rounded p-1 hover:bg-muted"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
            />
          </button>
          <TruncatedTooltip content={group.name}>
            <button
              type="button"
              onClick={() => selectDevice(key, group)}
              className="min-w-0 flex-1 truncate py-1 text-left"
            >
              {group.name}
            </button>
          </TruncatedTooltip>
        </div>
        {isExpanded && (
          <div className="ml-5 space-y-0.5">
            {group.entities.map((entity) => (
              <button
                key={entity.entity_id}
                type="button"
                onClick={() => selectEntity(entity)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted',
                  selected?.key === `entity::${entity.entity_id}` && 'bg-muted text-foreground'
                )}
              >
                <TruncatedTooltip content={getEntityName(entity)}>
                  <span className="truncate">{getEntityName(entity)}</span>
                </TruncatedTooltip>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderStandaloneEntity = (entity: HassEntity) => (
    <button
      key={entity.entity_id}
      type="button"
      onClick={() => selectEntity(entity)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted',
        selected?.key === `entity::${entity.entity_id}` && 'bg-muted text-foreground'
      )}
    >
      <TruncatedTooltip content={getEntityName(entity)}>
        <span className="ml-5 truncate">{getEntityName(entity)}</span>
      </TruncatedTooltip>
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('nodes:triggers.picker.searchTargetPlaceholder')}
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="max-h-[220px] overflow-y-auto rounded-md border p-1.5">
        {searchResults ? (
          searchResults.length === 0 ? (
            <p className="p-2 text-center text-muted-foreground text-xs">
              {t('nodes:triggers.picker.noResults')}
            </p>
          ) : (
            <div className="space-y-0.5">{searchResults.map(renderStandaloneEntity)}</div>
          )
        ) : (
          <div className="space-y-2">
            <div>
              <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">
                {t('nodes:triggers.picker.groups.homeAssistant')}
              </h4>
              {areaGroups.map(({ area, deviceGroups, standaloneEntities }) => {
                const isExpanded = expandedAreas.has(area.area_id);
                const isSelected = selected?.key === `area::${area.area_id}`;
                return (
                  <div key={area.area_id}>
                    <div
                      className={cn(
                        'flex w-full items-center gap-1 rounded text-sm',
                        isSelected && 'bg-muted text-foreground'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSet(setExpandedAreas, area.area_id)}
                        className="shrink-0 rounded p-1 hover:bg-muted"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 text-muted-foreground transition-transform',
                            isExpanded && 'rotate-90'
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          selectArea(area.area_id, area.name, { deviceGroups, standaloneEntities })
                        }
                        className="min-w-0 flex-1 truncate py-1 text-left font-medium"
                      >
                        <TruncatedTooltip content={area.name}>
                          <span className="block truncate">{area.name}</span>
                        </TruncatedTooltip>
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="ml-5 space-y-0.5">
                        {deviceGroups.map((group) =>
                          renderDeviceGroup(group, `${area.area_id}::${group.deviceId}`)
                        )}
                        {standaloneEntities.map(renderStandaloneEntity)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">
                {t('nodes:triggers.picker.groups.timeAndSun')}
              </h4>
              <button
                type="button"
                onClick={() => onSelectPlatform('time')}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
              >
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {t('nodes:triggers.platforms.time')}
              </button>
              <button
                type="button"
                onClick={() => onSelectPlatform('sun')}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
              >
                <Sun className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {t('nodes:triggers.platforms.sun')}
              </button>
            </div>

            {(unassignedScope.deviceGroups.length > 0 ||
              unassignedScope.standaloneEntities.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={() =>
                    setSelected({
                      key: 'unassigned',
                      label: t('nodes:triggers.picker.unassigned'),
                      deviceIds: unassignedScope.deviceGroups.map((g) => g.deviceId),
                      entityIds: allEntityIds(unassignedScope),
                    })
                  }
                  className={cn(
                    'w-full rounded px-1.5 py-1 text-left font-semibold text-muted-foreground text-xs hover:bg-muted',
                    selected?.key === 'unassigned' && 'bg-muted text-foreground'
                  )}
                >
                  {t('nodes:triggers.picker.unassigned')}
                </button>
                {unassignedScope.deviceGroups.map((group) =>
                  renderDeviceGroup(group, `unassigned::${group.deviceId}`)
                )}
                {unassignedScope.standaloneEntities.map(renderStandaloneEntity)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-h-[160px] max-h-[280px] overflow-y-auto rounded-md border p-1.5">
        <TargetResultsPanel
          selected={selected}
          entities={entities}
          onSelectEntityTarget={onSelectEntityTarget}
          onSelectDeviceTrigger={onSelectDeviceTrigger}
          onSelectRecipe={onSelectRecipe}
        />
      </div>
    </div>
  );
}

/**
 * One row in the merged results list — either a recipe (client-side,
 * synthesized from entity domain/device_class, see lib/triggerRecipes.ts) or
 * a device_automation-API-driven row. Normalized to a common shape so both
 * can be rendered under the same domain heading, sorted together.
 * `domain` drives the per-row icon (lib/domain-icons.ts) — resolved
 * per-row rather than per-heading, since a heading like a device's own
 * results can in principle mix domains.
 */
interface ResultRow {
  key: string;
  label: string;
  description?: string;
  chip: string | null;
  domain: string | undefined;
  onSelect: () => void;
}

/**
 * Exported so WhenTriggerDialog.tsx's Miller-column modal can use it as its
 * terminal ("results") column too — identical row/grouping logic to what's
 * shown inline here, just reused verbatim rather than re-derived.
 */
export function TargetResultsPanel({
  selected,
  entities,
  onSelectEntityTarget,
  onSelectDeviceTrigger,
  onSelectRecipe,
}: {
  selected: SelectedScope | null;
  entities: HassEntity[];
  onSelectEntityTarget: (entityId: string) => void;
  onSelectDeviceTrigger: (trigger: DeviceTrigger) => void;
  onSelectRecipe: (entityIds: string[], recipe: TriggerRecipe) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const { getDeviceTriggers } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { getDeviceNameById } = useHass();
  const [deviceTriggers, setDeviceTriggers] = useState<DeviceTrigger[]>([]);
  const [loading, setLoading] = useState(false);

  const domainHeadingLabel = (domain: string): string =>
    t(`nodes:serviceDomains.${domain}`, {
      defaultValue: domain.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    });

  useEffect(() => {
    if (!selected || selected.deviceIds.length === 0) {
      setDeviceTriggers([]);
      return;
    }
    let cancelled = false;
    setDeviceTriggers([]);
    setLoading(true);
    // allSettled, not all: getDeviceTriggers rejects when a device's own
    // integration doesn't implement device_automation/trigger/list at all
    // (common — plenty of integrations only register entities, no device
    // automations), which is routine, not exceptional. Promise.all would
    // let that one rejection wipe out every *other* device's triggers too —
    // for an area/room spanning several devices, one unsupported device was
    // enough to make the whole area show "No results found" even though its
    // other devices had real triggers. Each device's own failure is silently
    // skipped instead, same as HA's own automation editor does.
    Promise.allSettled(selected.deviceIds.map((id) => getDeviceTriggers(id)))
      .then((results) => {
        if (cancelled) return;
        const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        // Entity-tagged triggers are kept when they belong to one of the
        // entities in scope. Raw device-level events with no entity_id at
        // all (a physical button press, ZHA's "device offline", ...) are
        // only shown for genuine whole-device/area selections — once the
        // scope narrows down to one specific entity (singleEntityId set,
        // see the device->entity flattening below), those entity-less
        // events are the exact noise HA's own "By target" dialog doesn't
        // show for a single entity either (verified against a real HA
        // screenshot: picking one light entity there lists only that
        // light's own triggers, no unrelated device-wide events).
        const entityIds = new Set(selected.entityIds);
        const scoped = all.filter((tr) =>
          tr.entity_id ? entityIds.has(tr.entity_id) : !selected.singleEntityId
        );
        setDeviceTriggers(scoped);
      })
      .catch(() => {
        if (!cancelled) setDeviceTriggers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, getDeviceTriggers]);

  if (!selected) {
    return (
      <div className="flex h-full min-h-[140px] items-center justify-center text-center text-muted-foreground text-sm">
        {t('nodes:triggers.picker.selectTarget')}
      </div>
    );
  }

  const singleEntity = selected.singleEntityId
    ? entities.find((e) => e.entity_id === selected.singleEntityId)
    : undefined;
  const singleEntityLabel = singleEntity ? getEntityName(singleEntity) : selected.singleEntityId;
  const SingleEntityFallbackIcon = getDomainIcon(selected.singleEntityId?.split('.')[0], Zap);

  // Recipe rows: synthesized client-side from each selected entity's
  // domain/device_class (see lib/triggerRecipes.ts) — this is what actually
  // produces HA-authentic groups like "Battery"/"Motion"/"Illuminance" (each
  // their own heading) or "Cover" (sub-classes sharing one heading), with
  // device_class-aware wording ("Blind opened" vs plain "Cover opened").
  // Entities that share the same recipe group (e.g. two blinds) collapse
  // into one multi-entity trigger per recipe rather than duplicate rows.
  // Grouped by the already-resolved `heading` text (not a raw domain key),
  // since that's now device_class-specific for binary_sensor/sensor.
  const recipesByHeading = new Map<
    string,
    Map<string, { recipes: TriggerRecipe[]; entityIds: string[] }>
  >();
  for (const entityId of selected.entityIds) {
    const entity = entities.find((e) => e.entity_id === entityId);
    const group = getEntityRecipeGroup(entityId, entity);
    if (!group) continue;
    let byGroupKey = recipesByHeading.get(group.heading);
    if (!byGroupKey) {
      byGroupKey = new Map();
      recipesByHeading.set(group.heading, byGroupKey);
    }
    const existing = byGroupKey.get(group.groupKey);
    if (existing) {
      existing.entityIds.push(entityId);
    } else {
      byGroupKey.set(group.groupKey, { recipes: group.recipes, entityIds: [entityId] });
    }
  }

  // Device-automation rows: the genuinely device-specific triggers fetched
  // from HA's `device_automation/trigger/list` API (button presses,
  // integration-level connectivity events like ZHA's "device offline", ...).
  // Kept per-device (never merged/deduped across devices — HA's device
  // trigger schema is fundamentally per single device_id) and labeled with
  // the specific device's name so that e.g. two ZHA devices both offering a
  // "device offline" trigger are visually distinguishable.
  const deviceGroupsByHeading = new Map<string, DeviceTrigger[]>();
  for (const trigger of deviceTriggers) {
    const heading = domainHeadingLabel(trigger.domain);
    const list = deviceGroupsByHeading.get(heading);
    if (list) list.push(trigger);
    else deviceGroupsByHeading.set(heading, [trigger]);
  }

  const allHeadings = new Set<string>([...recipesByHeading.keys(), ...deviceGroupsByHeading.keys()]);
  const sortedHeadings = Array.from(allHeadings).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      {loading && (
        <p className="px-1.5 text-muted-foreground text-xs">
          {t('nodes:triggers.picker.loadingTriggers')}
        </p>
      )}

      {!loading && sortedHeadings.length === 0 && !selected.singleEntityId && (
        <p className="px-1.5 text-muted-foreground text-xs">{t('nodes:triggers.picker.noResults')}</p>
      )}

      {sortedHeadings.map((heading) => {
        const recipeGroups = Array.from(recipesByHeading.get(heading)?.values() ?? []);
        const rows: ResultRow[] = [];

        for (const { recipes, entityIds } of recipeGroups) {
          // All entities in a recipe group share the same recipe (that's
          // what put them in the same group), so any one of them's domain
          // is representative for the icon.
          const domain = entityIds[0]?.split('.')[0];
          for (const recipe of recipes) {
            rows.push({
              key: `recipe::${recipe.id}::${entityIds.join(',')}`,
              label: recipe.label,
              description: recipe.description,
              chip: selected.label,
              domain,
              onSelect: () => onSelectRecipe(entityIds, recipe),
            });
          }
        }

        for (const trigger of deviceGroupsByHeading.get(heading) ?? []) {
          rows.push({
            key: `device::${buildCompositeValue(trigger)}`,
            label: getTriggerLabel(
              trigger,
              translations,
              entities,
              getDeviceNameById(trigger.device_id)
            ),
            chip: getDeviceNameById(trigger.device_id),
            domain: trigger.entity_id?.split('.')[0] ?? trigger.domain,
            onSelect: () => onSelectDeviceTrigger(trigger),
          });
        }

        return (
          <div key={heading}>
            <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">{heading}</h4>
            <div className="space-y-1.5">
              {rows.map((row) => (
                <TriggerResultRow
                  key={row.key}
                  icon={getDomainIcon(row.domain, Zap)}
                  color={getDomainColor(row.domain)}
                  label={row.label}
                  description={row.description}
                  chip={row.chip}
                  onSelect={row.onSelect}
                />
              ))}
            </div>
          </div>
        );
      })}

      {selected.singleEntityId && (
        <div>
          <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">
            {t('nodes:triggers.picker.groups.entity')}
          </h4>
          <TriggerResultRow
            icon={SingleEntityFallbackIcon}
            color={getDomainColor(selected.singleEntityId?.split('.')[0])}
            label={t('nodes:triggers.platforms.state')}
            chip={singleEntityLabel ?? null}
            onSelect={() => onSelectEntityTarget(selected.singleEntityId as string)}
          />
        </div>
      )}
    </div>
  );
}
