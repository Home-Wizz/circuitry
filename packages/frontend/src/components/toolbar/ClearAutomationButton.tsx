import { BrushCleaning } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFlowStore } from '@/store/flow-store';

/**
 * Header button that empties the canvas. It asks first only when the canvas
 * holds changes that would be lost: an empty one, or an automation opened
 * and left as it was, is cleared at once (bug #191).
 */
export function ClearAutomationButton() {
  const { t } = useTranslation(['common', 'dialogs']);
  const { reset, hasRealChanges } = useFlowStore();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => (hasRealChanges() ? setConfirmOpen(true) : reset())}
            variant="ghost"
            size="icon"
          >
            <BrushCleaning className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('common:titles.clearAutomation')}</TooltipContent>
      </Tooltip>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('dialogs:import.discardTitle')}
        description={t('dialogs:import.discardDescription')}
        confirmLabel={t('dialogs:import.confirmDiscard')}
        onConfirm={() => {
          reset();
          setConfirmOpen(false);
        }}
      />
    </>
  );
}
