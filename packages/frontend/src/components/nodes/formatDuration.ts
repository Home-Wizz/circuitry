import type { TFunction } from 'i18next';
import type { DurationValue } from '@/components/panels/node-fields/DurationField';

/** The unit words a duration is written with ("5 min", "1 h 30 min"). */
export interface DurationUnits {
  hours: string;
  minutes: string;
  seconds: string;
  milliseconds: string;
}
const ENGLISH: DurationUnits = { hours: 'h', minutes: 'min', seconds: 's', milliseconds: 'ms' };

/** The unit words in the UI's language (`nodes:durationUnits`). */
export function durationUnits(t: TFunction<readonly ['nodes']>): DurationUnits {
  return {
    hours: t('nodes:durationUnits.hours'),
    minutes: t('nodes:durationUnits.minutes'),
    seconds: t('nodes:durationUnits.seconds'),
    milliseconds: t('nodes:durationUnits.milliseconds'),
  };
}

type Parts = Partial<Record<keyof DurationUnits, number | string>>;

/** "HH:MM:SS(.s)" as its parts, or null for anything else (a template). */
function clockParts(text: string): Parts | null {
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3]) };
}

/**
 * A duration as a card shows it: "5 min", "1 h 30 min", "1.5 s", from any
 * form HA accepts (seconds as a number, "HH:MM:SS", an object); a template
 * as written. Shared by the Delay card and the duration pills.
 */
export function formatDuration(
  val: DurationValue | undefined,
  units: DurationUnits = ENGLISH
): string {
  const words = (parts: Parts) => {
    const out = (['hours', 'minutes', 'seconds', 'milliseconds'] as const)
      .filter((key) => Number(parts[key]) !== 0 && parts[key] !== undefined && parts[key] !== '')
      .map((key) => `${parts[key]} ${units[key]}`);
    return out.join(' ') || `0 ${units.seconds}`;
  };
  // A number is seconds (`delay: 5`, `delay: 1.5`), as HA reads it.
  if (typeof val === 'number') return words({ seconds: val });
  if (!val) return '';
  if (typeof val === 'string') {
    const parts = clockParts(val);
    return parts ? words(parts) : val;
  }
  if (typeof val === 'object') return words(val);
  return String(val);
}
