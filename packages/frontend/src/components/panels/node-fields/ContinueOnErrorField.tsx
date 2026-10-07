import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Switch } from '@/components/ui/switch';
import { HaSwitch } from '@/ha';

interface ContinueOnErrorFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** In plain words, for the card's "+ more". */
  plain?: boolean;
}

/**
 * `continue_on_error` — home-assistant.io/docs/scripts/#continuing-on-error:
 * "available on all actions", default `false`. When `true`, the sequence
 * keeps running past this step even if it errors, instead of halting the
 * whole automation/script run. Shared by every ActionFields.tsx branch
 * (service call, fire event, stop, opaque repeat) rather than duplicating
 * this same toggle four times, per CLAUDE.md's DRY mandate — mirrors
 * WaitFields.tsx's `continue_on_timeout` toggle styling.
 */
export function ContinueOnErrorField({
  checked,
  onChange,
  plain = false,
}: ContinueOnErrorFieldProps) {
  const { t } = useTranslation(['nodes']);
  return (
    <FormField
      label={t(plain ? 'nodes:more.carryOn' : 'nodes:actions.continueOnError')}
      description={t(plain ? 'nodes:more.carryOnHint' : 'nodes:actions.continueOnErrorDescription')}
    >
      <HaSwitch
        checked={checked}
        onChange={onChange}
        fallback={<Switch checked={checked} onCheckedChange={onChange} />}
      />
    </FormField>
  );
}
