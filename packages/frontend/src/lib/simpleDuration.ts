import {
  type DurationObject,
  parseDurationString,
} from '@/components/panels/node-fields/DurationField';

export type SimpleDurationUnit = 'seconds' | 'minutes';

export interface SimpleDuration {
  amount: number;
  unit: SimpleDurationUnit;
}

/**
 * Best-effort reduction of a Delay/Wait duration value (string "HH:MM:SS" or
 * the `{ hours, minutes, seconds, milliseconds }` object — see
 * DurationField.tsx) down to a single amount+unit, for DelayNode.tsx's
 * inline canvas-card editor (matching a reference flow editor's own delay
 * card: one number, one Sec/Min toggle, no hour/millisecond fields).
 *
 * Returns `null` when the value doesn't cleanly fit that shape — hours or
 * milliseconds set, or both minutes and seconds set at once — rather than
 * silently discarding part of a duration someone set via the full property
 * panel editor. The card falls back to its previous plain-text display in
 * that case; editing still works via the property panel as before.
 */
export function parseSimpleDuration(value: string | DurationObject | undefined): SimpleDuration | null {
  if (value === undefined) return { amount: 0, unit: 'seconds' };

  const obj: DurationObject = typeof value === 'string' ? parseDurationString(value) : value;

  const hours = Number(obj.hours) || 0;
  const minutes = Number(obj.minutes) || 0;
  const seconds = Number(obj.seconds) || 0;
  const milliseconds = Number(obj.milliseconds) || 0;

  if (hours || milliseconds) return null;
  if (minutes && seconds) return null;
  if (minutes) return { amount: minutes, unit: 'minutes' };
  return { amount: seconds, unit: 'seconds' };
}

/** Inverse of parseSimpleDuration — builds the `{ minutes }`/`{ seconds }` object HA's duration selector expects. */
export function buildSimpleDuration({ amount, unit }: SimpleDuration): DurationObject {
  return unit === 'minutes' ? { minutes: amount } : { seconds: amount };
}
