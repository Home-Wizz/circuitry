/**
 * Trigger-side sibling of lib/triggerEnumField.ts — HA's purpose-specific
 * triggers whose real "how do I know when to fire" value isn't a threshold
 * or a mode string, but a required duration: `timer.remaining_time_reached`'s
 * `options.remaining` (HH:MM:SS), documented as the one field this trigger
 * needs beyond target — and, unlike every other threshold/enum-bearing
 * dotted trigger, this one carries NO `behavior`/`for` at all (see
 * nativeThreshold.ts's `getTriggerBehaviorVariant`/`triggerHasFor`, both of
 * which special-case 'timer.remaining_time_reached' directly).
 *
 * Before this classifier existed, nothing in nativeThreshold.ts's threshold
 * shape system or triggerEnumField.ts's mode-string system fit this field —
 * `remaining` is neither a numeric above/below/between/outside comparison
 * nor a fixed enum of valid strings, it's a raw duration value entered the
 * same way `options.for` is (reusing DurationField/DurationInput).
 */

export type TriggerDurationFieldLabelKey = 'remaining';

export interface TriggerDurationField {
  /** The key inside `options` this trigger's duration value lives at. */
  optionsKey: string;
  /** i18n key suffix for the field's label, under `nodes:triggers.native.durationFieldLabels`. */
  labelKey: TriggerDurationFieldLabelKey;
  /** Whether HA documents this field as required. */
  required: boolean;
}

const TRIGGER_DURATION_FIELDS: Record<string, TriggerDurationField> = {
  // home-assistant.io/triggers/timer.remaining_time_reached/: "remaining
  // Required — the amount of time remaining on the timer that should fire
  // this trigger."
  'timer.remaining_time_reached': { optionsKey: 'remaining', labelKey: 'remaining', required: true },
};

export function getTriggerDurationField(triggerType: string): TriggerDurationField | undefined {
  return TRIGGER_DURATION_FIELDS[triggerType];
}
