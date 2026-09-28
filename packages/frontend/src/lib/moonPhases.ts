/**
 * The moon phases HA knows (moon/helpers.py MOON_PHASES), for
 * `moon.phase_changed`'s optional `phase` (which also takes `any`, its
 * default) and `moon.is_phase`'s required one (#122).
 */
export const MOON_PHASES = [
  'new_moon',
  'waxing_crescent',
  'first_quarter',
  'waxing_gibbous',
  'full_moon',
  'waning_gibbous',
  'last_quarter',
  'waning_crescent',
] as const;
