import type { NodeValidationError } from '@circuitry/shared';
import { useCallback } from 'react';
import { useHass } from '@/contexts/HassContext';
import { pickGaps, pickNeedsSettings } from '@/lib/pickGaps';
import { nodeIssues } from '@/store/flow-store';

/**
 * What a pick still needs (lib/pickGaps.ts), checked the way the canvas
 * checks a node, with the connected HA's services. Shared by the pickers
 * (whether a pick opens its settings column) and that column (what it
 * lists as still needed), so the two never disagree.
 */
export function usePickGaps(): (
  nodeType: string,
  data: Record<string, unknown>
) => NodeValidationError[] {
  const { services } = useHass();
  return useCallback(
    (nodeType: string, data: Record<string, unknown>) =>
      pickGaps(nodeType, data, nodeIssues(nodeType, data), services),
    [services]
  );
}

/** Whether a pick opens the pickers' settings column (lib/pickGaps.ts's
 * pickNeedsSettings), checked like usePickGaps. */
export function usePickNeedsSettings(): (
  nodeType: string,
  data: Record<string, unknown>
) => boolean {
  const gapsOf = usePickGaps();
  return useCallback(
    (nodeType: string, data: Record<string, unknown>) =>
      pickNeedsSettings(nodeType, data, gapsOf(nodeType, data)),
    [gapsOf]
  );
}
