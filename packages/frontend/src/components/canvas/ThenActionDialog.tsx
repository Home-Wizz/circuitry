import {
  Blocks as BlocksIcon,
  Clock,
  Hourglass,
  Layers,
  ListTree,
  Play,
  Power,
  PowerOff,
  ScrollText,
  Tag,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  actionPickKey,
  PickerCurrentProvider,
  recipeChoiceKey,
} from '@/components/canvas/pickerCurrent';
import { type ConfigurableNodeType, NodeConfigColumn } from '@/components/canvas/NodeConfigColumn';
import {
  PickerColumnRow,
  MILLER_DIALOG_CONTENT_CLASS,
  usePickerSize,
  MultiTargetPanel,
  NavColumnList,
  NavColumnSections,
  type NavRow,
  type NavSection,
  PickerHeader,
  type PickerKind,
  PickerKindSwitch,
  ResizableColumn,
  ResultsColumn,
  renderStackedColumns,
} from '@/components/canvas/PickerColumns';
import { groupSections, headed } from '@/components/canvas/pickerRoot';
import {
  deviceEntityRows,
  devicesSections,
  homeSections,
  labelRow,
  type PlaceColumn,
  type PlaceLabels,
  placeRows,
  searchPlaceSections,
  entityTargetRows,
  routeScopePick,
  unassignedRows,
  usePickerPlaces,
} from '@/components/canvas/pickerPlaces';
import { DeviceAutomationColumn } from '@/components/canvas/DeviceAutomationColumn';
import { TriggerResultRow } from '@/components/panels/node-fields/TriggerResultRow';
import {
  type SelectedScope,
  scopeTypeEntityIds,
} from '@/components/panels/node-fields/TriggerTargetPicker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useHass } from '@/contexts/HassContext';
import { type DeviceAction, useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useIntegrationManifests } from '@/hooks/useIntegrationManifests';
import { usePickNeedsSettings } from '@/hooks/usePickGaps';
import { useTranslations } from '@/hooks/useTranslations';
import { ACTION_BLOCKS, type ActionBlock, getActionBlockIcon } from '@/lib/actionBlocks';
import { actionRecipeTakesEntities, buildActionNodeData } from '@/lib/actionNodeData';
import {
  type ActionRecipe,
  ENTITY_ACTION_CATEGORIES,
  type EntityActionCategory,
} from '@/lib/actionRecipes';
import type { CompoundBlockKey } from '@/lib/block-factories';
import { buildCompositeValue, getDeviceAutomationLabel } from '@/lib/deviceTriggerLabels';
import { getDomainColor } from '@/lib/domain-colors';
import { entityPickerIcon, getPickerIcon, StepIcon } from '@/components/nodes/StepIcon';
import { ACTION_NON_DEVICE_BLOCKS } from '@/lib/pickerLayout';
import { actionRecipeOffers, entitiesForService, serviceHasTarget } from '@/lib/serviceTargets';
import { prettify } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';
import { toneStyle } from '@/lib/node-colors';

/**
 * "Then…": the When picker's (WhenTriggerDialog.tsx) counterpart for
 * actions (service calls, lib/actionRecipes.ts) and the flow's blocks. Its
 * first column follows lib/pickerLayout.ts: Blocks, Home, Devices, Device
 * types, Non-device types (Fire manual event, Perform action) and Home
 * Assistant (Unassigned, Labels, Generic: Device; Integrations). A pick
 * that still needs something is set up under the column it was picked in;
 * a ready one is added at once.
 *
 * Two differences from When and And: `onCommit` takes a node type (a block
 * can be a delay, a wait, set_variables or a stop), and compound blocks
 * (If/Else, Choose, the Repeats, Parallel, Sequence) commit through
 * `onCommitCompound` as a whole subgraph (lib/block-factories.ts). A
 * device's results merge in its live `device_automation/action/list`
 * actions; there is no "this entity" fallback row as for conditions, since
 * every action needs a verb.
 */

type GroupKey = 'unassigned' | 'labels' | 'generic' | 'integrations';

type NavColumn =
  | { kind: 'root' }
  | { kind: 'search'; query: string }
  | PlaceColumn
  | { kind: 'devices' }
  | { kind: 'deviceTypes' }
  | { kind: 'nonDevice' }
  | { kind: 'group'; key: GroupKey; title: string }
  | { kind: 'genericDevicePick' }
  | { kind: 'blocks' }
  | { kind: 'waitForOptions' }
  // "Wait for a script to finish" / "for an automation to turn on/off": the
  // scripts or automations to wait for. `toState` is the row's (a script
  // turns off when it finishes).
  | {
      kind: 'waitEntityPick';
      domain: 'script' | 'automation';
      toState: 'on' | 'off';
      title: string;
    }
  // An integration's actions (Automation, Backup, ...): every service-only
  // domain the connected HA has, from `manifest/list` and `hass.services`.
  | { kind: 'integrationServices'; domain: string; label: string }
  | { kind: 'typeResults'; category: EntityActionCategory }
  | { kind: 'recipeEntities'; category: EntityActionCategory; recipe: ActionRecipe }
  | {
      kind: 'scopeTargets';
      label: string;
      recipe: ActionRecipe;
      entityIds: string[];
      /** "Anything in <room>" as the list's first line. */
      area?: { areaId: string; label: string };
    }
  // The pick's settings, when it still needs something (NodeConfigColumn):
  // an action's target and fields (Automation > Turn on asks which
  // automations), a delay's duration, a wait's template.
  | ({ kind: 'configure' } & StepDraft);

/** A pick's draft, waiting for its settings. */
type StepDraft = {
  pickKey: string;
  title: string;
  nodeType: ConfigurableNodeType;
  data: Record<string, unknown>;
};

/** The columns that set a pick up: shown under the column it was made in. */
const isSetup = (column: NavColumn) =>
  column.kind === 'recipeEntities' ||
  column.kind === 'scopeTargets' ||
  column.kind === 'waitEntityPick';

const INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }];
// For callers that already know it's a wait (NodePalette's Wait button, see
// useAddNodeDialogs.tsx's openThenForWait): straight to Blocks › Wait for….
const WAIT_FOR_INITIAL_COLUMNS: NavColumn[] = [
  { kind: 'root' },
  { kind: 'blocks' },
  { kind: 'waitForOptions' },
];
const WAIT_FOR_INITIAL_SELECTED_KEYS: (string | null)[] = ['blocks', 'wait_for'];

/** Blocks HA lists as types of their own (lib/pickerLayout.ts): not in Blocks. */
const BLOCKS_COLUMN = ACTION_BLOCKS.filter((b) => !ACTION_NON_DEVICE_BLOCKS.has(b.key));

interface ThenActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: HassEntity[];
  onCommit: (type: string, data: Record<string, unknown>) => void;
  onCommitCompound: (key: CompoundBlockKey) => void;
  /**
   * "Wait for a trigger" needs the When picker to build its trigger: see
   * useAddNodeDialogs.tsx's openWhenForWaitTrigger, which closes this
   * picker, opens that one, and wraps its result into a wait node.
   */
  onOpenWhenForWaitTrigger: () => void;
  /** Opens at Blocks › Wait for… (NodePalette's Wait button). */
  startAtWaitFor?: boolean;
  /** Offered when the picker may become the When or And picker instead. */
  onSwitchKind?: (kind: PickerKind) => void;
  /** The step a Replace… started from: the picker opens where it is, its
   * row marked "Current". */
  current?: { type: string; data: Record<string, unknown> };
  /** Text to open the picker's search with (the side panel's "Add a step…"). */
  initialQuery?: string;
}

export function ThenActionDialog({
  open,
  onOpenChange,
  entities: allEntities,
  onCommit,
  onCommitCompound,
  onOpenWhenForWaitTrigger,
  startAtWaitFor = false,
  onSwitchKind,
  current,
  initialQuery,
}: ThenActionDialogProps) {
  const { t } = useTranslation(['nodes']);
  const { getDeviceNameById, services } = useHass();
  const { manifests, fetchManifests } = useIntegrationManifests();
  const places = usePickerPlaces(allEntities);
  const { entities } = places;

  const initialColumns = startAtWaitFor ? WAIT_FOR_INITIAL_COLUMNS : INITIAL_COLUMNS;
  const initialSelectedKeys = startAtWaitFor ? WAIT_FOR_INITIAL_SELECTED_KEYS : [];

  const [columns, setColumns] = useState<NavColumn[]>(initialColumns);
  const [selectedKeys, setSelectedKeys] = useState<(string | null)[]>(initialSelectedKeys);
  const [search, setSearch] = useState('');

  // The step being replaced, by the key its row is marked with.
  const currentKey = current ? actionPickKey(current.type, current.data) : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening; the path is read from that render's catalog.
  useEffect(() => {
    if (open) {
      const path = currentKey
        ? pathToStep(currentKey)
        : startAtWaitFor
          ? { columns: WAIT_FOR_INITIAL_COLUMNS, selected: WAIT_FOR_INITIAL_SELECTED_KEYS }
          : null;
      setColumns(path?.columns ?? INITIAL_COLUMNS);
      setSelectedKeys(path?.selected ?? []);
      setSearch('');
      const query = initialQuery?.trim();
      if (query) {
        setSearch(initialQuery ?? '');
        setColumns([{ kind: 'search', query }]);
        setSelectedKeys([]);
      }
      // As HA's own dialog does: the manifests are fetched when it opens,
      // not when Integrations is opened (a no-op once loaded).
      fetchManifests();
    }
  }, [open, startAtWaitFor, fetchManifests]);

  const pushColumn = (atIndex: number, column: NavColumn, key: string) => {
    setColumns((prev) => [...prev.slice(0, atIndex + 1), column]);
    setSelectedKeys((prev) => [...prev.slice(0, atIndex), key]);
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    const query = value.trim();
    setColumns(query ? [{ kind: 'search', query }] : INITIAL_COLUMNS);
    setSelectedKeys([]);
  };

  const closeDialog = () => onOpenChange(false);

  // A single-step pick that's ready (lib/pickGaps.ts) is added at once, its
  // optional settings at HA's defaults; one that still needs something (an
  // action's target or required fields, an event name, a wait's template)
  // is set up first, with the property panel's own editors. Compound blocks
  // (if/else, choose, loops, parallel, sequence) add their whole structure.
  const commitDraft = (nodeType: ConfigurableNodeType, data: Record<string, unknown>) => {
    onCommit(nodeType, data);
    closeDialog();
  };
  const pickNeedsSettings = usePickNeedsSettings();
  const pickerSize = usePickerSize();
  const configure = (atIndex: number, draft: StepDraft) =>
    pickNeedsSettings(draft.nodeType, draft.data)
      ? pushColumn(atIndex, { kind: 'configure', ...draft }, draft.pickKey)
      : commitDraft(draft.nodeType, draft.data);

  const selectBlock = (block: ActionBlock, atIndex: number) => {
    if (block.commit.kind === 'drill') {
      pushColumn(atIndex, { kind: 'waitForOptions' }, block.key);
      return;
    }
    if (block.commit.kind === 'compound') {
      onCommitCompound(block.commit.compoundKey);
      closeDialog();
      return;
    }
    configure(atIndex, {
      pickKey: `block:${block.key}`,
      title: t(`nodes:blocks.${block.key}.label`),
      nodeType: block.commit.type,
      data: block.commit.data,
    });
  };
  const recipeDraft = (entityIds: string[], recipe: ActionRecipe, areaId?: string): StepDraft => ({
    pickKey: areaId
      ? `recipe:${recipe.id}:area:${areaId}`
      : `recipe:${recipe.id}:${entityIds.join(',')}`,
    title: recipe.label,
    nodeType: 'action',
    data: buildActionNodeData({ kind: 'recipe', entityIds, recipe, areaId }),
  });
  /** An action picked from a list of types: its entities first, when it acts on some. */
  const selectTypeRecipe = (
    atIndex: number,
    category: EntityActionCategory,
    recipe: ActionRecipe
  ) =>
    actionRecipeTakesEntities(recipe)
      ? pushColumn(
          atIndex,
          { kind: 'recipeEntities', category, recipe },
          recipeChoiceKey(recipe.id, [])
        )
      : configure(atIndex, recipeDraft([], recipe));
  // A device's own action (ZHA/deCONZ remote "press" commands, "identify",
  // IR-blaster commands, ...), fetched live from device_automation/action/list.
  const deviceActionDraft = (action: DeviceAction): StepDraft => ({
    pickKey: `device:${action.device_id}:${buildCompositeValue(action)}`,
    title: getDeviceNameById(action.device_id) || prettify(action.type),
    nodeType: 'action',
    data: buildActionNodeData({ kind: 'deviceAction', action }),
  });
  // "Wait for a script to finish" / "for an automation to turn on/off": a
  // state trigger on the picked entities, in a wait node.
  const waitEntitiesDraft = (
    title: string,
    entityIds: string[],
    toState: 'on' | 'off'
  ): StepDraft => ({
    pickKey: `wait:${toState}:${entityIds.join(',')}`,
    title,
    nodeType: 'wait',
    data: {
      wait_for_trigger: [{ trigger: 'state', entity_id: entityIds, to: toState }],
      timeout: '00:01:00',
    },
  });
  // An integration's action (Automation > Turn on): set up with the target
  // and fields HA describes for the service.
  const integrationServiceDraft = (domain: string, service: string, label: string): StepDraft => ({
    pickKey: `service:${domain}.${service}`,
    title: label,
    nodeType: 'action',
    data: { service: `${domain}.${service}`, target: {}, data: {} },
  });
  // "Perform action": any action, picked by name in its settings.
  const performActionDraft = (): StepDraft => ({
    pickKey: 'perform',
    title: t('nodes:picker.rows.performAction'),
    nodeType: 'action',
    data: { service: '', target: {}, data: {} },
  });

  const placeLabels: PlaceLabels = {
    home: t('nodes:picker.sections.home'),
    otherAreas: t('nodes:picker.groups.otherAreas'),
    unassignedOption: (key) => t(`nodes:picker.unassignedOptions.${key}`),
  };

  // The integrations with actions that aren't an entity domain the catalog
  // covers or a helper (those are under Device types and Unassigned, as HA
  // classifies them). One with no manifest yet is included, as HA does.
  const coveredActionDomains = useMemo(
    () => new Set(ENTITY_ACTION_CATEGORIES.map((c) => c.domain)),
    []
  );
  const integrationDomains = useMemo(
    () =>
      Object.keys(services)
        .filter((domain) => {
          if (coveredActionDomains.has(domain)) return false;
          const integrationType = manifests?.[domain]?.integration_type;
          return integrationType !== 'entity' && integrationType !== 'helper';
        })
        .sort((a, b) => a.localeCompare(b)),
    [services, manifests, coveredActionDomains]
  );
  const integrationLabel = (domain: string) => manifests?.[domain]?.name || prettify(domain);

  const multiTargetLabels = {
    addAllLabel: t('nodes:actions.picker.then.addAllTargets'),
    clearAllLabel: t('nodes:actions.picker.then.clearAllTargets'),
    noResultsLabel: t('nodes:actions.picker.noResults'),
    selectPromptLabel: t('nodes:actions.picker.then.selectTargetsPrompt'),
    commitLabel: (count: number) => t('nodes:actions.picker.then.addActionButton', { count }),
  };
  // "Add wait": the script/automation pick always makes a wait node.
  const waitTargetLabels = {
    ...multiTargetLabels,
    commitLabel: (count: number) => t('nodes:actions.waitFor.addWaitButton', { count }),
  };

  const configureCommitLabel = (nodeType: ConfigurableNodeType) =>
    t(
      nodeType === 'condition' ? 'nodes:pickerConfig.addCondition' : 'nodes:pickerConfig.addAction'
    );

  // ---- Rows -----------------------------------------------------------

  const blockRow = (block: ActionBlock, atIndex: number): NavRow => ({
    key: `block:${block.key}`,
    label: t(`nodes:blocks.${block.key}.label`),
    pickKey: `block:${block.key}`,
    icon: getActionBlockIcon(block),
    color: getDomainColor('blocks'),
    onSelect: () => selectBlock(block, atIndex),
  });
  const integrationRow = (domain: string, atIndex: number): NavRow => ({
    key: `int:${domain}`,
    label: integrationLabel(domain),
    icon: getPickerIcon(domain, Layers),
    color: getDomainColor(domain),
    onDrill: () =>
      pushColumn(
        atIndex,
        { kind: 'integrationServices', domain, label: integrationLabel(domain) },
        `int:${domain}`
      ),
  });

  /** The columns that show a step's row: Building blocks (Wait for…'s
   * choices for a wait or a delay), Non-device types, its domain under
   * Device types, or its integration's actions. */
  function pathToStep(key: string): { columns: NavColumn[]; selected: (string | null)[] } | null {
    const root = { kind: 'root' } as const;
    if (key.startsWith('wait:'))
      return { columns: WAIT_FOR_INITIAL_COLUMNS, selected: WAIT_FOR_INITIAL_SELECTED_KEYS };
    if (key === 'block:fire_event')
      return { columns: [root, { kind: 'nonDevice' }], selected: ['nonDevice'] };
    if (key.startsWith('block:'))
      return { columns: [root, { kind: 'blocks' }], selected: ['blocks'] };
    if (!key.startsWith('service:')) return null;
    const domain = key.slice('service:'.length).split('.')[0] ?? '';
    const category = ENTITY_ACTION_CATEGORIES.find((c) => c.domain === domain);
    if (category)
      return {
        columns: [root, { kind: 'deviceTypes' }, { kind: 'typeResults', category }],
        selected: ['deviceTypes', category.groupKey],
      };
    return {
      columns: [root, { kind: 'integrationServices', domain, label: integrationLabel(domain) }],
      selected: [`int:${domain}`],
    };
  }

  /** Device types: every entity domain with actions, as HA lists them all. */
  const deviceTypeRows = (atIndex: number): NavRow[] =>
    ENTITY_ACTION_CATEGORIES.map((category) => ({
      key: category.groupKey,
      label: category.label,
      icon: getPickerIcon(category.domain, Layers),
      color: getDomainColor(category.domain),
      onSelect: () => pushColumn(atIndex, { kind: 'typeResults', category }, category.groupKey),
    })).sort((a, b) => a.label.localeCompare(b.label));

  const nonDeviceRows = (atIndex: number): NavRow[] => [
    ...ACTION_BLOCKS.filter((b) => ACTION_NON_DEVICE_BLOCKS.has(b.key)).map((b) =>
      blockRow(b, atIndex)
    ),
    {
      key: 'perform',
      label: t('nodes:picker.rows.performAction'),
      icon: getPickerIcon('action', Zap),
      color: getDomainColor('integration'),
      onSelect: () => configure(atIndex, performActionDraft()),
    },
  ];

  const groupHead = (key: GroupKey) =>
    ({
      unassigned: {
        key,
        label: t('nodes:picker.rows.unassigned'),
        icon: getPickerIcon('unassigned', ListTree),
      },
      labels: {
        key,
        label: t('nodes:picker.groups.labels'),
        icon: getPickerIcon('tag', Tag),
        color: getDomainColor('labels'),
      },
      generic: {
        key,
        label: t('nodes:picker.groups.generic'),
        icon: getPickerIcon('generic', BlocksIcon),
      },
      integrations: {
        key,
        label: t('nodes:picker.groups.integrations'),
        icon: getPickerIcon('integration', Layers),
      },
    })[key];
  const groupRows = (key: GroupKey, atIndex: number): NavRow[] => {
    switch (key) {
      case 'unassigned':
        return unassignedRows(places, atIndex, pushColumn, placeLabels);
      case 'labels':
        return places.labelGroups.map((g) => labelRow(g, atIndex, pushColumn));
      case 'generic':
        return [
          {
            key: 'g:device',
            label: t('nodes:picker.groups.device'),
            icon: getPickerIcon('devices', Layers),
            color: getDomainColor('devices'),
            onDrill: () => pushColumn(atIndex, { kind: 'genericDevicePick' }, 'g:device'),
          },
        ];
      case 'integrations':
        return integrationDomains.map((d) => integrationRow(d, atIndex));
    }
  };
  const groupSectionsAt = (key: GroupKey) =>
    groupSections(groupHead(key), groupRows(key, 0), () =>
      pushColumn(0, { kind: 'group', key, title: groupHead(key).label }, key)
    );

  const rootSections = (): NavSection[] => [
    {
      rows: [
        {
          key: 'blocks',
          label: t('nodes:picker.rows.blocks'),
          icon: getPickerIcon('blocks', BlocksIcon),
          color: getDomainColor('blocks'),
          onDrill: () => pushColumn(0, { kind: 'blocks' }, 'blocks'),
        },
      ],
    },
    ...homeSections(places, 0, pushColumn, placeLabels),
    {
      separate: true,
      rows: [
        {
          key: 'devices',
          label: t('nodes:picker.rows.devices'),
          icon: getPickerIcon('devices', Layers),
          color: getDomainColor('devices'),
          onDrill: () => pushColumn(0, { kind: 'devices' }, 'devices'),
        },
        {
          key: 'deviceTypes',
          label: t('nodes:picker.rows.deviceTypes'),
          icon: getPickerIcon('device_types', Layers),
          onDrill: () => pushColumn(0, { kind: 'deviceTypes' }, 'deviceTypes'),
        },
        {
          key: 'nonDevice',
          label: t('nodes:picker.rows.nonDeviceTypes'),
          icon: Zap,
          onDrill: () => pushColumn(0, { kind: 'nonDevice' }, 'nonDevice'),
        },
      ],
    },
    ...headed(t('nodes:picker.sections.homeAssistant'), [
      ...groupSectionsAt('unassigned'),
      ...groupSectionsAt('labels'),
      ...groupSectionsAt('generic'),
      ...groupSectionsAt('integrations'),
    ]),
  ];

  /** Search: the action types whose names match, then the places. */
  const searchSections = (query: string): NavSection[] => {
    const q = query.toLowerCase();
    const matches = (...texts: (string | undefined)[]) =>
      texts.some((s) => s?.toLowerCase().includes(q));
    const typeRows: NavRow[] = [
      ...ACTION_BLOCKS.filter((b) =>
        matches(t(`nodes:blocks.${b.key}.label`), t(`nodes:blocks.${b.key}.description`))
      ).map((b) => blockRow(b, 0)),
      ...nonDeviceRows(0).filter((r) => r.key === 'perform' && matches(r.label)),
      ...ENTITY_ACTION_CATEGORIES.flatMap((category) =>
        category.recipes
          .filter((recipe) => matches(recipe.label, recipe.description, category.label))
          .map((recipe) => ({
            key: `recipe:${recipe.id}`,
            label: recipe.label,
            icon: getPickerIcon(category.domain, Layers),
            color: getDomainColor(category.domain),
            onSelect: () => selectTypeRecipe(0, category, recipe),
          }))
      ),
      ...integrationDomains.flatMap((domain) =>
        Object.entries(services[domain] ?? {})
          .filter(([service, definition]) =>
            matches(definition?.name, service, integrationLabel(domain))
          )
          .map(([service, definition]) => {
            const label = definition?.name || prettify(service);
            return {
              key: `service:${domain}.${service}`,
              label: `${integrationLabel(domain)}: ${label}`,
              icon: getPickerIcon(domain, Layers),
              color: getDomainColor(domain),
              onSelect: () => configure(0, integrationServiceDraft(domain, service, label)),
            };
          })
      ),
    ].slice(0, 60);
    return [
      { subtitle: t('nodes:picker.search.types'), rows: typeRows },
      ...searchPlaceSections(places, query, 0, pushColumn, {
        areas: t('nodes:picker.search.areas'),
        devices: t('nodes:picker.search.devices'),
        entities: t('nodes:picker.search.entities'),
      }),
    ];
  };

  // ---- Columns ----------------------------------------------------------

  function renderColumn(column: NavColumn, index: number) {
    switch (column.kind) {
      case 'root':
        return (
          <NavColumnSections
            key={index}
            sections={rootSections()}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'search':
        return (
          <NavColumnSections
            key={index}
            sections={searchSections(column.query)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'blocks':
        return (
          <BlocksColumn
            key={index}
            blocks={BLOCKS_COLUMN}
            onSelectBlock={(block) => selectBlock(block, index)}
          />
        );

      case 'devices':
        return (
          <NavColumnSections
            key={index}
            title={t('nodes:picker.rows.devices')}
            sections={devicesSections(places, index, pushColumn)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'deviceTypes':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:picker.rows.deviceTypes')}
            rows={deviceTypeRows(index)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'nonDevice':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:picker.rows.nonDeviceTypes')}
            rows={nonDeviceRows(index)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'group':
        return (
          <NavColumnList
            key={index}
            title={column.title}
            rows={groupRows(column.key, index)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'genericDevicePick':
        return (
          <DeviceAutomationColumn
            key={index}
            kind="action"
            places={places}
            atIndex={index}
            push={pushColumn}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:actions.picker.noResults')}
          />
        );

      case 'integrationServices': {
        const rows = Object.entries(services[column.domain] ?? {}).map(([service, definition]) => ({
          key: service,
          label: definition?.name || prettify(service),
          description: definition?.description || undefined,
        }));
        return (
          <ResultsColumn key={index} title={column.label} chosenKey={selectedKeys[index]}>
            <div className="space-y-1.5">
              {rows.length === 0 ? (
                <p className="p-2 text-center text-muted-foreground text-xs">
                  {t('nodes:actions.picker.noResults')}
                </p>
              ) : (
                rows.map((row) => (
                  <TriggerResultRow
                    key={row.key}
                    icon={getPickerIcon(column.domain, Layers)}
                    color={getDomainColor(column.domain)}
                    label={row.label}
                    description={row.description}
                    onSelect={() =>
                      configure(index, integrationServiceDraft(column.domain, row.key, row.label))
                    }
                    pickKey={`service:${column.domain}.${row.key}`}
                  />
                ))
              )}
            </div>
          </ResultsColumn>
        );
      }

      case 'waitForOptions':
        return (
          <WaitForOptionsColumn
            key={index}
            onSelectTemplate={() =>
              configure(index, {
                pickKey: 'wait:template',
                title: t('nodes:actions.waitFor.template'),
                nodeType: 'wait',
                data: { timeout: '00:01:00' },
              })
            }
            onSelectTrigger={onOpenWhenForWaitTrigger}
            onSelectDelay={() =>
              configure(index, {
                pickKey: 'delay',
                title: t('nodes:actions.waitFor.delay'),
                nodeType: 'delay',
                data: { delay: '00:00:05' },
              })
            }
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

      case 'waitEntityPick':
        return (
          <MultiTargetPanel
            key={index}
            title={column.title}
            rows={entityTargetRows(
              entities.filter((e) => e.entity_id.startsWith(`${column.domain}.`))
            )}
            labels={waitTargetLabels}
            onCommit={(entityIds) =>
              configure(index, waitEntitiesDraft(column.title, entityIds, column.toState))
            }
          />
        );

      case 'areaChildren':
        return (
          <NavColumnList
            key={index}
            title={column.areaLabel}
            rows={placeRows(column, index, pushColumn)}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:actions.picker.noResults')}
          />
        );

      case 'deviceChildren':
        return (
          <NavColumnList
            key={index}
            title={column.group.name}
            rows={deviceEntityRows(column.group, index, pushColumn)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'targetResults':
        return (
          <ResultsColumn key={index} title={column.scope.label} chosenKey={selectedKeys[index]}>
            <ThenTargetResultsPanel
              selected={column.scope}
              entities={entities}
              onSelectRecipe={(entityIds, recipe) =>
                routeScopePick(
                  column.scope,
                  entityIds,
                  serviceHasTarget(services, recipe.service),
                  {
                    pick: (ids) => configure(index, recipeDraft(ids, recipe)),
                    tick: (ids, areaId) =>
                      pushColumn(
                        index,
                        {
                          kind: 'scopeTargets',
                          label: recipe.label,
                          recipe,
                          entityIds: ids,
                          area: areaId ? { areaId, label: column.scope.label } : undefined,
                        },
                        recipeChoiceKey(recipe.id, entityIds)
                      ),
                  }
                )
              }
              onSelectDeviceAction={(action) => configure(index, deviceActionDraft(action))}
            />
          </ResultsColumn>
        );

      case 'typeResults':
        return (
          <ResultsColumn key={index} title={column.category.label} chosenKey={selectedKeys[index]}>
            <ThenTypeResultsPanel
              category={column.category}
              onSelectRecipe={(recipe) => selectTypeRecipe(index, column.category, recipe)}
            />
          </ResultsColumn>
        );

      case 'recipeEntities':
        // Only the entities that can do it (#130): HA refuses the call for
        // one without the features the action needs.
        return (
          <MultiTargetPanel
            key={index}
            title={column.recipe.label}
            rows={entityTargetRows(
              entitiesForService(
                services,
                column.recipe.service,
                entities.filter((e) => e.entity_id.startsWith(`${column.category.domain}.`))
              )
            )}
            labels={multiTargetLabels}
            onCommit={(entityIds) => configure(index, recipeDraft(entityIds, column.recipe))}
          />
        );

      case 'scopeTargets':
        return (
          <MultiTargetPanel
            key={index}
            title={column.label}
            rows={entityTargetRows(
              entitiesForService(
                services,
                column.recipe.service,
                column.entityIds
                  .map((id) => entities.find((e) => e.entity_id === id))
                  .filter((e): e is HassEntity => Boolean(e))
              )
            )}
            labels={multiTargetLabels}
            onCommit={(entityIds) => configure(index, recipeDraft(entityIds, column.recipe))}
            wholeArea={
              column.area && {
                label: t('nodes:picker.rows.anythingIn', { name: column.area.label }),
                onSelect: () =>
                  configure(
                    index,
                    recipeDraft(column.entityIds, column.recipe, column.area?.areaId)
                  ),
              }
            }
          />
        );

      case 'configure':
        return (
          <NodeConfigColumn
            key={`${index}:${column.pickKey}`}
            onBack={() => {
              setColumns((prev) => prev.slice(0, index));
              setSelectedKeys((prev) => prev.slice(0, index));
            }}
            title={column.title}
            nodeType={column.nodeType}
            initialData={column.data}
            entities={entities}
            commitLabel={configureCommitLabel(column.nodeType)}
            onCommit={(data) => commitDraft(column.nodeType, data)}
          />
        );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={MILLER_DIALOG_CONTENT_CLASS}
        // Its kind's colour, for the "Anything in" line's edge (index.css).
        style={{ ...toneStyle('action'), ...pickerSize.style }}
      >
        {pickerSize.grip}
        <PickerCurrentProvider value={currentKey}>
          <PickerHeader
            title={t('nodes:actions.picker.then.title')}
            icon={<StepIcon tone="action" icon={Play} size="md" />}
            search={search}
            onSearchChange={changeSearch}
            placeholder={t('nodes:picker.search.placeholder')}
            kindSwitch={onSwitchKind && <PickerKindSwitch current="then" onSwitch={onSwitchKind} />}
          />
          <PickerColumnRow columnCount={columns.length}>
            {renderStackedColumns(columns, isSetup, renderColumn)}
          </PickerColumnRow>
        </PickerCurrentProvider>
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
  const { t } = useTranslation(['nodes']);
  return (
    <ResizableColumn defaultWidth={384} minWidth={280} maxWidth={640}>
      <div className="flex h-full flex-col overflow-y-auto p-1.5">
        <div className="space-y-1.5">
          {blocks.map((block) => (
            <TriggerResultRow
              key={block.key}
              icon={getActionBlockIcon(block)}
              color={getDomainColor('blocks')}
              label={t(`nodes:blocks.${block.key}.label`)}
              description={t(`nodes:blocks.${block.key}.description`)}
              pickKey={`block:${block.key}`}
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
 * 'wait_for' entry doc comment). Template and Delay are picked like any
 * other block (the template opens the configure column, the delay is added
 * at its default); Trigger hands off to the WHEN dialog instead (see
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
            pickKey="wait:trigger"
          />
          <TriggerResultRow
            icon={Clock}
            color={color}
            label={t('nodes:actions.waitFor.template')}
            description={t('nodes:actions.waitFor.templateDescription')}
            onSelect={onSelectTemplate}
            pickKey="wait:template"
          />
          <TriggerResultRow
            icon={Hourglass}
            color={color}
            label={t('nodes:actions.waitFor.delay')}
            description={t('nodes:actions.waitFor.delayDescription')}
            onSelect={onSelectDelay}
            pickKey="wait:delay"
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
    return (
      <p className="p-2 text-center text-muted-foreground text-xs">
        {t('nodes:actions.picker.noResults')}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {category.recipes.map((recipe) => (
        <TriggerResultRow
          key={recipe.id}
          icon={getPickerIcon(category.domain, Layers)}
          color={getDomainColor(category.domain)}
          label={recipe.label}
          description={recipe.description}
          onSelect={() => onSelectRecipe(recipe)}
          pickKey={`service:${recipe.service}`}
          choiceKey={recipeChoiceKey(recipe.id, [])}
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
  const { getDeviceNameById, services } = useHass();
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
        const scoped = all.filter((a) =>
          a.entity_id ? entityIds.has(a.entity_id) : !selected.singleEntityId
        );
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

  // Each action with the selected entities that can do it (#130).
  const recipesByHeading = actionRecipeOffers(scopeTypeEntityIds(selected), entities, services);

  const deviceActionsByHeading = new Map<string, DeviceAction[]>();
  for (const action of deviceActions) {
    const heading = domainHeadingLabel(action.domain);
    const list = deviceActionsByHeading.get(heading);
    if (list) list.push(action);
    else deviceActionsByHeading.set(heading, [action]);
  }

  const allHeadings = new Set<string>([
    ...recipesByHeading.keys(),
    ...deviceActionsByHeading.keys(),
  ]);
  const sortedHeadings = Array.from(allHeadings).sort((a, b) => a.localeCompare(b));

  if (!loading && sortedHeadings.length === 0) {
    return (
      <p className="px-1.5 text-muted-foreground text-xs">{t('nodes:actions.picker.noResults')}</p>
    );
  }

  return (
    <div className="space-y-3">
      {sortedHeadings.map((heading) => {
        const offers = recipesByHeading.get(heading) ?? [];
        return (
          <div key={heading}>
            <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">{heading}</h4>
            <div className="space-y-1.5">
              {offers.map(({ recipe, entityIds }) => {
                const domain = entityIds[0]?.split('.')[0];
                return (
                  <TriggerResultRow
                    key={`${recipe.id}::${entityIds.join(',')}`}
                    icon={entityPickerIcon(
                      entities.find((e) => e.entity_id === entityIds[0]),
                      Zap
                    )}
                    color={getDomainColor(domain)}
                    label={recipe.label}
                    description={recipe.description}
                    chip={selected.label}
                    onSelect={() => onSelectRecipe(entityIds, recipe)}
                    choiceKey={recipeChoiceKey(recipe.id, entityIds)}
                  />
                );
              })}
              {(deviceActionsByHeading.get(heading) ?? []).map((action) => (
                <TriggerResultRow
                  key={`device::${buildCompositeValue(action)}`}
                  icon={getPickerIcon(action.entity_id?.split('.')[0] ?? action.domain, Zap)}
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
      {/* Below the list, so the rows don't move when HA's device
          automations arrive and the line goes. */}
      {loading && (
        <p className="px-1.5 text-muted-foreground text-xs">
          {t('nodes:triggers.picker.loadingTriggers')}
        </p>
      )}
    </div>
  );
}
