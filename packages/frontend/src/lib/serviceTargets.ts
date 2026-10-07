import type { NodeValidationError } from '@circuitry/shared';
import type { HassEntity, HassServices } from 'home-assistant-js-websocket';
import { type ActionRecipe, getEntityActionCategory } from '@/lib/actionRecipes';
import { isRecord } from '@/lib/utils';

/**
 * Which entities an action can act on (#130). HA refuses a service call
 * that names an entity without the features the service needs ("Entity ...
 * does not support action ..."), and the automation step making it fails;
 * so the pickers offer only entities that have them, and a step naming one
 * that doesn't is flagged.
 *
 * HA's rule (helpers/service.py): an entity qualifies when it has every
 * feature of at least one of the service's feature sets, and an entity
 * without a `supported_features` attribute qualifies for none. (HA's own
 * entity picker asks for any one feature of a set, not all of them.)
 *
 * The feature sets are the ones HA registers the service with. The editor
 * sees only the service's description (its `target.entity` filters), which
 * says the same for every service but those below: there HA 2025.8 through
 * 2026.9 register other sets than they describe (or describe none). Read
 * from a real HA; the service-target tests hold this rule to that HA's
 * verdict on every call.
 */
const REGISTERED_FEATURES: Record<string, number[] | null> = {
  'fan.set_preset_mode': [1, 8],
  'fan.toggle': [16, 32],
  'media_player.browse_media': null,
  'update.install': [1],
  'vacuum.clean_spot': [1024],
  'vacuum.send_command': [256],
  'vacuum.set_fan_speed': [32],
  'water_heater.set_away_mode': [4],
  'water_heater.set_operation_mode': [2],
  'water_heater.set_temperature': [1],
  'water_heater.turn_off': [8],
  'water_heater.turn_on': [8],
};

/** One of a description's `target.entity` filters. */
export interface EntityFilter {
  domain?: string[];
  device_class?: string[];
  supported_features?: number[];
  integration?: string;
}

const stringList = (value: unknown): string[] | undefined =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : undefined;

const numberList = (value: unknown): number[] | undefined =>
  typeof value === 'number'
    ? [value]
    : Array.isArray(value)
      ? value.filter((v): v is number => typeof v === 'number')
      : undefined;

function asFilter(value: unknown): EntityFilter | null {
  if (!isRecord(value)) return null;
  return {
    domain: stringList(value.domain),
    device_class: stringList(value.device_class),
    supported_features: numberList(value.supported_features),
    integration: typeof value.integration === 'string' ? value.integration : undefined,
  };
}

/** A description's `target.entity` filters (one filter or a list), or
 * null when it gives none: a service's, or a purpose-specific trigger's or
 * condition's. */
export function entityFiltersOf(target: unknown): EntityFilter[] | null {
  const entity = isRecord(target) ? target.entity : undefined;
  const raw = Array.isArray(entity) ? entity : entity === undefined ? [] : [entity];
  const filters = raw.map(asFilter).filter((f): f is EntityFilter => f !== null);
  return filters.length > 0 ? filters : null;
}

/** A service's `target.entity` filters as its description gives them (one
 * filter or a list), or null when it gives none. */
export function serviceEntityFilters(
  services: HassServices | undefined,
  service: string
): EntityFilter[] | null {
  const [domain, name] = service.split('.');
  return entityFiltersOf(services?.[domain]?.[name]?.target);
}

/** HA's feature rule: every feature of at least one set. */
export function hasFeatureSet(supported: number | undefined, featureSets: number[]): boolean {
  if (typeof supported !== 'number') return false;
  return featureSets.some((set) => (supported & set) === set);
}

/** What the check reads of an entity's state. */
export interface EntityFeatures {
  supported_features?: number;
  device_class?: string;
}

export function featuresOf(entity: HassEntity): EntityFeatures {
  const { supported_features, device_class } = entity.attributes;
  return {
    ...(typeof supported_features === 'number' ? { supported_features } : {}),
    ...(typeof device_class === 'string' ? { device_class } : {}),
  };
}

/** Whether an entity passes a filter's domain and device class.
 * (`integration` names the entity's integration, which its state doesn't
 * say; such a filter is taken as met.) */
export function filterTakes(
  filter: EntityFilter,
  entityId: string,
  features: EntityFeatures
): boolean {
  const domain = entityId.split('.')[0];
  if (filter.domain && !filter.domain.includes(domain)) return false;
  const deviceClass = features.device_class;
  return !(
    filter.device_class && !(deviceClass !== undefined && filter.device_class.includes(deviceClass))
  );
}

function filterMatches(
  filter: EntityFilter,
  entityId: string,
  features: EntityFeatures,
  featureSets: number[] | null
): boolean {
  if (!filterTakes(filter, entityId, features)) return false;
  return featureSets === null || featureSets.length === 0
    ? true
    : hasFeatureSet(features.supported_features, featureSets);
}

/** Whether HA takes the entity `entityId`, with `features`, as a target of
 * `service`. See entitySupportsService. */
export function serviceTakes(
  services: HassServices | undefined,
  service: string,
  entityId: string,
  features: EntityFeatures
): boolean {
  const filters = serviceEntityFilters(services, service);
  const registered = Object.hasOwn(REGISTERED_FEATURES, service)
    ? REGISTERED_FEATURES[service]
    : undefined;
  if (!filters) {
    return registered ? hasFeatureSet(features.supported_features, registered) : true;
  }
  return filters.some((filter) =>
    filterMatches(
      filter,
      entityId,
      features,
      registered !== undefined ? registered : (filter.supported_features ?? null)
    )
  );
}

/**
 * Whether HA takes `entity` as a target of `service`. True when nothing is
 * known against it: services not loaded yet, a service HA doesn't describe,
 * or one whose description doesn't restrict its entities.
 */
export function entitySupportsService(
  services: HassServices | undefined,
  service: string,
  entity: HassEntity
): boolean {
  return serviceTakes(services, service, entity.entity_id, featuresOf(entity));
}

/** The entities of `entities` HA takes as targets of `service`. */
export function entitiesForService<T extends HassEntity>(
  services: HassServices | undefined,
  service: string,
  entities: T[]
): T[] {
  return entities.filter((entity) => entitySupportsService(services, service, entity));
}

/** A catalog action offered for a selection, with the selected entities
 * that can do it. */
export interface ActionRecipeOffer {
  recipe: ActionRecipe;
  entityIds: string[];
}

/**
 * The catalog actions for a selection of entities (an area, a device, ...),
 * by their category's heading: each with the selected entities that can do
 * it. An action none of them can do isn't offered. An entity HA sends no
 * state for is kept: nothing is known against it.
 */
export function actionRecipeOffers(
  entityIds: string[],
  entities: HassEntity[],
  services: HassServices | undefined
): Map<string, ActionRecipeOffer[]> {
  const byId = new Map(entities.map((e) => [e.entity_id, e]));
  const groups = new Map<
    string,
    { heading: string; recipes: ActionRecipe[]; entityIds: string[] }
  >();
  for (const entityId of entityIds) {
    const category = getEntityActionCategory(entityId);
    if (!category) continue;
    const key = `${category.heading}\u0000${category.groupKey}`;
    const group = groups.get(key);
    if (group) group.entityIds.push(entityId);
    else
      groups.set(key, {
        heading: category.heading,
        recipes: category.recipes,
        entityIds: [entityId],
      });
  }
  const out = new Map<string, ActionRecipeOffer[]>();
  for (const group of groups.values()) {
    const offers = group.recipes
      .map((recipe) => ({
        recipe,
        entityIds: group.entityIds.filter((id) => {
          const entity = byId.get(id);
          return !entity || entitySupportsService(services, recipe.service, entity);
        }),
      }))
      .filter((offer) => offer.entityIds.length > 0);
    if (offers.length > 0) out.set(group.heading, [...(out.get(group.heading) ?? []), ...offers]);
  }
  return out;
}

/** HA's services and each entity's features: what the editor checks an
 * action step's entities against. */
export interface ServiceTargetContext {
  services: HassServices;
  features: Record<string, EntityFeatures>;
}

/** Each entity's features, from HA's states. */
export function entityFeatures(
  states: Record<string, HassEntity> | undefined
): Record<string, EntityFeatures> {
  const out: Record<string, EntityFeatures> = {};
  for (const [id, entity] of Object.entries(states ?? {})) out[id] = featuresOf(entity);
  return out;
}

/** Every feature bit set (HA's feature flags are well below 2^31). */
const ALL_FEATURES = 0x7fffffff;

/** The entity ids a step names literally (one string, comma-separated, or
 * a list), templates left out. */
export const literalIds = (value: unknown): string[] =>
  (typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.includes('.') && !v.includes('{'));

/**
 * A warning when an action step names an entity HA would refuse for its
 * service for lack of a feature (#130): HA saves the automation, and the
 * step fails when it runs (never an error: decision D3). An entity named in `target` or in `data`
 * (HA takes `entity_id` in either) counts; a template, or an entity HA
 * sends no state for, isn't checked.
 */
export function unsupportedTargetIssues(
  data: Record<string, unknown>,
  context: ServiceTargetContext | undefined
): NodeValidationError[] {
  const service = typeof data.service === 'string' ? data.service : undefined;
  if (!service || !context) return [];
  const issues: NodeValidationError[] = [];
  for (const key of ['target', 'data'] as const) {
    const block = data[key];
    if (!isRecord(block)) continue;
    // Refused for its features: taken were it to have every feature. (One
    // of another domain HA skips, doing nothing, rather than failing.)
    const refused = literalIds(block.entity_id).some((id) => {
      const features = context.features[id];
      return (
        features !== undefined &&
        !serviceTakes(context.services, service, id, features) &&
        serviceTakes(context.services, service, id, {
          ...features,
          supported_features: ALL_FEATURES,
        })
      );
    });
    if (refused) {
      issues.push({
        path: [key, 'entity_id'],
        message: 'errors:validation.action.entityUnsupported',
        severity: 'warning',
      });
    }
  }
  return issues;
}

/** Whether HA describes a target for a service: it acts on entities, an
 * area ("Anything in <room>") or a device given as its target. A service
 * with an entity field but no target takes entities only. */
export function serviceHasTarget(services: HassServices | undefined, service: string): boolean {
  const [domain, name] = service.split('.');
  return services?.[domain ?? '']?.[name ?? '']?.target !== undefined;
}
