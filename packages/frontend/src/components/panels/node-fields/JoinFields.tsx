import type { JoinNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface JoinFieldsProps {
  node: JoinNode;
  onChange: (key: string, value: unknown) => void;
}

/**
 * Join ("All") node field component. Only the 'all' mode is selectable
 * today — HA's automation engine has no task-cancellation primitive, so a
 * true race-and-cancel "Any" (race, cancel the losers) can only ever be
 * approximated. That approximation is a deliberate follow-up, not shipped
 * yet — see docs/flow-parity-design.md §3 — so 'any' stays disabled
 * here rather than silently behaving like 'all'.
 */
export function JoinFields({ node, onChange }: JoinFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const mode = node.data.mode ?? 'all';

  return (
    <div className="space-y-4">
      <FormField
        label={t('nodes:joinFields.mode')}
        description={t('nodes:joinFields.modeDescription')}
      >
        <Select value={mode} onValueChange={(v) => onChange('mode', v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('nodes:joinFields.modeAllLabel')}</SelectItem>
            <SelectItem value="any" disabled>
              {t('nodes:joinFields.modeAnyLabel')}
            </SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <p className="text-muted-foreground text-xs">{t('nodes:joinFields.note')}</p>
    </div>
  );
}
