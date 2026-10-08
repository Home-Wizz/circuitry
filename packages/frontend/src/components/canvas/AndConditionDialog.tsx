import {
  Blocks as BlocksIcon,
  Clock,
  Layers,
  ListTree,
  type LucideIcon,
  Moon,
  Signpost,
  Sun,
  Tag,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  conditionPickKey,
  PickerCurrentProvider,
  recipeChoiceKey,
} from '@/components/canvas/pickerCurrent';
import { searchTypeKey, uniqueSearchTypes } from '@/components/canvas/searchTypes';
import { NodeConfigColumn } from '@/components/canvas/NodeConfigColumn';
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
  scopeSecondaryEntityIds,
  scopeTypeEntityIds,
} from '@/components/panels/node-fields/TriggerTargetPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useHass } from '@/contexts/HassContext';
import { HaSelector } from '@/ha';
import { type DeviceCondition, useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useConditionCatalog, useHaOffers } from '@/hooks/useHaCatalog';
import { usePickNeedsSettings } from '@/hooks/usePickGaps';
import { useTranslations } from '@/hooks/useTranslations';
import {
  buildConditionNodeData,
  conditionRecipeTakesArea,
  conditionRecipeTakesEntities,
} from '@/lib/conditionNodeData';
import { groupRecipesByHeading } from '@/lib/recipeRows';
import {
  CONDITION_BLOCKS,
  type ConditionBlock,
  type ConditionRecipe,
  type EntityConditionCategory,
  getConditionBlockIcon,
  getEntityConditionRecipeGroup,
} from '@/lib/conditionRecipes';
import { buildCompositeValue, getDeviceAutomationLabel } from '@/lib/deviceTriggerLabels';
import { getDomainColor } from '@/lib/domain-colors';
import { entityPickerIcon, getPickerIcon, StepIcon } from '@/components/nodes/StepIcon';
import { useNativeDescriptions } from '@/hooks/useNativeDescriptions';
import { categoryEntityDomains } from '@/lib/haCatalog';
import {
  entityRecipeGroups,
  entitiesForType,
  secondaryEntityCategories,
} from '@/lib/nativeTargets';
import {
  CONDITION_GENERIC_BLOCKS,
  CONDITION_GROUPED_BLOCKS,
  CONDITION_LOGIC_BLOCKS,
  CONDITION_NON_DEVICE_BLOCKS,
  isIntegrationCategory,
  TIME_CATEGORY_DOMAINS,
} from '@/lib/pickerLayout';
import { prettify } from '@/lib/utils';
import { entityName } from '@/lib/entityNames';
import type { HassEntity } from '@/types/hass';
import { toneStyle } from '@/lib/node-colors';

/**
 * "And…": the When picker's (WhenTriggerDialog.tsx) counterpart for Home
 * Assistant's conditions -- the purpose-specific ones (`condition:
 * light.is_on`, lib/conditionRecipes.ts) and the classic blocks. Its first
 * column follows lib/pickerLayout.ts: Blocks (And, Or, Not), Home, Devices,
 * Device types, Non-device types (Time, Sun, Template, Triggered by) and
 * Home Assistant (Unassigned, Labels, Generic: Device, State, Numeric
 * state; Integrations). A device's results merge in its live
 * `device_automation/condition/list` conditions (ConditionTargetResultsPanel).
 * A pick that still needs something is set up under the column it was
 * picked in; a ready one is added at once.
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
  // Non-device types › Time: the Time condition (its after/before/weekday
  // form) and the calendar's and schedule's conditions.
  | { kind: 'timeGroup' }
  // The sun's and the moon's conditions: no target (the sun and the moon are
  // singletons), picked like blocks. The Sun's list also has the classic
  // Sun condition.
  | { kind: 'singletonOptions'; key: 'sun' | 'moon' }
  // A category's conditions, with the classic blocks HA lists beside them
  // (the Zone condition with the zone conditions).
  | { kind: 'typeResults'; category: EntityConditionCategory; extraBlocks?: ConditionBlock[] }
  | { kind: 'recipeEntities'; category: EntityConditionCategory; recipe: ConditionRecipe }
  | {
      kind: 'scopeTargets';
      label: string;
      recipe: ConditionRecipe;
      entityIds: string[];
      /** "Anything in <room>" as the list's first line. */
      area?: { areaId: string; label: string };
    }
  /** A room's State row: its entities, to tick. */
  | { kind: 'stateTargets'; label: string; entityIds: string[] }
  // The Time condition's form: an after/before/weekday window is a decision
  // to make, not a "fill in later" default.
  | { kind: 'timeOptions' }
  // The pick's settings, when it still needs something (NodeConfigColumn).
  | ({ kind: 'configure' } & ConditionDraft);

/** A pick's draft, waiting for its settings. */
type ConditionDraft = { pickKey: string; title: string; data: Record<string, unknown> };

/** The columns that set a pick up: shown under the column it was made in. */
const isSetup = (column: NavColumn) =>
  column.kind === 'recipeEntities' ||
  column.kind === 'scopeTargets' ||
  column.kind === 'stateTargets' ||
  column.kind === 'timeOptions';

const INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }];

const blockByKey = (key: string): ConditionBlock | undefined =>
  CONDITION_BLOCKS.find((b) => b.key === key);

interface AndConditionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: HassEntity[];
  onCommit: (data: Record<string, unknown>) => void;
  /** Offered when the picker may become the When or Then picker instead. */
  onSwitchKind?: (kind: PickerKind) => void;
  /** The condition a Replace… started from: the picker opens where it is,
   * its row marked "Current". */
  current?: Record<string, unknown>;
  /** Text to open the picker's search with (the side panel's "Add a step…"). */
  initialQuery?: string;
}

export function AndConditionDialog({
  open,
  onOpenChange,
  entities: allEntities,
  onCommit,
  onSwitchKind,
  current,
  initialQuery,
}: AndConditionDialogProps) {
  const { t } = useTranslation(['nodes']);
  const { getDeviceNameById } = useHass();
  const places = usePickerPlaces(allEntities);
  const { entities } = places;

  const [columns, setColumns] = useState<NavColumn[]>(INITIAL_COLUMNS);
  const [selectedKeys, setSelectedKeys] = useState<(string | null)[]>([]);
  const [search, setSearch] = useState('');

  // The condition being replaced, by the key its row is marked with.
  const currentType = typeof current?.condition === 'string' ? current.condition : undefined;
  const currentKey = conditionPickKey(currentType);

  // Opened afresh each time; at the condition being replaced when there is one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening; the path is read from that render's catalog.
  useEffect(() => {
    if (open) {
      const path = currentType ? pathToCondition(currentType) : null;
      setColumns(path?.columns ?? INITIAL_COLUMNS);
      setSelectedKeys(path?.selected ?? []);
      setSearch('');
      const query = initialQuery?.trim();
      if (query) {
        setSearch(initialQuery ?? '');
        setColumns([{ kind: 'search', query }]);
        setSelectedKeys([]);
      }
    }
  }, [open]);

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

  const commitAndClose = (data: Record<string, unknown>) => {
    onCommit(data);
    onOpenChange(false);
  };

  // A pick that's ready (lib/pickGaps.ts) is added at once, its optional
  // settings at HA's defaults; one that still needs something (an entity's
  // state, a template, a zone, a threshold, a moon phase, ...) is set up
  // first, with the property panel's own editors.
  const pickNeedsSettings = usePickNeedsSettings();
  const pickerSize = usePickerSize();
  const configure = (atIndex: number, draft: ConditionDraft) =>
    pickNeedsSettings('condition', draft.data)
      ? pushColumn(atIndex, { kind: 'configure', ...draft }, draft.pickKey)
      : commitAndClose(draft.data);

  const blockDraft = (block: ConditionBlock): ConditionDraft => ({
    pickKey: `block:${block.key}`,
    title: block.label,
    data: buildConditionNodeData({ kind: 'block', block }),
  });
  /** A block picked: the Time condition's form, or the block itself. */
  const selectBlock = (block: ConditionBlock, atIndex: number) =>
    block.key === 'time'
      ? pushColumn(atIndex, { kind: 'timeOptions' }, 'block:time')
      : configure(atIndex, blockDraft(block));
  const entityTargetDraft = (entityIds: string[]): ConditionDraft => ({
    pickKey: `entity:${entityIds.join(',')}`,
    title: t('nodes:conditions.types.state'),
    data: buildConditionNodeData({ kind: 'entityTarget', entityIds }),
  });
  const recipeDraft = (
    entityIds: string[],
    recipe: ConditionRecipe,
    areaId?: string
  ): ConditionDraft => ({
    pickKey: areaId ? `recipe:${recipe.id}:area:${areaId}` : recipeChoiceKey(recipe.id, entityIds),
    title: recipe.label,
    data: buildConditionNodeData({ kind: 'recipe', entityIds, recipe, areaId }),
  });
  // A tick list's button says what comes next: "Next: settings" when the
  // pick still needs its Fill in column (pickNeedsSettings), else Add.
  const recipeTargetLabels = (recipe: ConditionRecipe, entityIds: string[]) =>
    pickNeedsSettings('condition', recipeDraft(entityIds, recipe).data)
      ? { ...multiTargetLabels, commitLabel: () => t('nodes:pickerConfig.nextSettings') }
      : multiTargetLabels;
  const selectRecipe = (
    atIndex: number,
    entityIds: string[],
    recipe: ConditionRecipe,
    areaId?: string
  ) => configure(atIndex, recipeDraft(entityIds, recipe, areaId));
  /** A condition picked from a list of types: its entities first, when it tests some. */
  const selectTypeRecipe = (
    atIndex: number,
    category: EntityConditionCategory,
    recipe: ConditionRecipe
  ) =>
    conditionRecipeTakesEntities(recipe)
      ? pushColumn(
          atIndex,
          { kind: 'recipeEntities', category, recipe },
          recipeChoiceKey(recipe.id, [])
        )
      : selectRecipe(atIndex, [], recipe);
  // A device's own condition (ZHA/deCONZ "is on"/"is off" checks and other
  // integration-defined ones), fetched live from device_automation/condition/list.
  const deviceConditionDraft = (condition: DeviceCondition): ConditionDraft => ({
    pickKey: `device:${condition.device_id}:${buildCompositeValue(condition)}`,
    title: getDeviceNameById(condition.device_id) || prettify(condition.type),
    data: buildConditionNodeData({ kind: 'deviceCondition', condition }),
  });
  // The Time form's window, built directly: it carries the picked fields on
  // top of the block's bare `{ condition: 'time' }`.
  const commitTimeOptions = (after: string, before: string, weekdays: string[]) =>
    commitAndClose({
      condition: 'time',
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      ...(weekdays.length > 0 ? { weekday: weekdays } : {}),
    });

  const placeLabels: PlaceLabels = {
    home: t('nodes:picker.sections.home'),
    otherAreas: t('nodes:picker.groups.otherAreas'),
    unassignedOption: (key) => t(`nodes:picker.unassignedOptions.${key}`),
  };

  const multiTargetLabels = {
    addAllLabel: t('nodes:conditions.picker.and.addAllTargets'),
    clearAllLabel: t('nodes:conditions.picker.and.clearAllTargets'),
    noResultsLabel: t('nodes:conditions.picker.noResults'),
    selectPromptLabel: t('nodes:conditions.picker.and.selectTargetsPrompt'),
    commitLabel: (count: number) => t('nodes:conditions.picker.and.addConditionButton', { count }),
  };

  // The catalog as the connected HA has it (hooks/useHaCatalog.ts), its
  // categories split: the calendar's and schedule's under Non-device types ›
  // Time, a new integration's under Integrations, the rest under Device types.
  const catalog = useConditionCatalog();
  const conditionDescriptions = useNativeDescriptions('condition');
  const timeCategories = catalog.categories.filter((c) =>
    TIME_CATEGORY_DOMAINS.has(c.conditionPrefix)
  );
  const integrationCategories = catalog.categories.filter((c) => isIntegrationCategory(c.groupKey));
  // Every category HA describes, as HA lists them (the calendar's and the
  // schedule's under Time too).
  const deviceCategories = catalog.categories.filter((c) => !isIntegrationCategory(c.groupKey));
  // ---- Rows -----------------------------------------------------------

  const blockRow = (block: ConditionBlock, atIndex: number, icon?: LucideIcon): NavRow => ({
    key: `block:${block.key}`,
    label: block.label,
    icon: icon ?? getConditionBlockIcon(block),
    color: getDomainColor(block.key),
    onSelect: () => selectBlock(block, atIndex),
    pickKey: conditionPickKey(block.data.condition),
  });
  const blockRows = (keys: readonly string[], atIndex: number): NavRow[] =>
    keys
      .map(blockByKey)
      .filter((b): b is ConditionBlock => Boolean(b))
      .map((b) => blockRow(b, atIndex));
  const categoryRow = (category: EntityConditionCategory, atIndex: number): NavRow => {
    return {
      key: category.groupKey,
      label: category.label,
      icon: getPickerIcon(category.conditionPrefix, Layers),
      color: getDomainColor(category.conditionPrefix),
      onSelect: () => pushColumn(atIndex, categoryColumn(category), category.groupKey),
    };
  };

  /** The column a category's row opens: its conditions (the Zone
   * condition beside the zone ones). */
  function categoryColumn(category: EntityConditionCategory): NavColumn {
    const zone =
      category.conditionPrefix === 'zone'
        ? blockByKey(CONDITION_GROUPED_BLOCKS.zone ?? '')
        : undefined;
    return { kind: 'typeResults', category, ...(zone ? { extraBlocks: [zone] } : {}) };
  }

  /** The columns that show a condition's row: its category under Device
   * types, Non-device types' Time or Sun, the moon's, or the first
   * column's own rows (And, Or, Not; State, Numeric state). */
  function pathToCondition(type: string): { columns: NavColumn[]; selected: string[] } | null {
    const root = { kind: 'root' } as const;
    const nonDevice = { kind: 'nonDevice' } as const;
    const dot = type.indexOf('.');
    const prefix = dot > 0 ? type.slice(0, dot) : type;
    if (type === 'time' || TIME_CATEGORY_DOMAINS.has(prefix))
      return { columns: [root, nonDevice, { kind: 'timeGroup' }], selected: ['nonDevice', 'time'] };
    if (prefix === 'sun')
      return {
        columns: [root, nonDevice, { kind: 'singletonOptions', key: 'sun' }],
        selected: ['nonDevice', 'sun'],
      };
    if (prefix === 'moon')
      return {
        columns: [root, { kind: 'deviceTypes' }, { kind: 'singletonOptions', key: 'moon' }],
        selected: ['deviceTypes', 'moon'],
      };
    if ((CONDITION_NON_DEVICE_BLOCKS as readonly string[]).includes(type))
      return { columns: [root, nonDevice], selected: ['nonDevice'] };
    const integration = integrationCategories.find((c) =>
      c.recipes.some((r) => r.fields.condition === type)
    );
    if (integration)
      return { columns: [root, categoryColumn(integration)], selected: [integration.groupKey] };
    const category = deviceCategories.find((c) => c.conditionPrefix === prefix);
    if (!category) return null;
    return {
      columns: [root, { kind: 'deviceTypes' }, categoryColumn(category)],
      selected: ['deviceTypes', category.groupKey],
    };
  }

  /** Device types: every category HA describes (and the moon's), A to Z,
   * as HA lists them. */
  const deviceTypeRows = (atIndex: number): NavRow[] => {
    const rows = deviceCategories.map((category) => categoryRow(category, atIndex));
    if (catalog.moon.length > 0) {
      rows.push({
        key: 'moon',
        label: t('nodes:picker.groups.moon'),
        icon: getPickerIcon('moon', Moon),
        color: getDomainColor('moon'),
        onSelect: () => pushColumn(atIndex, { kind: 'singletonOptions', key: 'moon' }, 'moon'),
      });
    }
    return rows.sort((x, y) => x.label.localeCompare(y.label));
  };

  const nonDeviceSections = (atIndex: number): NavSection[] => [
    {
      subtitle: t('nodes:picker.groups.timeAndSun'),
      rows: [
        {
          key: 'time',
          label: t('nodes:picker.groups.time'),
          icon: getPickerIcon('time', Clock),
          color: getDomainColor('time'),
          onDrill: () => pushColumn(atIndex, { kind: 'timeGroup' }, 'time'),
        },
        {
          key: 'sun',
          label: t('nodes:picker.groups.sun'),
          icon: getPickerIcon('sun', Sun),
          color: getDomainColor('sun'),
          onDrill: () => pushColumn(atIndex, { kind: 'singletonOptions', key: 'sun' }, 'sun'),
        },
      ],
    },
    { rows: blockRows(CONDITION_NON_DEVICE_BLOCKS, atIndex) },
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
          ...blockRows(CONDITION_GENERIC_BLOCKS, atIndex),
        ];
      case 'integrations':
        return integrationCategories.map((c) => categoryRow(c, atIndex));
    }
  };
  const groupSectionsAt = (key: GroupKey) =>
    groupSections(groupHead(key), groupRows(key, 0), () =>
      pushColumn(0, { kind: 'group', key, title: groupHead(key).label }, key)
    );

  const rootSections = (): NavSection[] => [
    { title: t('nodes:picker.sections.blocks'), rows: blockRows(CONDITION_LOGIC_BLOCKS, 0) },
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
          icon: getPickerIcon('non_device', Clock),
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

  /** Search: the condition types whose names match, then the places. */
  const searchSections = (query: string): NavSection[] => {
    const q = query.toLowerCase();
    const matches = (...texts: (string | undefined)[]) =>
      texts.some((s) => s?.toLowerCase().includes(q));
    const typeRows: NavRow[] = [
      ...CONDITION_BLOCKS.filter((b) => matches(b.label)).map((b) => blockRow(b, 0)),
      ...[...catalog.sun, ...catalog.moon]
        .filter((b) => matches(b.label))
        .map((b) => blockRow(b, 0)),
      ...uniqueSearchTypes(
        catalog.categories.flatMap((category) =>
          category.recipes
            .filter((recipe) => matches(recipe.label, recipe.description, category.label))
            .map((recipe) => ({
              key: searchTypeKey(recipe.fields.condition, category.groupKey, recipe.id),
              label: recipe.label,
              group: category.label,
              category,
              recipe,
            }))
        )
      ).map(({ category, recipe, shown }) => ({
        key: `recipe:${category.groupKey}:${recipe.id}`,
        label: shown,
        icon: getPickerIcon(category.conditionPrefix, Layers),
        color: getDomainColor(category.conditionPrefix),
        onSelect: () => selectTypeRecipe(0, category, recipe),
        pickKey: conditionPickKey(recipe.fields.condition),
      })),
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

      case 'devices':
        return (
          <NavColumnSections
            key={index}
            title={t('nodes:picker.rows.devices')}
            sections={devicesSections(places, index, pushColumn)}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'deviceTypes': {
        const rows = deviceTypeRows(index);
        return (
          <NavColumnList
            key={index}
            title={t('nodes:picker.rows.deviceTypes')}
            rows={rows}
            selectedKey={selectedKeys[index]}
          />
        );
      }

      case 'nonDevice':
        return (
          <NavColumnSections
            key={index}
            title={t('nodes:picker.rows.nonDeviceTypes')}
            sections={nonDeviceSections(index)}
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
            kind="condition"
            places={places}
            atIndex={index}
            push={pushColumn}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:conditions.picker.noResults')}
          />
        );

      case 'timeGroup':
        return (
          <NavColumnList
            key={index}
            title={t('nodes:picker.groups.time')}
            rows={[
              ...blockRows([CONDITION_GROUPED_BLOCKS.time ?? 'time'], index),
              ...timeCategories.map((c) => categoryRow(c, index)),
            ]}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'singletonOptions': {
        const classic =
          column.key === 'sun' ? blockByKey(CONDITION_GROUPED_BLOCKS.sun ?? 'sun') : undefined;
        return (
          <BlocksColumn
            key={index}
            blocks={
              column.key === 'sun' ? [...catalog.sun, ...(classic ? [classic] : [])] : catalog.moon
            }
            icon={column.key === 'sun' ? Sun : Moon}
            color={getDomainColor(column.key)}
            onSelectBlock={(block) => selectBlock(block, index)}
          />
        );
      }

      case 'timeOptions':
        return (
          <ResultsColumn
            key={index}
            title={t('nodes:conditions.types.time')}
            chosenKey={selectedKeys[index]}
          >
            <ConditionTimeOptionsForm onCommit={commitTimeOptions} />
          </ResultsColumn>
        );

      case 'areaChildren':
        return (
          <NavColumnList
            key={index}
            title={column.areaLabel}
            rows={placeRows(column, index, pushColumn)}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:conditions.picker.noResults')}
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
            <ConditionTargetResultsPanel
              selected={column.scope}
              // Every entity, config and diagnostic ones too: a room's battery
              // level is looked up here (#177).
              entities={allEntities}
              onSelectEntityTarget={(entityId) => configure(index, entityTargetDraft([entityId]))}
              onSelectStateTargets={(entityIds) =>
                pushColumn(
                  index,
                  { kind: 'stateTargets', label: t('nodes:conditions.types.state'), entityIds },
                  'state'
                )
              }
              onSelectRecipe={(entityIds, recipe) =>
                routeScopePick(column.scope, entityIds, conditionRecipeTakesArea(recipe), {
                  pick: (ids) => selectRecipe(index, ids, recipe),
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
                      recipeChoiceKey(recipe.id, ids)
                    ),
                })
              }
              onSelectDeviceCondition={(condition) =>
                configure(index, deviceConditionDraft(condition))
              }
            />
          </ResultsColumn>
        );

      case 'typeResults':
        return (
          <ResultsColumn key={index} title={column.category.label} chosenKey={selectedKeys[index]}>
            <ConditionTypeResultsPanel
              category={column.category}
              onSelectRecipe={(recipe) => selectTypeRecipe(index, column.category, recipe)}
            />
            {column.extraBlocks && column.extraBlocks.length > 0 && (
              <div className="mt-1.5 space-y-1.5">
                {column.extraBlocks.map((block) => (
                  <TriggerResultRow
                    key={block.key}
                    icon={getConditionBlockIcon(block)}
                    color={getDomainColor(block.key)}
                    label={block.label}
                    description={block.description}
                    onSelect={() => selectBlock(block, index)}
                    pickKey={conditionPickKey(block.data.condition)}
                  />
                ))}
              </div>
            )}
          </ResultsColumn>
        );

      case 'recipeEntities': {
        // The entities of the domains the category acts on (its own, or for
        // one discovered from HA's descriptions, its target's).
        // (#166: by the type's description, as HA keeps them.)
        const rows = entityTargetRows(
          entitiesForType(
            entities,
            'condition',
            column.recipe.fields.condition,
            conditionDescriptions[column.recipe.fields.condition],
            {
              domains: categoryEntityDomains(column.category, column.category.entityDomain),
              domain: column.category.entityDomain,
              deviceClass: column.category.deviceClass,
            }
          )
        );
        return (
          <MultiTargetPanel
            key={index}
            title={column.recipe.label}
            rows={rows}
            labels={recipeTargetLabels(
              column.recipe,
              rows.map((r) => r.entityId)
            )}
            onCommit={(entityIds) => selectRecipe(index, entityIds, column.recipe)}
          />
        );
      }

      case 'scopeTargets': {
        const rows = entityTargetRows(
          column.entityIds
            .map((id) => allEntities.find((e) => e.entity_id === id))
            .filter((e): e is HassEntity => Boolean(e))
        );
        return (
          <MultiTargetPanel
            key={index}
            title={column.label}
            rows={rows}
            labels={recipeTargetLabels(column.recipe, column.entityIds)}
            onCommit={(entityIds) => selectRecipe(index, entityIds, column.recipe)}
            wholeArea={
              column.area && {
                label: t('nodes:picker.rows.anythingIn', { name: column.area.label }),
                onSelect: () =>
                  selectRecipe(index, column.entityIds, column.recipe, column.area?.areaId),
              }
            }
          />
        );
      }

      case 'stateTargets':
        return (
          <MultiTargetPanel
            key={index}
            title={column.label}
            rows={entityTargetRows(
              column.entityIds
                .map((id) => entities.find((e) => e.entity_id === id))
                .filter((e): e is HassEntity => Boolean(e))
            )}
            labels={multiTargetLabels}
            onCommit={(entityIds) => configure(index, entityTargetDraft(entityIds))}
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
            nodeType="condition"
            initialData={column.data}
            entities={entities}
            commitLabel={t('nodes:pickerConfig.addCondition')}
            onCommit={commitAndClose}
          />
        );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={MILLER_DIALOG_CONTENT_CLASS}
        // Its kind's colour, for the "Anything in" line's edge (index.css).
        style={{ ...toneStyle('condition'), ...pickerSize.style }}
      >
        {pickerSize.grip}
        <PickerCurrentProvider value={currentKey}>
          <PickerHeader
            title={t('nodes:conditions.picker.and.title')}
            icon={<StepIcon tone="condition" icon={Signpost} size="md" />}
            search={search}
            onSearchChange={changeSearch}
            placeholder={t('nodes:picker.search.placeholder')}
            kindSwitch={onSwitchKind && <PickerKindSwitch current="and" onSwitch={onSwitchKind} />}
          />
          <PickerColumnRow columnCount={columns.length}>
            {renderStackedColumns(columns, isSetup, renderColumn)}
          </PickerColumnRow>
        </PickerCurrentProvider>
      </DialogContent>
    </Dialog>
  );
}

// Flat card list, no grouping needed — CONDITION_BLOCKS, SUN_CONDITIONS and
// MOON_CONDITIONS (the "By type" > "Sun"/"Moon" categories, see the
// NavColumn type's doc comment) are short, flat lists, unlike PlatformsColumn's
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
              pickKey={conditionPickKey(block.data.condition)}
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
    return (
      <p className="p-2 text-center text-muted-foreground text-xs">
        {t('nodes:conditions.picker.noResults')}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {category.recipes.map((recipe) => (
        <TriggerResultRow
          key={recipe.id}
          icon={getPickerIcon(category.conditionPrefix, Layers)}
          color={getDomainColor(category.conditionPrefix)}
          label={recipe.label}
          description={recipe.description}
          onSelect={() => onSelectRecipe(recipe)}
          pickKey={conditionPickKey(recipe.fields.condition)}
          choiceKey={recipeChoiceKey(recipe.id, [])}
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
  onSelectStateTargets,
  onSelectRecipe,
  onSelectDeviceCondition,
}: {
  selected: SelectedScope | null;
  entities: HassEntity[];
  onSelectEntityTarget: (entityId: string) => void;
  /** A room's State row: its entities, to tick. */
  onSelectStateTargets?: (entityIds: string[]) => void;
  onSelectRecipe: (entityIds: string[], recipe: ConditionRecipe) => void;
  onSelectDeviceCondition: (condition: DeviceCondition) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const { getDeviceConditions } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { getDeviceNameById } = useHass();
  // Only the types the connected HA offers (hooks/useHaCatalog.ts).
  const haOffers = useHaOffers('condition');
  const conditionCategories = useConditionCatalog().categories;
  const conditionDescriptions = useNativeDescriptions('condition');
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
        const scoped = all.filter((c) =>
          c.entity_id ? entityIds.has(c.entity_id) : !selected.singleEntityId
        );
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
  const singleEntityLabel = selected.singleEntityId
    ? entityName(singleEntity, selected.singleEntityId)
    : undefined;
  const singleEntityIcon = entityPickerIcon(singleEntity, Zap);
  const singleEntityColor = getDomainColor(selected.singleEntityId?.split('.')[0]);

  // The types HA keeps each entity for (#166).
  // The types each entity offers; a config or diagnostic one (a battery
  // level) only the types that reach it (#177).
  const secondary = new Set(scopeSecondaryEntityIds(selected));
  const typeOf = (r: ConditionRecipe) => r.fields.condition;
  const recipesByHeading = groupRecipesByHeading(
    [...scopeTypeEntityIds(selected), ...secondary],
    (entityId) => {
      const entity = entities.find((e) => e.entity_id === entityId);
      const describe = (type: string) => conditionDescriptions[type];
      const groups = entityRecipeGroups(
        entity,
        getEntityConditionRecipeGroup(entityId, entity),
        conditionCategories,
        'condition',
        typeOf,
        haOffers,
        describe
      );
      return secondary.has(entityId) ? secondaryEntityCategories(groups, typeOf, describe) : groups;
    },
    undefined,
    typeOf
  );

  const deviceConditionsByHeading = new Map<string, DeviceCondition[]>();
  for (const condition of deviceConditions) {
    const heading = domainHeadingLabel(condition.domain);
    const list = deviceConditionsByHeading.get(heading);
    if (list) list.push(condition);
    else deviceConditionsByHeading.set(heading, [condition]);
  }

  const allHeadings = new Set<string>([
    ...recipesByHeading.keys(),
    ...deviceConditionsByHeading.keys(),
  ]);
  const sortedHeadings = Array.from(allHeadings).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      {!loading && sortedHeadings.length === 0 && !selected.singleEntityId && (
        <p className="px-1.5 text-muted-foreground text-xs">
          {t('nodes:conditions.picker.noResults')}
        </p>
      )}

      {sortedHeadings.map((heading) => {
        const recipeGroups = Array.from(recipesByHeading.get(heading)?.values() ?? []);
        return (
          <div key={heading}>
            <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">{heading}</h4>
            <div className="space-y-1.5">
              {recipeGroups.map(({ recipes, entityIds }) => {
                const domain = entityIds[0]?.split('.')[0];
                const icon = entityPickerIcon(
                  entities.find((e) => e.entity_id === entityIds[0]),
                  Zap
                );
                return recipes.map((recipe) => (
                  <TriggerResultRow
                    key={`${recipe.id}::${entityIds.join(',')}`}
                    icon={icon}
                    color={getDomainColor(domain)}
                    label={recipe.label}
                    description={recipe.description}
                    chip={selected.label}
                    onSelect={() => onSelectRecipe(entityIds, recipe)}
                    pickKey={conditionPickKey(recipe.fields.condition)}
                    choiceKey={recipeChoiceKey(recipe.id, entityIds)}
                  />
                ));
              })}
              {(deviceConditionsByHeading.get(heading) ?? []).map((condition) => (
                <TriggerResultRow
                  key={`device::${buildCompositeValue(condition)}`}
                  icon={getPickerIcon(condition.entity_id?.split('.')[0] ?? condition.domain, Zap)}
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
      {selected.room && onSelectStateTargets && selected.entityIds.length > 0 && (
        <div>
          <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">
            {t('nodes:conditions.picker.groups.entity')}
          </h4>
          <TriggerResultRow
            icon={Zap}
            label={t('nodes:conditions.types.state')}
            chip={selected.label}
            onSelect={() => onSelectStateTargets(selected.entityIds)}
          />
        </div>
      )}
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
            <Input
              id="condition-time-after"
              type="time"
              value={after}
              onChange={(e) => setAfter(e.target.value)}
            />
          }
        />
      </div>

      <div className="space-y-1.5">
        <label
          className="font-medium text-muted-foreground text-xs"
          htmlFor="condition-time-before"
        >
          {t('nodes:conditionFields.time.before')}
        </label>
        <HaSelector
          selector={{ time: { no_second: true } }}
          value={before}
          onChange={(v) => setBefore(typeof v === 'string' ? v : '')}
          fallback={
            <Input
              id="condition-time-before"
              type="time"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
            />
          }
        />
      </div>

      <div className="space-y-1.5">
        <span className="font-medium text-muted-foreground text-xs">
          {t('nodes:conditionFields.time.weekday')}
        </span>
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
