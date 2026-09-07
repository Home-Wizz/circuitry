import {
  AlertTriangle,
  AppWindow,
  BatteryLow,
  Bot,
  Boxes,
  Calendar,
  CalendarClock,
  CalendarDays,
  Camera,
  ChevronsUpDown,
  CircleDot,
  Cpu,
  DoorOpen,
  Droplet,
  Fan,
  Gauge,
  Hash,
  Layers,
  Lightbulb,
  List,
  ListChecks,
  ListFilter,
  Lock,
  MapPin,
  MessageSquare,
  Mic,
  Move,
  MousePointerClick,
  Power,
  Radio,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Speaker,
  Sprout,
  Sun,
  TextCursorInput,
  Thermometer,
  Timer,
  ToggleLeft,
  Tv,
  Type,
  User,
  Users,
  Vibrate,
  Wand2,
  Waves,
  Wind,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Entity-domain -> icon, for canvas node cards (TriggerNode/ActionNode) that
 * resolve a specific entity/device rather than showing the generic
 * per-node-type icon (Zap for every trigger, Play for every action, ...).
 * Matches the reference card style this was modeled on, where each card
 * shows an icon for the actual device involved rather than the card
 * *type*.
 *
 * Deliberately lucide-react rather than HA's native `ha-state-icon` — every
 * other icon on the canvas already comes from lucide (see NODE_COLORS/
 * node type icons), and `ha-state-icon` depends on Lit context providers
 * (`configContext`/`connectionContext`/`entitiesContext`, see
 * home-assistant/frontend's `ha-state-icon.ts`) that may not be present at
 * Circuitry's mount point inside HA's DOM, silently falling back to a blank/
 * generic icon rather than erroring — not worth the risk for a `- prettier
 * icon` upgrade when a small static table covers the common domains fine.
 *
 * Not exhaustive — anything not listed here falls back to the caller's own
 * default (the existing generic per-node-type icon).
 */
const DOMAIN_ICONS: Record<string, LucideIcon> = {
  light: Lightbulb,
  switch: Power,
  cover: DoorOpen,
  fan: Fan,
  climate: Thermometer,
  water_heater: Thermometer,
  lock: Lock,
  media_player: Tv,
  vacuum: Bot,
  camera: Camera,
  person: User,
  device_tracker: MapPin,
  zone: MapPin,
  sensor: Gauge,
  binary_sensor: Gauge,
  humidifier: Droplet,
  siren: AlertTriangle,
  alarm_control_panel: AlertTriangle,
  remote: Radio,
  notify: Speaker,
  valve: Waves,
  select: ChevronsUpDown,
  text: Type,
  scene: Wand2,
  counter: Hash,
  todo: ListChecks,
  lawn_mower: Sprout,
  button: CircleDot,
  timer: Timer,
  // Not real HA entity domains — device-class-prefixed condition/trigger
  // groups (lib/conditionRecipes.ts, lib/triggerRecipes.ts's
  // BINARY_SENSOR_NATIVE/SENSOR_NATIVE) key straight off the device class
  // itself (`door.is_open`, `motion.is_detected`, ...), so these give those
  // groups their own distinct icon in the picker instead of falling back to
  // the generic binary_sensor/sensor Gauge for all of them.
  door: DoorOpen,
  garage_door: DoorOpen,
  gate: DoorOpen,
  window: AppWindow,
  moisture: Droplet,
  motion: Move,
  occupancy: Users,
  vibration: Vibrate,
  battery: BatteryLow,
  humidity: Droplet,
  illuminance: Sun,
  power: Zap,
  temperature: Thermometer,
  air_quality: Wind,
  assist_satellite: Mic,
  calendar: Calendar,
  update: RefreshCw,
  ai_task: Sparkles,
  conversation: MessageSquare,
  date: CalendarDays,
  datetime: CalendarClock,
  group: Boxes,
  automation: Workflow,
  script: ScrollText,

  // Helper-domain entities (Settings > Devices & services > Helpers) and the
  // generic `number` platform domain — added alongside actionRecipes.ts's
  // matching entries, see that file's doc comment on the "devices missing
  // their actions" audit finding: these domains previously had no icon *or*
  // action-recipe entry at all, so any device/area/label scope whose only
  // actionable entities were e.g. input_number/number/input_select showed up
  // completely empty in the Action miller despite genuinely having actions.
  input_boolean: ToggleLeft,
  input_button: MousePointerClick,
  input_datetime: CalendarClock,
  input_number: SlidersHorizontal,
  input_select: ListFilter,
  input_text: TextCursorInput,
  number: SlidersHorizontal,

  // Not real HA entity domains — the Action/Condition/Trigger miller's
  // "Unassigned" root row now drills into four subcategories (Entities/
  // Helpers/Devices/Services, matching real HA's own Settings > Entities
  // page) instead of one flat list — see
  // TriggerTargetPicker.tsx's buildUnassignedGroups. These give each of
  // those four rows their own icon, same treatment as 'blocks'/'zones'/
  // 'labels' below.
  entities: List,
  helpers: Wrench,
  devices: Cpu,
  services: Layers,

  // "Generic"/"Integration" rows inside the Action miller's own "By type"
  // list — see domain-colors.ts's matching entries' doc comment for why
  // these live in the By-type list rather than as separate root sections.
  generic: Sparkles,
  integration: Radio,
};

/** Returns the domain-specific icon, or `fallback` if the domain isn't mapped. */
export function getDomainIcon(domain: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!domain) return fallback;
  return DOMAIN_ICONS[domain] ?? fallback;
}
