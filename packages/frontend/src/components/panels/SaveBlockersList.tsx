import { useReactFlow } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { type SaveBlocker, useFlowStore } from '@/store/flow-store';

/** The card's kind as the canvas names it: When, And or Then. */
const KIND_KEY: Record<string, string> = {
  trigger: 'dialogs:save.blocked.kind.trigger',
  condition: 'dialogs:save.blocked.kind.condition',
};

/**
 * What keeps a save from going ahead (Phase 4: what Home Assistant would
 * refuse, said before anything is sent), one row per card or for the
 * automation's settings, each with its reasons and a way to the card.
 */
export function SaveBlockersList({
  blockers,
  onShowCard,
}: {
  blockers: SaveBlocker[];
  /** Called after a card was selected and brought into view (the dialog closes). */
  onShowCard: () => void;
}) {
  const { t } = useTranslation(['dialogs', 'errors']);
  const selectNode = useFlowStore((s) => s.selectNode);
  const nodes = useFlowStore((s) => s.nodes);
  const { setCenter } = useReactFlow();

  const showCard = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    selectNode(nodeId);
    if (node) {
      const width = node.measured?.width ?? 0;
      const height = node.measured?.height ?? 0;
      void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: 1,
        duration: 300,
      });
    }
    onShowCard();
  };

  const name = (b: SaveBlocker) =>
    b.nodeId === undefined
      ? t('dialogs:save.blocked.settings')
      : (b.alias ??
        t(KIND_KEY[b.nodeType ?? ''] ?? 'dialogs:save.blocked.kind.action', {
          defaultValue: 'Then',
        }));

  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="flex flex-col gap-3">
        <p className="font-medium">{t('dialogs:save.blocked.title', { count: blockers.length })}</p>
        <ul className="flex flex-col gap-2">
          {blockers.map((b) => (
            <li key={b.nodeId ?? 'settings'} className="flex items-start justify-between gap-3">
              <span>
                <strong>{name(b)}</strong>
                {': '}
                {b.messages.map((m) => t(m, { defaultValue: m })).join(' ')}
              </span>
              {b.nodeId !== undefined ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto shrink-0 p-0"
                  onClick={() => showCard(b.nodeId as string)}
                >
                  {t('dialogs:save.blocked.showCard')}
                </Button>
              ) : (
                <span className="shrink-0 text-xs">{t('dialogs:save.blocked.whereSettings')}</span>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
