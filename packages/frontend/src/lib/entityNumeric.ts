import type { HassEntity } from '@/types/hass';

/** Domains whose state is a number, as Home Assistant's add-trigger dialog lists them. */
const NUMERIC_DOMAINS: ReadonlySet<string> = new Set([
  'counter',
  'input_number',
  'number',
  'sensor',
]);

/**
 * Whether the picker offers "Numeric state" for one entity beside "State":
 * Home Assistant's rule (its add trigger / condition dialog) is a numeric
 * domain, or an entity that reports a unit or a state class (bug #192).
 */
export function offersNumericState(
  entityId: string,
  entity: Pick<HassEntity, 'attributes'> | undefined
): boolean {
  if (NUMERIC_DOMAINS.has(entityId.split('.')[0] ?? '')) return true;
  const attributes: Record<string, unknown> = entity?.attributes ?? {};
  return Boolean(attributes.unit_of_measurement) || Boolean(attributes.state_class);
}
