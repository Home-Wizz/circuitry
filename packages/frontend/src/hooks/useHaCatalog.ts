import { useCallback, useMemo } from 'react';
import { useNativeDescriptions } from '@/hooks/useNativeDescriptions';
import { useTranslations } from '@/hooks/useTranslations';
import {
  type ConditionCatalog,
  conditionCatalog,
  type HaTitles,
  type HaTypeTexts,
  haOffers,
  triggerCatalog,
} from '@/lib/haCatalog';
import type { EntityTriggerCategory } from '@/lib/triggerRecipes';

const TEXT_CATEGORIES = ['triggers', 'conditions', 'title'] as const;

/** HA's names and descriptions for its purpose-specific types and
 * integrations, in HA's language (`frontend/get_translations`). */
function useHaTexts(): { texts: HaTypeTexts; titles: HaTitles } {
  const { translations } = useTranslations(TEXT_CATEGORIES);
  const texts = useCallback<HaTypeTexts>(
    (kind, type) => {
      const dot = type.indexOf('.');
      const prefix = `component.${type.slice(0, dot)}.${kind}s.${type.slice(dot + 1)}`;
      return {
        name: translations[`${prefix}.name`],
        description: translations[`${prefix}.description`],
      };
    },
    [translations]
  );
  const titles = useCallback<HaTitles>(
    (domain) => translations[`component.${domain}.title`],
    [translations]
  );
  return { texts, titles };
}

/** The When picker's categories as the connected HA has them (lib/haCatalog.ts). */
export function useTriggerCatalog(): EntityTriggerCategory[] {
  const described = useNativeDescriptions('trigger');
  const { texts, titles } = useHaTexts();
  return useMemo(() => triggerCatalog(described, texts, titles), [described, texts, titles]);
}

/** The And picker's catalog as the connected HA has it (lib/haCatalog.ts). */
export function useConditionCatalog(): ConditionCatalog {
  const described = useNativeDescriptions('condition');
  const { texts, titles } = useHaTexts();
  return useMemo(() => conditionCatalog(described, texts, titles), [described, texts, titles]);
}

/** Whether the connected HA offers a type (lib/haCatalog.ts's haOffers),
 * for the lists built per entity (the "by target" results). */
export function useHaOffers(kind: 'trigger' | 'condition'): (type: string) => boolean {
  const described = useNativeDescriptions(kind);
  return useCallback((type: string) => haOffers(type, described), [described]);
}
