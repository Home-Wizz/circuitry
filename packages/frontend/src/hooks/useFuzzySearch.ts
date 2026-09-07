import Fuse, { type IFuseOptions } from 'fuse.js';
import { useMemo, useState } from 'react';

export interface FuzzySearchOptions {
  keys: string[];
  threshold?: number;
  includeScore?: boolean;
  ignoreLocation?: boolean;
  includeMatches?: boolean;
  minMatchCharLength?: number;
}

/**
 * Custom hook for fuzzy searching using Fuse.js
 * Provides fuzzy search functionality with customizable options
 */
export function useFuzzySearch<T>(items: T[], options: FuzzySearchOptions) {
  const [query, setQuery] = useState('');

  // Depends on `options`' individual primitive fields, not the `options`
  // object itself — every caller passes a fresh object literal inline
  // (`useFuzzySearch(items, { keys: [...], threshold: 0.4, ... })`), so a
  // dependency on `options` as a whole is a *different reference* on every
  // single render regardless of whether any actual value changed, silently
  // defeating this useMemo entirely: it was rebuilding the whole Fuse.js
  // search index from scratch on every render, not just when `items` or a
  // real option value changed. `options.keys` is itself an inline array
  // literal too, so it's joined into a stable string for the same reason.
  const keysSignature = options.keys.join('|');
  const fuse = useMemo(() => {
    const defaultOptions: IFuseOptions<T> = {
      threshold: 0.3, // Lower = more strict, higher = more fuzzy
      ignoreLocation: true,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 1,
      keys: options.keys,
      ...(options.threshold !== undefined && { threshold: options.threshold }),
      ...(options.includeScore !== undefined && { includeScore: options.includeScore }),
      ...(options.ignoreLocation !== undefined && { ignoreLocation: options.ignoreLocation }),
      ...(options.includeMatches !== undefined && { includeMatches: options.includeMatches }),
      ...(options.minMatchCharLength !== undefined && {
        minMatchCharLength: options.minMatchCharLength,
      }),
    };

    return new Fuse(items, defaultOptions);
    // biome-ignore lint/correctness/useExhaustiveDependencies: keysSignature/threshold/etc. stand in for `options` on purpose — see comment above.
  }, [
    items,
    keysSignature,
    options.threshold,
    options.includeScore,
    options.ignoreLocation,
    options.includeMatches,
    options.minMatchCharLength,
  ]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return items.map((item, index) => ({
        item,
        refIndex: index,
        score: 0,
      }));
    }

    return fuse.search(query);
  }, [query, fuse, items]);

  return {
    query,
    setQuery,
    filteredItems: filteredItems.map((result) => result.item),
    results: filteredItems,
  };
}
