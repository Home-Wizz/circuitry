import { z } from 'zod';

/**
 * A Home Assistant duration, as `delay:`, a wait's `timeout:` and a
 * trigger's `for:` take it (HA's `positive_time_period_template`): an
 * "HH:MM:SS[.ms]" string or a template, a number of seconds (whole or
 * fractional, `delay: 5`, `timeout: 1.5`), or an object of
 * days/hours/minutes/seconds/milliseconds, each a number or a template
 * (unknown keys kept, so nothing is dropped on the way through).
 *
 * The number form was missing: the parser turned `delay: 5` into
 * `delay: ""` (bug #60) and dropped `timeout: 30` altogether (bug #61).
 * One schema for every duration, so they can't drift apart again: a
 * trigger's `for:` had its own copy without `days`, which dropped it
 * (bug #194).
 */
export const HADurationSchema = z.union([
  z.string(),
  z.number(),
  z.looseObject({
    days: z.union([z.number(), z.string()]).optional(),
    hours: z.union([z.number(), z.string()]).optional(),
    minutes: z.union([z.number(), z.string()]).optional(),
    seconds: z.union([z.number(), z.string()]).optional(),
    milliseconds: z.union([z.number(), z.string()]).optional(),
  }),
]);
export type HADuration = z.infer<typeof HADurationSchema>;
