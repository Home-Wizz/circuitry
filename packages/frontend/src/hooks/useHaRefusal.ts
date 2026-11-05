import { useTranslation } from 'react-i18next';
import { useFlowStore } from '@/store/flow-store';

/**
 * The error keys for what Home Assistant itself would refuse in a card's
 * own values (Phase 4): written out on the card, not only in its badge's
 * tooltip, as the reason can't be seen in the card's sentence (an entity id
 * without its domain, a step kept exactly as written).
 */
const SHOWN_ON_CARD = ['errors:validation.entityIdForm', 'errors:validation.keptStep.'];

/** The card's reason Home Assistant would refuse it, translated; undefined when none. */
export function useHaRefusal(nodeId: string | undefined): string | undefined {
  const { t } = useTranslation();
  const message = useFlowStore((s) =>
    nodeId === undefined
      ? undefined
      : s.nodeErrors
          .get(nodeId)
          ?.find((e) => SHOWN_ON_CARD.some((key) => e.message.startsWith(key)))?.message
  );
  return message === undefined ? undefined : t(message, { defaultValue: message });
}
