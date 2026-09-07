import type { TriggerPlatform } from '@circuitry/shared';
import {
  Bell,
  Braces,
  Calendar,
  ChevronRight,
  Clock,
  Cpu,
  Globe,
  Home,
  MapPin,
  MessageSquare,
  Radio,
  Repeat,
  Search,
  Sun,
  Tag,
  TrendingUp,
  Webhook,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import { getDomainColor } from '@/lib/domain-colors';
import { getDomainIcon } from '@/lib/domain-icons';
import {
  ENTITY_TRIGGER_CATEGORIES,
  type EntityTriggerCategory,
  groupCategoriesByDomain,
  type TriggerRecipe,
} from '@/lib/triggerRecipes';
import { cn } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';
import { TriggerResultRow } from './TriggerResultRow';
import { TriggerTargetPicker } from './TriggerTargetPicker';

/**
 * Trigger node "empty state" — shown by TriggerFields whenever a trigger
 * node's `trigger` platform hasn't been chosen yet (freshly dropped from the
 * palette). Mirrors the shape of Home Assistant's own "Add trigger" dialog
 * (By target / By type tabs):
 *  - "By target" (TriggerTargetPicker.tsx) is a real Home > Area > Device >
 *    Entity tree, with a results panel driven by a client-side domain/
 *    device_class recipe catalog (lib/triggerRecipes.ts) plus HA's own
 *    device_automation API — this is where HA's device-class-specific
 *    entries (Battery, Motion, Occupancy, ...) actually live.
 *  - "By type" leads with the same domain/device_class recipe catalog (lib/
 *    triggerRecipes.ts) — Light, Cover, Battery, Motion, ... — laid out as a
 *    vertical tree exactly like "By target"'s: a search box, then a list
 *    where most domains (Light, Cover, Lock, ...) are flat, directly-
 *    selectable leaves (mirroring real HA, which lists "Cover" as one entry
 *    and shows every device class's triggers together the moment you select
 *    it — not nested sub-categories per device class), while binary_sensor
 *    and sensor expand into their many device-class children (Battery,
 *    Motion, Illuminance, ...) since those really are separate entries in
 *    HA's own dialog too. Selecting a category shows its Triggers directly
 *    in a results panel below — matching real HA's type-then-target order:
 *    pick the trigger first, then use the normal entity_id field afterward
 *    to scope it, rather than asking for entities up front. Below that,
 *    the plain trigger platforms/types, grouped the same way HA's own
 *    dialog groups them (see TRIGGER_COLLECTIONS in home-assistant/
 *    frontend's src/data/trigger.ts): Time (which also bundles Calendar)
 *    and Sun up top, then Event/Home Assistant/Template/Webhook/Sentence
 *    (conversation)/Persistent notification, then a "Generic" section for
 *    Device and the Entity fallbacks (State, Numeric state), then an
 *    "Integrations" section for integration-provided triggers (MQTT, Zone,
 *    Tag, Geolocation) HA would otherwise group dynamically per integration.
 */

// Exported (along with TYPE_GROUPS, DOMAIN_GROUP_ORDER/LABELS, and
// TypeResultsPanel below) so WhenTriggerDialog.tsx's Miller-column modal can
// reuse the exact same grouping/labeling/results-rendering rather than
// re-deriving it.
export const PLATFORM_ICONS: Record<TriggerPlatform, React.ComponentType<{ className?: string }>> = {
  state: Zap,
  numeric_state: TrendingUp,
  time: Clock,
  time_pattern: Repeat,
  sun: Sun,
  event: Radio,
  mqtt: Webhook,
  webhook: Webhook,
  zone: MapPin,
  template: Braces,
  homeassistant: Home,
  device: Cpu,
  calendar: Calendar,
  tag: Tag,
  geo_location: Globe,
  persistent_notification: Bell,
  conversation: MessageSquare,
};

// Mirrors the real grouping HA's frontend uses for its own "By type" list
// (see TRIGGER_COLLECTIONS in home-assistant/frontend's src/data/trigger.ts):
// an unheaded top section with Time (which itself bundles the Calendar
// trigger via its `domains: ["calendar", "schedule"]`) and Sun grouped
// together, then Event/Home Assistant/Template/Webhook as flat entries;
// then a "Generic" section for Device and the Entity fallbacks (State,
// Numeric state) — notably Device lives here, not with Home Assistant/Event,
// which is a correction from this component's first pass; then an
// "Integrations" section for triggers HA would dynamically group per the
// providing integration (MQTT, Zone) rather than list statically.
export type TriggerPickerGroupKey =
  | 'entity'
  | 'timeAndSun'
  | 'homeAssistant'
  | 'generic'
  | 'integrations';

// AUDITED (5th catalog re-audit pass, "By type" platform tab): every
// platform's config/triggerFields.ts field list was individually cross-
// checked against its home-assistant.io/triggers/<platform>/ doc page's
// "Options in YAML" table (or, where a per-trigger page doesn't exist for a
// legacy platform, docs/automation/trigger/) — all 17 are complete and
// accurate. Two spot-checks worth recording since they looked suspicious at
// a glance: `time`'s `weekday` field is real (confirmed via raw markdown
// source, not just the example YAML), and `mqtt` genuinely has NO `qos`
// field despite most other MQTT-integration entities having one.
//
// KNOWN DUPLICATES (flagged per explicit user request, NOT fixed this pass
// — deferred to a future cleanup): `sun`, `calendar`, and `zone` here are
// the LEGACY generic platforms (`platform: sun`/`calendar`/`zone` + a
// static `event`/`offset` field list, rendered via DynamicFieldRenderer).
// This same pass added modern dotted equivalents with fuller target/
// options support as their own "By type" domain categories (see
// lib/triggerRecipes.ts's `sun`/`calendar`/`zone` category pushes) —
// `sun.sunrise`/`sun.sunset` vs. legacy `sun`'s event:sunrise/sunset;
// `calendar.event_started`/`event_ended` vs. legacy `calendar`'s
// event:start/end; `zone.entered`/`left` vs. legacy `zone`'s event:enter/
// leave. Both forms are still valid HA YAML (the legacy ones aren't
// deprecated), so nothing here is broken, but having both listed
// separately in "By type" is redundant enough to be worth resolving later
// — most likely by collapsing these three legacy platform entries out of
// TYPE_GROUPS once the dotted equivalents are confirmed to fully cover
// every legacy use case (legacy `sun`'s "offset before/after" already maps
// 1:1 to the dotted version's offset/offset_type; same for calendar/zone).
export const TYPE_GROUPS: Array<{ key: TriggerPickerGroupKey; platforms: TriggerPlatform[] }> = [
  { key: 'timeAndSun', platforms: ['time', 'time_pattern', 'sun', 'calendar'] },
  {
    key: 'homeAssistant',
    platforms: ['event', 'homeassistant', 'template', 'webhook', 'conversation', 'persistent_notification'],
  },
  { key: 'generic', platforms: ['device', 'state', 'numeric_state'] },
  { key: 'integrations', platforms: ['mqtt', 'zone', 'tag', 'geo_location'] },
];

// Display order/labels for the domain-grouped "By type" categories (see
// lib/triggerRecipes.ts). Rendered ABOVE the plain platform groups below —
// this is the primary way most people will actually browse "By type"
// (picking "Battery" or "Blind" rather than "State Change"), so it leads.
//
// calendar/sun/moon/assist_satellite/update/zone/event were added in the
// 5th catalog re-audit pass — each pushed as its own category in
// buildCategories() (lib/triggerRecipes.ts) but, without an entry here,
// would have been entirely unreachable from the browse tree (only
// discoverable via the search box, which iterates ENTITY_TRIGGER_CATEGORIES
// directly rather than going through this list) — the exact kind of gap
// this whole audit pass was meant to catch.
export const DOMAIN_GROUP_ORDER: string[] = [
  'light',
  'switch',
  'fan',
  'cover',
  'lock',
  'climate',
  'media_player',
  'vacuum',
  'lawn_mower',
  'humidifier',
  'water_heater',
  'valve',
  'siren',
  'alarm_control_panel',
  'remote',
  'button',
  'select',
  'text',
  'counter',
  'todo',
  'scene',
  'person',
  'schedule',
  'timer',
  'calendar',
  'sun',
  'moon',
  'assist_satellite',
  'update',
  'zone',
  'event',
  'binary_sensor',
  'sensor',
];

export const DOMAIN_GROUP_LABELS: Record<string, string> = {
  light: 'Light',
  switch: 'Switch',
  fan: 'Fan',
  cover: 'Cover',
  lock: 'Lock',
  climate: 'Climate',
  media_player: 'Media player',
  vacuum: 'Vacuum',
  lawn_mower: 'Lawn mower',
  humidifier: 'Humidifier',
  water_heater: 'Water heater',
  valve: 'Valve',
  siren: 'Siren',
  alarm_control_panel: 'Alarm panel',
  remote: 'Remote',
  button: 'Button',
  select: 'Dropdown',
  text: 'Text',
  counter: 'Counter',
  todo: 'To-do list',
  scene: 'Scene',
  person: 'Person',
  schedule: 'Schedule',
  timer: 'Timer',
  calendar: 'Calendar',
  sun: 'Sun',
  moon: 'Moon',
  assist_satellite: 'Assist satellite',
  update: 'Update',
  zone: 'Zone',
  event: 'Event',
  binary_sensor: 'Binary sensor',
  sensor: 'Sensor',
};

/**
 * DOMAIN_GROUP_ORDER's own sequence mirrors real HA's "Add trigger" dialog
 * grouping (Light/Switch/Fan first, Binary sensor/Sensor last, ...) — but per
 * direct user request, the "Device types" list (this component's "By type"
 * tree below, and WhenTriggerDialog.tsx's Miller-column root section built
 * from the same two constants) renders alphabetically by resolved label
 * instead. Derived rather than reordering DOMAIN_GROUP_ORDER itself, so that
 * array still documents HA's own grouping for anyone comparing against the
 * real dialog.
 */
export const SORTED_DOMAIN_GROUP_ORDER: string[] = [...DOMAIN_GROUP_ORDER].sort((a, b) =>
  (DOMAIN_GROUP_LABELS[a] ?? a).localeCompare(DOMAIN_GROUP_LABELS[b] ?? b)
);

interface TriggerTypePickerProps {
  entities: HassEntity[];
  onSelectPlatform: (platform: TriggerPlatform) => void;
  onSelectEntityTarget: (entityId: string) => void;
  onSelectDeviceTrigger: (trigger: DeviceTrigger) => void;
  onSelectRecipe: (entityIds: string[], recipe: TriggerRecipe) => void;
}

export function TriggerTypePicker({
  entities,
  onSelectPlatform,
  onSelectEntityTarget,
  onSelectDeviceTrigger,
  onSelectRecipe,
}: TriggerTypePickerProps) {
  const { t } = useTranslation(['nodes']);
  const [tab, setTab] = useState<'target' | 'type'>('target');
  const [selectedCategory, setSelectedCategory] = useState<EntityTriggerCategory | null>(null);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [categorySearch, setCategorySearch] = useState('');

  // Grouped by originating domain rather than one flat list — with ~90
  // categories across 14 domains, a single undifferentiated list is hard to
  // scan and (worse) has real label collisions: a sensor's "Battery" (%)
  // and a binary_sensor's "Battery" (low/normal) are different categories
  // that happen to share a name, only disambiguated by which group they're
  // under.
  const categoriesByDomain = useMemo(() => groupCategoriesByDomain(), []);

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  // Same tree shape as "By target" (TriggerTargetPicker.tsx): a top search
  // box that, once typed into, replaces the tree with a flat matched list;
  // otherwise a vertical expand/collapse tree, here one level deep
  // (domain -> category) rather than area -> device -> entity.
  const normalizedCategorySearch = categorySearch.trim().toLowerCase();
  const categorySearchResults = useMemo(() => {
    if (!normalizedCategorySearch) return null;
    return ENTITY_TRIGGER_CATEGORIES.filter(
      (category) =>
        category.label.toLowerCase().includes(normalizedCategorySearch) ||
        (DOMAIN_GROUP_LABELS[category.domain] ?? category.domain)
          .toLowerCase()
          .includes(normalizedCategorySearch)
    ).sort((a, b) => a.label.localeCompare(b.label));
  }, [normalizedCategorySearch]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab('target')}
          className={cn(
            'rounded-md px-3 py-1.5 font-medium transition-colors',
            tab === 'target'
              ? 'bg-primary text-primary-foreground shadow'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('nodes:triggers.picker.byTarget')}
        </button>
        <button
          type="button"
          onClick={() => setTab('type')}
          className={cn(
            'rounded-md px-3 py-1.5 font-medium transition-colors',
            tab === 'type'
              ? 'bg-primary text-primary-foreground shadow'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('nodes:triggers.picker.byType')}
        </button>
      </div>

      {tab === 'type' ? (
        <div className="flex flex-col gap-2">
          {/* Domain -> category tree, matching "By target"'s tree design.
              Most domains (Light, Cover, Lock, ...) render as flat,
              directly-selectable leaves — real HA lists "Cover" as one entry
              and shows every device class's triggers together once you
              select it, rather than nesting per-device-class sub-items.
              binary_sensor/sensor are the exception: they really do have a
              separate entry per device class in HA's own dialog, so those
              two still expand into children. */}
          <div className="flex items-center gap-2 rounded-md border px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              placeholder={t('nodes:triggers.picker.searchTypePlaceholder')}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[200px] overflow-y-auto rounded-md border p-1.5">
            {categorySearchResults ? (
              categorySearchResults.length === 0 ? (
                <p className="p-2 text-center text-muted-foreground text-xs">
                  {t('nodes:triggers.picker.noResults')}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {categorySearchResults.map((category) => (
                    <button
                      key={category.groupKey}
                      type="button"
                      onClick={() => setSelectedCategory(category)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted',
                        selectedCategory?.groupKey === category.groupKey && 'bg-muted text-foreground'
                      )}
                    >
                      <Zap className="h-3.5 w-3.5 shrink-0 text-trigger" />
                      <TruncatedTooltip content={category.label}>
                        <span className="min-w-0 flex-1 truncate">{category.label}</span>
                      </TruncatedTooltip>
                      <TruncatedTooltip content={DOMAIN_GROUP_LABELS[category.domain] ?? category.domain}>
                        <span className="shrink-0 truncate text-muted-foreground text-xs">
                          {DOMAIN_GROUP_LABELS[category.domain] ?? category.domain}
                        </span>
                      </TruncatedTooltip>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-0.5">
                {SORTED_DOMAIN_GROUP_ORDER.map((domain) => {
                  const categories = categoriesByDomain.get(domain);
                  if (!categories || categories.length === 0) return null;
                  const domainLabel = DOMAIN_GROUP_LABELS[domain] ?? domain;

                  // Single-category domain: a flat, directly-selectable leaf
                  // (no expand step) — matches real HA's "Cover"/"Light"/...
                  if (categories.length === 1) {
                    const category = categories[0] as EntityTriggerCategory;
                    const isSelected = selectedCategory?.groupKey === category.groupKey;
                    return (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => setSelectedCategory(category)}
                        className={cn(
                          'flex w-full items-center rounded px-1.5 py-1 text-left text-sm font-medium hover:bg-muted',
                          isSelected && 'bg-muted text-foreground'
                        )}
                      >
                        {domainLabel}
                      </button>
                    );
                  }

                  // Multi-category domain (binary_sensor, sensor): expand to
                  // reveal per-device-class children.
                  const isExpanded = expandedDomains.has(domain);
                  return (
                    <div key={domain}>
                      <div className="flex w-full items-center gap-1 rounded text-sm">
                        <button
                          type="button"
                          onClick={() => toggleDomain(domain)}
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
                          onClick={() => toggleDomain(domain)}
                          className="min-w-0 flex-1 truncate py-1 text-left font-medium"
                        >
                          <TruncatedTooltip content={domainLabel}>
                            <span className="block truncate">{domainLabel}</span>
                          </TruncatedTooltip>
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="ml-5 space-y-0.5">
                          {categories.map((category) => (
                            <button
                              key={category.groupKey}
                              type="button"
                              onClick={() => setSelectedCategory(category)}
                              className={cn(
                                'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted',
                                selectedCategory?.groupKey === category.groupKey &&
                                  'bg-muted text-foreground'
                              )}
                            >
                              <TruncatedTooltip content={category.label}>
                                <span className="truncate">{category.label}</span>
                              </TruncatedTooltip>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Results panel — the selected category's Triggers, shown
              directly below like "By target"'s results panel. Clicking one
              commits it with no entities pre-selected; the normal entity_id
              field on the resulting trigger is how you scope it afterward,
              matching real HA's type-then-target order. */}
          <div className="min-h-[120px] max-h-[220px] overflow-y-auto rounded-md border p-1.5">
            <TypeResultsPanel category={selectedCategory} onSelectRecipe={onSelectRecipe} />
          </div>

          {/* Plain trigger platforms/types (Time & Sun, Home Assistant, Generic, Integrations) */}
          <Command className="rounded-md border">
            <CommandInput placeholder={t('nodes:triggers.picker.searchTypePlaceholder')} />
            <CommandList className="max-h-[200px]">
              <CommandEmpty>{t('nodes:triggers.picker.noResults')}</CommandEmpty>
              {TYPE_GROUPS.map((group) => (
                <CommandGroup key={group.key} heading={t(`nodes:triggers.picker.groups.${group.key}`)}>
                  {group.platforms.map((platform) => {
                    const Icon = PLATFORM_ICONS[platform];
                    const label = t(`nodes:triggers.platforms.${platform}`);
                    return (
                      <CommandItem
                        key={platform}
                        value={`${platform} ${label}`}
                        onSelect={() => onSelectPlatform(platform)}
                      >
                        <Icon className="h-4 w-4 text-trigger" />
                        {label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </div>
      ) : (
        <TriggerTargetPicker
          entities={entities}
          onSelectPlatform={onSelectPlatform}
          onSelectEntityTarget={onSelectEntityTarget}
          onSelectDeviceTrigger={onSelectDeviceTrigger}
          onSelectRecipe={onSelectRecipe}
        />
      )}
    </div>
  );
}

/**
 * "By type" tab's results panel — shows the selected category's Triggers,
 * exactly like "By target"'s TargetResultsPanel below its tree. Clicking a
 * row commits that recipe immediately with no entities attached yet; the
 * resulting trigger's own entity_id field (already part of the normal
 * StateTriggerFields/etc UI) is where the user picks which entities it
 * applies to — matching real HA's own order (type first, then target).
 */
export function TypeResultsPanel({
  category,
  onSelectRecipe,
}: {
  category: EntityTriggerCategory | null;
  onSelectRecipe: (entityIds: string[], recipe: TriggerRecipe) => void;
}) {
  const { t } = useTranslation(['nodes']);

  if (!category) {
    return (
      <div className="flex h-full min-h-[100px] items-center justify-center text-center text-muted-foreground text-sm">
        {t('nodes:triggers.picker.selectType')}
      </div>
    );
  }

  // Every recipe in a category shares the same domain (that's what makes it
  // one category), so a single icon lookup covers the whole list.
  const CategoryIcon = getDomainIcon(category.domain, Zap);
  const categoryColor = getDomainColor(category.domain);

  return (
    <div className="space-y-1.5">
      {category.recipes.map((recipe) => (
        <TriggerResultRow
          key={recipe.id}
          icon={CategoryIcon}
          color={categoryColor}
          label={recipe.label}
          description={recipe.description}
          onSelect={() => onSelectRecipe([], recipe)}
        />
      ))}
    </div>
  );
}
