import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';
import { useConditionCatalog, useTriggerCatalog } from '@/hooks/useHaCatalog';
import { useNativeDescription } from '@/hooks/useNativeDescriptions';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import { categoryEntityDomains } from '@/lib/haCatalog';
import { entitiesForType } from '@/lib/nativeTargets';
import { entitiesForService, serviceHasTarget } from '@/lib/serviceTargets';
import { type EditableTargets, editableTargets, wholeAreaIds } from '@/lib/stepTargets';
import { prettify } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';

type Kind = 'trigger' | 'condition';

/** The type a trigger or condition step has, for its description. */
function stepType(nodeType: string | undefined, data: Readonly<Record<string, unknown>>) {
  const kind: Kind | null =
    nodeType === 'trigger' ? 'trigger' : nodeType === 'condition' ? 'condition' : null;
  const raw = kind ? data[kind] : undefined;
  return { kind, type: typeof raw === 'string' ? raw : '' };
}

/** The step's entities, when its card edits them (lib/stepTargets.ts). */
export function useEditableTargets(
  nodeType: string | undefined,
  data: Readonly<Record<string, unknown>>
): EditableTargets | null {
  const { kind, type } = stepType(nodeType, data);
  const description = useNativeDescription(kind ?? 'trigger', type);
  const { services } = useHass();
  return editableTargets(nodeType, data, {
    description: kind ? description : undefined,
    // A service acts on entities when HA describes a target for it.
    actionTakesTargets: (service) => serviceHasTarget(services, service),
  });
}

/**
 * The entities the target pill offers for a step: the ones its pickers
 * offer. A purpose-specific trigger or condition: those HA keeps for its
 * type (#166). A State or Numeric state one: any entity. An action: those
 * that can do it (#130).
 */
export function useOfferedEntities(
  nodeType: string | undefined,
  data: Readonly<Record<string, unknown>>
): HassEntity[] {
  const entities = useResolvedEntities();
  const { kind, type } = stepType(nodeType, data);
  const description = useNativeDescription(kind ?? 'trigger', type);
  const triggerCatalog = useTriggerCatalog();
  const conditionCatalog = useConditionCatalog();
  const { services } = useHass();
  return useMemo(() => {
    if (nodeType === 'action') {
      return typeof data.service === 'string'
        ? entitiesForService(services, data.service, entities)
        : [];
    }
    if (!kind || !type.includes('.')) return entities;
    // Where HA describes nothing: the entities of the category the type is in.
    const scope =
      kind === 'trigger'
        ? triggerCatalog
            .filter((c) => c.recipes.some((r) => r.fields.trigger === type))
            .map((c) => ({
              domains: categoryEntityDomains(c, c.domain),
              domain: c.domain,
              deviceClass: c.deviceClass,
            }))[0]
        : conditionCatalog.categories
            .filter((c) => c.recipes.some((r) => r.fields.condition === type))
            .map((c) => ({
              domains: categoryEntityDomains(c, c.entityDomain),
              domain: c.entityDomain,
              deviceClass: c.deviceClass,
            }))[0];
    return entitiesForType(
      entities,
      kind,
      type,
      description,
      scope ?? { domains: [type.split('.')[0] ?? ''], domain: type.split('.')[0] ?? '' }
    );
  }, [
    nodeType,
    data.service,
    kind,
    type,
    description,
    entities,
    services,
    triggerCatalog,
    conditionCatalog,
  ]);
}

/**
 * A step whose target is a whole area ("Anything in <room>"): its label for
 * the card ("Anything in Hallway") and the area's name for the context line;
 * undefined for any other target.
 */
export function useWholeArea(target: unknown): { label: string; place: string } | undefined {
  const { t } = useTranslation(['nodes']);
  const { areas } = useHass();
  const ids = wholeAreaIds(target);
  if (!ids) return undefined;
  const place = ids
    .map((id) => areas.find((a) => a.area_id === id)?.name ?? prettify(id))
    .join(', ');
  return { label: t('nodes:picker.rows.anythingIn', { name: place }), place };
}
