import type { ChooseFallThrough } from '@circuitry/transpiler';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { stopOnNoSide } from '@/lib/fall-through-edges';
import { useFlowStore } from '@/store/flow-store';

interface ChooseGatesNothingDialogProps {
  /** The Choose that gates nothing (the first, when there are several). */
  fallThrough: ChooseFallThrough | null;
  onSaveAnyway: () => void;
  onClose: () => void;
}

/** A card's own name, when it has one. */
function aliasOf(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const alias = (data as { alias?: unknown }).alias;
  return typeof alias === 'string' && alias.trim() !== '' ? alias : undefined;
}

/**
 * Before saving: a Choose card whose options all lead straight on to where
 * it carries on when none passes gates nothing -- what follows runs whatever
 * its tests say (the maintainer, 2026-10-25, after a bedroom light gated on
 * "night, or day and dark" turned on in daylight). "Add a Stop" gives the
 * last option an "Otherwise" line to a new Stop card and leaves the
 * automation unsaved, to look at first.
 */
export function ChooseGatesNothingDialog({
  fallThrough,
  onSaveAnyway,
  onClose,
}: ChooseGatesNothingDialogProps) {
  const { t } = useTranslation('dialogs');
  const nodes = useFlowStore((s) => s.nodes);
  const addCompound = useFlowStore((s) => s.addCompound);
  const last = fallThrough ? nodes.find((n) => n.id === fallThrough.from) : undefined;
  const next = fallThrough ? nodes.find((n) => n.id === fallThrough.to) : undefined;

  const addStop = () => {
    if (!last) return;
    const { node, edge } = stopOnNoSide(last);
    addCompound([node], [edge]);
    onClose();
  };

  return (
    <Dialog open={fallThrough !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t('save.chooseGatesNothing.title')}
          </DialogTitle>
          <DialogDescription>
            {t('save.chooseGatesNothing.body', {
              choose: aliasOf(last?.data) ?? t('save.chooseGatesNothing.theChoose'),
              next: aliasOf(next?.data) ?? t('save.chooseGatesNothing.theNext'),
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('save.chooseGatesNothing.hint')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onSaveAnyway}>
            {t('save.chooseGatesNothing.saveAnyway')}
          </Button>
          <Button onClick={addStop} disabled={!last}>
            {t('save.chooseGatesNothing.addStop')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
