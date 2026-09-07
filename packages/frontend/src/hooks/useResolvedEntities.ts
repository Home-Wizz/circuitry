import { useMemo } from 'react';
import { useHass } from '@/contexts/HassContext';
import type { HassEntity } from '@/types/hass';

/**
 * The entity list every entity-aware picker/field ultimately renders from:
 * prefers live `hass.states` (kept fresh by HA's websocket) when available,
 * falling back to the context's own `entities` snapshot otherwise (e.g. in
 * the standalone-dev harness, which has no `hass` object at all).
 *
 * Extracted from PropertyPanel.tsx so WhenTriggerDialog.tsx's "+Add > When"
 * modal — which needs the same resolved entity list but isn't rendered
 * inside the property panel — doesn't have to re-derive it.
 */
export function useResolvedEntities(): HassEntity[] {
  const { hass, entities } = useHass();

  return useMemo(() => {
    if (hass?.states && Object.keys(hass.states).length > 0) {
      return Object.values(hass.states).map((state: HassEntity) => ({
        entity_id: state.entity_id,
        state: state.state,
        attributes: state.attributes || {},
        last_changed: state.last_changed || '',
        last_updated: state.last_updated || '',
        context: state.context,
      }));
    }
    return entities;
  }, [hass, entities]);
}
