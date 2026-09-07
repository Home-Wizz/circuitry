/**
 * Domain -> solid icon-badge color, for the Miller-column picker dialogs
 * (WhenTriggerDialog/AndConditionDialog/ThenActionDialog, via
 * TriggerResultRow.tsx/PickerColumns.tsx's NavRowView) — per user request to
 * make the picker read more like a reference "Add card" dialog style, where
 * every row's icon sits in a small solid-color circle rather than a plain
 * gray line icon with no background.
 *
 * Deliberately a *separate* table from `lib/node-colors.ts`, not an
 * extension of it: `node-colors.ts` is a different axis entirely (styling
 * for the 8 *node types* — trigger/condition/action/delay/... — pulled from
 * HA-theme-following CSS variables so those cards match HA's active theme).
 * This table is per-*domain* (light/switch/climate/...), a fixed curated
 * palette independent of the active theme — device-type icons in the
 * reference style stay the same color in light or dark mode, and there are
 * ~60 domain keys
 * here vs. node-colors.ts's 8 node types, so folding them into one table
 * would conflate two unrelated concepts.
 *
 * Same Tailwind-JIT caveat as node-colors.ts: every class name is spelled
 * out in full below, never template-built, so Tailwind's static scanner can
 * find them.
 */

export interface DomainColor {
  /** Badge background. */
  bg: string;
  /** Icon color against that background — always a light/white tone since every bg below is a mid-to-dark solid color. */
  fg: string;
}

const DOMAIN_COLORS: Record<string, DomainColor> = {
  // Core actionable domains
  light: { bg: 'bg-amber-400', fg: 'text-white' },
  switch: { bg: 'bg-sky-500', fg: 'text-white' },
  fan: { bg: 'bg-cyan-500', fg: 'text-white' },
  cover: { bg: 'bg-indigo-500', fg: 'text-white' },
  lock: { bg: 'bg-slate-600', fg: 'text-white' },
  climate: { bg: 'bg-orange-500', fg: 'text-white' },
  water_heater: { bg: 'bg-red-500', fg: 'text-white' },
  media_player: { bg: 'bg-purple-500', fg: 'text-white' },
  vacuum: { bg: 'bg-teal-500', fg: 'text-white' },
  camera: { bg: 'bg-gray-500', fg: 'text-white' },
  person: { bg: 'bg-pink-500', fg: 'text-white' },
  device_tracker: { bg: 'bg-pink-500', fg: 'text-white' },
  zone: { bg: 'bg-pink-400', fg: 'text-white' },
  humidifier: { bg: 'bg-sky-400', fg: 'text-white' },
  siren: { bg: 'bg-red-600', fg: 'text-white' },
  alarm_control_panel: { bg: 'bg-red-600', fg: 'text-white' },
  remote: { bg: 'bg-violet-500', fg: 'text-white' },
  valve: { bg: 'bg-blue-500', fg: 'text-white' },
  select: { bg: 'bg-violet-400', fg: 'text-white' },
  text: { bg: 'bg-slate-500', fg: 'text-white' },
  scene: { bg: 'bg-fuchsia-500', fg: 'text-white' },
  counter: { bg: 'bg-emerald-500', fg: 'text-white' },
  todo: { bg: 'bg-green-500', fg: 'text-white' },
  lawn_mower: { bg: 'bg-lime-600', fg: 'text-white' },
  button: { bg: 'bg-zinc-500', fg: 'text-white' },
  timer: { bg: 'bg-orange-400', fg: 'text-white' },
  schedule: { bg: 'bg-blue-400', fg: 'text-white' },
  sensor: { bg: 'bg-slate-400', fg: 'text-white' },
  binary_sensor: { bg: 'bg-slate-400', fg: 'text-white' },
  notify: { bg: 'bg-indigo-400', fg: 'text-white' },
  // Time/Sun condition rows in AndConditionDialog.tsx's "By type" list —
  // not real entity domains, same reasoning as 'blocks'/'zones'/'labels'
  // below.
  time: { bg: 'bg-blue-600', fg: 'text-white' },
  sun: { bg: 'bg-amber-500', fg: 'text-white' },

  // Device-class-prefixed condition/trigger groups (see domain-icons.ts's
  // identical note) — colored to read as their own category, not a
  // washed-out repeat of binary_sensor/sensor's gray.
  door: { bg: 'bg-indigo-500', fg: 'text-white' },
  garage_door: { bg: 'bg-indigo-600', fg: 'text-white' },
  gate: { bg: 'bg-indigo-400', fg: 'text-white' },
  window: { bg: 'bg-sky-400', fg: 'text-white' },
  moisture: { bg: 'bg-blue-500', fg: 'text-white' },
  motion: { bg: 'bg-rose-500', fg: 'text-white' },
  occupancy: { bg: 'bg-rose-400', fg: 'text-white' },
  vibration: { bg: 'bg-rose-600', fg: 'text-white' },
  battery: { bg: 'bg-green-500', fg: 'text-white' },
  humidity: { bg: 'bg-blue-400', fg: 'text-white' },
  illuminance: { bg: 'bg-yellow-400', fg: 'text-white' },
  power: { bg: 'bg-yellow-500', fg: 'text-white' },
  temperature: { bg: 'bg-red-400', fg: 'text-white' },
  air_quality: { bg: 'bg-teal-400', fg: 'text-white' },
  assist_satellite: { bg: 'bg-violet-600', fg: 'text-white' },
  calendar: { bg: 'bg-blue-500', fg: 'text-white' },
  update: { bg: 'bg-gray-400', fg: 'text-white' },
  ai_task: { bg: 'bg-purple-600', fg: 'text-white' },
  conversation: { bg: 'bg-teal-600', fg: 'text-white' },
  date: { bg: 'bg-cyan-600', fg: 'text-white' },
  datetime: { bg: 'bg-sky-600', fg: 'text-white' },
  group: { bg: 'bg-zinc-600', fg: 'text-white' },
  automation: { bg: 'bg-violet-600', fg: 'text-white' },
  script: { bg: 'bg-fuchsia-600', fg: 'text-white' },

  // Helper domains + generic `number` platform — see domain-icons.ts's
  // identical note on this same set, added alongside actionRecipes.ts's
  // "devices missing their actions" audit fix.
  input_boolean: { bg: 'bg-teal-500', fg: 'text-white' },
  input_button: { bg: 'bg-rose-500', fg: 'text-white' },
  input_datetime: { bg: 'bg-cyan-500', fg: 'text-white' },
  input_number: { bg: 'bg-lime-500', fg: 'text-white' },
  input_select: { bg: 'bg-purple-400', fg: 'text-white' },
  input_text: { bg: 'bg-stone-500', fg: 'text-white' },
  number: { bg: 'bg-lime-600', fg: 'text-white' },

  // Not a domain at all — the AND/THEN dialogs' "Blocks" root section
  // (and/or/not/template/time/trigger conditions; if-else/choose/repeat/
  // wait/parallel/stop/delay/set-variables actions). Its own distinct color
  // rather than the neutral fallback, since it's a whole root category with
  // its own icon (`Blocks`, lucide-react), not an unmapped domain.
  blocks: { bg: 'bg-violet-500', fg: 'text-white' },
  // Root-section rows in the same three dialogs — Zones (Home icon) and
  // Labels (Tag icon) aren't domains either, same reasoning as 'blocks'.
  zones: { bg: 'bg-blue-500', fg: 'text-white' },
  labels: { bg: 'bg-fuchsia-500', fg: 'text-white' },
  // The four "Unassigned" subcategory rows (see domain-icons.ts's identical
  // note) — their own colors rather than the neutral fallback, same
  // reasoning as 'blocks'/'zones'/'labels' above.
  entities: { bg: 'bg-slate-500', fg: 'text-white' },
  helpers: { bg: 'bg-amber-600', fg: 'text-white' },
  devices: { bg: 'bg-indigo-600', fg: 'text-white' },
  services: { bg: 'bg-gray-500', fg: 'text-white' },
  // "Generic"/"Integration" rows inside the Action miller's own "By type"
  // list (ThenActionDialog.tsx) — HA-core vs. integration-provided services
  // with no entity domain of their own, listed as two more browsable
  // entries alongside Light/Switch/etc. in real HA's own "Add action" > "By
  // type" tab rather than as separate root sections. Same not-a-domain
  // reasoning as 'blocks'/'zones'/'labels' above.
  generic: { bg: 'bg-neutral-500', fg: 'text-white' },
  integration: { bg: 'bg-teal-500', fg: 'text-white' },
};

/** Neutral fallback for any domain not in the table above. */
export const DEFAULT_DOMAIN_COLOR: DomainColor = { bg: 'bg-slate-400', fg: 'text-white' };

/** Returns the domain's badge color, or the neutral fallback if unmapped. */
export function getDomainColor(domain: string | undefined): DomainColor {
  if (!domain) return DEFAULT_DOMAIN_COLOR;
  return DOMAIN_COLORS[domain] ?? DEFAULT_DOMAIN_COLOR;
}
