/**
 * The `period` option of HA's golden and blue hour triggers and
 * conditions (#122): which of the day's two golden/blue hours counts. HA
 * 2026.9's sun/triggers.yaml and conditions.yaml: a select of any/morning/
 * evening, default any.
 */
export type SunPeriod = 'any' | 'morning' | 'evening';

export interface SunPeriodField {
  values: SunPeriod[];
  default: SunPeriod;
}

const PERIOD: SunPeriodField = { values: ['any', 'morning', 'evening'], default: 'any' };

const SUN_PERIOD_TYPES = new Set<string>([
  'sun.blue_hour_started',
  'sun.blue_hour_ended',
  'sun.golden_hour_started',
  'sun.golden_hour_ended',
  'sun.is_blue_hour',
  'sun.is_golden_hour',
]);

export function getSunPeriodField(type: string): SunPeriodField | undefined {
  return SUN_PERIOD_TYPES.has(type) ? PERIOD : undefined;
}
