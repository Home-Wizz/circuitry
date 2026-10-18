import type { FlowNode } from '@circuitry/shared';
import { fnv1aHex } from './fanOutHash';

/**
 * What a card is, in a few words: its type, what it does (service, trigger
 * or condition type, a delay) and what it acts on. Saved with each card's
 * position, so a reopened automation whose steps were changed outside
 * Circuitry gives each card the position of the saved card it matches
 * (bug #222). Two cards alike are told apart by their order. Saved as a
 * short hash, so the automation's YAML doesn't repeat its entities and
 * services; two kinds sharing a hash (about one in four billion) only put a
 * card where the other was. The leading "k" keeps an all-digit hash from
 * being read back as a number by a YAML tool.
 */
export function nodeKey(node: Pick<FlowNode, 'type' | 'data'>): string {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const target = data.target as Record<string, unknown> | undefined;
  const what =
    data.service ??
    data.action ??
    data.trigger ??
    data.condition ??
    (data.delay !== undefined ? 'delay' : '');
  const on = target?.entity_id ?? data.entity_id ?? '';
  return `k${fnv1aHex(
    `${node.type ?? ''}|${typeof what === 'string' ? what : JSON.stringify(what)}|${JSON.stringify(on)}`
  )}`;
}
