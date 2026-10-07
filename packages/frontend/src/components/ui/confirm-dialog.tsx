import { Loader2 } from 'lucide-react';
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

interface ConfirmDialogProps {
  open: boolean;
  /** Called with `false` when it's dismissed (Cancel, Escape, outside). */
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The destructive button's label ("Delete", "Close without saving"). */
  confirmLabel: string;
  onConfirm: () => void;
  /** The cancel button's label; "Cancel" when unset. */
  cancelLabel?: string;
  /** While the confirmed action runs: both buttons disabled, a spinner. */
  busy?: boolean;
}

/**
 * Asks before something that can't be undone (deleting an automation,
 * dropping unsaved changes): a title, what will happen, Cancel, and a red
 * confirm button. Every such question in the app is one of these.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  cancelLabel,
  busy = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['common']);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel ?? t('common:buttons.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
