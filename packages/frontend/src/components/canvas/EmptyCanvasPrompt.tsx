import { Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StepIcon } from '@/components/nodes/StepIcon';
import { toneStyle } from '@/lib/node-colors';
import { useFlowStore } from '@/store/flow-store';

/**
 * What an empty canvas shows: a large "When… add a trigger" pill in the
 * cards' own style (.step-pill), opening the trigger picker, and a link to
 * open an existing automation instead (both through the left panel).
 */
export function EmptyCanvasPrompt() {
  const { t } = useTranslation(['common', 'nodes']);
  const requestFromPalette = useFlowStore((state) => state.requestFromPalette);
  return (
    <div
      data-testid="empty-canvas"
      className="pointer-events-none absolute inset-0 z-[4] grid place-items-center"
    >
      <div className="flex flex-col items-center gap-3.5 text-center">
        <p className="text-[15px] text-muted-foreground">{t('emptyCanvas.hint')}</p>
        <button
          type="button"
          onClick={() => requestFromPalette('when')}
          style={toneStyle('trigger')}
          className="step-pill pointer-events-auto flex items-center gap-3 bg-card py-2.5 pr-6 pl-2.5 font-semibold text-base transition-transform hover:scale-[1.03]"
        >
          <StepIcon tone="trigger" icon={Radio} size="xl" />
          <span>
            <span className="font-bold text-trigger">{`${t('nodes:picker.sectionNames.when')}… `}</span>
            {t('emptyCanvas.addTrigger')}
          </span>
        </button>
        <p className="text-muted-foreground text-sm">
          {`${t('emptyCanvas.or')} `}
          <button
            type="button"
            onClick={() => requestFromPalette('open')}
            className="pointer-events-auto underline underline-offset-2 hover:text-foreground"
          >
            {t('emptyCanvas.openExisting')}
          </button>
        </p>
      </div>
    </div>
  );
}
