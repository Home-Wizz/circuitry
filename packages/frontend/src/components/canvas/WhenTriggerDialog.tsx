import { type TriggerPlatform, TriggerPlatformSchema } from '@circuitry/shared';
import { Blocks as BlocksIcon, Clock, Layers, ListTree, Radio, Sun, Tag, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  renderStackedColumns,
  ResultsColumn,
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
import { TargetResultsPanel } from '@/components/panels/node-fields/TriggerTargetPicker';
import { DeviceAutomationColumn } from '@/components/canvas/DeviceAutomationColumn';
import { TriggerResultRow } from '@/components/panels/node-fields/TriggerResultRow';
import {
  domainGroupLabel,
  PLATFORM_ICONS,
  sortedDomainGroups,
  TypeResultsPanel,
} from '@/components/panels/node-fields/TriggerTypePicker';
import {
  PickerCurrentProvider,
  recipeChoiceKey,
  triggerPickKey,
} from '@/components/canvas/pickerCurrent';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import { useTriggerCatalog } from '@/hooks/useHaCatalog';
import { usePickNeedsSettings } from '@/hooks/usePickGaps';
import { buildCompositeValue } from '@/lib/deviceTriggerLabels';
import { getDomainColor } from '@/lib/domain-colors';
import { getPickerIcon, StepIcon } from '@/components/nodes/StepIcon';
import { useNativeDescriptions } from '@/hooks/useNativeDescriptions';
import { categoryEntityDomains } from '@/lib/haCatalog';
import { entitiesForType } from '@/lib/nativeTargets';
import {
  isIntegrationCategory,
  SUN_CATEGORY_DOMAINS,
  TIME_CATEGORY_DOMAINS,
  TRIGGER_DOMAIN_PLATFORMS,
  TRIGGER_EVENT_PLATFORMS,
  TRIGGER_GENERIC_PLATFORMS,
  TRIGGER_INTEGRATION_PLATFORMS,
  TRIGGER_SUN_PLATFORMS,
  TRIGGER_TIME_PLATFORMS,
} from '@/lib/pickerLayout';
import {
  buildTriggerNodeData,
  triggerRecipeTakesArea,
  triggerRecipeTakesEntities,
} from '@/lib/triggerNodeData';
import {
  type EntityTriggerCategory,
  groupCategoriesByType,
  type TriggerRecipe,
  triggerTypeDomain,
} from '@/lib/triggerRecipes';
import type { HassEntity } from '@/types/hass';
import { toneStyle } from '@/lib/node-colors';

/**
 * "When…": a Miller-column modal for picking a trigger, opened from
 * NodePalette.tsx's Trigger button. Its first column follows
 * lib/pickerLayout.ts (Home, Devices, Device types, Non-device types, Home
 * Assistant); the places' rows and columns are pickerPlaces.ts's, shared
 * with the And and Then pickers. A pick builds a new node's data in one go
 * (lib/triggerNodeData.ts), and is added at once when it's ready; one that
 * still needs something -- its targets, then its settings -- is set up
 * under the column it was picked in (renderStackedColumns), never in a
 * further column. The caller creates the node (useAddNodeDialogs.tsx).
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
  | { kind: 'domainCategories'; domainLabel: string; categories: EntityTriggerCategory[] }
  // A group of trigger types listed together: classic platforms, then the
  // categories' own types (Time with the calendar and schedule; Sun; Zone).
  | {
      kind: 'typeGroup';
      title: string;
      platforms: TriggerPlatform[];
      categories: EntityTriggerCategory[];
    }
  | { kind: 'typeResults'; category: EntityTriggerCategory }
  | { kind: 'recipeEntities'; category: EntityTriggerCategory; recipe: TriggerRecipe }
  | {
      kind: 'scopeTargets';
      label: string;
      recipe: TriggerRecipe;
      entityIds: string[];
      /** "Anything in <room>" as the list's first line. */
      area?: { areaId: string; label: string };
    }
  /** A room's State row: its entities, to tick. */
  | { kind: 'stateTargets'; label: string; entityIds: string[] }
  | { kind: 'platformEntities'; platform: TriggerPlatform }
  // The pick's settings, when it still needs something (NodeConfigColumn).
  // `pickKey` names the pick, so a different pick starts from its own data.
  | { kind: 'configure'; pickKey: string; title: string; data: Record<string, unknown> };

/** A pick's draft, waiting for its settings. */
type TriggerDraft = { pickKey: string; title: string; data: Record<string, unknown> };

/** The columns that set a pick up: shown under the column it was made in. */
const isSetup = (column: NavColumn) =>
  column.kind === 'recipeEntities' ||
  column.kind === 'scopeTargets' ||
  column.kind === 'stateTargets' ||
  column.kind === 'platformEntities';

const INITIAL_COLUMNS: NavColumn[] = [{ kind: 'root' }];

interface WhenTriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: HassEntity[];
  onCommit: (data: Record<string, unknown>) => void;
  /** Offered when the picker may become the And or Then picker instead. */
  onSwitchKind?: (kind: PickerKind) => void;
  /** The trigger a Replace… started from: the picker opens where it is,
   * its row marked "Current". */
  current?: Record<string, unknown>;
  /** Text to open the picker's search with (the side panel's "Add a step…"). */
  initialQuery?: string;
}

export function WhenTriggerDialog({
  open,
  onOpenChange,
  entities: allEntities,
  onCommit,
  onSwitchKind,
  current,
  initialQuery,
}: WhenTriggerDialogProps) {
  const { t } = useTranslation(['nodes']);
  const places = usePickerPlaces(allEntities);
  const { entities } = places;

  const [columns, setColumns] = useState<NavColumn[]>(INITIAL_COLUMNS);
  const [selectedKeys, setSelectedKeys] = useState<(string | null)[]>([]);
  const [search, setSearch] = useState('');

  // The trigger being replaced, by the key its row is marked with.
  const currentType = typeof current?.trigger === 'string' ? current.trigger : undefined;
  const currentKey =
    currentType === undefined
      ? undefined
      : (triggerPickKey(currentType) ?? `platform:${currentType}`);

  // Opened afresh each time; at the trigger being replaced when there is one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on opening; the path is read from that render's catalog.
  useEffect(() => {
    if (open) {
      const path = currentType ? pathToTrigger(currentType) : null;
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
  // settings at HA's defaults; one that still needs something (a time, a
  // template, a threshold, ...) is set up first, with the property panel's
  // own editors. The platforms with an entity to pick (state,
  // numeric_state) ask for the entities first.
  const pickNeedsSettings = usePickNeedsSettings();
  const pickerSize = usePickerSize();
  const configure = (atIndex: number, draft: TriggerDraft) =>
    pickNeedsSettings('trigger', draft.data)
      ? pushColumn(atIndex, { kind: 'configure', ...draft }, draft.pickKey)
      : commitAndClose(draft.data);
  const platformLabel = (platform: TriggerPlatform) => t(`nodes:triggers.platforms.${platform}`);
  const platformDraft = (platform: TriggerPlatform, entityIds?: string[]): TriggerDraft => ({
    pickKey: `platform:${platform}`,
    title: platformLabel(platform),
    data: {
      ...buildTriggerNodeData({ kind: 'platform', platform }),
      ...(entityIds ? { entity_id: entityIds } : {}),
    },
  });
  const selectPlatform = (atIndex: number, platform: TriggerPlatform) => {
    if (platform === 'device') pushColumn(atIndex, { kind: 'genericDevicePick' }, 'g:device');
    else if (platform === 'state' || platform === 'numeric_state')
      pushColumn(atIndex, { kind: 'platformEntities', platform }, platform);
    else configure(atIndex, platformDraft(platform));
  };
  const entityTargetDraft = (entityIds: string[]): TriggerDraft => ({
    pickKey: `entity:${entityIds.join(',')}`,
    title: platformLabel('state'),
    data: buildTriggerNodeData({ kind: 'entityTarget', entityIds }),
  });
  const deviceTriggerDraft = (trigger: DeviceTrigger): TriggerDraft => ({
    pickKey: `device:${trigger.device_id}:${buildCompositeValue(trigger)}`,
    title: platformLabel('device'),
    data: buildTriggerNodeData({ kind: 'deviceTrigger', trigger }),
  });
  const recipeDraft = (
    entityIds: string[],
    recipe: TriggerRecipe,
    areaId?: string
  ): TriggerDraft => ({
    pickKey: areaId ? `recipe:${recipe.id}:area:${areaId}` : recipeChoiceKey(recipe.id, entityIds),
    title: recipe.label,
    data: buildTriggerNodeData({ kind: 'recipe', entityIds, recipe, areaId }),
  });
  // A tick list's button says what comes next: "Next: settings" when the
  // pick still needs its Fill in column (pickNeedsSettings), else Add.
  const recipeTargetLabels = (recipe: TriggerRecipe, entityIds: string[]) =>
    pickNeedsSettings('trigger', recipeDraft(entityIds, recipe).data)
      ? { ...multiTargetLabels, commitLabel: () => t('nodes:pickerConfig.nextSettings') }
      : multiTargetLabels;
  const selectRecipe = (
    atIndex: number,
    entityIds: string[],
    recipe: TriggerRecipe,
    areaId?: string
  ) => configure(atIndex, recipeDraft(entityIds, recipe, areaId));
  /** A type picked from a list of types: its entities first, when it acts on some. */
  const selectTypeRecipe = (
    atIndex: number,
    category: EntityTriggerCategory,
    recipe: TriggerRecipe
  ) =>
    triggerRecipeTakesEntities(recipe)
      ? pushColumn(
          atIndex,
          { kind: 'recipeEntities', category, recipe },
          recipeChoiceKey(recipe.id, [])
        )
      : selectRecipe(atIndex, [], recipe);

  const placeLabels: PlaceLabels = {
    home: t('nodes:picker.sections.home'),
    otherAreas: t('nodes:picker.groups.otherAreas'),
    unassignedOption: (key) => t(`nodes:picker.unassignedOptions.${key}`),
  };

  const multiTargetLabels = {
    addAllLabel: t('nodes:triggers.picker.when.addAllTargets'),
    clearAllLabel: t('nodes:triggers.picker.when.clearAllTargets'),
    noResultsLabel: t('nodes:triggers.picker.noResults'),
    selectPromptLabel: t('nodes:triggers.picker.when.selectTargetsPrompt'),
    commitLabel: (count: number) => t('nodes:triggers.picker.when.addTriggerButton', { count }),
  };

  // The catalog as the connected HA has it (hooks/useHaCatalog.ts), its
  // categories split: Time's and Sun's under Non-device types, a new
  // integration's under Integrations, the rest by domain under Device types.
  const catalog = useTriggerCatalog();
  const triggerDescriptions = useNativeDescriptions('trigger');
  const timeCategories = catalog.filter((c) => TIME_CATEGORY_DOMAINS.has(c.domain));
  const sunCategories = catalog.filter((c) => SUN_CATEGORY_DOMAINS.has(c.domain));
  const integrationCategories = catalog.filter((c) => isIntegrationCategory(c.groupKey));
  const categoriesByDomain = useMemo(
    () =>
      groupCategoriesByType(
        catalog.filter(
          // Every type HA describes (the calendar's and the schedule's under
          // Time too); the sun's are under Sun.
          (c) => !SUN_CATEGORY_DOMAINS.has(c.domain) && !isIntegrationCategory(c.groupKey)
        )
      ),
    [catalog]
  );

  // ---- Rows -----------------------------------------------------------

  const platformRow = (platform: TriggerPlatform, atIndex: number): NavRow => ({
    key: `platform:${platform}`,
    label: platformLabel(platform),
    icon: PLATFORM_ICONS[platform],
    color: getDomainColor(platform),
    onSelect: () => selectPlatform(atIndex, platform),
    pickKey: `platform:${platform}`,
  });
  const typeGroupColumn = (
    title: string,
    platforms: TriggerPlatform[],
    categories: EntityTriggerCategory[]
  ) => ({ kind: 'typeGroup', title, platforms, categories }) satisfies NavColumn;

  /** The column a Device types row opens: its platforms and types, its
   * one category's types, or its categories (Binary sensor › Cold). */
  function typeColumnFor(domain: string): NavColumn | null {
    const categories = categoriesByDomain.get(domain);
    if (!categories || categories.length === 0) return null;
    const label = domainGroupLabel(domain, categories);
    const platforms = TRIGGER_DOMAIN_PLATFORMS[domain] ?? [];
    if (platforms.length > 0) return typeGroupColumn(label, platforms, categories);
    if (categories.length === 1)
      return { kind: 'typeResults', category: categories[0] as EntityTriggerCategory };
    return { kind: 'domainCategories', domainLabel: label, categories };
  }

  /** The columns that show a trigger type's row: its group under Device
   * types, Non-device types' Time or Sun, or the first column's own rows. */
  function pathToTrigger(type: string): { columns: NavColumn[]; selected: string[] } | null {
    const nonDevice = (key: 'time' | 'sun') => ({
      columns: [
        { kind: 'root' } as const,
        { kind: 'nonDevice' } as const,
        key === 'time'
          ? typeGroupColumn(t('nodes:picker.groups.time'), TRIGGER_TIME_PLATFORMS, timeCategories)
          : typeGroupColumn(t('nodes:picker.groups.sun'), TRIGGER_SUN_PLATFORMS, sunCategories),
      ],
      selected: ['nonDevice', key],
    });
    const domain = triggerTypeDomain(type);
    if (domain === null) {
      const platform = TriggerPlatformSchema.safeParse(type);
      if (!platform.success) return null;
      if (TRIGGER_TIME_PLATFORMS.includes(platform.data)) return nonDevice('time');
      if (TRIGGER_SUN_PLATFORMS.includes(platform.data)) return nonDevice('sun');
      if (TRIGGER_EVENT_PLATFORMS.includes(platform.data))
        return { columns: [{ kind: 'root' }, { kind: 'nonDevice' }], selected: ['nonDevice'] };
      const domainOf = Object.entries(TRIGGER_DOMAIN_PLATFORMS).find(([, platforms]) =>
        platforms.includes(platform.data)
      )?.[0];
      if (domainOf) return pathToDeviceType(domainOf);
      return null; // Generic and Integrations: rows of the first column, or its group's.
    }
    if (TIME_CATEGORY_DOMAINS.has(domain)) return nonDevice('time');
    if (SUN_CATEGORY_DOMAINS.has(domain)) return nonDevice('sun');
    const integration = integrationCategories.find((c) =>
      c.recipes.some((r) => r.fields.trigger === type)
    );
    if (integration)
      return {
        columns: [{ kind: 'root' }, { kind: 'typeResults', category: integration }],
        selected: [integration.groupKey],
      };
    return pathToDeviceType(domain);
  }
  function pathToDeviceType(domain: string) {
    const column = typeColumnFor(domain);
    if (!column) return null;
    return {
      columns: [{ kind: 'root' } as const, { kind: 'deviceTypes' } as const, column],
      selected: ['deviceTypes', domain],
    };
  }

  /** Device types: every domain HA describes types for, as HA lists them. */
  const deviceTypeRows = (atIndex: number): NavRow[] => {
    const rows: NavRow[] = [];
    for (const domain of sortedDomainGroups(categoriesByDomain)) {
      const categories = categoriesByDomain.get(domain) ?? [];
      const label = domainGroupLabel(domain, categories);
      const platforms = TRIGGER_DOMAIN_PLATFORMS[domain] ?? [];
      const column = typeColumnFor(domain);
      const open = () => {
        if (column) pushColumn(atIndex, column, domain);
      };
      const row: NavRow = {
        key: domain,
        label,
        icon: getPickerIcon(domain, Layers),
        color: getDomainColor(domain),
        ...(platforms.length > 0 || categories.length > 1 ? { onDrill: open } : { onSelect: open }),
      };
      rows.push(row);
    }
    return rows;
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
          onDrill: () =>
            pushColumn(
              atIndex,
              typeGroupColumn(
                t('nodes:picker.groups.time'),
                TRIGGER_TIME_PLATFORMS,
                timeCategories
              ),
              'time'
            ),
        },
        {
          key: 'sun',
          label: t('nodes:picker.groups.sun'),
          icon: getPickerIcon('sun', Sun),
          color: getDomainColor('sun'),
          onDrill: () =>
            pushColumn(
              atIndex,
              typeGroupColumn(t('nodes:picker.groups.sun'), TRIGGER_SUN_PLATFORMS, sunCategories),
              'sun'
            ),
        },
      ],
    },
    {
      subtitle: t('nodes:picker.groups.eventsAndTemplates'),
      rows: TRIGGER_EVENT_PLATFORMS.map((p) => platformRow(p, atIndex)),
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
          ...TRIGGER_GENERIC_PLATFORMS.map((p) => platformRow(p, atIndex)),
        ];
      case 'integrations':
        return [
          ...TRIGGER_INTEGRATION_PLATFORMS.map((p) => platformRow(p, atIndex)),
          ...integrationCategories.map((category) => ({
            key: category.groupKey,
            label: category.label,
            icon: getPickerIcon(category.domain, Layers),
            color: getDomainColor(category.domain),
            onSelect: () =>
              pushColumn(atIndex, { kind: 'typeResults', category }, category.groupKey),
          })),
        ];
    }
  };
  const groupSectionsAt = (key: GroupKey) =>
    groupSections(groupHead(key), groupRows(key, 0), () =>
      pushColumn(0, { kind: 'group', key, title: groupHead(key).label }, key)
    );

  const rootSections = (): NavSection[] => [
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

  /** Search: the trigger types whose names match, then the places. */
  const searchSections = (query: string): NavSection[] => {
    const q = query.toLowerCase();
    const matches = (...texts: (string | undefined)[]) =>
      texts.some((s) => s?.toLowerCase().includes(q));
    const platforms = [
      ...TRIGGER_TIME_PLATFORMS,
      ...TRIGGER_SUN_PLATFORMS,
      ...TRIGGER_EVENT_PLATFORMS,
      ...TRIGGER_GENERIC_PLATFORMS,
      ...TRIGGER_INTEGRATION_PLATFORMS,
      ...Object.values(TRIGGER_DOMAIN_PLATFORMS).flat(),
    ];
    const typeRows: NavRow[] = [
      ...platforms.filter((p) => matches(platformLabel(p))).map((p) => platformRow(p, 0)),
      ...uniqueSearchTypes(
        catalog.flatMap((category) =>
          category.recipes
            .filter((recipe) => matches(recipe.label, recipe.description, category.label))
            .map((recipe) => ({
              key: searchTypeKey(recipe.fields.trigger, category.groupKey, recipe.id),
              label: recipe.label,
              group: category.label,
              category,
              recipe,
            }))
        )
      ).map(({ category, recipe, shown }) => ({
        key: `recipe:${category.groupKey}:${recipe.id}`,
        label: shown,
        icon: getPickerIcon(category.domain, Zap),
        color: getDomainColor(category.domain),
        onSelect: () => selectTypeRecipe(0, category, recipe),
        pickKey: triggerPickKey(recipe.fields.trigger),
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
            kind="trigger"
            places={places}
            atIndex={index}
            push={pushColumn}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:triggers.picker.noResults')}
          />
        );

      case 'areaChildren':
        return (
          <NavColumnList
            key={index}
            title={column.areaLabel}
            rows={placeRows(column, index, pushColumn)}
            selectedKey={selectedKeys[index]}
            emptyLabel={t('nodes:triggers.picker.noResults')}
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

      case 'domainCategories':
        return (
          <NavColumnList
            key={index}
            title={column.domainLabel}
            rows={column.categories.map((category) => ({
              key: category.groupKey,
              label: category.label,
              icon: getPickerIcon(category.domain, Layers),
              color: getDomainColor(category.domain),
              onSelect: () =>
                pushColumn(index, { kind: 'typeResults', category }, category.groupKey),
            }))}
            selectedKey={selectedKeys[index]}
          />
        );

      case 'typeGroup':
        return (
          <ResultsColumn key={index} title={column.title} chosenKey={selectedKeys[index]}>
            <div className="space-y-3">
              {column.platforms.length > 0 && (
                <div className="space-y-1.5">
                  {column.platforms.map((platform) => (
                    <TriggerResultRow
                      key={platform}
                      icon={PLATFORM_ICONS[platform]}
                      color={getDomainColor(platform)}
                      label={platformLabel(platform)}
                      description={
                        t(`nodes:triggers.platformDescriptions.${platform}`, {
                          defaultValue: '',
                        }) || undefined
                      }
                      onSelect={() => selectPlatform(index, platform)}
                      pickKey={`platform:${platform}`}
                    />
                  ))}
                </div>
              )}
              {column.categories.map((category) => (
                <div key={category.groupKey}>
                  <h4 className="px-1.5 py-1 font-semibold text-muted-foreground text-xs">
                    {category.label}
                  </h4>
                  <TypeResultsPanel
                    category={category}
                    onSelectRecipe={(_entityIds, recipe) =>
                      selectTypeRecipe(index, category, recipe)
                    }
                  />
                </div>
              ))}
            </div>
          </ResultsColumn>
        );

      case 'typeResults':
        return (
          <ResultsColumn key={index} title={column.category.label} chosenKey={selectedKeys[index]}>
            <TypeResultsPanel
              category={column.category}
              onSelectRecipe={(_entityIds, recipe) =>
                selectTypeRecipe(index, column.category, recipe)
              }
            />
          </ResultsColumn>
        );

      case 'targetResults':
        return (
          <ResultsColumn key={index} title={column.scope.label} chosenKey={selectedKeys[index]}>
            <TargetResultsPanel
              selected={column.scope}
              // Every entity, config and diagnostic ones too: a room's battery
              // level is looked up here (#177).
              entities={allEntities}
              onSelectEntityTarget={(entityId) => configure(index, entityTargetDraft([entityId]))}
              onSelectStateTargets={(entityIds) =>
                pushColumn(
                  index,
                  { kind: 'stateTargets', label: platformLabel('state'), entityIds },
                  'state'
                )
              }
              onSelectDeviceTrigger={(trigger) => configure(index, deviceTriggerDraft(trigger))}
              // A recipe row here can cover more than one entity (every light
              // in a room): its entities are offered to pick from first; one
              // that covers a single entity goes on at once.
              onSelectRecipe={(entityIds, recipe) =>
                routeScopePick(column.scope, entityIds, triggerRecipeTakesArea(recipe), {
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
            />
          </ResultsColumn>
        );

      case 'platformEntities':
        return (
          <MultiTargetPanel
            key={index}
            title={platformLabel(column.platform)}
            rows={entityTargetRows(entities)}
            labels={multiTargetLabels}
            onCommit={(entityIds) => configure(index, platformDraft(column.platform, entityIds))}
          />
        );

      case 'recipeEntities': {
        // The entities HA keeps for the type (#166): by its description's
        // domains and device classes; where it describes none, the
        // category's own.
        const offered = entitiesForType(
          entities,
          'trigger',
          column.recipe.fields.trigger,
          triggerDescriptions[column.recipe.fields.trigger],
          {
            domains: categoryEntityDomains(column.category, column.category.domain),
            domain: column.category.domain,
            deviceClass: column.category.deviceClass,
          }
        );
        return (
          <MultiTargetPanel
            key={index}
            title={column.recipe.label}
            rows={entityTargetRows(offered)}
            labels={recipeTargetLabels(
              column.recipe,
              offered.map((e) => e.entity_id)
            )}
            onCommit={(entityIds) => selectRecipe(index, entityIds, column.recipe)}
          />
        );
      }

      case 'scopeTargets':
        return (
          <MultiTargetPanel
            key={index}
            title={column.label}
            rows={entityTargetRows(
              column.entityIds
                .map((id) => allEntities.find((e) => e.entity_id === id))
                .filter((e): e is HassEntity => Boolean(e))
            )}
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
            nodeType="trigger"
            initialData={column.data}
            entities={entities}
            commitLabel={t('nodes:pickerConfig.addTrigger')}
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
        style={{ ...toneStyle('trigger'), ...pickerSize.style }}
      >
        {pickerSize.grip}
        <PickerCurrentProvider value={currentKey}>
          <PickerHeader
            title={t('nodes:triggers.picker.when.title')}
            icon={<StepIcon tone="trigger" icon={Radio} size="md" />}
            search={search}
            onSearchChange={changeSearch}
            placeholder={t('nodes:picker.search.placeholder')}
            kindSwitch={onSwitchKind && <PickerKindSwitch current="when" onSwitch={onSwitchKind} />}
          />
          <PickerColumnRow columnCount={columns.length}>
            {renderStackedColumns(columns, isSetup, renderColumn)}
          </PickerColumnRow>
        </PickerCurrentProvider>
      </DialogContent>
    </Dialog>
  );
}

/** The rows of a target list: the entities, by name. */
