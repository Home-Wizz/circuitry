import { getConditionEnumField } from '@/lib/conditionEnumField';
import { getTriggerEnumField } from '@/lib/triggerEnumField';

/**
 * Whether the entities picked for a purpose-specific trigger or condition
 * are zones: its `zone` option, not its target (#118 -- HA's target there
 * is the people and device trackers, and zone occupancy has none).
 */
export function picksZone(kind: 'trigger' | 'condition', type: string): boolean {
  const field = kind === 'trigger' ? getTriggerEnumField(type) : getConditionEnumField(type);
  return field?.optionsKey === 'zone';
}
