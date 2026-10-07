import { prettify } from '@/lib/utils';

/**
 * A name for an entity HA gives none (no friendly name) or no longer has,
 * made from its id rather than showing the id: `light.under_cabinet` ->
 * "Under cabinet". The id itself is never what a person should read.
 */
export function nameFromEntityId(entityId: string): string {
  const dot = entityId.indexOf('.');
  return prettify(dot === -1 ? entityId : entityId.slice(dot + 1));
}

/** An entity's name: its friendly name, else one made from its id. */
export function entityName(
  entity: { attributes: Record<string, unknown> } | undefined,
  entityId: string
): string {
  const friendly = entity?.attributes.friendly_name;
  return typeof friendly === 'string' && friendly ? friendly : nameFromEntityId(entityId);
}
