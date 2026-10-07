import type { FlowNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import type { NodeColorToken } from '@/lib/node-colors';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { useOnCardSummary } from './onCardSummary';
import { StepMore } from './StepMore';

/** The steps whose settings a card offers ("+ more"). */
const SETTABLE: ReadonlySet<string> = new Set([
  'trigger',
  'condition',
  'action',
  'delay',
  'wait',
  'set_variables',
]);

/** What "+ more" calls the step, by its kind. */
function titleKey(type: string) {
  if (type === 'trigger') return 'nodes:more.title.trigger' as const;
  if (type === 'condition') return 'nodes:more.title.condition' as const;
  if (type === 'action') return 'nodes:more.title.action' as const;
  return 'nodes:more.title.step' as const;
}

/**
 * A selected card's "+ more": the step's settings its card doesn't show,
 * in plain words (StepMore), under a line saying what the card does show.
 * It opens beside the card, flips to the other side near an edge and
 * scrolls inside itself; "Side panel" opens the full editor.
 */
export function StepSettingsPill({ nodeId, tone }: { nodeId: string; tone: NodeColorToken }) {
  const { t } = useTranslation(['nodes']);
  const node = useFlowStore((s) => s.nodes.find((n) => n.id === nodeId));
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const openPanelFor = useFlowStore((s) => s.openPanelFor);
  const onCard = useOnCardSummary(node as FlowNode | undefined);
  if (!node || !SETTABLE.has(node.type ?? '')) return null;
  const onChange = (key: string, value: unknown) => updateNodeData(nodeId, { [key]: value });
  return (
    <>
      {' '}
      <EditPill
        tone={tone}
        testId="step-settings-pill"
        ariaLabel={t('nodes:pill.moreSettings')}
        side="right"
        besideCard
        contentClassName="flex max-h-(--radix-popover-content-available-height) w-96 flex-col gap-0 overflow-hidden p-0"
        editor={() => (
          <>
            <div className="flex items-baseline justify-between gap-3 border-foreground/15 border-b px-4 py-3">
              <span className="font-semibold text-sm">{t(titleKey(node.type ?? ''))}</span>
              <button
                type="button"
                onClick={() => openPanelFor(nodeId)}
                className="shrink-0 font-medium text-primary text-xs hover:underline"
              >
                {`${t('nodes:more.sidePanel')} ↗`}
              </button>
            </div>
            <div
              className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-3"
              data-testid="step-more"
            >
              {onCard.length > 0 && (
                <p className="rounded-lg bg-muted px-2.5 py-1.5 text-muted-foreground text-xs">
                  {`${t('nodes:more.onCard')} `}
                  <span className="font-semibold text-foreground">{onCard.join(', ')}</span>
                </p>
              )}
              <StepMore node={node as FlowNode} onChange={onChange} />
            </div>
          </>
        )}
      >
        <span className={PILL_TEXT}>{t('nodes:pill.more')}</span>
      </EditPill>
    </>
  );
}
