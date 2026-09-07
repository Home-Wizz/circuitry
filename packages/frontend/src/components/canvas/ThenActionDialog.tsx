import {
  Blocks,
  Clock,
  Hourglass,
  Home,
  Layers,
  type LucideIcon,
  Power,
  PowerOff,
  ScrollText,
  Search,
  Tag,
  Zap,
} from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useHass } from '@/contexts/HassContext';
import { type DeviceAction, useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useIntegrationManifests } from '@/hooks/useIntegrationManifests';
import { useStableEntityList } from '@/hooks/useStableEntityList';
import { useTranslations } from '@/hooks/useTranslations';
import { ACTION_BLOCKS, type ActionBlock, getActionBlockIcon } from '@/lib/actionBlocks';
import { buildActionNodeData } from '@/lib/actionNodeData';
import {
  type ActionRecipe,
  ENTITY_ACTION_CATEGORIES,
  type EntityActionCategory,
  getEntityActionCategory,
} from '@/lib/actionRecipes';
import type { CompoundBlockKey } from '@/lib/block-factories';
import { buildCompositeValue, getDeviceAutomationLabel } from '@/lib/deviceTriggerLabels';
import { getDomainColor } from '@/lib/domain-colors';
import { getDomainIcon } from '@/lib/domain-icons';
import { prettify } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';

/**
 * "+Add > Then" — the ThenActionDialog equivalent of AndConditionDialog.tsx/
 * WhenTriggerDialog.tsx, applying the same Miller-column architecture to
 * Home Assistant actions (service calls). See lib/actionRecipes.ts for the
 * catalog and lib/actionNodeData.ts for the selection -> node-data mapping.
 *
 * Two differences from When/And, both explained in lib/actionBlocks.ts's
 * doc comment:
 *
 *  1. **`onCommit` takes a node `type`, not just `data`.** When/And always
 *     create one fixed node type ('trigger'/'condition'); Then's Blocks
 *     section spans several real node types (delay/wait/set_variables/
 *     action-as-stop) depending which block was picked, so the type has to
 *     travel with the data.
 *  2. **A second `onCommitCompound` prop.** Some of the Blocks (If/Else,
 *     Choose, the count/while/until Repeat variants, Parallel) are compound
 *     blocks — a whole (nodes, edges) subgraph via `lib/block-factories.ts`'s
 *     `createCompoundBlock`, not a single node's `data` — so they commit
 *     through a completely different callback than everything else in this
 *     dialog, mirroring how `useAddNodeAtCenter` itself splits
 *     `addNodeAtCenter`/`addCompoundAtCenter`.
 *
 * Unlike AndConditionDialog's `ConditionTargetResultsPanel`, this dialog's
 * `ThenTargetResultsPanel` has **no singleEntityId fallback row** — there's
 * no generic "act on this entity" service the way `state` is a
 * generic "test this entity" condition/trigger; every action needs a real
 * verb, so an entity with no matching lib/actionRecipes.ts category (e.g. a
 * bare sensor/binary_sensor — read-only, nothing to act on) just shows no
 * results, full stop.
 */

type NavColumn =
  | { kind: 'root' }
  | { kind: 'blocks' }
  | { kind: 'areas' }
  | { kind: 'areaChildren'; areaLabel: string; scope: EntityScope }
  | { kind: 'deviceChildren'; group: DeviceGroup }
  | { kind: 'targetResults'; scope: SelectedScope }
  | { kind: 'typeResults'; category: EntityActionCategory }
  | { kind: 'recipeEntities'; category: EntityActionCategory; recipe: ActionRecipe }
  | { kind: 'scopeTargets'; label: string; recipe: ActionRecipe; entityIds: string[] }
  | { kind: 'labels' }
  | { kind: 'waitForOptions' }
  // Terminal column for the "Wait for a script to finish"/"Wait for an
  // automation to turn on/off" waitForOptions rows — a domain-filtered
  // entity multi-select (script.*/automation.*), same MultiTargetPanel
  // mechanism the By-type flow already uses for regular actions. `toState`
  // is baked in per-row rather than asked here (finish=off for scripts,
  // on/off for automations are two distinct rows) — see WaitForOptionsColumn.
  | { kind: 'waitEntityPick'; domain: 'script' | 'automation'; toState: 'on' | 'off'; title: string }
  | { kind: 'unassignedOptions' }
  | { kind: 'generic' }
  // "By type" > "Generic" only ever offers one thing in real HA — "Device"
  // (home-assistant/frontend's data/action.ts's ACTION_COLLECTIONS: the
  // generic collection's `groups` is just `{ device_id: {} }`) — a flat,
  // area-unscoped device list leading to the exact same device_action
  // results panel the Zones flow already uses.
  | { kind: 'genericDevicePick' }
  | { kind: 'integration' }
  // "By type" > "Integration" lists every service-only domain the connected
  // HA instance actually has installed (Activity, Automation, Backup, File,
  // Home Assistant Cloud, ...) — generated live from `manifest/list` +
  // `hass.services`, see useIntegrationManifests.ts and
  // integrationDomainRows below, rather than a hand-maintained guess.
  | { kind: 'integrationServices'; domain: string; label: string };

function deviceGroupIcon(group: DeviceGroup): LucideIcon {
  const domain = group.entities[0]?.entity_id.split('.')[0];
  return getDomainIcon(domain, Layers);
}
function deviceGroupColor(group: DeviceGroup) {
  const domain = group.entities[0]?.entity_id.split('.')[0];
  return getDomainColor(domain);
}

const INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }, { kind: 'areas' }];
const INITIAL_SELECTED_KEYS: (string | null)[] = ['zones'];
// Alternate starting point for callers that already know the user wants
// "Wait for..." specifically (NodePalette's own Wait node-type button) — see
// useAddNodeDialogs.tsx's openThenForWait. Skips straight to the 6-option
// waitForOptions column instead of making the user click Blocks first.
const WAIT_FOR_INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }, { kind: 'waitForOptions' }];
const WAIT_FOR_INITIAL_SELECTED_KEYS: (string | null)[] = ['blocks'];

interface ThenActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: HassEntity[];
  onCommit: (type: string, data: Record<string, unknown>) => void;
  onCommitCompound: (key: CompoundBlockKey) => void;
  /**
   * "Wait for..." block's "Trigger" option needs a whole separate dialog
   * (WhenTriggerDialog) to build the actual trigger, not just a bit of data
   * this dialog can build itself — see useAddNodeDialogs.tsx's
   * openWhenForWaitTrigger, which owns closing this dialog, opening that
   * one, and wrapping its result into a wait node's wait_for_trigger.
   */
  onOpenWhenForWaitTrigger: () => void;
  /**
   * When true, opens straight into the waitForOptions column instead of the
   * usual root+areas default — see useAddNodeDialogs.tsx's openThenForWait,
   * which sets this for NodePalette's dedicated Wait node-type button (that
   * button used to drop a blank, unconfigurable wait node directly; this is
   * the fix).
   */
  startAtWaitFor?: boolean;
}

export function ThenActionDialog({
  open,
  onOpenChange,
  entities: allEntities,
  onCommit,
  onCommitCompound,
  onOpenWhenForWaitTrigger,
  startAtWaitFor = false,
}: ThenActionDialogProps) {
  const { t } = useTranslation(['nodes']);
  const {
    areas,
    getAreaIdForEntity,
    getDeviceIdForEntity,
    getDeviceNameById,
    isAutomationRelevantEntity,
    labels,
    getLabelIdsForEntity,
    services,
  } = useHass();
  const { manifests, fetchManifests } = useIntegrationManifests();
  // Stabilized via useStableEntityList — see its own doc comment — so this
  // dialog's area/device/label grouping chain below doesn't recompute on
  // every live entity-state tick (was causing multi-second freezes while
  // browsing, confirmed from a user screen recording).
  const stableAllEntities = useStableEntityList(allEntities);
  const entities = useMemo(
    () => stableAllEntities.filter((e) => isAutomationRelevantEntity(e.entity_id)),
    [stableAllEntities, isAutomationRelevantEntity]
  );

  const initialColumns = startAtWaitFor ? WAIT_FOR_INITIAL_COLUMNS : INITIAL_COLUMNS;
  const initialSelectedKeys = startAtWaitFor ? WAIT_FOR_INITIAL_SELECTED_KEYS : INITIAL_SELECTED_KEYS;

  const [columns, setColumns] = useState<NavColumn[]>(initialColumns);
  const [selectedKeys, setSelectedKeys] = useState<(string | null)[]>(initialSelectedKeys);
  const [search, setSearch] = useState('');
  const [searchSelectedEntityId, setSearchSelectedEntityId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setColumns(startAtWaitFor ? WAIT_FOR_INITIAL_COLUMNS : INITIAL_COLUMNS);
      setSelectedKeys(startAtWaitFor ? WAIT_FOR_INITIAL_SELECTED_KEYS : INITIAL_SELECTED_KEYS);
      setSearch('');
      setSearchSelectedEntityId(null);
      // Mirrors real HA's own add-automation-element-dialog.ts's showDialog(),
      // which kicks off its manifest/list fetch as soon as the dialog opens
      // rather than waiting for the user to drill into "Integration" —
      // useIntegrationManifests.ts no-ops once already loaded.
      fetchManifests();
    }
  }, [open, startAtWaitFor, fetchManifests]);

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

  const closeDialog = () => onOpenChange(false);

  const handleSelectBlock = (block: ActionBlock, atIndex: number) => {
    if (block.commit.kind === 'drill') {
      pushColumn(atIndex, { kind: 'waitForOptions' }, block.key);
      return;
    }
    if (block.commit.kind === 'compound') {
      onCommitCompound(block.commit.compoundKey);
    } else {
      onCommit(block.commit.type, block.commit.data);
    }
    closeDialog();
  };
  const handleSelectRecipe = (entityIds: string[], recipe: ActionRecipe) => {
    onCommit('action', buildActionNodeData({ kind: 'recipe', entityIds, recipe }));
    closeDialog();
  };
  // Device-specific action (ZHA/deCONZ remote "press" commands, "identify",
  // IR-blaster commands, ...) fetched live from device_automation/action/list
  // — see useDeviceAutomation.ts's DeviceAction doc comment for why this is
  // needed alongside the domain-recipe rows above.
  const handleSelectDeviceAction = (action: DeviceAction) => {
    onCommit('action', buildActionNodeData({ kind: 'deviceAction', action }));
    closeDialog();
  };
  // "Wait for a script to finish"/"Wait for an automation to turn on/off" —
  // builds a plain state trigger scoped to the picked script/automation
  // entities and wraps it into a wait node, same wait_for_trigger shape
  // onOpenWhenForWaitTrigger's generic Trigger option produces, just without
  // needing the full When dialog since there's only one real choice to make
  // (which entity, and the to: state is already implied by which row was
  // picked).
  const handleSelectWaitEntities = (entityIds: string[], toState: 'on' | 'off') => {
    onCommit('wait', {
      wait_for_trigger: [{ trigger: 'state', entity_id: entityIds, to: toState }],
      timeout: '00:01:00',
    });
    closeDialog();
  };
  // A bare service call from the dynamically-generated "Integration" list
  // (e.g. Automation > "Trigger automation") — no recipe/entity-domain
  // catalog entry exists for these since they're generated live from
  // whatever integrations the connected instance has, so this commits the
  // service directly with empty target/data and leaves ActionFields.tsx's
  // existing live getServiceDefinition()-driven form (same one every other
  // action node already uses) to render the right fields once placed.
  const handleSelectIntegrationService = (domain: string, service: string) => {
    onCommit('action', { service: `${domain}.${service}`, target: {}, data: {} });
    closeDialog();
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

  // Domains already covered by their own "By type" entry (lib/actionRecipes.ts)
  // are never duplicated into the dynamic Integration list below.
  const coveredActionDomains = useMemo(
    () => new Set(ENTITY_ACTION_CATEGORIES.map((category) => category.domain)),
    []
  );

  // Live-generated "Integration" domain list — see useIntegrationManifests.ts's
  // doc comment for why this mirrors real HA's own manifest-driven
  // classification instead of a hardcoded catalog. A domain qualifies once
  // it (a) actually has services (`services` — HA wouldn't list it in "Add
  // action" otherwise either), (b) isn't already one of our own curated
  // domain categories, and (c) isn't an entity-domain or helper-type
  // integration (those belong in the regular "By type" list / Unassigned >
  // Helpers, matching real HA's `_classifyDomain`). A domain with no
  // manifest entry at all (custom/HACS integrations before HA has indexed
  // them) is still included — real HA's own algorithm falls through to
  // "integration" for anything that isn't explicitly helper/entity/system,
  // and an unclassified domain is closer to that than to a core entity
  // domain.
  const integrationDomains = useMemo(() => {
    return Object.keys(services)
      .filter((domain) => {
        if (coveredActionDomains.has(domain)) return false;
        const integrationType = manifests?.[domain]?.integration_type;
        return integrationType !== 'entity' && integrationType !== 'helper';
      })
      .sort((a, b) => a.localeCompare(b));
  }, [services, manifests, coveredActionDomains]);

  const multiTargetLabels = useMemo(
    () => ({
      addAllLabel: t('nodes:actions.picker.then.addAllTargets'),
      clearAllLabel: t('nodes:actions.picker.then.clearAllTargets'),
      noResultsLabel: t('nodes:actions.picker.noResults'),
      selectPromptLabel: t('nodes:actions.picker.then.selectTargetsPrompt'),
      commitLabel: (count: number) => t('nodes:actions.picker.then.addActionButton', { count }),
    }),
    [t]
  );

  // Same panel, different commit wording — "Add wait" reads correctly for
  // the script/automation entity pick, where "Add action" (multiTargetLabels
  // above) would be misleading: this always produces a wait node, never an
  // action node.
  const waitTargetLabels = useMemo(
    () => ({
      addAllLabel: t('nodes:actions.picker.then.addAllTargets'),
      clearAllLabel: t('nodes:actions.picker.then.clearAllTargets'),
      noResultsLabel: t('nodes:actions.picker.noResults'),
      selectPromptLabel: t('nodes:actions.picker.then.selectTargetsPrompt'),
      commitLabel: (count: number) => t('nodes:actions.waitFor.addWaitButton', { count }),
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
      label: t('nodes:actions.picker.then.blocksRootLabel'),
      icon: Blocks,
      color: getDomainColor('blocks'),
      onDrill: () => pushColumn(0, { kind: 'blocks' }, 'blocks'),
    };

    const zonesRow: NavRow = {
      key: 'zones',
      label: t('nodes:actions.picker.then.zonesRootLabel'),
      onDrill: () => pushColumn(0, { kind: 'areas' }, 'zones'),
    };

    // "Generic"/"Integration" — mirrors real HA's own `ACTION_COLLECTIONS`
    // generic/integration split (home-assistant/frontend's data/action.ts) —
    // see the NavColumn type's doc comment and integrationDomains above for
    // what each one actually contains. Listed as two more browsable entries
    // inside "By type" itself (not as separate root sections) — per direct
    // comparison against native HA's own "Add action" > "By type" tab, which
    // lists Generic and Integration alongside Light/Switch/Cover/... in that
    // same flat list.
    const genericRow: NavRow = {
      key: 'generic',
      label: t('nodes:actions.picker.then.genericRootLabel'),
      icon: getDomainIcon('generic', Layers),
      color: getDomainColor('generic'),
      onDrill: () => pushColumn(0, { kind: 'generic' }, 'generic'),
    };
    const integrationRow: NavRow = {
      key: 'integration',
      label: t('nodes:actions.picker.then.integrationRootLabel'),
      icon: getDomainIcon('integration', Layers),
      color: getDomainColor('integration'),
      onDrill: () => pushColumn(0, { kind: 'integration' }, 'integration'),
    };

    const deviceTypeRows: NavRow[] = [
      ...ENTITY_ACTION_CATEGORIES.map((category) => ({
        key: category.groupKey,
        label: category.label,
        icon: getDomainIcon(category.domain, Layers),
        color: getDomainColor(category.domain),
        onSelect: () => pushColumn(0, { kind: 'typeResults', category }, category.groupKey),
      })),
      genericRow,
      integrationRow,
    ].sort((a, b) => a.label.localeCompare(b.label));

    const unassignedRow: NavRow = {
      key: 'unassigned',
      label: t('nodes:actions.picker.unassigned'),
      onDrill: () => pushColumn(0, { kind: 'unassignedOptions' }, 'unassigned'),
    };

    const labelsRow: NavRow = {
      key: 'labels',
      label: t('nodes:actions.picker.then.labelsRootLabel'),
      icon: Tag,
      color: getDomainColor('labels'),
      onDrill: () => pushColumn(0, { kind: 'labels' }, 'labels'),
    };

    const sections: NavSection[] = [
      { title: t('nodes:actions.picker.then.sections.blocks'), rows: [blocksRow] },
      { title: t('nodes:actions.picker.then.sections.zones'), rows: [zonesRow] },
      { title: t('nodes:actions.picker.then.sections.deviceTypes'), rows: deviceTypeRows },
      { title: t('nodes:actions.picker.unassigned'), rows: [unassignedRow] },
    ];
    if (labelGroups.length > 0) {
      sections.push({ title: t('nodes:actions.picker.then.sections.labels'), rows: [labelsRow] });
    }
    return sections;
  }, [t, labelGroups.length]);

  // The four rows shown when drilling into "Unassigned" — see
  // WhenTriggerDialog.tsx's identical helper.
  const unassignedOptionRows = useMemo((): NavRow[] => {
    const makeRow = (key: 'entities' | 'helpers' | 'devices' | 'services', scope: EntityScope): NavRow => ({
      key,
      label: t(`nodes:actions.picker.unassignedOptions.${key}`),
      icon: getDomainIcon(key, Layers),
      color: getDomainColor(key),
      onDrill: () =>
        pushColumn(
          1,
          { kind: 'areaChildren', areaLabel: t(`nodes:actions.picker.unassignedOptions.${key}`), scope },
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
  const zonesColumnSections = useMemo(
    (): NavSection[] => [
      { title: t('nodes:actions.picker.then.sections.zones'), rows: areaRows },
      { title: t('nodes:actions.picker.then.sections.devices'), rows: deviceRows },
    ],
    [t, areaRows, deviceRows]
  );

  // ---- Column renderer ------------------------------------------------

  function renderColumn(column: NavColumn, index: number) {
    switch (column.kind) {
      case 'root':
        return <NavColumnSections key={index} sections={rootSections} selectedKey={selectedKeys[index]} />;

      case 'blocks':
        return (
          <BlocksColumn key={index} blocks={ACTION_BLOCKS} onSelectBlock={(block) => handleSelectBlock(block, index)} />
        );

      case 'generic': {
        // Real HA's own "Generic" collection is just this one row — see the
        // NavColumn type's doc comment.
        const deviceRow: NavRow = {
          key: 'device',
          label: t('nodes:actions.picker.then.genericDeviceLabel'),
          icon: getDomainIcon('devices', Layers),
          color: getDomainColor('devices'),
          onDrill: () => pushColumn(index, { kind: 'genericDevicePick' }, 'device'),
        };
        return (
          <NavColumnList
            key={index}
            title={t('nodes:actions.picker.then.genericRootLabel')}
            rows={[deviceRow]}
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
            title={t('nodes:actions.picker.then.genericDeviceLabel')}
            rows={rows}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:actions.picker.noResults')}
          />
        );
      }

      case 'integration': {
        const rows: NavRow[] = integrationDomains.map((domain) => {
          const manifest = manifests?.[domain];
          const label = manifest?.name || prettify(domain);
          return {
            key: domain,
            label,
            icon: getDomainIcon(domain, Layers),
            color: getDomainColor(domain),
            onDrill: () => pushColumn(index, { kind: 'integrationServices', domain, label }, domain),
          };
        });
        return (
          <NavColumnList
            key={index}
            title={t('nodes:actions.picker.then.integrationRootLabel')}
            rows={rows}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:actions.picker.noResults')}
          />
        );
      }

      case 'integrationServices': {
        const domainServices = services[column.domain] ?? {};
        const rows = Object.entries(domainServices).map(([service, definition]) => ({
          key: service,
          label: definition?.name || prettify(service),
          description: definition?.description || undefined,
        }));
        return (
          <ResizableColumn key={index} defaultWidth={384} minWidth={280} maxWidth={640}>
            <div className="flex h-full flex-col overflow-y-auto p-1.5">
              <div className="space-y-1.5">
                {rows.length === 0 ? (
                  <p className="p-2 text-center text-muted-foreground text-xs">
                    {t('nodes:actions.picker.noResults')}
                  </p>
                ) : (
                  rows.map((row) => (
                    <TriggerResultRow
                      key={row.key}
                      icon={getDomainIcon(column.domain, Layers)}
                      color={getDomainColor(column.domain)}
                      label={row.label}
                      description={row.description}
                      onSelect={() => handleSelectIntegrationService(column.domain, row.key)}
                    />
                  ))
                )}
              </div>
            </div>
          </ResizableColumn>
        );
      }

      case 'waitForOptions':
        return (
          <WaitForOptionsColumn
            key={index}
            onSelectTemplate={() => {
              onCommit('wait', { wait_template: '', timeout: '00:01:00' });
              closeDialog();
            }}
            onSelectTrigger={onOpenWhenForWaitTrigger}
            onSelectDelay={() => {
              onCommit('delay', { delay: '00:00:05' });
              closeDialog();
            }}
            onSelectAutomationOn={() =>
              pushColumn(
                index,
                {
                  kind: 'waitEntityPick',
                  domain: 'automation',
                  toState: 'on',
                  title: t('nodes:actions.waitFor.automationOn'),
                },
                'automation_on'
              )
            }
            onSelectAutomationOff={() =>
              pushColumn(
                index,
                {
                  kind: 'waitEntityPick',
                  domain: 'automation',
                  toState: 'off',
                  title: t('nodes:actions.waitFor.automationOff'),
                },
                'automation_off'
              )
            }
            onSelectScript={() =>
              pushColumn(
                index,
                {
                  kind: 'waitEntityPick',
                  domain: 'script',
                  toState: 'off',
                  title: t('nodes:actions.waitFor.script'),
                },
                'script'
              )
            }
          />
        );

      case 'waitEntityPick': {
        const domainPrefix = `${column.domain}.`;
        const rows: TargetPickerRow[] = entities
          .filter((e) => e.entity_id.startsWith(domainPrefix))
          .sort((a, b) => getEntityName(a).localeCompare(getEntityName(b)))
          .map((entity) => ({
            entityId: entity.entity_id,
            label: getEntityName(entity),
            icon: getDomainIcon(column.domain, Layers),
            color: getDomainColor(column.domain),
          }));
        return (
          <MultiTargetPanel
            key={index}
            title={column.title}
            rows={rows}
            labels={waitTargetLabels}
            onCommit={(entityIds) => handleSelectWaitEntities(entityIds, column.toState)}
          />
        );
      }

      case 'unassignedOptions':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:actions.picker.unassigned')}
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
            title={t('nodes:actions.picker.then.sections.labels')}
            rows={labelRows}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:actions.picker.noResults')}
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
            <ThenTargetResultsPanel
              selected={column.scope}
              entities={entities}
              onSelectRecipe={(entityIds, recipe) =>
                entityIds.length > 1
                  ? pushColumn(index, { kind: 'scopeTargets', label: recipe.label, recipe, entityIds }, recipe.id)
                  : handleSelectRecipe(entityIds, recipe)
              }
              onSelectDeviceAction={handleSelectDeviceAction}
            />
          </ResultsColumn>
        );

      case 'typeResults':
        return (
          <ResultsColumn key={index} title={column.category.label}>
            <ThenTypeResultsPanel
              category={column.category}
              onSelectRecipe={(recipe) =>
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
            onCommit={(entityIds) => handleSelectRecipe(entityIds, column.recipe)}
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
            onCommit={(entityIds) => handleSelectRecipe(entityIds, column.recipe)}
          />
        );
      }

      default:
        return null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={MILLER_DIALOG_CONTENT_CLASS}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('nodes:actions.picker.then.title')}</DialogTitle>
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
            placeholder={t('nodes:actions.picker.then.searchPlaceholder')}
            className="h-8 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex min-h-0 flex-1 divide-x overflow-x-auto">
          {searchResults ? (
            <>
              <NavColumnList
                title={t('nodes:actions.picker.then.sections.zones')}
                rows={searchResults.map((entity) => ({
                  key: entity.entity_id,
                  label: getEntityName(entity),
                  onSelect: () => setSearchSelectedEntityId(entity.entity_id),
                }))}
                selectedKey={searchSelectedEntityId}
                emptyLabel={t('nodes:actions.picker.noResults')}
              />
              {searchSelectedEntityId &&
                (() => {
                  const entity = entities.find((e) => e.entity_id === searchSelectedEntityId);
                  const scope: SelectedScope = {
                    key: `entity::${searchSelectedEntityId}`,
                    label: entity ? getEntityName(entity) : searchSelectedEntityId,
                    deviceIds: [],
                    entityIds: [searchSelectedEntityId],
                    singleEntityId: searchSelectedEntityId,
                  };
                  return (
                    <ResultsColumn title={scope.label}>
                      <ThenTargetResultsPanel
                        selected={scope}
                        entities={entities}
                        onSelectRecipe={handleSelectRecipe}
                        onSelectDeviceAction={handleSelectDeviceAction}
                      />
                    </ResultsColumn>
                  );
                })()}
            </>
          ) : (
            columns.map((column, index) => renderColumn(column, index))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The Blocks root section's flat card list (ACTION_BLOCKS). The
// 'generic'/'integration' NavColumn cases don't use this anymore — they're
// live-generated device/domain lists now, see the NavColumn type's doc
// comment and actionBlocks.ts's note on why the old hardcoded catalogs were
// removed.
function BlocksColumn({
  blocks,
  onSelectBlock,
}: {
  blocks: ActionBlock[];
  onSelectBlock: (block: ActionBlock) => void;
}) {
  return (
    <ResizableColumn defaultWidth={384} minWidth={280} maxWidth={640}>
      <div className="flex h-full flex-col overflow-y-auto p-1.5">
        <div className="space-y-1.5">
          {blocks.map((block) => (
            <TriggerResultRow
              key={block.key}
              icon={getActionBlockIcon(block)}
              color={getDomainColor('blocks')}
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

/**
 * The "Wait for..." block's second column — template / trigger / time to
 * pass / automation on / automation off / script finish, consolidated here
 * instead of six separate top-level Blocks cards (see actionBlocks.ts's
 * 'wait_for' entry doc comment). Template and Delay commit immediately, same
 * as any other block; Trigger hands off to the WHEN dialog instead (see
 * onOpenWhenForWaitTrigger on ThenActionDialogProps); the automation/script
 * rows push a further column to pick which entity (see ThenActionDialog's
 * 'waitEntityPick' column).
 *
 * Automation "on"/"off" reflect what those words genuinely mean for an
 * automation entity in HA — enabled/disabled, not currently-running — since
 * HA has no built-in signal for "an automation finished running" at all (an
 * automation's state is never "currently executing"; only script entities
 * have that on/off-means-running semantic, which is why "Script" below
 * commits to: 'off' — a script actually does turn off when it finishes).
 */
function WaitForOptionsColumn({
  onSelectTemplate,
  onSelectTrigger,
  onSelectDelay,
  onSelectAutomationOn,
  onSelectAutomationOff,
  onSelectScript,
}: {
  onSelectTemplate: () => void;
  onSelectTrigger: () => void;
  onSelectDelay: () => void;
  onSelectAutomationOn: () => void;
  onSelectAutomationOff: () => void;
  onSelectScript: () => void;
}) {
  const { t } = useTranslation(['nodes']);
  const color = getDomainColor('blocks');
  return (
    <ResizableColumn defaultWidth={384} minWidth={280} maxWidth={640}>
      <div className="flex h-full flex-col overflow-y-auto p-1.5">
        <div className="space-y-1.5">
          <TriggerResultRow
            icon={Zap}
            color={color}
            label={t('nodes:actions.waitFor.trigger')}
            description={t('nodes:actions.waitFor.triggerDescription')}
            onSelect={onSelectTrigger}
          />
          <TriggerResultRow
            icon={Clock}
            color={color}
            label={t('nodes:actions.waitFor.template')}
            description={t('nodes:actions.waitFor.templateDescription')}
            onSelect={onSelectTemplate}
          />
          <TriggerResultRow
            icon={Hourglass}
            color={color}
            label={t('nodes:actions.waitFor.delay')}
            description={t('nodes:actions.waitFor.delayDescription')}
            onSelect={onSelectDelay}
          />
          <TriggerResultRow
            icon={Power}
            color={color}
            label={t('nodes:actions.waitFor.automationOn')}
            description={t('nodes:actions.waitFor.automationOnDescription')}
            onSelect={onSelectAutomationOn}
          />
          <TriggerResultRow
            icon={PowerOff}
            color={color}
            label={t('nodes:actions.waitFor.automationOff')}
            description={t('nodes:actions.waitFor.automationOffDescription')}
            onSelect={onSelectAutomationOff}
          />
          <TriggerResultRow
            icon={ScrollText}
            color={color}
            label={t('nodes:actions.waitFor.script')}
            description={t('nodes:actions.waitFor.scriptDescription')}
            onSelect={onSelectScript}
          />
        </div>
      </div>
    </ResizableColumn>
  );
}

function ThenTypeResultsPanel({
  category,
  onSelectRecipe,
}: {
  category: EntityActionCategory;
  onSelectRecipe: (recipe: ActionRecipe) => void;
}) {
  const { t } = useTranslation(['nodes']);
  if (category.recipes.length === 0) {
    return <p className="p-2 text-center text-muted-foreground text-xs">{t('nodes:actions.picker.noResults')}</p>;
  }
  return (
    <div className="space-y-1.5">
      {category.recipes.map((recipe) => (
        <TriggerResultRow
          key={recipe.id}
          icon={getDomainIcon(category.domain, Layers)}
          color={getDomainColor(category.domain)}
          label={recipe.label}
          description={recipe.description}
          onSelect={() => onSelectRecipe(recipe)}
        />
      ))}
    </div>
  );
}

/**
 * See this file's doc comment for why there's no singleEntityId fallback row
 * here, unlike TargetResultsPanel/ConditionTargetResultsPanel — but it does
 * merge in live `device_automation/action/list` rows (device-specific
 * actions like ZHA/deCONZ remote "press" commands, "identify", IR-blaster
 * commands, ...) alongside the client-side domain-recipe rows, the same way
 * TargetResultsPanel (trigger) merges its own device_automation/trigger/list
 * rows in — see useDeviceAutomation.ts's DeviceAction doc comment for why
 * this half was missing before.
 */
function ThenTargetResultsPanel({
  selected,
  entities,
  onSelectRecipe,
  onSelectDeviceAction,
}: {
  selected: SelectedScope | null;
  entities: HassEntity[];
  onSelectRecipe: (entityIds: string[], recipe: ActionRecipe) => void;
  onSelectDeviceAction: (action: DeviceAction) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const { getDeviceActions } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { getDeviceNameById } = useHass();
  const [deviceActions, setDeviceActions] = useState<DeviceAction[]>([]);
  const [loading, setLoading] = useState(false);

  const domainHeadingLabel = (domain: string): string =>
    t(`nodes:serviceDomains.${domain}`, {
      defaultValue: domain.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    });

  useEffect(() => {
    if (!selected || selected.deviceIds.length === 0) {
      setDeviceActions([]);
      return;
    }
    let cancelled = false;
    setDeviceActions([]);
    setLoading(true);
    // allSettled, not all — see TriggerTargetPicker.tsx's TargetResultsPanel
    // for the identical fix and why: getDeviceActions rejects for any device
    // whose integration doesn't implement device_automation/action/list at
    // all (routine, not exceptional), and Promise.all would let that one
    // rejection blank out every other device's actions too — an area/room
    // with several devices showed "No results found" entirely if even one
    // of its devices didn't support device actions, even though its other
    // devices had real ones.
    Promise.allSettled(selected.deviceIds.map((id) => getDeviceActions(id)))
      .then((results) => {
        if (cancelled) return;
        const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        // Same entity-scoping rule as TargetResultsPanel's deviceTriggers:
        // entity-tagged actions are kept when they belong to one of the
        // entities in scope; raw device-level actions with no entity_id are
        // only shown for whole-device/area selections.
        const entityIds = new Set(selected.entityIds);
        const scoped = all.filter((a) => (a.entity_id ? entityIds.has(a.entity_id) : !selected.singleEntityId));
        setDeviceActions(scoped);
      })
      .catch(() => {
        if (!cancelled) setDeviceActions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, getDeviceActions]);

  if (!selected) {
    return (
      <div className="flex h-full min-h-[140px] items-center justify-center text-center text-muted-foreground text-sm">
        {t('nodes:triggers.picker.selectTarget')}
      </div>
    );
  }

  const recipesByHeading = new Map<string, Map<string, { recipes: ActionRecipe[]; entityIds: string[] }>>();
  for (const entityId of selected.entityIds) {
    const category = getEntityActionCategory(entityId);
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

  const deviceActionsByHeading = new Map<string, DeviceAction[]>();
  for (const action of deviceActions) {
    const heading = domainHeadingLabel(action.domain);
    const list = deviceActionsByHeading.get(heading);
    if (list) list.push(action);
    else deviceActionsByHeading.set(heading, [action]);
  }

  const allHeadings = new Set<string>([...recipesByHeading.keys(), ...deviceActionsByHeading.keys()]);
  const sortedHeadings = Array.from(allHeadings).sort((a, b) => a.localeCompare(b));

  if (!loading && sortedHeadings.length === 0) {
    return <p className="px-1.5 text-muted-foreground text-xs">{t('nodes:actions.picker.noResults')}</p>;
  }

  return (
    <div className="space-y-3">
      {loading && <p className="px-1.5 text-muted-foreground text-xs">{t('nodes:triggers.picker.loadingTriggers')}</p>}

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
              {(deviceActionsByHeading.get(heading) ?? []).map((action) => (
                <TriggerResultRow
                  key={`device::${buildCompositeValue(action)}`}
                  icon={getDomainIcon(action.entity_id?.split('.')[0] ?? action.domain, Zap)}
                  color={getDomainColor(action.entity_id?.split('.')[0] ?? action.domain)}
                  label={getDeviceAutomationLabel(
                    'action',
                    action,
                    translations,
                    entities,
                    getDeviceNameById(action.device_id)
                  )}
                  chip={getDeviceNameById(action.device_id)}
                  onSelect={() => onSelectDeviceAction(action)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
