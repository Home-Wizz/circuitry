/** A group of recipes an entity is kept for, under a heading. */
export interface RecipeGroup<R> {
  heading: string;
  groupKey: string;
  recipes: R[];
}

type RowsByHeading<R> = Map<string, Map<string, { recipes: R[]; entityIds: string[] }>>;

/**
 * The trigger or condition rows a place's results list, by heading: each
 * entity's groups (`groupsFor`), its recipes narrowed by `keep`, entities
 * sharing a row only when they share the same recipes (two covers of one
 * category may be kept for different ones). A purpose-specific type two
 * groups list (door.opened for a door sensor and for a door cover) is one
 * row, for all their entities, where it's first listed (`typeOf`). Shared
 * by the When and And pickers' results panels.
 */
export function groupRecipesByHeading<R extends { id: string }>(
  entityIds: readonly string[],
  groupsFor: (entityId: string) => RecipeGroup<R>[],
  keep: (recipe: R) => boolean = () => true,
  typeOf?: (recipe: R) => string
): RowsByHeading<R> {
  const byHeading: RowsByHeading<R> = new Map();
  for (const entityId of entityIds) {
    for (const group of groupsFor(entityId)) {
      const recipes = group.recipes.filter(keep);
      if (recipes.length === 0) continue;
      let byKey = byHeading.get(group.heading);
      if (!byKey) {
        byKey = new Map();
        byHeading.set(group.heading, byKey);
      }
      const key = `${group.groupKey}|${recipes.map((r) => r.id).join(',')}`;
      const existing = byKey.get(key);
      if (existing) existing.entityIds.push(entityId);
      else byKey.set(key, { recipes, entityIds: [entityId] });
    }
  }
  return typeOf ? mergeSharedTypes(byHeading, typeOf) : byHeading;
}

/** One row per purpose-specific type: its entities from every group that
 * lists it, where it's first listed; the rest of each group as it was. */
function mergeSharedTypes<R>(byHeading: RowsByHeading<R>, typeOf: (recipe: R) => string) {
  const rows = [...byHeading].flatMap(([heading, byKey]) =>
    [...byKey].flatMap(([key, group]) =>
      group.recipes.map((recipe) => ({ heading, key, recipe, entityIds: [...group.entityIds] }))
    )
  );
  const first = new Map<string, (typeof rows)[number]>();
  const kept = rows.filter((row) => {
    const type = typeOf(row.recipe);
    if (!type.includes('.')) return true;
    const earlier = first.get(type);
    if (!earlier) {
      first.set(type, row);
      return true;
    }
    for (const id of row.entityIds) if (!earlier.entityIds.includes(id)) earlier.entityIds.push(id);
    return false;
  });
  const merged: RowsByHeading<R> = new Map();
  for (const { heading, key, recipe, entityIds } of kept) {
    let byKey = merged.get(heading);
    if (!byKey) {
      byKey = new Map();
      merged.set(heading, byKey);
    }
    const rowKey = `${key}|${entityIds.join(',')}`;
    const existing = byKey.get(rowKey);
    if (existing) existing.recipes.push(recipe);
    else byKey.set(rowKey, { recipes: [recipe], entityIds });
  }
  return merged;
}
