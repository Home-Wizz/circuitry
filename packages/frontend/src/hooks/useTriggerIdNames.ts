import { useCallback, useMemo } from 'react';
import { triggerSummary, useTriggerCardDisplay } from '@/hooks/useTriggerCardDisplay';
import { type TriggerNodeData, useFlowStore } from '@/store/flow-store';

/** A "Triggered by" condition's trigger ids, as a list (HA takes one id or
 * several; it compares them as text). */
export function triggerIdsOf(value: unknown): string[] {
  const ids = Array.isArray(value) ? value : [value];
  return ids
    .filter((id) => (typeof id === 'string' && id.trim() !== '') || typeof id === 'number')
    .map(String);
}

/**
 * What a "Triggered by" condition's ids mean, in words: each trigger in the
 * flow that carries one of them, as its card reads ("Kitchen motion ·
 * detects motion"). HA 2026.10's editor writes ids like `generated-a1B2`,
 * which mean nothing to read; the ids themselves are unchanged. An id no
 * trigger carries is given as written, after "id:" (the editor flags it).
 */
export function useTriggerIdNames(): (value: unknown) => string[] {
  const nodes = useFlowStore((s) => s.nodes);
  const triggers = useMemo(() => nodes.filter((n) => n.type === 'trigger'), [nodes]);
  const { getTriggerDisplayInfo } = useTriggerCardDisplay();
  return useCallback(
    (value: unknown) => {
      const names: string[] = [];
      for (const id of triggerIdsOf(value)) {
        const carrying = triggers.filter((n) => {
          const own = (n.data as Record<string, unknown>).id;
          return own !== undefined && own !== null && String(own) === id;
        });
        const found =
          carrying.length > 0
            ? carrying.map((n) => triggerSummary(getTriggerDisplayInfo(n.data as TriggerNodeData)))
            : [`id: ${id}`];
        for (const name of found) if (!names.includes(name)) names.push(name);
      }
      return names;
    },
    [triggers, getTriggerDisplayInfo]
  );
}
