import type { FlowNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useWholeArea } from '@/hooks/useStepTargets';
import { serviceFieldList } from '@/lib/serviceFields';
import { isRecord } from '@/lib/utils';
import { asServiceField } from '@/components/panels/node-fields/ServiceDataFields';
import { conditionStatePhrase } from './cardWording';
import { durationUnits, formatDuration } from './formatDuration';
import { holdForValue } from './holdFor';
import { useThreshold } from './ThresholdPill';
import { formatServiceValue } from './ValuePills';

/** The entity ids a step names: its target's, or a legacy `entity_id`. */
function namedIds(data: Readonly<Record<string, unknown>>): string[] {
  const raw = isRecord(data.target) ? data.target.entity_id : data.entity_id;
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  return typeof raw === 'string' && raw ? [raw] : [];
}

/**
 * What a step's card already shows, as the card says it ("Front door",
 * "above 22 °C", "for 5 min", "100 %"), for the top line of its "+ more":
 * those aren't repeated below it.
 */
export function useOnCardSummary(node: FlowNode | undefined): string[] {
  const { t } = useTranslation(['nodes']);
  const { entityNames } = useNodeCardDisplay();
  const { getServiceDefinition } = useHass();
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const kind = node?.type === 'trigger' || node?.type === 'condition' ? node.type : null;
  const wholeArea = useWholeArea(data.target);
  const threshold = useThreshold(data, kind ?? 'trigger', kind !== null);
  if (!node) return [];
  const items: string[] = [];
  const ids = namedIds(data);
  if (wholeArea) items.push(wholeArea.label);
  else if (ids.length > 0) items.push(entityNames(ids));
  if (threshold) items.push(threshold.text);
  if (kind === 'condition' && data.condition === 'state') {
    const state = conditionStatePhrase(t, data.state, undefined);
    if (state) items.push(state);
  }
  if (kind) {
    const held = holdForValue(kind, data);
    if (held !== undefined)
      items.push(`${t('nodes:pill.for')} ${formatDuration(held, durationUnits(t))}`);
  }
  if (node.type === 'action' && typeof data.service === 'string') {
    const values = isRecord(data.data) ? data.data : {};
    for (const [name, raw] of serviceFieldList(getServiceDefinition(data.service)?.fields)
      .filter(([field]) => values[field] !== undefined)
      .slice(0, 3)) {
      items.push(formatServiceValue(asServiceField(raw).selector, values[name], t, entityNames));
    }
  }
  return items;
}
