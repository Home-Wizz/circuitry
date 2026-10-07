import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  /** The name it opens with. */
  initialName: string;
  /** Called with the name as typed (trimmed). */
  onSave: (name: string) => void;
  /** An empty name may be saved (it clears the name). */
  allowEmpty?: boolean;
  placeholder?: string;
  /** While the save runs: the fields disabled, a spinner. */
  saving?: boolean;
  error?: string | null;
}

/**
 * Asks for a name (renaming the automation, or a step): a title, what the
 * name is for, one field, Cancel and Save. Enter saves.
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialName,
  onSave,
  allowEmpty = false,
  placeholder,
  saving = false,
  error,
}: NameDialogProps) {
  const { t } = useTranslation(['common']);
  const inputId = useId();
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);
  const canSave = !saving && (allowEmpty || name.trim() !== '');
  const save = () => {
    if (canSave) onSave(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{label}</Label>
          <Input
            id={inputId}
            value={name}
            placeholder={placeholder}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          {error && <p className="whitespace-pre-line text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common:buttons.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
