import type { FlowNode, TriggerPlatform } from '@circuitry/shared';
import { Home, Layers, type LucideIcon, Search, Tag } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  allEntityIds,
  buildDeviceScope,
  buildUnassignedGroups,
  type DeviceGroup,
  type EntityScope,
  getEntityName,
  groupByDevice,
  type SelectedScope,
  TargetResultsPanel,
} from '@/components/panels/node-fields/TriggerTargetPicker';
import { NativeTriggerFields } from '@/components/panels/node-fields/NativeTriggerFields';
import { TriggerResultRow } from '@/components/panels/node-fields/TriggerResultRow';
import {
  MILLER_DIALOG_CONTENT_CLASS,
  MultiTargetPanel,
  NavColumnList,
  NavColumnSections,
  type NavRow,
  type NavSection,
  ResizableColumn,
  ResultsColumn,
  type TargetPickerRow,
} from '@/components/canvas/PickerColumns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DOMAIN_GROUP_LABELS,
  PLATFORM_ICONS,
  SORTED_DOMAIN_GROUP_ORDER,
  TYPE_GROUPS,
  TypeResultsPanel,
} from '@/components/panels/node-fields/TriggerTypePicker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getTriggerDefaults } from '@/config/triggerFields';
import { useHass } from '@/contexts/HassContext';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import { useStableEntityList } from '@/hooks/useStableEntityList';
import { getDomainColor } from '@/lib/domain-colors';
import { getDomainIcon } from '@/lib/domain-icons';
import { getTriggerThresholdShape } from '@/lib/nativeThreshold';
import { buildTriggerNodeData } from '@/lib/triggerNodeData';
import { getTriggerEnumField } from '@/lib/triggerEnumField';
import {
  type EntityTriggerCategory,
  groupCategoriesByDomain,
  type TriggerRecipe,
} from '@/lib/triggerRecipes';

/** A device group's icon is its first entity's domain — devices are almost
 * always single-purpose in HA's registry, so this is representative in
 * practice; `Layers` (a generic "multiple things" glyph) covers the rare
 * empty/mixed case and any domain not in lib/domain-icons.ts's table. */
function deviceGroupIcon(group: DeviceGroup): LucideIcon {
  const domain = group.entities[0]?.entity_id.split('.')[0];
  return getDomainIcon(domain, Layers);
}
function deviceGroupColor(group: DeviceGroup) {
  const domain = group.entities[0]?.entity_id.split('.')[0];
  return getDomainColor(domain);
}
import type { HassEntity } from '@/types/hass';

/**
 * "When" — a Miller-column (Finder-style cascading columns) modal
 * mirroring the "When…" dialog style of other flow-based automation
 * editors, opened from NodePalette.tsx's Trigger button (or its drag
 * target) rather than embedded in the property panel. Deliberately a *new* navigation pattern (columns that cascade
 * left-to-right as you drill in) rather than TriggerTypePicker.tsx's
 * expand/collapse tree — see docs/trigger-picker-rebuild.md for why the two
 * coexist — but it shares 100% of that picker's underlying data and result
 * rendering (groupByDevice, TargetResultsPanel, TypeResultsPanel,
 * ENTITY_TRIGGER_CATEGORIES, ...) rather than re-deriving any of it.
 *
 * Unlike TriggerFields.tsx (which edits an already-placed node's fields one
 * onChange call at a time), this dialog builds a brand new node's data in a
 * single shot via lib/triggerNodeData.ts's buildTriggerNodeData, then hands
 * it to the caller via `onCommit` — the caller is responsible for actually
 * creating + selecting the node (see useAddNodeDialogs.tsx).
 */

type NavColumn =
  | { kind: 'root' }
  | { kind: 'areas' }
  | { kind: 'areaChildren'; areaLabel: string; scope: EntityScope }
  | { kind: 'deviceChildren'; group: DeviceGroup }
  | { kind: 'domainCategories'; domainLabel: string; categories: EntityTriggerCategory[] }
  | { kind: 'platforms' }
  | { kind: 'unassignedOptions' }
  | { kind: 'targetResults'; scope: SelectedScope }
  | { kind: 'typeResults'; category: EntityTriggerCategory }
  | { kind: 'recipeEntities'; category: EntityTriggerCategory; recipe: TriggerRecipe }
  | { kind: 'scopeTargets'; label: string; recipe: TriggerRecipe; entityIds: string[] }
  | { kind: 'recipeConfig'; recipe: TriggerRecipe; draftData: Record<string, unknown> }
  | { kind: 'platformEntities'; platform: TriggerPlatform }
  | { kind: 'labels' }
  | { kind: 'sunOptions' };

// Opens straight into the "Zones" column (areas + a flat, alphabetical
// device list) instead of requiring a click on "Zones" first — matches
// the reference "When…" dialog this was modeled on, which lands there by
// default too.
const INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }, { kind: 'areas' }];
const INITIAL_SELECTED_KEYS: (string | null)[] = ['zones'];

interface WhenTriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: HassEntity[];
  onCommit: (data: Record<string, unknown>) => void;
}

export function WhenTriggerDialog({
  open,
  onOpenChange,
  entities: allEntities,
  onCommit,
}: WhenTriggerDialogProps) {
  const { t } = useTranslation(['nodes']);
  const {
    areas,
    getAreaIdForEntity,
    getDeviceIdForEntity,
    getDeviceNameById,
    isAutomationRelevantEntity,
    labels,
    getLabelIdsForEntity,
  } = useHass();
  // See TriggerTargetPicker.tsx's identical filter for why: keeps
  // config/diagnostic-category and hidden entities out of the device/entity
  // browsing and results entirely, matching HA's own automation editor.
  // Stabilized via useStableEntityList first — see its own doc comment —
  // so this dialog's whole area/device/label grouping chain below doesn't
  // recompute on every live entity-state tick (was causing multi-second
  // freezes while browsing, confirmed from a user screen recording).
  const stableAllEntities = useStableEntityList(allEntities);
  const entities = useMemo(
    () => stableAllEntities.filter((e) => isAutomationRelevantEntity(e.entity_id)),
    [stableAllEntities, isAutomationRelevantEntity]
  );

  const [columns, setColumns] = useState<NavColumn[]>(INITIAL_COLUMNS);
  const [selectedKeys, setSelectedKeys] = useState<(string | null)[]>(INITIAL_SELECTED_KEYS);
  const [search, setSearch] = useState('');
  const [searchSelectedEntityId, setSearchSelectedEntityId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setColumns(INITIAL_COLUMNS);
      setSelectedKeys(INITIAL_SELECTED_KEYS);
      setSearch('');
      setSearchSelectedEntityId(null);
    }
  }, [open]);

  const pushColumn = (atIndex: number, column: NavColumn, key: string) => {
    setColumns((prev) => [...prev.slice(0, atIndex + 1), column]);
    setSelectedKeys((prev) => [...prev.slice(0, atIndex), key]);
  };

  // Shared "open a results column scoped to X" helpers — used by both the
  // root "Zones" column (area rows + the flat all-devices list) and the
  // area-drilldown column (areaChildren), so the SelectedScope shape for
  // "whole area" / "whole device" / "single entity" is only built once.
  const openAreaResults = (atIndex: number, areaId: string, label: string, scope: EntityScope) =>
    pushColumn(
      atIndex,
      {
        kind: 'targetResults',
        scope: {
          key: `area::${areaId}`,
          label,
          deviceIds: scope.deviceGroups.map((g) => g.deviceId),
          entityIds: allEntityIds(scope),
        },
      },
      areaId
    );

  const openLabelResults = (atIndex: number, labelId: string, label: string, scope: EntityScope) =>
    pushColumn(
      atIndex,
      {
        kind: 'targetResults',
        scope: {
          key: `label::${labelId}`,
          label,
          deviceIds: scope.deviceGroups.map((g) => g.deviceId),
          entityIds: allEntityIds(scope),
        },
      },
      labelId
    );

  const openDeviceResults = (atIndex: number, group: DeviceGroup) =>
    pushColumn(atIndex, { kind: 'targetResults', scope: buildDeviceScope(group.deviceId, group) }, group.deviceId);

  const openEntityResults = (atIndex: number, entity: HassEntity, deviceId: string | null) =>
    pushColumn(
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
    );

  const commitAndClose = (data: Record<string, unknown>) => {
    onCommit(data);
    onOpenChange(false);
  };

  const handleSelectPlatform = (platform: TriggerPlatform) =>
    commitAndClose(buildTriggerNodeData({ kind: 'platform', platform }));
  const handleSelectPlatformWithEntities = (platform: TriggerPlatform, entityIds: string[]) =>
    commitAndClose({ ...buildTriggerNodeData({ kind: 'platform', platform }), entity_id: entityIds });
  // 'state'/'numeric_state' are the two platform triggers with a genuine
  // entity_id concept (everything else here — time, sun, template, event,
  // webhook, mqtt, zone, homeassistant, calendar, device — either has no
  // entity target at all, or (device) is much better served by the Zones
  // flow's real device_automation-backed results). Picking either of those
  // two now pushes the same final-selection panel the rest of the picker
  // uses instead of committing with an empty entity_id. 'sun' similarly
  // pushes a column instead of committing immediately — it has no entity to
  // pick, but does have a real choice to make (sunrise vs. sunset) that
  // shouldn't default silently.
  const handleSelectPlatformRow = (atIndex: number, platform: TriggerPlatform) => {
    if (platform === 'state' || platform === 'numeric_state') {
      pushColumn(atIndex, { kind: 'platformEntities', platform }, platform);
    } else if (platform === 'sun') {
      pushColumn(atIndex, { kind: 'sunOptions' }, platform);
    } else {
      handleSelectPlatform(platform);
    }
  };
  const handleSelectSun = (event: string, offset: string) =>
    commitAndClose({
      ...getTriggerDefaults('sun'),
      event,
      ...(offset.trim() ? { offset: offset.trim() } : {}),
    });
  const handleSelectEntityTarget = (entityId: string) =>
    commitAndClose(buildTriggerNodeData({ kind: 'entityTarget', entityId }));
  const handleSelectDeviceTrigger = (trigger: DeviceTrigger) =>
    commitAndClose(buildTriggerNodeData({ kind: 'deviceTrigger', trigger }));
  const handleSelectRecipe = (entityIds: string[], recipe: TriggerRecipe) =>
    commitAndClose(buildTriggerNodeData({ kind: 'recipe', entityIds, recipe }));

  // Purpose-specific recipes with a real, non-defaultable decision to make
  // push one more column instead of committing immediately — same "real
  // choice, no sensible silent default" reasoning handleSelectPlatformRow
  // already uses for 'sun' (sunrise vs. sunset). Two cases qualify:
  //   - a real threshold to configure (illuminance/battery/humidity/
  //     temperature's changed + crossed_threshold, light's brightness ones,
  //     ...)
  //   - a REQUIRED enum field with no sensible default (e.g.
  //     `water_heater.operation_mode_changed`'s `operation_mode` — unlike
  //     `humidifier.mode_changed`'s optional `mode`, which is fine to leave
  //     unset and means "any mode change")
  // Deliberately NOT triggered by `behavior`/`for` alone, even though the
  // catalog-wide audit found those on nearly every dotted trigger — both
  // have sensible HA-matching defaults (each/any + no minimum duration), so
  // forcing an extra click on every single trigger addition would hurt the
  // common case for no real benefit. Reuses NativeTriggerFields verbatim
  // (see RecipeConfigForm below) so this column is never out of sync with
  // the property panel's own editor for the same fields.
  //
  // Only wired into the three Miller-column call sites below — not the flat
  // search-results path at the bottom of this component, which stays a
  // one-click commit for speed (it already skips targetResults' multi-select
  // branch the same way).
  const handleSelectRecipeConfigurable = (
    atIndex: number,
    entityIds: string[],
    recipe: TriggerRecipe
  ) => {
    const triggerType = recipe.fields.trigger;
    const needsConfig =
      triggerType.includes('.') &&
      (getTriggerThresholdShape(triggerType) !== 'none' ||
        getTriggerEnumField(triggerType)?.required === true);
    if (needsConfig) {
      const draftData = buildTriggerNodeData({ kind: 'recipe', entityIds, recipe });
      pushColumn(atIndex, { kind: 'recipeConfig', recipe, draftData }, recipe.id);
      return;
    }
    handleSelectRecipe(entityIds, recipe);
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

  // Same shape as areaGroups, just grouped by HA label instead of area — a
  // label can span multiple rooms (e.g. "Downstairs" or "Energy-hungry"),
  // so this is a genuinely different cut through the same entities rather
  // than a duplicate of Zones. Reuses groupByDevice verbatim, which is why
  // clicking a label can reuse the exact same 'areaChildren' column kind
  // areas use (see rootSections' labelRows below).
  const labelGroups = useMemo(() => {
    return labels
      .map((label) => {
        const labelEntities = entities.filter((e) => getLabelIdsForEntity(e.entity_id).includes(label.label_id));
        const scope = groupByDevice(labelEntities, getDeviceIdForEntity, getDeviceNameById);
        return { label, ...scope };
      })
      .filter((g) => g.deviceGroups.length > 0 || g.standaloneEntities.length > 0);
  }, [labels, entities, getLabelIdsForEntity, getDeviceIdForEntity, getDeviceNameById]);

  // Every device across every area (plus unassigned ones), deduplicated and
  // alphabetically sorted by groupByDevice itself — this is the flat
  // "Devices" list shown directly under "Zones" at the Home root,
  // letting you jump straight to a device without picking a room first.
  const allDeviceGroups = useMemo(
    () => groupByDevice(entities, getDeviceIdForEntity, getDeviceNameById).deviceGroups,
    [entities, getDeviceIdForEntity, getDeviceNameById]
  );

  // Split that flat list into devices that actually belong to some area vs.
  // ones that don't — HA's device registry is full of system/integration
  // "devices" nobody ever assigns a room to (Backup, HACS, File editor,
  // ESPHome Device, Google Cast weather cards, ...), and mixing those into
  // the same alphabetical list as real physical devices makes it much
  // harder to scan. Real HA has no separate "ungrouped" concept, so this is
  // derived rather than looked up: a device counts as grouped if it shows
  // up in any area's deviceGroups above.
  const groupedDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { deviceGroups } of areaGroups) {
      for (const group of deviceGroups) ids.add(group.deviceId);
    }
    return ids;
  }, [areaGroups]);

  const { devicesInAreas, ungroupedDevices } = useMemo(() => {
    const devicesInAreas: DeviceGroup[] = [];
    const ungroupedDevices: DeviceGroup[] = [];
    for (const group of allDeviceGroups) {
      (groupedDeviceIds.has(group.deviceId) ? devicesInAreas : ungroupedDevices).push(group);
    }
    return { devicesInAreas, ungroupedDevices };
  }, [allDeviceGroups, groupedDeviceIds]);

  // Entities with no device at all (helpers, template entities, ...) that
  // also have no area of their own — the other half of "Unassigned" besides
  // ungroupedDevices above. groupByDevice's own standaloneEntities list
  // includes entities that DO have a direct area (just no device), so this
  // filters those back out; they already show up under their area instead.
  const unassignedStandaloneEntities = useMemo(
    () =>
      groupByDevice(entities, getDeviceIdForEntity, getDeviceNameById).standaloneEntities.filter(
        (e) => !getAreaIdForEntity(e.entity_id)
      ),
    [entities, getDeviceIdForEntity, getDeviceNameById, getAreaIdForEntity]
  );

  // "Unassigned" used to live as a sub-section tucked inside the Zones
  // column ("Other") — promoted to its own root-level entry (still built
  // from the exact same ungroupedDevices/unassignedStandaloneEntities data,
  // reusing the 'areaChildren' column verbatim since the shape is
  // identical) per user request, positioned right after Platform triggers.
  // Further split into Entities/Helpers/Devices/Services subcategories
  // (matching real HA's own Settings > Entities filter chips) per follow-up
  // user request — see buildUnassignedGroups' doc comment for what each of
  // the four covers.
  const unassignedGroups = useMemo(
    () => buildUnassignedGroups(entities, ungroupedDevices, unassignedStandaloneEntities),
    [entities, ungroupedDevices, unassignedStandaloneEntities]
  );

  // Built once and reused by every MultiTargetPanel usage below — the panel
  // itself is domain-agnostic (see PickerColumns.tsx), so the "Add
  // trigger"/"Add all"/etc. wording lives here instead.
  const multiTargetLabels = useMemo(
    () => ({
      addAllLabel: t('nodes:triggers.picker.when.addAllTargets'),
      clearAllLabel: t('nodes:triggers.picker.when.clearAllTargets'),
      noResultsLabel: t('nodes:triggers.picker.noResults'),
      selectPromptLabel: t('nodes:triggers.picker.when.selectTargetsPrompt'),
      commitLabel: (count: number) => t('nodes:triggers.picker.when.addTriggerButton', { count }),
    }),
    [t]
  );

  const categoriesByDomain = useMemo(() => groupCategoriesByDomain(), []);

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

  // ---- Row builders -------------------------------------------------------

  const rootSections = useMemo((): NavSection[] => {
    const zonesRow: NavRow = {
      key: 'zones',
      label: t('nodes:triggers.picker.when.zonesRootLabel'),
      onDrill: () => pushColumn(0, { kind: 'areas' }, 'zones'),
    };

    const domainRows: NavRow[] = [];
    for (const domain of SORTED_DOMAIN_GROUP_ORDER) {
      const categories = categoriesByDomain.get(domain);
      if (!categories || categories.length === 0) continue;
      const label = DOMAIN_GROUP_LABELS[domain] ?? domain;
      const icon = getDomainIcon(domain, Layers);
      const color = getDomainColor(domain);
      if (categories.length === 1) {
        const category = categories[0] as EntityTriggerCategory;
        domainRows.push({
          key: domain,
          label,
          icon,
          color,
          onSelect: () => pushColumn(0, { kind: 'typeResults', category }, domain),
        });
      } else {
        domainRows.push({
          key: domain,
          label,
          icon,
          color,
          onDrill: () =>
            pushColumn(0, { kind: 'domainCategories', domainLabel: label, categories }, domain),
        });
      }
    }

    const platformsRow: NavRow = {
      key: 'platforms',
      label: t('nodes:triggers.picker.when.platformsRootLabel'),
      onDrill: () => pushColumn(0, { kind: 'platforms' }, 'platforms'),
    };

    const unassignedRow: NavRow = {
      key: 'unassigned',
      label: t('nodes:triggers.picker.unassigned'),
      onDrill: () => pushColumn(0, { kind: 'unassignedOptions' }, 'unassigned'),
    };

    const labelsRow: NavRow = {
      key: 'labels',
      label: t('nodes:triggers.picker.when.labelsRootLabel'),
      icon: Tag,
      color: getDomainColor('labels'),
      onDrill: () => pushColumn(0, { kind: 'labels' }, 'labels'),
    };

    const sections: NavSection[] = [
      { title: t('nodes:triggers.picker.when.sections.zones'), rows: [zonesRow] },
      { title: t('nodes:triggers.picker.when.sections.deviceTypes'), rows: domainRows },
      { title: t('nodes:triggers.picker.when.sections.platformTriggers'), rows: [platformsRow] },
      { title: t('nodes:triggers.picker.unassigned'), rows: [unassignedRow] },
    ];
    // Only shown once the label registry actually has entries — an empty
    // "Labels" section with nothing under it is just clutter for the many
    // HA setups that don't use labels at all.
    if (labelGroups.length > 0) {
      sections.push({ title: t('nodes:triggers.picker.when.sections.labels'), rows: [labelsRow] });
    }
    return sections;
  }, [t, categoriesByDomain, labelGroups.length]);

  // The four rows shown when drilling into "Unassigned" — each pushes the
  // same 'areaChildren' column the Zones flow already uses, just scoped to
  // one of buildUnassignedGroups' four EntityScopes instead of an area's.
  const unassignedOptionRows = useMemo((): NavRow[] => {
    const makeRow = (key: 'entities' | 'helpers' | 'devices' | 'services', scope: EntityScope): NavRow => ({
      key,
      label: t(`nodes:triggers.picker.unassignedOptions.${key}`),
      icon: getDomainIcon(key, Layers),
      color: getDomainColor(key),
      onDrill: () =>
        pushColumn(
          1,
          { kind: 'areaChildren', areaLabel: t(`nodes:triggers.picker.unassignedOptions.${key}`), scope },
          key
        ),
    });
    return [
      makeRow('entities', unassignedGroups.entities),
      makeRow('helpers', unassignedGroups.helpers),
      makeRow('devices', unassignedGroups.devices),
      makeRow('services', unassignedGroups.services),
    ];
  }, [t, unassignedGroups]);

  const areaRows = useMemo((): NavRow[] => {
    return areaGroups.map(({ area, deviceGroups, standaloneEntities }) => ({
      key: area.area_id,
      label: area.name,
      icon: Home,
      color: getDomainColor('zones'),
      onSelect: () => openAreaResults(1, area.area_id, area.name, { deviceGroups, standaloneEntities }),
      onDrill: () =>
        pushColumn(
          1,
          { kind: 'areaChildren', areaLabel: area.name, scope: { deviceGroups, standaloneEntities } },
          area.area_id
        ),
    }));
  }, [areaGroups]);

  // Labels column (root -> 'labels') — same two-affordance shape as areas:
  // clicking the row shows every device/entity carrying the label merged
  // together (openLabelResults), the chevron drills into 'areaChildren' to
  // browse device-by-device first. Both eventually reach the same
  // targetResults/scopeTargets flow areas do, so a multi-entity recipe
  // picked here gets the same "Add all"/multi-select third panel.
  const labelRows = useMemo((): NavRow[] => {
    return labelGroups.map(({ label, deviceGroups, standaloneEntities }) => ({
      key: label.label_id,
      label: label.name,
      icon: Tag,
      color: getDomainColor('labels'),
      onSelect: () => openLabelResults(1, label.label_id, label.name, { deviceGroups, standaloneEntities }),
      onDrill: () =>
        pushColumn(
          1,
          { kind: 'areaChildren', areaLabel: label.name, scope: { deviceGroups, standaloneEntities } },
          label.label_id
        ),
    }));
  }, [labelGroups]);

  // Flat, alphabetical device list shown alongside the areas in the "Zones"
  // column — clicking one goes straight to its cards (so picking a device
  // never requires picking its room first).
  const toDeviceRows = (groups: DeviceGroup[]): NavRow[] =>
    groups.map((group) => ({
      key: group.deviceId,
      label: group.name,
      icon: deviceGroupIcon(group),
      color: deviceGroupColor(group),
      onSelect: () => openDeviceResults(1, group),
      onDrill: () => openDeviceResults(1, group),
    }));

  const deviceRows = useMemo(() => toDeviceRows(devicesInAreas), [devicesInAreas]);
  // Ungrouped devices used to also render here as an "Other" section — moved
  // to its own root-level "Unassigned" entry (see unassignedGroups/
  // rootSections above) per user request, so this column is now just areas
  // + the devices that belong to one of them.
  const zonesColumnSections = useMemo(
    (): NavSection[] => [
      { title: t('nodes:triggers.picker.when.sections.zones'), rows: areaRows },
      { title: t('nodes:triggers.picker.when.sections.devices'), rows: deviceRows },
    ],
    [t, areaRows, deviceRows]
  );

  // ---- Column renderer ------------------------------------------------

  function renderColumn(column: NavColumn, index: number) {
    switch (column.kind) {
      case 'root':
        return <NavColumnSections key={index} sections={rootSections} selectedKey={selectedKeys[index]} />;

      case 'areas':
        return (
          <NavColumnSections key={index} sections={zonesColumnSections} selectedKey={selectedKeys[index]} />
        );

      case 'labels':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:triggers.picker.when.sections.labels')}
            rows={labelRows}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:triggers.picker.noResults')}
          />
        );

      case 'areaChildren': {
        const rows: NavRow[] = [
          ...column.scope.deviceGroups.map((group) => ({
            key: group.deviceId,
            label: group.name,
            icon: deviceGroupIcon(group),
            color: deviceGroupColor(group),
            onSelect: () => openDeviceResults(index, group),
            onDrill: () => pushColumn(index, { kind: 'deviceChildren', group }, group.deviceId),
          })),
          ...column.scope.standaloneEntities.map((entity) => ({
            key: entity.entity_id,
            label: getEntityName(entity),
            icon: getDomainIcon(entity.entity_id.split('.')[0], Layers),
            color: getDomainColor(entity.entity_id.split('.')[0]),
            onSelect: () => openEntityResults(index, entity, null),
          })),
        ];
        return (
          <NavColumnList
            key={index}
            title={column.areaLabel}
            rows={rows}
            selectedKey={selectedKeys[index]}
          />
        );
      }

      case 'deviceChildren': {
        const rows: NavRow[] = column.group.entities.map((entity) => ({
          key: entity.entity_id,
          label: getEntityName(entity),
          icon: getDomainIcon(entity.entity_id.split('.')[0], Layers),
          color: getDomainColor(entity.entity_id.split('.')[0]),
          onSelect: () => openEntityResults(index, entity, column.group.deviceId),
        }));
        return (
          <NavColumnList
            key={index}
            title={column.group.name}
            rows={rows}
            selectedKey={selectedKeys[index]}
          />
        );
      }

      case 'domainCategories': {
        const rows: NavRow[] = column.categories.map((category) => ({
          key: category.groupKey,
          label: category.label,
          icon: getDomainIcon(category.domain, Layers),
          color: getDomainColor(category.domain),
          onSelect: () => pushColumn(index, { kind: 'typeResults', category }, category.groupKey),
        }));
        return (
          <NavColumnList
            key={index}
            title={column.domainLabel}
            rows={rows}
            selectedKey={selectedKeys[index]}
          />
        );
      }

      case 'platforms':
        return (
          <PlatformsColumn
            key={index}
            onSelectPlatform={(platform) => handleSelectPlatformRow(index, platform)}
          />
        );

      case 'unassignedOptions':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:triggers.picker.unassigned')}
            rows={unassignedOptionRows}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'platformEntities': {
        const rows: TargetPickerRow[] = entities
          .slice()
          .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
          .map((entity) => ({
            entityId: entity.entity_id,
            label: getEntityName(entity),
            icon: getDomainIcon(entity.entity_id.split('.')[0], Layers),
            color: getDomainColor(entity.entity_id.split('.')[0]),
          }));
        return (
          <MultiTargetPanel
            key={index}
            title={t(`nodes:triggers.platforms.${column.platform}`)}
            rows={rows}
            labels={multiTargetLabels}
            onCommit={(entityIds) => handleSelectPlatformWithEntities(column.platform, entityIds)}
          />
        );
      }

      case 'targetResults':
        return (
          <ResultsColumn key={index} title={column.scope.label}>
            <TargetResultsPanel
              selected={column.scope}
              entities={entities}
              onSelectEntityTarget={handleSelectEntityTarget}
              onSelectDeviceTrigger={handleSelectDeviceTrigger}
              // A recipe row here can already cover more than one entity
              // (e.g. "Light turned on" under a Living Room with 3 lights —
              // TargetResultsPanel merges same-recipe entities into one
              // row). Committing that straight away used to mean "whole
              // area, no choice" was the only option; now it opens the same
              // multi-select-with-Add-all target panel used by the "By
              // type" flow so the user can pick a subset instead. A recipe
              // that only ever covers one entity (a single device/entity
              // scope) still commits immediately — there's nothing to
              // choose between.
              onSelectRecipe={(entityIds, recipe) =>
                entityIds.length > 1
                  ? pushColumn(index, { kind: 'scopeTargets', label: recipe.label, recipe, entityIds }, recipe.id)
                  : handleSelectRecipeConfigurable(index, entityIds, recipe)
              }
            />
          </ResultsColumn>
        );

      case 'typeResults':
        return (
          <ResultsColumn key={index} title={column.category.label}>
            {/* Unlike TriggerTypePicker.tsx's inline embedding of this same
                panel (which commits a recipe immediately with no entities —
                fine there, since the property panel's own Targets field is
                right below it), picking a recipe here pushes a third column
                of that domain's actual entities instead of committing. Per
                user: selecting e.g. "Light turned on" should show "a list of
                the lights i have in home assistant" before the trigger is
                created, not commit with an empty target. */}
            <TypeResultsPanel
              category={column.category}
              onSelectRecipe={(_entityIds, recipe) =>
                pushColumn(index, { kind: 'recipeEntities', category: column.category, recipe }, recipe.id)
              }
            />
          </ResultsColumn>
        );

      case 'recipeEntities': {
        const domainPrefix = `${column.category.domain}.`;
        const rows: TargetPickerRow[] = entities
          .filter((e) => e.entity_id.startsWith(domainPrefix))
          .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
          .map((entity) => ({
            entityId: entity.entity_id,
            label: getEntityName(entity),
            icon: getDomainIcon(column.category.domain, Layers),
            color: getDomainColor(column.category.domain),
          }));
        return (
          <MultiTargetPanel
            key={index}
            title={column.recipe.label}
            rows={rows}
            labels={multiTargetLabels}
            onCommit={(entityIds) => handleSelectRecipeConfigurable(index, entityIds, column.recipe)}
          />
        );
      }

      case 'scopeTargets': {
        const rows: TargetPickerRow[] = column.entityIds
          .map((id) => entities.find((e) => e.entity_id === id))
          .filter((e): e is HassEntity => Boolean(e))
          .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
          .map((entity) => ({
            entityId: entity.entity_id,
            label: getEntityName(entity),
            icon: getDomainIcon(entity.entity_id.split('.')[0], Layers),
            color: getDomainColor(entity.entity_id.split('.')[0]),
          }));
        return (
          <MultiTargetPanel
            key={index}
            title={column.label}
            rows={rows}
            labels={multiTargetLabels}
            onCommit={(entityIds) => handleSelectRecipeConfigurable(index, entityIds, column.recipe)}
          />
        );
      }

      case 'recipeConfig':
        return (
          <ResultsColumn key={index} title={column.recipe.label}>
            <RecipeConfigForm
              recipe={column.recipe}
              draftData={column.draftData}
              onCommit={commitAndClose}
            />
          </ResultsColumn>
        );

      case 'sunOptions':
        return (
          <ResultsColumn key={index} title={t('nodes:triggers.platforms.sun')}>
            <SunOptionsForm onCommit={handleSelectSun} />
          </ResultsColumn>
        );

      default:
        return null;
    }
  }

  const searchSelectedScope: SelectedScope | null = useMemo(() => {
    if (!searchSelectedEntityId) return null;
    const entity = entities.find((e) => e.entity_id === searchSelectedEntityId);
    return {
      key: `entity::${searchSelectedEntityId}`,
      label: entity ? getEntityName(entity) : searchSelectedEntityId,
      deviceIds: [],
      entityIds: [searchSelectedEntityId],
      singleEntityId: searchSelectedEntityId,
    };
  }, [searchSelectedEntityId, entities]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={MILLER_DIALOG_CONTENT_CLASS}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('nodes:triggers.picker.when.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-6 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchSelectedEntityId(null);
            }}
            placeholder={t('nodes:triggers.picker.when.searchPlaceholder')}
            className="h-8 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex min-h-0 flex-1 divide-x overflow-x-auto">
          {searchResults ? (
            <>
              <NavColumnList
                title={t('nodes:triggers.picker.when.sections.zones')}
                rows={searchResults.map((entity) => ({
                  key: entity.entity_id,
                  label: getEntityName(entity),
                  onSelect: () => setSearchSelectedEntityId(entity.entity_id),
                }))}
                selectedKey={searchSelectedEntityId}
                emptyLabel={t('nodes:triggers.picker.noResults')}
              />
              {searchSelectedScope && (
                <ResultsColumn title={searchSelectedScope.label}>
                  <TargetResultsPanel
                    selected={searchSelectedScope}
                    entities={entities}
                    onSelectEntityTarget={handleSelectEntityTarget}
                    onSelectDeviceTrigger={handleSelectDeviceTrigger}
                    onSelectRecipe={handleSelectRecipe}
                  />
                </ResultsColumn>
              )}
            </>
          ) : (
            columns.map((column, index) => renderColumn(column, index))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Same card-row treatment as the domain-recipe columns (TriggerResultRow —
// icon, bold title, muted description) rather than the old flat
// icon+label-only list, per user request to bring "platform triggers" in
// line with the rest of the redesigned picker. Descriptions are real HA
// wording for these long-stable trigger types (nodes:triggers.
// platformDescriptions), the same "Triggers when..." phrasing already used
// for the migrated domain recipes.
function PlatformsColumn({
  onSelectPlatform,
}: {
  onSelectPlatform: (platform: TriggerPlatform) => void;
}) {
  const { t } = useTranslation(['nodes']);
  return (
    <ResizableColumn defaultWidth={384} minWidth={280} maxWidth={640}>
      <div className="flex h-full flex-col overflow-y-auto p-1.5">
        {TYPE_GROUPS.map((group) => (
          <div key={group.key} className="mb-3">
            <div className="px-1.5 py-1 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
              {t(`nodes:triggers.picker.groups.${group.key}`)}
            </div>
            <div className="space-y-1.5">
              {group.platforms.map((platform) => (
                <TriggerResultRow
                  key={platform}
                  icon={PLATFORM_ICONS[platform]}
                  label={t(`nodes:triggers.platforms.${platform}`)}
                  description={t(`nodes:triggers.platformDescriptions.${platform}`, { defaultValue: '' }) || undefined}
                  onSelect={() => onSelectPlatform(platform)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ResizableColumn>
  );
}

/**
 * Threshold/behavior/`for` configuration step for a purpose-specific recipe
 * whose trigger has a real threshold (see handleSelectRecipeConfigurable) —
 * e.g. picking "Illuminance crossed threshold" now lands here instead of
 * committing a bare `{type: 'above', value: {number: 0}}` default straight
 * onto the canvas, so it's set up correctly (or at least deliberately) from
 * the moment the node exists rather than requiring a follow-up trip to the
 * property panel.
 *
 * Reuses NativeTriggerFields verbatim against a small local draft, same as
 * the property panel's own trigger editor — target/behavior/threshold/`for`
 * are edited exactly once, here, rather than this column re-implementing a
 * second copy of that form. Local `data` state is throwaway, matching
 * SunOptionsForm below — this only exists to build one `onCommit` payload.
 */
function RecipeConfigForm({
  recipe,
  draftData,
  onCommit,
}: {
  recipe: TriggerRecipe;
  draftData: Record<string, unknown>;
  onCommit: (data: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const [data, setData] = useState<Record<string, unknown>>(draftData);
  const handleChange = (key: string, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));
  // NativeTriggerFields only ever reads `node.data` — a real FlowNode's
  // other fields (position, type, ...) don't exist yet for a still-being-
  // configured node, so a minimal stand-in is enough here.
  const draftNode = { id: 'draft', data } as unknown as FlowNode;

  return (
    <div className="flex flex-col gap-4 p-4">
      <NativeTriggerFields node={draftNode} onChange={handleChange} triggerType={recipe.fields.trigger} />
      <Button className="w-full" onClick={() => onCommit(data)}>
        {t('nodes:triggerFields.sun.addTrigger')}
      </Button>
    </div>
  );
}

/**
 * Inline sunrise/sunset picker for the 'sun' platform trigger — pushed as a
 * third column instead of committing immediately (see
 * handleSelectPlatformRow's doc comment), since "which edge of the sun
 * event" is a real choice with no sensible silent default, unlike every
 * other non-entity platform (time, template, ...) which commits straight
 * away. Local `event`/`offset` state here is intentionally throwaway — this
 * form only exists to build one `onCommit` payload, not to be revisited.
 */
function SunOptionsForm({ onCommit }: { onCommit: (event: string, offset: string) => void }) {
  const { t } = useTranslation(['nodes']);
  const [event, setEvent] = useState<string>('sunset');
  const [offset, setOffset] = useState('');

  return (
    <div className="space-y-4 p-2">
      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs" htmlFor="sun-event">
          {t('nodes:triggerFields.sun.event')}
        </label>
        <Select value={event} onValueChange={setEvent}>
          <SelectTrigger id="sun-event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sunrise">{t('nodes:triggerFields.sun.sunrise')}</SelectItem>
            <SelectItem value="sunset">{t('nodes:triggerFields.sun.sunset')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs" htmlFor="sun-offset">
          {t('nodes:triggerFields.sun.offset')}
        </label>
        <Input
          id="sun-offset"
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          placeholder={t('nodes:triggerFields.sun.offsetPlaceholder')}
        />
      </div>

      <Button className="w-full" onClick={() => onCommit(event, offset)}>
        {t('nodes:triggerFields.sun.addTrigger')}
      </Button>
    </div>
  );
}
