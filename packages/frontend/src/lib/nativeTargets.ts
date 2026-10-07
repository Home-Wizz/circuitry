import type { NodeValidationError } from '@circuitry/shared';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { NativeDescription } from '@/lib/nativeDescriptions';
import { picksZone } from '@/lib/nativeZone';
import {
  type EntityFeatures,
  type EntityFilter,
  entityFiltersOf,
  featuresOf,
  filterTakes,
  literalIds,
  type ServiceTargetContext,
} from '@/lib/serviceTargets';
import { isRecord } from '@/lib/utils';

/**
 * The entities a purpose-specific trigger or condition acts on (#166). HA
 * keeps only the targets its type accepts, by domain and, where the type
 * names one, device class (helpers/automation.py's filter_by_domain_specs):
 * door.opened takes a door sensor or a door cover, and drops a motion
 * sensor without a word, so the trigger never fires for it. The type's
 * description lists the same filters (`target.entity`; the target-specs
 * test holds the two to each other for every type HA 2026.9.3 has).
 */

/** A type's target filters as the connected HA describes them, or null
 * when it describes none (a legacy platform, a targetless type, an HA that
 * hasn't described it). */
export function nativeTargetFilters(
  description: NativeDescription | null | undefined
): EntityFilter[] | null {
  return description ? entityFiltersOf(description.target) : null;
}

type Kind = 'trigger' | 'condition';

/** The filters an entity picked for a type must pass: its target's. None
 * for a zone trigger or condition, whose picked entities are its zones
 * (lib/nativeZone.ts), not its target. */
function pickFilters(
  kind: Kind,
  type: string,
  description: NativeDescription | null | undefined
): EntityFilter[] | null {
  return picksZone(kind, type) ? null : nativeTargetFilters(description);
}

/** Whether HA keeps the entity as a target of a type with these filters. */
export function filtersTake(
  filters: readonly EntityFilter[],
  entityId: string,
  features: EntityFeatures
): boolean {
  return filters.some((filter) => filterTakes(filter, entityId, features));
}

/** The fallback where HA describes nothing: a catalog category's domains,
 * and its device class for entities of its own domain. */
export interface CategoryScope {
  domains: readonly string[];
  domain: string;
  deviceClass?: string;
}

/** Whether a picker offers the entity for a type: HA keeps it, read from
 * the type's description; where HA describes no filters (or the picks are
 * a zone's), it's of the category the type was picked from. */
function offersFor(
  kind: Kind,
  type: string,
  description: NativeDescription | null | undefined,
  scope: CategoryScope
): (entity: HassEntity) => boolean {
  const filters = pickFilters(kind, type, description);
  if (filters) return (e) => filtersTake(filters, e.entity_id, featuresOf(e));
  return (e) => {
    const domain = e.entity_id.split('.')[0] ?? '';
    if (!scope.domains.includes(domain)) return false;
    return (
      scope.deviceClass === undefined ||
      domain !== scope.domain ||
      featuresOf(e).device_class === scope.deviceClass
    );
  };
}

/** The entities a picker offers for a type (offersFor). */
export function entitiesForType(
  entities: readonly HassEntity[],
  kind: Kind,
  type: string,
  description: NativeDescription | null | undefined,
  scope: CategoryScope
): HassEntity[] {
  return entities.filter(offersFor(kind, type, description, scope));
}

/** Whether a type reaches config and diagnostic entities: HA describes
 * its target with `primary_entities_only: false` (the battery's types). */
export function reachesSecondary(description: NativeDescription | null | undefined): boolean {
  return isRecord(description?.target) && description.target.primary_entities_only === false;
}

/** A config or diagnostic entity's categories: only the types that reach it
 * (reachesSecondary). */
export function secondaryEntityCategories<R, C extends { recipes: R[] }>(
  categories: readonly C[],
  typeOf: (recipe: R) => string,
  describe: (type: string) => NativeDescription | null | undefined
): C[] {
  return categories
    .map((c) => ({ ...c, recipes: c.recipes.filter((r) => reachesSecondary(describe(typeOf(r)))) }))
    .filter((c) => c.recipes.length > 0);
}

/** A catalog category, as far as an entity's picks go. */
interface RecipeCategory<R> {
  groupKey: string;
  recipes: R[];
}

/**
 * The types offered for one entity ("By target"), as categories: its own
 * category's types HA keeps it for, then every other category's types
 * whose described target takes it (a door cover's door conditions, a
 * thermostat's temperature types), each type once. A type HA describes no
 * target filters for is the entity's own category's to offer, as before.
 */
export function categoriesForEntity<R, C extends RecipeCategory<R>>(
  entity: HassEntity,
  own: C | null,
  catalog: readonly C[],
  kind: Kind,
  typeOf: (recipe: R) => string,
  describe: (type: string) => NativeDescription | null | undefined
): C[] {
  const features = featuresOf(entity);
  const seen = new Set<string>();
  const out: C[] = [];
  const take = (category: C, viaOwn: boolean) => {
    const recipes = category.recipes.filter((recipe) => {
      const type = typeOf(recipe);
      if (seen.has(type)) return false;
      const filters = pickFilters(kind, type, describe(type));
      return filters ? filtersTake(filters, entity.entity_id, features) : viaOwn;
    });
    for (const recipe of recipes) seen.add(typeOf(recipe));
    if (recipes.length > 0) out.push({ ...category, recipes });
  };
  if (own) take(own, true);
  for (const category of catalog) if (category.groupKey !== own?.groupKey) take(category, false);
  return out;
}

/**
 * The types a place's results list for one of its entities, by category:
 * its own category's types that the connected HA offers, and any other
 * category's whose target takes it (categoriesForEntity). Without a state,
 * its own as listed. The When and And pickers' results panels use it, as
 * does the test that every type reaches the entities it targets.
 */
export function entityRecipeGroups<R, C extends RecipeCategory<R>>(
  entity: HassEntity | undefined,
  found: C | null,
  catalog: readonly C[],
  kind: Kind,
  typeOf: (recipe: R) => string,
  offers: (type: string) => boolean,
  describe: (type: string) => NativeDescription | null | undefined
): C[] {
  const own = found && { ...found, recipes: found.recipes.filter((r) => offers(typeOf(r))) };
  return entity
    ? categoriesForEntity(entity, own, catalog, kind, typeOf, describe)
    : own
      ? [own]
      : [];
}

/**
 * A warning when a purpose-specific trigger or condition names an entity
 * HA drops for it: HA saves the automation, and that entity is ignored
 * (never an error: decision D3). An entity HA sends no state for, or a
 * template, isn't checked.
 */
export function ignoredTargetIssues(
  data: Record<string, unknown>,
  description: NativeDescription | null | undefined,
  context: ServiceTargetContext | undefined
): NodeValidationError[] {
  const filters = nativeTargetFilters(description);
  if (!filters || !context || !isRecord(data.target)) return [];
  const ignored = literalIds(data.target.entity_id).some((id) => {
    const features = context.features[id];
    return features !== undefined && !filtersTake(filters, id, features);
  });
  return ignored
    ? [
        {
          path: ['target', 'entity_id'],
          message: 'errors:validation.node.entityIgnored',
          severity: 'warning',
        },
      ]
    : [];
}
