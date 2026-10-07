/** A type search found: what it is (`key`), its name, and the group it's
 * listed under ("Door", "Window"). */
export interface SearchTypeEntry {
  key: string;
  label: string;
  group: string;
}

/**
 * Search's types, as they read alone in one list: each type once (a type
 * two groups list, as door.opened under Cover and under Door, keeps its
 * first), and a name several types share ("Opened" for a window and for an
 * opening) given its group ("Window: Opened").
 */
export function uniqueSearchTypes<T extends SearchTypeEntry>(
  entries: readonly T[]
): (T & { shown: string })[] {
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
  const uses = new Map<string, number>();
  for (const entry of unique) uses.set(entry.label, (uses.get(entry.label) ?? 0) + 1);
  return unique.map((entry) => ({
    ...entry,
    shown: (uses.get(entry.label) ?? 0) > 1 ? `${entry.group}: ${entry.label}` : entry.label,
  }));
}

/** A type's key for search: a purpose-specific type is one type wherever
 * it's listed; a legacy one (`state` to on) is its group's own. */
export function searchTypeKey(type: string, groupKey: string, recipeId: string): string {
  return type.includes('.') ? type : `${groupKey}:${recipeId}`;
}
