import type { FlowNode } from '@circuitry/shared';
import { Blocks, Clock, Home, Layers, type LucideIcon, Radio, Search, Sun, Tag, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { NativeConditionFields } from '@/components/panels/node-fields/NativeConditionFields';
import { TriggerResultRow } from '@/components/panels/node-fields/TriggerResultRow';
import {
  allEntityIds,
  buildDeviceScope,
  buildUnassignedGroups,
  type DeviceGroup,
  type EntityScope,
  getEntityName,
  groupByDevice,
  type SelectedScope,
} from '@/components/panels/node-fields/TriggerTargetPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useHass } from '@/contexts/HassContext';
import { HaSelector } from '@/ha';
import { type DeviceCondition, useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useStableEntityList } from '@/hooks/useStableEntityList';
import { useTranslations } from '@/hooks/useTranslations';
import { buildConditionNodeData } from '@/lib/conditionNodeData';
import {
  CONDITION_BLOCKS,
  getConditionBlockIcon,
  type ConditionBlock,
  type ConditionRecipe,
  ENTITY_CONDITION_CATEGORIES,
  type EntityConditionCategory,
  getEntityConditionRecipeGroup,
  SUN_CONDITIONS,
} from '@/lib/conditionRecipes';
import { buildCompositeValue, getDeviceAutomationLabel } from '@/lib/deviceTriggerLabels';
import { getConditionEnumField, hasConditionSingleValueField } from '@/lib/conditionEnumField';
import { getDomainColor } from '@/lib/domain-colors';
import { getDomainIcon } from '@/lib/domain-icons';
import { getConditionThresholdShape } from '@/lib/nativeThreshold';
import type { HassEntity } from '@/types/hass';

/**
 * "+Add > And" — the AndConditionDialog equivalent of WhenTriggerDialog.tsx,
 * applying the exact same Miller-column architecture (root sections, card
 * rows, multi-select third panels) to Home Assistant's purpose-specific
 * *conditions* (`condition: light.is_on`, dotted domain.is_* form —
 * confirmed against the live home-assistant.io/conditions/ reference,
 * mirroring the same 2025.12+ mechanism WhenTriggerDialog already uses for
 * triggers) instead of triggers. See lib/conditionRecipes.ts for the
 * catalog and lib/conditionNodeData.ts for the selection -> node-data
 * mapping.
 *
 * The one structural difference from When, per explicit user request: a
 * "Blocks" root section — and/or/not, Template, Time, Trigger (by id) —
 * positioned ABOVE Zones/Device types, covering AND's non-entity-scoped
 * structural conditions. Blocks commit immediately (no target/entity
 * picker step — none of them test a specific entity), the same way When's
 * "Platform triggers" section's time/sun/template entries commit
 * immediately rather than opening a third column.
 *
 * Unlike When, there's no "Platform triggers"-style flat legacy-platform
 * section: every recipe here is already a genuine purpose-specific
 * condition (see conditionRecipes.ts's doc comment for why no legacy
 * state/numeric_state fallback catalog exists), and the structural bits
 * that would've needed one live in Blocks instead. Device rows (both the
 * Zones flow and the "Generic" > "Device" flow below) merge in live
 * `device_automation/condition/list` results alongside the catalog recipes
 * — see ConditionTargetResultsPanel, mirroring how ThenActionDialog's
 * equivalent panel merges live device actions.
 */

type NavColumn =
  | { kind: 'root' }
  | { kind: 'blocks' }
  | { kind: 'areas' }
  | { kind: 'areaChildren'; areaLabel: string; scope: EntityScope }
  | { kind: 'deviceChildren'; group: DeviceGroup }
  | { kind: 'unassignedOptions' }
  | { kind: 'targetResults'; scope: SelectedScope }
  | { kind: 'typeResults'; category: EntityConditionCategory }
  | { kind: 'recipeEntities'; category: EntityConditionCategory; recipe: ConditionRecipe }
  | { kind: 'scopeTargets'; label: string; recipe: ConditionRecipe; entityIds: string[] }
  | { kind: 'recipeConfig'; recipe: ConditionRecipe; draftData: Record<string, unknown> }
  | { kind: 'labels' }
  | { kind: 'generic' }
  // "By type" > "Generic" — real HA's own condition Generic collection is
  // `{ device: {}, entity: { members: { state: {}, numeric_state: {} } } }`
  // (home-assistant/frontend's data/condition.ts's CONDITION_COLLECTIONS) —
  // a flat device list leading to the same live device-condition results
  // panel the Zones flow already uses, and a two-row State/Numeric State
  // pick reusing CONDITION_BLOCKS' own entries.
  | { kind: 'genericDevicePick' }
  | { kind: 'genericEntityPick' }
  // "By type" > "Sun" — real HA's own Sun category (verified against
  // home-assistant/core's sun/condition.py) is 8 purpose-built conditions
  // (is_up, is_set, is_ascending, is_descending, elevation, is_night,
  // is_morning_twilight, is_evening_twilight), none of which take a target —
  // the sun is a singleton — so this pushes a flat card list
  // (lib/conditionRecipes.ts's SUN_CONDITIONS) that commits immediately on
  // select, the same as the Blocks column, rather than routing through the
  // entity-target picker every other By-type category uses.
  | { kind: 'sunOptions' }
  // "By type" > "Time" pushes a second column instead of committing
  // immediately: an after/before/weekday window shouldn't silently default
  // to "always true" the way e.g. Zone's empty entity_id/zone does, since
  // it reads as a genuine decision rather than a "fill in later"
  // placeholder.
  | { kind: 'timeOptions' };

/**
 * Turns a CONDITION_BLOCKS entry into a NavRow that commits immediately —
 * shared by rootSections' "By type" list and zonesColumnSections' "By
 * target" list below, so Time/Sun (real HA's TIME_LOCATION_GROUPS: shown in
 * both tabs since they have no target) don't need their row-building logic
 * duplicated per call site.
 */
function blockToNavRow(block: ConditionBlock, icon: LucideIcon, onSelectBlock: (block: ConditionBlock) => void): NavRow {
  return {
    key: block.key,
    label: block.label,
    icon,
    color: getDomainColor(block.key),
    onSelect: () => onSelectBlock(block),
  };
}

/** A device group's icon is its first entity's domain — see WhenTriggerDialog.tsx's identical helper. */
function deviceGroupIcon(group: DeviceGroup): LucideIcon {
  const domain = group.entities[0]?.entity_id.split('.')[0];
  return getDomainIcon(domain, Layers);
}
function deviceGroupColor(group: DeviceGroup) {
  const domain = group.entities[0]?.entity_id.split('.')[0];
  return getDomainColor(domain);
}

// Opens straight into the "Zones" column, matching WhenTriggerDialog.tsx.
const INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }, { kind: 'areas' }];
const INITIAL_SELECTED_KEYS: (string | null)[] = ['zones'];

interface AndConditionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: HassEntity[];
  onCommit: (data: Record<string, unknown>) => void;
}

export function AndConditionDialog({
  open,
  onOpenChange,
  entities: allEntities,
  onCommit,
}: AndConditionDialogProps) {
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
  // Stabilized via useStableEntityList — see its own doc comment — so this
  // dialog's area/device/label grouping chain below doesn't recompute on
  // every live entity-state tick (was causing multi-second freezes while
  // browsing, confirmed from a user screen recording).
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

  const handleSelectBlock = (block: ConditionBlock) => commitAndClose(buildConditionNodeData({ kind: 'block', block }));
  const handleSelectEntityTarget = (entityId: string) =>
    commitAndClose(buildConditionNodeData({ kind: 'entityTarget', entityId }));
  const handleSelectRecipe = (entityIds: string[], recipe: ConditionRecipe) =>
    commitAndClose(buildConditionNodeData({ kind: 'recipe', entityIds, recipe }));

  // Purpose-specific recipes with a real, non-defaultable decision to make
  // push one more column instead of committing immediately — the AND-dialog
  // equivalent of WhenTriggerDialog.tsx's handleSelectRecipeConfigurable,
  // same "real choice, no sensible silent default" reasoning. Three cases
  // qualify:
  //   - a real threshold to configure (illuminance/battery/humidity/
  //     temperature/light's `is_value`/`is_brightness`/`is_level`
  //     conditions, ...)
  //   - a REQUIRED enum field (`climate.is_hvac_mode`, `water_heater.
  //     is_operation_mode`, `select.is_option_selected` — but NOT
  //     `humidifier.is_mode`, which HA documents as optional)
  //   - the single-value field (`text.is_equal_to`'s `value` — always
  //     required, no list form)
  // Deliberately NOT triggered by `behavior`/`for` alone — see
  // WhenTriggerDialog.tsx's identical reasoning. Reuses
  // NativeConditionFields verbatim (see RecipeConfigForm below) so this
  // column is never out of sync with the property panel's own editor.
  //
  // Only wired into the three Miller-column call sites below — not the flat
  // search-results path at the bottom of this component, which stays a
  // one-click commit for speed.
  const handleSelectRecipeConfigurable = (
    atIndex: number,
    entityIds: string[],
    recipe: ConditionRecipe
  ) => {
    const conditionType = recipe.fields.condition;
    const needsConfig =
      getConditionThresholdShape(conditionType) !== 'none' ||
      getConditionEnumField(conditionType)?.required === true ||
      hasConditionSingleValueField(conditionType);
    if (needsConfig) {
      const draftData = buildConditionNodeData({ kind: 'recipe', entityIds, recipe });
      pushColumn(atIndex, { kind: 'recipeConfig', recipe, draftData }, recipe.id);
      return;
    }
    handleSelectRecipe(entityIds, recipe);
  };
  // Device-specific condition (ZHA/deCONZ "is on"/"is off" checks and other
  // integration-defined device conditions) fetched live from
  // device_automation/condition/list — the condition-side sibling of
  // ThenActionDialog's handleSelectDeviceAction.
  const handleSelectDeviceCondition = (condition: DeviceCondition) =>
    commitAndClose(buildConditionNodeData({ kind: 'deviceCondition', condition }));
  // Time's "after/before/weekday window" — built directly rather than
  // through buildConditionNodeData's 'block' case, since it carries real
  // user-picked fields on top of CONDITION_BLOCKS' bare `{ condition: 'time' }`
  // default.
  const handleSelectTimeOptions = (after: string, before: string, weekdays: string[]) =>
    commitAndClose({
      condition: 'time',
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      ...(weekdays.length > 0 ? { weekday: weekdays } : {}),
    });
  // Sun/Time's "By type"/"By target" row — pushes the options column above
  // instead of committing immediately, at whichever index the caller is
  // rendering from (root's deviceTypeRows is always index 0; zonesColumn
  // Sections' timeSunTargetRows is always index 1, same as areaRows/
  // deviceRows there).
  const timeSunRow = (kind: 'time' | 'sun', icon: LucideIcon, atIndex: number): NavRow | null => {
    const block = CONDITION_BLOCKS.find((b) => b.key === kind);
    if (!block) return null;
    return {
      key: block.key,
      label: block.label,
      icon,
      color: getDomainColor(block.key),
      onDrill: () => pushColumn(atIndex, { kind: kind === 'time' ? 'timeOptions' : 'sunOptions' }, block.key),
    };
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

  const labelGroups = useMemo(() => {
    return labels
      .map((label) => {
        const labelEntities = entities.filter((e) => getLabelIdsForEntity(e.entity_id).includes(label.label_id));
        const scope = groupByDevice(labelEntities, getDeviceIdForEntity, getDeviceNameById);
        return { label, ...scope };
      })
      .filter((g) => g.deviceGroups.length > 0 || g.standaloneEntities.length > 0);
  }, [labels, entities, getLabelIdsForEntity, getDeviceIdForEntity, getDeviceNameById]);

  const allDeviceGroups = useMemo(
    () => groupByDevice(entities, getDeviceIdForEntity, getDeviceNameById).deviceGroups,
    [entities, getDeviceIdForEntity, getDeviceNameById]
  );

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

  const unassignedStandaloneEntities = useMemo(
    () =>
      groupByDevice(entities, getDeviceIdForEntity, getDeviceNameById).standaloneEntities.filter(
        (e) => !getAreaIdForEntity(e.entity_id)
      ),
    [entities, getDeviceIdForEntity, getDeviceNameById, getAreaIdForEntity]
  );

  // Split into Entities/Helpers/Devices/Services subcategories — see
  // buildUnassignedGroups' doc comment and WhenTriggerDialog.tsx's identical
  // usage for what each of the four covers.
  const unassignedGroups = useMemo(
    () => buildUnassignedGroups(entities, ungroupedDevices, unassignedStandaloneEntities),
    [entities, ungroupedDevices, unassignedStandaloneEntities]
  );

  const multiTargetLabels = useMemo(
    () => ({
      addAllLabel: t('nodes:conditions.picker.and.addAllTargets'),
      clearAllLabel: t('nodes:conditions.picker.and.clearAllTargets'),
      noResultsLabel: t('nodes:conditions.picker.noResults'),
      selectPromptLabel: t('nodes:conditions.picker.and.selectTargetsPrompt'),
      commitLabel: (count: number) => t('nodes:conditions.picker.and.addConditionButton', { count }),
    }),
    [t]
  );

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
    const blocksRow: NavRow = {
      key: 'blocks',
      label: t('nodes:conditions.picker.and.blocksRootLabel'),
      icon: Blocks,
      color: getDomainColor('blocks'),
      onDrill: () => pushColumn(0, { kind: 'blocks' }, 'blocks'),
    };

    const zonesRow: NavRow = {
      key: 'zones',
      label: t('nodes:conditions.picker.and.zonesRootLabel'),
      onDrill: () => pushColumn(0, { kind: 'areas' }, 'zones'),
    };

    // Every condition category is already its own row — unlike
    // WhenTriggerDialog's domain-nested categories (several trigger
    // categories can share one domain, e.g. binary_sensor's many device
    // classes), conditionRecipes.ts's categories are one-per-prefix, so no
    // intermediate "domainCategories" column is needed here at all.
    //
    // "Time", "Sun", and "Trigger" are also folded into this same "By type"
    // list — matching real HA's own "Add condition" dialog, which lists them
    // as browsable entries alongside Light/Switch/etc. (home-assistant/
    // frontend's data/condition.ts's CONDITION_COLLECTIONS first collection:
    // dynamicGroups/time/sun/helpers/template/trigger) rather than nesting
    // them under "Blocks" (previously the only way to reach them here,
    // buried among and/or/not/state/numeric_state/zone/template/trigger —
    // easy to miss since none of those read as their own device type).
    // "Zone" gets the same treatment for the same reason (device_tracker/
    // person "is inside a zone" reads like its own type, not a structural
    // block). Reuses CONDITION_BLOCKS' own entries rather than duplicating
    // their data, and commits immediately on select like every other Blocks
    // entry (none of these four need a target/entity picker step).
    const blockAsRow = (key: string, icon: LucideIcon): NavRow | null => {
      const block = CONDITION_BLOCKS.find((b) => b.key === key);
      return block ? blockToNavRow(block, icon, handleSelectBlock) : null;
    };
    const extraTypeRows: NavRow[] = [
      timeSunRow('time', Clock, 0),
      timeSunRow('sun', Sun, 0),
      blockAsRow('zone', Home),
      blockAsRow('trigger', Radio), // matches nodeTypeCatalog.ts's own 'trigger' node icon
    ].filter((row): row is NavRow => row !== null);

    // "Generic" — real HA's own condition Generic collection is Device +
    // Entity (state/numeric_state on any single entity), listed as one more
    // browsable "By type" entry rather than a separate root section — see
    // the NavColumn type's doc comment.
    const genericRow: NavRow = {
      key: 'generic',
      label: t('nodes:conditions.picker.and.genericRootLabel'),
      icon: getDomainIcon('generic', Layers),
      color: getDomainColor('generic'),
      onDrill: () => pushColumn(0, { kind: 'generic' }, 'generic'),
    };

    const deviceTypeRows: NavRow[] = [
      ...ENTITY_CONDITION_CATEGORIES.map((category) => ({
        key: category.groupKey,
        label: category.label,
        icon: getDomainIcon(category.conditionPrefix, Layers),
        color: getDomainColor(category.conditionPrefix),
        onSelect: () => pushColumn(0, { kind: 'typeResults', category }, category.groupKey),
      })),
      ...extraTypeRows,
      genericRow,
    ].sort((a, b) => a.label.localeCompare(b.label));

    const unassignedRow: NavRow = {
      key: 'unassigned',
      label: t('nodes:conditions.picker.unassigned'),
      onDrill: () => pushColumn(0, { kind: 'unassignedOptions' }, 'unassigned'),
    };

    const labelsRow: NavRow = {
      key: 'labels',
      label: t('nodes:conditions.picker.and.labelsRootLabel'),
      icon: Tag,
      color: getDomainColor('labels'),
      onDrill: () => pushColumn(0, { kind: 'labels' }, 'labels'),
    };

    const sections: NavSection[] = [
      { title: t('nodes:conditions.picker.and.sections.blocks'), rows: [blocksRow] },
      { title: t('nodes:conditions.picker.and.sections.zones'), rows: [zonesRow] },
      { title: t('nodes:conditions.picker.and.sections.deviceTypes'), rows: deviceTypeRows },
      { title: t('nodes:conditions.picker.unassigned'), rows: [unassignedRow] },
    ];
    if (labelGroups.length > 0) {
      sections.push({ title: t('nodes:conditions.picker.and.sections.labels'), rows: [labelsRow] });
    }
    return sections;
  }, [t, labelGroups.length]);

  // The four rows shown when drilling into "Unassigned" — see
  // WhenTriggerDialog.tsx's identical helper.
  const unassignedOptionRows = useMemo((): NavRow[] => {
    const makeRow = (key: 'entities' | 'helpers' | 'devices' | 'services', scope: EntityScope): NavRow => ({
      key,
      label: t(`nodes:conditions.picker.unassignedOptions.${key}`),
      icon: getDomainIcon(key, Layers),
      color: getDomainColor(key),
      onDrill: () =>
        pushColumn(
          1,
          { kind: 'areaChildren', areaLabel: t(`nodes:conditions.picker.unassignedOptions.${key}`), scope },
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

  // Time/Sun surfaced a second time here in "By target" — real HA's own
  // dialog does the same (TIME_LOCATION_GROUPS), since neither has a
  // target/entity to scope by; picking one here commits immediately, same
  // as the "By type" copy above.
  const timeSunTargetRows = useMemo((): NavRow[] => {
    return [timeSunRow('time', Clock, 1), timeSunRow('sun', Sun, 1)].filter((row): row is NavRow => row !== null);
  }, []);

  const zonesColumnSections = useMemo(
    (): NavSection[] => [
      { title: t('nodes:conditions.picker.and.sections.zones'), rows: areaRows },
      { title: t('nodes:conditions.picker.and.sections.devices'), rows: deviceRows },
      { title: t('nodes:conditions.picker.and.sections.timeAndSun'), rows: timeSunTargetRows },
    ],
    [t, areaRows, deviceRows, timeSunTargetRows]
  );

  // ---- Column renderer ------------------------------------------------

  function renderColumn(column: NavColumn, index: number) {
    switch (column.kind) {
      case 'root':
        return <NavColumnSections key={index} sections={rootSections} selectedKey={selectedKeys[index]} />;

      case 'blocks':
        return <BlocksColumn key={index} blocks={CONDITION_BLOCKS} onSelectBlock={handleSelectBlock} />;

      case 'generic': {
        // Real HA's own condition Generic collection is Device + Entity —
        // see the NavColumn type's doc comment.
        const deviceRow: NavRow = {
          key: 'device',
          label: t('nodes:conditions.picker.and.genericDeviceLabel'),
          icon: getDomainIcon('devices', Layers),
          color: getDomainColor('devices'),
          onDrill: () => pushColumn(index, { kind: 'genericDevicePick' }, 'device'),
        };
        const entityRow: NavRow = {
          key: 'entity',
          label: t('nodes:conditions.picker.and.genericEntityLabel'),
          icon: getDomainIcon('entities', Layers),
          color: getDomainColor('entities'),
          onDrill: () => pushColumn(index, { kind: 'genericEntityPick' }, 'entity'),
        };
        return (
          <NavColumnList
            key={index}
            title={t('nodes:conditions.picker.and.genericRootLabel')}
            rows={[deviceRow, entityRow]}
            selectedKey={selectedKeys[index]}
          />
        );
      }

      case 'genericDevicePick': {
        const rows: NavRow[] = allDeviceGroups.map((group) => ({
          key: group.deviceId,
          label: group.name,
          icon: deviceGroupIcon(group),
          color: deviceGroupColor(group),
          onSelect: () => openDeviceResults(index, group),
        }));
        return (
          <NavColumnList
            key={index}
            title={t('nodes:conditions.picker.and.genericDeviceLabel')}
            rows={rows}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:conditions.picker.noResults')}
          />
        );
      }

      case 'genericEntityPick': {
        // Real HA's generic "Entity" group offers exactly two members: State
        // and Numeric State (a generic test on any single entity, filled in
        // afterward via the property panel) — reuses CONDITION_BLOCKS' own
        // 'state'/'numeric_state' entries rather than duplicating their data.
        const stateBlock = CONDITION_BLOCKS.find((block) => block.key === 'state');
        const numericStateBlock = CONDITION_BLOCKS.find((block) => block.key === 'numeric_state');
        const rows: NavRow[] = [];
        if (stateBlock) {
          rows.push({
            key: 'state',
            label: stateBlock.label,
            icon: getDomainIcon('entities', Layers),
            color: getDomainColor('entities'),
            onSelect: () => handleSelectBlock(stateBlock),
          });
        }
        if (numericStateBlock) {
          rows.push({
            key: 'numeric_state',
            label: numericStateBlock.label,
            icon: getDomainIcon('entities', Layers),
            color: getDomainColor('entities'),
            onSelect: () => handleSelectBlock(numericStateBlock),
          });
        }
        return (
          <NavColumnList
            key={index}
            title={t('nodes:conditions.picker.and.genericEntityLabel')}
            rows={rows}
            selectedKey={selectedKeys[index]}
          />
        );
      }

      case 'sunOptions':
        return (
          <BlocksColumn
            key={index}
            blocks={SUN_CONDITIONS}
            icon={Sun}
            color={getDomainColor('sun')}
            onSelectBlock={handleSelectBlock}
          />
        );

      case 'timeOptions':
        return (
          <ResultsColumn key={index} title={t('nodes:conditions.types.time')}>
            <ConditionTimeOptionsForm onCommit={handleSelectTimeOptions} />
          </ResultsColumn>
        );

      case 'unassignedOptions':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:conditions.picker.unassigned')}
            rows={unassignedOptionRows}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'areas':
        return (
          <NavColumnSections key={index} sections={zonesColumnSections} selectedKey={selectedKeys[index]} />
        );

      case 'labels':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:conditions.picker.and.sections.labels')}
            rows={labelRows}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:conditions.picker.noResults')}
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
        return <NavColumnList key={index} title={column.areaLabel} rows={rows} selectedKey={selectedKeys[index]} />;
      }

      case 'deviceChildren': {
        const rows: NavRow[] = column.group.entities.map((entity) => ({
          key: entity.entity_id,
          label: getEntityName(entity),
          icon: getDomainIcon(entity.entity_id.split('.')[0], Layers),
          color: getDomainColor(entity.entity_id.split('.')[0]),
          onSelect: () => openEntityResults(index, entity, column.group.deviceId),
        }));
        return <NavColumnList key={index} title={column.group.name} rows={rows} selectedKey={selectedKeys[index]} />;
      }

      case 'targetResults':
        return (
          <ResultsColumn key={index} title={column.scope.label}>
            <ConditionTargetResultsPanel
              selected={column.scope}
              entities={entities}
              onSelectEntityTarget={handleSelectEntityTarget}
              onSelectRecipe={(entityIds, recipe) =>
                entityIds.length > 1
                  ? pushColumn(index, { kind: 'scopeTargets', label: recipe.label, recipe, entityIds }, recipe.id)
                  : handleSelectRecipeConfigurable(index, entityIds, recipe)
              }
              onSelectDeviceCondition={handleSelectDeviceCondition}
            />
          </ResultsColumn>
        );

      case 'typeResults':
        return (
          <ResultsColumn key={index} title={column.category.label}>
            <ConditionTypeResultsPanel
              category={column.category}
              onSelectRecipe={(recipe) =>
                pushColumn(index, { kind: 'recipeEntities', category: column.category, recipe }, recipe.id)
              }
            />
          </ResultsColumn>
        );

      case 'recipeEntities': {
        const domainPrefix = `${column.category.entityDomain}.`;
        const rows: TargetPickerRow[] = entities
          .filter((e) => e.entity_id.startsWith(domainPrefix))
          .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
          .map((entity) => ({
            entityId: entity.entity_id,
            label: getEntityName(entity),
            icon: getDomainIcon(column.category.conditionPrefix, Layers),
            color: getDomainColor(column.category.conditionPrefix),
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
          <DialogTitle>{t('nodes:conditions.picker.and.title')}</DialogTitle>
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
            placeholder={t('nodes:conditions.picker.and.searchPlaceholder')}
            className="h-8 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex min-h-0 flex-1 divide-x overflow-x-auto">
          {searchResults ? (
            <>
              <NavColumnList
                title={t('nodes:conditions.picker.and.sections.zones')}
                rows={searchResults.map((entity) => ({
                  key: entity.entity_id,
                  label: getEntityName(entity),
                  onSelect: () => setSearchSelectedEntityId(entity.entity_id),
                }))}
                selectedKey={searchSelectedEntityId}
                emptyLabel={t('nodes:conditions.picker.noResults')}
              />
              {searchSelectedScope && (
                <ResultsColumn title={searchSelectedScope.label}>
                  <ConditionTargetResultsPanel
                    selected={searchSelectedScope}
                    entities={entities}
                    onSelectEntityTarget={handleSelectEntityTarget}
                    onSelectRecipe={handleSelectRecipe}
                    onSelectDeviceCondition={handleSelectDeviceCondition}
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

// Flat card list, no grouping needed — both CONDITION_BLOCKS and
// SUN_CONDITIONS (the "By type" > "Sun" category, see the NavColumn type's
// doc comment) are short, flat lists, unlike PlatformsColumn's
// TYPE_GROUPS-grouped ~20 platforms. `icon`/`color` default to the Blocks
// section's own styling; the Sun category passes its own so its cards read
// as sun-related rather than the generic Blocks purple.
function BlocksColumn({
  blocks,
  icon,
  color = getDomainColor('blocks'),
  onSelectBlock,
}: {
  blocks: ConditionBlock[];
  /** Fixed icon for every row — used by the Sun category (all rows are sun-related). Omit to let each row use its own icon via getConditionBlockIcon (the CONDITION_BLOCKS "Blocks" section, where and/or/not/state/... need to look distinct from each other). */
  icon?: LucideIcon;
  color?: ReturnType<typeof getDomainColor>;
  onSelectBlock: (block: ConditionBlock) => void;
}) {
  return (
    <ResizableColumn defaultWidth={384} minWidth={280} maxWidth={640}>
      <div className="flex h-full flex-col overflow-y-auto p-1.5">
        <div className="space-y-1.5">
          {blocks.map((block) => (
            <TriggerResultRow
              key={block.key}
              icon={icon ?? getConditionBlockIcon(block)}
              color={color}
              label={block.label}
              description={block.description}
              onSelect={() => onSelectBlock(block)}
            />
          ))}
        </div>
      </div>
    </ResizableColumn>
  );
}

function ConditionTypeResultsPanel({
  category,
  onSelectRecipe,
}: {
  category: EntityConditionCategory;
  onSelectRecipe: (recipe: ConditionRecipe) => void;
}) {
  const { t } = useTranslation(['nodes']);
  if (category.recipes.length === 0) {
    return <p className="p-2 text-center text-muted-foreground text-xs">{t('nodes:conditions.picker.noResults')}</p>;
  }
  return (
    <div className="space-y-1.5">
      {category.recipes.map((recipe) => (
        <TriggerResultRow
          key={recipe.id}
          icon={getDomainIcon(category.conditionPrefix, Layers)}
          color={getDomainColor(category.conditionPrefix)}
          label={recipe.label}
          description={recipe.description}
          onSelect={() => onSelectRecipe(recipe)}
        />
      ))}
    </div>
  );
}

/**
 * The AND-dialog equivalent of TriggerTargetPicker.tsx's TargetResultsPanel
 * — catalog recipe rows grouped by category heading, plus the same
 * singleEntityId "Entity > State" fallback trigger's version offers (here: a
 * generic legacy `state` condition on that one entity), and now also merges
 * in live `device_automation/condition/list` rows (device-specific
 * conditions some integrations define, e.g. ZHA/deCONZ) alongside the
 * client-side domain-recipe rows — the same way ThenActionDialog's
 * ThenTargetResultsPanel merges its own device_automation/action/list rows
 * in, see useDeviceAutomation.ts's DeviceCondition doc comment for why this
 * half was missing before.
 */
function ConditionTargetResultsPanel({
  selected,
  entities,
  onSelectEntityTarget,
  onSelectRecipe,
  onSelectDeviceCondition,
}: {
  selected: SelectedScope | null;
  entities: HassEntity[];
  onSelectEntityTarget: (entityId: string) => void;
  onSelectRecipe: (entityIds: string[], recipe: ConditionRecipe) => void;
  onSelectDeviceCondition: (condition: DeviceCondition) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const { getDeviceConditions } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { getDeviceNameById } = useHass();
  const [deviceConditions, setDeviceConditions] = useState<DeviceCondition[]>([]);
  const [loading, setLoading] = useState(false);

  const domainHeadingLabel = (domain: string): string =>
    t(`nodes:serviceDomains.${domain}`, {
      defaultValue: domain.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    });

  useEffect(() => {
    if (!selected || selected.deviceIds.length === 0) {
      setDeviceConditions([]);
      return;
    }
    let cancelled = false;
    setDeviceConditions([]);
    setLoading(true);
    // allSettled, not all — see ThenActionDialog's identical fix: a device
    // whose integration doesn't implement device_automation/condition/list
    // at all rejects (routine, not exceptional), and Promise.all would blank
    // out every other device's conditions too.
    Promise.allSettled(selected.deviceIds.map((id) => getDeviceConditions(id)))
      .then((results) => {
        if (cancelled) return;
        const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        const entityIds = new Set(selected.entityIds);
        const scoped = all.filter((c) => (c.entity_id ? entityIds.has(c.entity_id) : !selected.singleEntityId));
        setDeviceConditions(scoped);
      })
      .catch(() => {
        if (!cancelled) setDeviceConditions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, getDeviceConditions]);

  if (!selected) {
    return (
      <div className="flex h-full min-h-[140px] items-center justify-center text-center text-muted-foreground text-sm">
        {t('nodes:conditions.picker.selectTarget')}
      </div>
    );
  }

  const singleEntity = selected.singleEntityId
    ? entities.find((e) => e.entity_id === selected.singleEntityId)
    : undefined;
  const singleEntityLabel = singleEntity ? getEntityName(singleEntity) : selected.singleEntityId;
  const singleEntityIcon = getDomainIcon(selected.singleEntityId?.split('.')[0], Zap);
  const singleEntityColor = getDomainColor(selected.singleEntityId?.split('.')[0]);

  const recipesByHeading = new Map<string, Map<string, { recipes: ConditionRecipe[]; entityIds: string[] }>>();
  for (const entityId of selected.entityIds) {
    const entity = entities.find((e) => e.entity_id === entityId);
    const category = getEntityConditionRecipeGroup(entityId, entity);
    if (!category) continue;
    let byGroupKey = recipesByHeading.get(category.heading);
    if (!byGroupKey) {
      byGroupKey = new Map();
      recipesByHeading.set(category.heading, byGroupKey);
    }
    const existing = byGroupKey.get(category.groupKey);
    if (existing) {
      existing.entityIds.push(entityId);
    } else {
      byGroupKey.set(category.groupKey, { recipes: category.recipes, entityIds: [entityId] });
    }
  }

  const deviceConditionsByHeading = new Map<string, DeviceCondition[]>();
  for (const condition of deviceConditions) {
    const heading = domainHeadingLabel(condition.domain);
    const list = deviceConditionsByHeading.get(heading);
    if (list) list.push(condition);
    else deviceConditionsByHeading.set(heading, [condition]);
  }

  const allHeadings = new Set<string>([...recipesByHeading.keys(), ...deviceConditionsByHeading.keys()]);
  const sortedHeadings = Array.from(allHeadings).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      {loading && <p className="px-1.5 text-muted-foreground text-xs">{t('nodes:triggers.picker.loadingTriggers')}</p>}

      {!loading && sortedHeadings.length === 0 && !selected.singleEntityId && (
        <p className="px-1.5 text-muted-foreground text-xs">{t('nodes:conditions.picker.noResults')}</p>
      )}

      {sortedHeadings.map((heading) => {
        const recipeGroups = Array.from(recipesByHeading.get(heading)?.values() ?? []);
        return (
          <div key={heading}>
            <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">{heading}</h4>
            <div className="space-y-1.5">
              {recipeGroups.map(({ recipes, entityIds }) => {
                const domain = entityIds[0]?.split('.')[0];
                return recipes.map((recipe) => (
                  <TriggerResultRow
                    key={`${recipe.id}::${entityIds.join(',')}`}
                    icon={getDomainIcon(domain, Zap)}
                    color={getDomainColor(domain)}
                    label={recipe.label}
                    description={recipe.description}
                    chip={selected.label}
                    onSelect={() => onSelectRecipe(entityIds, recipe)}
                  />
                ));
              })}
              {(deviceConditionsByHeading.get(heading) ?? []).map((condition) => (
                <TriggerResultRow
                  key={`device::${buildCompositeValue(condition)}`}
                  icon={getDomainIcon(condition.entity_id?.split('.')[0] ?? condition.domain, Zap)}
                  color={getDomainColor(condition.entity_id?.split('.')[0] ?? condition.domain)}
                  label={getDeviceAutomationLabel(
                    'condition',
                    condition,
                    translations,
                    entities,
                    getDeviceNameById(condition.device_id)
                  )}
                  chip={getDeviceNameById(condition.device_id)}
                  onSelect={() => onSelectDeviceCondition(condition)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {selected.singleEntityId && (
        <div>
          <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">
            {t('nodes:conditions.picker.groups.entity')}
          </h4>
          <TriggerResultRow
            icon={singleEntityIcon}
            color={singleEntityColor}
            label={t('nodes:conditions.types.state')}
            chip={singleEntityLabel ?? null}
            onSelect={() => onSelectEntityTarget(selected.singleEntityId as string)}
          />
        </div>
      )}
    </div>
  );
}

const TIME_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Inline after/before/weekday picker for the "Time" condition — pushed as a
 * second column instead of committing immediately (see the NavColumn type's
 * doc comment), for the same reason a silent bare `{ condition: 'time' }` default leaves the node
 * looking configured when it tests nothing at all). All three fields are
 * optional — HA's own time condition allows any combination — so this form
 * can still be committed with nothing set, same as CONDITION_BLOCKS' own
 * default; picking a day or a bound here just saves the extra trip to the
 * property panel for the common case.
 */
function ConditionTimeOptionsForm({
  onCommit,
}: {
  onCommit: (after: string, before: string, weekdays: string[]) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [weekdays, setWeekdays] = useState<string[]>([]);

  const toggleWeekday = (day: string) =>
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  return (
    <div className="space-y-4 p-2">
      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs" htmlFor="condition-time-after">
          {t('nodes:conditionFields.time.after')}
        </label>
        {/* HA's own <ha-selector> time picker, not a bare native
            <input type="time"> — the native control's OS-level time-picker
            widget crashes inside the user's embedded WebView client (the Mac
            app) as soon as it's interacted with, reported directly ("go to
            time and try to enter the time, this crashes home assistant").
            Matches DynamicFieldRenderer.tsx's existing 'time'/'date' cases,
            which already avoid the raw native input for exactly this reason
            — this form was the one place in the app that still used it
            directly. `no_second: true` keeps the same HH:MM (no seconds)
            granularity the native input had. The plain Input stays only as
            the `fallback`, used solely if `ha-selector` isn't registered at
            all (standalone dev outside real HA) — never hit in a real HA
            install, so the crash-prone native input never renders there. */}
        <HaSelector
          selector={{ time: { no_second: true } }}
          value={after}
          onChange={(v) => setAfter(typeof v === 'string' ? v : '')}
          fallback={
            <Input id="condition-time-after" type="time" value={after} onChange={(e) => setAfter(e.target.value)} />
          }
        />
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs" htmlFor="condition-time-before">
          {t('nodes:conditionFields.time.before')}
        </label>
        <HaSelector
          selector={{ time: { no_second: true } }}
          value={before}
          onChange={(v) => setBefore(typeof v === 'string' ? v : '')}
          fallback={
            <Input id="condition-time-before" type="time" value={before} onChange={(e) => setBefore(e.target.value)} />
          }
        />
      </div>

      <div className="space-y-1.5">
        <span className="font-medium text-muted-foreground text-xs">{t('nodes:conditionFields.time.weekday')}</span>
        <div className="flex flex-wrap gap-1">
          {TIME_WEEKDAYS.map((day) => (
            <Button
              key={day}
              type="button"
              size="sm"
              variant={weekdays.includes(day) ? 'secondary' : 'outline'}
              onClick={() => toggleWeekday(day)}
            >
              {t(`nodes:conditionFields.time.weekdays.${day}`)}
            </Button>
          ))}
        </div>
      </div>

      <Button className="w-full" onClick={() => onCommit(after, before, weekdays)}>
        {t('nodes:conditionFields.time.addCondition')}
      </Button>
    </div>
  );
}

/**
 * Threshold/behavior/`for` configuration step for a purpose-specific recipe
 * whose condition has a real threshold (see handleSelectRecipeConfigurable)
 * — e.g. picking "Illuminance is value" now lands here instead of
 * committing a bare `{type: 'above', value: {number: 0}}` default straight
 * onto the canvas. The AND-dialog equivalent of WhenTriggerDialog.tsx's
 * RecipeConfigForm — reuses NativeConditionFields verbatim against a small
 * local draft, same as the property panel's own condition editor, so this
 * column is never a second, out-of-sync copy of that form. Local `data`
 * state is throwaway, matching ConditionTimeOptionsForm above.
 */
function RecipeConfigForm({
  recipe,
  draftData,
  onCommit,
}: {
  recipe: ConditionRecipe;
  draftData: Record<string, unknown>;
  onCommit: (data: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const [data, setData] = useState<Record<string, unknown>>(draftData);
  const handleChange = (key: string, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));
  // NativeConditionFields only ever reads `node.data` — a real FlowNode's
  // other fields (position, type, ...) don't exist yet for a still-being-
  // configured node, so a minimal stand-in is enough here.
  const draftNode = { id: 'draft', data } as unknown as FlowNode;

  return (
    <div className="flex flex-col gap-4 p-4">
      <NativeConditionFields node={draftNode} onChange={handleChange} conditionType={recipe.fields.condition} />
      <Button className="w-full" onClick={() => onCommit(data)}>
        {t('nodes:conditionFields.time.addCondition')}
      </Button>
    </div>
  );
}
