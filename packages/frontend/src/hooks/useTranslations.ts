import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useOptionalHass } from '@/contexts/HassContext';

const DEFAULT_CATEGORIES = ['device_automation'] as const;

type CallWS = { callWS: (message: { type: string; [key: string]: unknown }) => Promise<unknown> };

/** Each connection's fetched categories, by language and category. */
const fetched = new WeakMap<object, Map<string, Promise<Record<string, string>>>>();

function cachedCategory(
  connection: object,
  language: string,
  category: string,
  hass: CallWS
): Promise<Record<string, string>> {
  let byKey = fetched.get(connection);
  if (!byKey) {
    byKey = new Map();
    fetched.set(connection, byKey);
  }
  const key = `${language}|${category}`;
  let pending = byKey.get(key);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => hass.callWS({ type: 'frontend/get_translations', language, category }))
      .then((result) => {
        const parsed = TranslationResponseSchema.safeParse(result);
        return parsed.success ? parsed.data.resources : {};
      })
      // Expected if message type doesn't exist (or there's no such call)
      .catch(() => ({}));
    byKey.set(key, pending);
  }
  return pending;
}

// Zod schema for translation API response
const TranslationResponseSchema = z.object({
  resources: z.record(z.string(), z.unknown()).transform((resources) => {
    const stringResources: Record<string, string> = {};
    for (const [key, value] of Object.entries(resources)) {
      if (typeof value === 'string') {
        stringResources[key] = value;
      }
    }
    return stringResources;
  }),
});

/**
 * Hook to manage Home Assistant translation loading.
 * Uses the unified hass instance from context and fetches the given
 * translation categories (device_automation by default; the pickers also
 * read `triggers`, `conditions` and `title` for the types HA describes).
 */
export function useTranslations(categories: readonly string[] = DEFAULT_CATEGORIES) {
  // Outside a HassProvider (a field editor rendered alone), no translations.
  const hass = useOptionalHass()?.hass;
  const [wsTranslations, setWsTranslations] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  // One string, so a new array each render doesn't refetch.
  const categoryList = categories.join('|');

  // Get base translations from hass.resources (already unified via HassContext)
  // Note: At runtime, HA provides resources as a flat Record<string, string> for the current language,
  // but the custom-card-helpers type defines it as nested { [lang]: { [key]: string } }
  const baseTranslations = useMemo(() => {
    const resources = hass?.resources;
    if (!resources || Object.keys(resources).length === 0) {
      return {};
    }
    // Check if it's already flat (string values) or nested (object values)
    const firstValue = Object.values(resources)[0];
    if (typeof firstValue === 'string') {
      // Already flat - cast since HA runtime differs from type definition
      return resources as unknown as Record<string, string>;
    }
    // Nested structure - flatten for current language
    if (typeof firstValue === 'object' && firstValue !== null) {
      const flat: Record<string, string> = {};
      for (const langTranslations of Object.values(resources)) {
        if (typeof langTranslations === 'object' && langTranslations !== null) {
          Object.assign(flat, langTranslations);
        }
      }
      return flat;
    }
    return {};
  }, [hass?.resources]);

  // Fetch the categories' translations via WebSocket, once per connection,
  // language and category (every panel and picker shares the answer).
  const connection = hass?.connection;
  const hassRef = useRef(hass);
  hassRef.current = hass;
  useEffect(() => {
    const current = hassRef.current;
    if (!current || !connection) {
      setIsLoading(false);
      return;
    }
    const language = navigator.language.split('-')[0] || 'en';
    let cancelled = false;
    setIsLoading(true);
    Promise.all(
      categoryList
        .split('|')
        .map((category) => cachedCategory(connection, language, category, current))
    )
      .then((all) => {
        if (!cancelled) setWsTranslations(Object.assign({}, ...all));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, categoryList]);

  // Merge base translations with WS-fetched translations
  const translations = useMemo(
    () => ({ ...baseTranslations, ...wsTranslations }),
    [baseTranslations, wsTranslations]
  );

  return { translations, isLoading };
}
