/**
 * `target`/`options` only belong on purpose-specific dotted conditions
 * (e.g. `climate.is_cooling` — `options` holds inline threshold state like
 * `options.threshold`, `target` holds the entity/device/area it applies
 * to). Legacy flat condition types (state, time, sun, zone, ...) never have
 * either in HA's own schema, and HA's config validator rejects them
 * outright as "extra keys not allowed" the moment they show up — regardless
 * of how they got there.
 *
 * A defensive strip here, independent of the frontend fix that stops these
 * fields from being *written* onto the wrong condition type in the first
 * place (see packages/frontend/src/config/conditionFields.ts's
 * getAllConditionFieldNames), means a condition that's already carrying a
 * stale `target`/`options` — from an already-saved automation, or a
 * live-but-unsaved canvas session — transpiles cleanly the moment this
 * ships, without the user having to reconfigure it again just to clear the
 * leftover field. Reported directly: reconfiguring an If/Else condition
 * from a purpose-specific type (with a threshold) to the legacy "Time" type
 * left `options` behind, and saving failed with "extra keys not allowed @
 * ...['options']".
 *
 * Every `sun.*` condition is the one dotted family that takes no `target`
 * (the sun is a singleton; HA refuses the key), so a stray one is dropped.
 * Its `options` are kept: `sun.elevation` needs `options.threshold`, the
 * twilight conditions take `options.type`, golden and blue hour
 * `options.period`, and the others take `options: {}` (HA's default).
 * They used to be dropped too, on the belief that the sun conditions take
 * no options, which left every elevation and twilight condition impossible
 * to save (#120: the graph checker refused the output).
 *
 * The graph checkers read conditions through this too (verification/
 * boolean.ts): a key HA refuses means nothing, and the checker comparing
 * the node with it against the output without it refused every condition
 * carrying a stray one -- the strip never got to heal anything (#120).
 */
export function stripDottedOnlyConditionFields(
  condition: unknown,
  rest: Record<string, unknown>
): Record<string, unknown> {
  if (typeof condition === 'string' && condition.startsWith('sun.')) {
    const { target, ...cleaned } = rest;
    return cleaned;
  }
  if (typeof condition === 'string' && condition.includes('.')) return rest;
  const { target, options, ...cleaned } = rest;
  return cleaned;
}
