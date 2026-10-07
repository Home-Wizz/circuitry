import {
  CONDITION_BLOCKS,
  type ConditionBlock,
  type ConditionRecipe,
  ENTITY_CONDITION_CATEGORIES,
  type EntityConditionCategory,
  MOON_CONDITIONS,
  SUN_CONDITIONS,
} from '@/lib/conditionRecipes';
import {
  describedThresholdShape,
  type NativeDescription,
  type NativeDescriptions,
} from '@/lib/nativeDescriptions';
import { getConditionThresholdShape, getTriggerThresholdShape } from '@/lib/nativeThreshold';
import {
  ENTITY_TRIGGER_CATEGORIES,
  type EntityTriggerCategory,
  type TriggerRecipe,
} from '@/lib/triggerRecipes';
import { describedFieldDefaults } from '@/lib/describedFields';
import { isRecord, prettify } from '@/lib/utils';

/**
 * The pickers' catalog, as the connected HA has it. The hand-written
 * catalog (lib/triggerRecipes.ts, lib/conditionRecipes.ts) stays the
 * curated base -- its order, names,
 * groups, and the fallbacks HA has no purpose-specific type for -- and the
 * connected HA's own descriptions (`trigger_platforms/subscribe`,
 * `condition_platforms/subscribe`, what HA's editor builds its picker from)
 * adjust it both ways:
 *
 * - a purpose-specific type HA describes that the catalog doesn't know is
 *   added, named and described from HA's translations, acting on the
 *   entities its target names, its fields rendered by HA's own selectors;
 * - a purpose-specific type the catalog has but HA doesn't describe is
 *   hidden: that HA would refuse it (an older release, or an integration
 *   that isn't loaded, which HA's own editor doesn't offer either);
 * - a type the catalog gives a threshold that HA describes without one (an
 *   HA from before the threshold rework) seeds none: its bounds are HA's
 *   own fields.
 *
 * An HA that describes nothing (one from before these commands, or before
 * its first answer) leaves the catalog as it is.
 */

type Kind = 'trigger' | 'condition';

/** A type's name and description in HA's language, when it has them. */
export interface HaTypeText {
  name?: string;
  description?: string;
}
export type HaTypeTexts = (kind: Kind, type: string) => HaTypeText;
/** An integration's name in HA's language (`component.<domain>.title`). */
export type HaTitles = (domain: string) => string | undefined;

/** The types the hand-written catalog offers, by kind. */
export const KNOWN_TRIGGER_TYPES: ReadonlySet<string> = new Set(
  ENTITY_TRIGGER_CATEGORIES.flatMap((category) => category.recipes.map((r) => r.fields.trigger))
);
export const KNOWN_CONDITION_TYPES: ReadonlySet<string> = new Set([
  ...ENTITY_CONDITION_CATEGORIES.flatMap((category) =>
    category.recipes.map((r) => r.fields.condition)
  ),
  ...[...CONDITION_BLOCKS, ...SUN_CONDITIONS, ...MOON_CONDITIONS]
    .map((block) => block.data.condition)
    .filter((type): type is string => typeof type === 'string'),
]);

/** Whether the connected HA offers a type: any legacy platform or
 * condition, and, once HA describes anything, the purpose-specific types it
 * describes. */
export function haOffers(type: string, described: NativeDescriptions): boolean {
  return !type.includes('.') || Object.keys(described).length === 0 || type in described;
}

/** Whether the tables give a type a threshold the connected HA describes
 * it without (an HA from before the threshold rework: its bounds are other
 * fields, describedThresholdShape). */
function describedWithoutThreshold(
  kind: Kind,
  type: string,
  described: NativeDescriptions
): boolean {
  const description = described[type];
  if (!description) return false;
  const tables =
    kind === 'trigger' ? getTriggerThresholdShape(type) : getConditionThresholdShape(type);
  return tables !== 'none' && describedThresholdShape(kind, type, description) === 'none';
}

/** A recipe's fields that seed no threshold, and that HA's bound fields
 * start at their defaults (describedFieldDefaults: 2026.2's
 * `threshold_type`, which its validator has no default for). */
function noThreshold(
  kind: Kind,
  type: string,
  options: Record<string, unknown> | undefined,
  described: NativeDescriptions
): { thresholdless: true; options: Record<string, unknown> } {
  const { threshold: _seeded, ...rest } = options ?? {};
  const description = described[type];
  const defaults = description ? describedFieldDefaults(kind, type, description) : {};
  return { thresholdless: true, options: { ...defaults, ...rest } };
}

/** A discovered type's starting options: its required fields' defaults
 * (describedFieldDefaults), when it has any. */
function seededOptions(
  kind: Kind,
  type: string,
  description: NativeDescription
): { options?: Record<string, unknown> } {
  const defaults = describedFieldDefaults(kind, type, description);
  return Object.keys(defaults).length > 0 ? { options: defaults } : {};
}

/** The purpose-specific types HA describes that the catalog doesn't know. */
function discovered(
  described: NativeDescriptions,
  known: ReadonlySet<string>
): [string, NativeDescription][] {
  return Object.entries(described)
    .filter(
      (entry): entry is [string, NativeDescription] => entry[0].includes('.') && entry[1] !== null
    )
    .filter(([type]) => !known.has(type))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** The entity domains a described target names (`{ entity: [{ domain }] }`,
 * one filter or several, each with one domain or several). */
export function targetDomains(description: NativeDescription): string[] {
  const target = isRecord(description.target) ? description.target : undefined;
  const filters =
    target?.entity === undefined
      ? []
      : Array.isArray(target.entity)
        ? target.entity
        : [target.entity];
  const domains = filters.flatMap((filter) => {
    const domain = isRecord(filter) ? filter.domain : undefined;
    return typeof domain === 'string' ? [domain] : Array.isArray(domain) ? domain : [];
  });
  return [...new Set(domains.filter((d): d is string => typeof d === 'string'))];
}

/** The integration a purpose-specific type belongs to, and its own key. */
function splitType(type: string): [string, string] {
  const dot = type.indexOf('.');
  return [type.slice(0, dot), type.slice(dot + 1)];
}

function label(texts: HaTypeTexts, kind: Kind, type: string): HaTypeText & { name: string } {
  const text = texts(kind, type);
  return { name: text.name || prettify(splitType(type)[1]), description: text.description };
}

/** Whether a category already holds types of `domain`: it, or else the
 * category named for the domain, gets the discovered ones too, rather than
 * a second category of the same name. */
const holdsDomain = (types: string[], domain: string) =>
  types.some((t) => t.startsWith(`${domain}.`));

/** The When picker's categories: the catalog's that HA offers, with the
 * types HA describes and the catalog doesn't know added. */
export function triggerCatalog(
  described: NativeDescriptions,
  texts: HaTypeTexts,
  titles: HaTitles
): EntityTriggerCategory[] {
  const categories = ENTITY_TRIGGER_CATEGORIES.map((category) => ({
    ...category,
    recipes: category.recipes
      .filter((recipe) => haOffers(recipe.fields.trigger, described))
      .map((recipe) =>
        describedWithoutThreshold('trigger', recipe.fields.trigger, described)
          ? {
              ...recipe,
              fields: {
                ...recipe.fields,
                ...noThreshold('trigger', recipe.fields.trigger, recipe.fields.options, described),
              },
            }
          : recipe
      ),
  }));
  for (const [type, description] of discovered(described, KNOWN_TRIGGER_TYPES)) {
    const [domain] = splitType(type);
    const text = label(texts, 'trigger', type);
    const recipe: TriggerRecipe = {
      id: `discovered:${type}`,
      label: text.name,
      description: text.description,
      fields: {
        trigger: type,
        targetless: description.target === undefined,
        // Its threshold is HA's description's (a name like `*_crossed_
        // threshold` alone doesn't give it one).
        ...(describedWithoutThreshold('trigger', type, described) ? { thresholdless: true } : {}),
        ...seededOptions('trigger', type, description),
      },
    };
    const entityDomains = targetDomains(description);
    const home =
      categories.find((c) =>
        holdsDomain(
          c.recipes.map((r) => r.fields.trigger),
          domain
        )
      ) ?? categories.find((c) => c.groupKey === domain);
    if (home) {
      home.recipes = [...home.recipes, recipe];
      if (entityDomains.length > 0 && !entityDomains.every((d) => d === home.domain)) {
        home.entityDomains = [
          ...new Set([...(home.entityDomains ?? [home.domain]), ...entityDomains]),
        ];
      }
      continue;
    }
    const heading = titles(domain) || prettify(domain);
    categories.push({
      groupKey: `discovered:${domain}`,
      domain,
      ...(entityDomains.length > 0 && !entityDomains.every((d) => d === domain)
        ? { entityDomains }
        : {}),
      heading,
      label: heading,
      recipes: [recipe],
    });
  }
  return categories.filter((category) => category.recipes.length > 0);
}

/** The And picker's catalog: its categories and the sun's and moon's
 * conditions (picked as blocks), as for triggerCatalog. */
export interface ConditionCatalog {
  categories: EntityConditionCategory[];
  sun: ConditionBlock[];
  moon: ConditionBlock[];
}

export function conditionCatalog(
  described: NativeDescriptions,
  texts: HaTypeTexts,
  titles: HaTitles
): ConditionCatalog {
  const offeredBlock = (block: ConditionBlock) =>
    typeof block.data.condition !== 'string' || haOffers(block.data.condition, described);
  const sun = SUN_CONDITIONS.filter(offeredBlock);
  const moon = MOON_CONDITIONS.filter(offeredBlock);
  const categories = ENTITY_CONDITION_CATEGORIES.map((category) => ({
    ...category,
    recipes: category.recipes
      .filter((recipe) => haOffers(recipe.fields.condition, described))
      .map((recipe) =>
        describedWithoutThreshold('condition', recipe.fields.condition, described)
          ? {
              ...recipe,
              fields: {
                ...recipe.fields,
                ...noThreshold(
                  'condition',
                  recipe.fields.condition,
                  recipe.fields.options,
                  described
                ),
              },
            }
          : recipe
      ),
  }));
  for (const [type, description] of discovered(described, KNOWN_CONDITION_TYPES)) {
    const [domain] = splitType(type);
    const text = label(texts, 'condition', type);
    const targetless = description.target === undefined;
    // The sun's and the moon's are picked as blocks, beside the others.
    if ((domain === 'sun' || domain === 'moon') && targetless) {
      const block: ConditionBlock = {
        key: `discovered:${type}`,
        label: text.name,
        description: text.description ?? '',
        data: { condition: type },
      };
      (domain === 'sun' ? sun : moon).push(block);
      continue;
    }
    const recipe: ConditionRecipe = {
      id: `discovered:${type}`,
      label: text.name,
      description: text.description,
      fields: {
        condition: type,
        targetless,
        ...(describedWithoutThreshold('condition', type, described) ? { thresholdless: true } : {}),
        ...seededOptions('condition', type, description),
      },
    };
    const entityDomains = targetDomains(description);
    const home =
      categories.find((c) =>
        holdsDomain(
          c.recipes.map((r) => r.fields.condition),
          domain
        )
      ) ?? categories.find((c) => c.groupKey === domain);
    if (home) {
      home.recipes = [...home.recipes, recipe];
      if (entityDomains.length > 0 && !entityDomains.every((d) => d === home.entityDomain)) {
        home.entityDomains = [
          ...new Set([...(home.entityDomains ?? [home.entityDomain]), ...entityDomains]),
        ];
      }
      continue;
    }
    const heading = titles(domain) || prettify(domain);
    categories.push({
      groupKey: `discovered:${domain}`,
      conditionPrefix: domain,
      entityDomain: entityDomains[0] ?? domain,
      ...(entityDomains.length > 1 ? { entityDomains } : {}),
      heading,
      label: heading,
      recipes: [recipe],
    });
  }
  return { categories: categories.filter((category) => category.recipes.length > 0), sun, moon };
}

/** The entity domains a category's recipes act on. */
export function categoryEntityDomains(
  category: { entityDomains?: string[] },
  own: string
): string[] {
  return category.entityDomains ?? [own];
}
