/**
 * Trigger-side classifier for dotted triggers whose real "when exactly does
 * this fire" value is an `offset` duration PLUS an `offset_type`
 * ('before'/'after') saying which side of some reference event it applies
 * to — e.g. "30 minutes after sunrise" is `offset: {minutes: 30},
 * offset_type: after`. Two families use this shape:
 *
 *  - The sun integration's 6 non-numeric "event" triggers (`sun.dawn`,
 *    `sun.dusk`, `sun.solar_midnight`, `sun.solar_noon`, `sun.sunrise`,
 *    `sun.sunset`) — distinct from both `sun.elevation_changed`/
 *    `elevation_crossed_threshold` (numeric, handled by
 *    lib/nativeThreshold.ts's TYPED threshold system) and every other
 *    trigger's `options.for` (a "how long must this condition hold"
 *    duration, always non-negative). `offset` is OPTIONAL here (default
 *    "00:00:00"). Confirmed via home-assistant/core's sun/trigger.py
 *    (`_EVENT_TRIGGER_SCHEMA`/`_DAWN_DUSK_TRIGGER_SCHEMA`) and raw
 *    home-assistant.io markdown source for sun.sunrise/sun.dawn.
 *  - `calendar.event_started`/`calendar.event_ended` — same offset/
 *    offset_type pair, but `offset` is REQUIRED here (no default; the
 *    trigger fires exactly at event start/end only if offset is present
 *    and zero) — confirmed via raw home-assistant.io markdown source for
 *    calendar.event_started's "Options in YAML" table. Unlike the sun
 *    triggers, calendar keeps a normal target (`entity_id` — which
 *    calendar(s) to watch) and has no `behavior`/`for`.
 *
 * `dawn`/`dusk` additionally get a `type` field selecting which twilight
 * phase marks the event: civil (default)/nautical/astronomical — a 3-value
 * enum, NOT the 4-value civil/nautical/astronomical/**any** list used by the
 * CONDITION-side `sun.is_morning_twilight`/`is_evening_twilight` (see
 * NativeConditionFields.tsx's `TWILIGHT_TYPES`) — "any" means something
 * different there ("currently in any twilight phase") and isn't a valid
 * choice for a point-in-time trigger, which always fires for one specific
 * phase's threshold crossing.
 */

export type TriggerOffsetType = 'before' | 'after';

export interface TriggerOffsetField {
  /** Whether this trigger also gets the dawn/dusk twilight-phase `type` selector. */
  hasTwilightType: boolean;
  /** Whether HA documents `offset` as required (calendar) vs. optional/defaulted to 00:00:00 (every sun.* event trigger). */
  required: boolean;
}

const TRIGGER_OFFSET_FIELDS: Record<string, TriggerOffsetField> = {
  'sun.sunrise': { hasTwilightType: false, required: false },
  'sun.sunset': { hasTwilightType: false, required: false },
  'sun.solar_noon': { hasTwilightType: false, required: false },
  'sun.solar_midnight': { hasTwilightType: false, required: false },
  'sun.dawn': { hasTwilightType: true, required: false },
  'sun.dusk': { hasTwilightType: true, required: false },
  // home-assistant.io/triggers/calendar.event_started/ and
  // .../calendar.event_ended/: "offset — Required — the length of time from
  // the start/end of the event."
  'calendar.event_started': { hasTwilightType: false, required: true },
  'calendar.event_ended': { hasTwilightType: false, required: true },
};

export function getTriggerOffsetField(triggerType: string): TriggerOffsetField | undefined {
  return TRIGGER_OFFSET_FIELDS[triggerType];
}

export type TriggerTwilightType = 'civil' | 'nautical' | 'astronomical';
export const TRIGGER_TWILIGHT_TYPES: TriggerTwilightType[] = ['civil', 'nautical', 'astronomical'];
