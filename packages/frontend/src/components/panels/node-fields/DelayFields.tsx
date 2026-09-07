import type { DelayNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { HaSelect, HaSelector } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { ContinueOnErrorField } from './ContinueOnErrorField';
import { DurationField, parseDurationString } from './DurationField';

interface DelayFieldsProps {
  node: DelayNode;
  onChange: (key: string, value: unknown) => void;
}

/** A plain "HH:MM:SS[.ms]" string — the legacy fixed-duration format, as opposed to a Jinja2 template string. */
const DURATION_STRING_RE = /^([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2})(?:\.(\d{1,3}))?$/;

/**
 * Delay node field component.
 *
 * home-assistant.io/docs/scripts/#delay accepts `delay` as a fixed duration
 * (object or "HH:MM:SS" string) OR a template string that evaluates to one
 * at runtime (e.g. `"{{ states('input_number.wait_minutes') }}"`) — the
 * latter had no UI path here: DurationInput always parses a string with
 * `parseDurationString` and always writes back the object shape, so a stored
 * template would render as an empty 00:00:00 and any interaction with the
 * picker would silently overwrite it with a fixed value.
 *
 * `continue_on_error` (home-assistant.io/docs/scripts/#continuing-on-error)
 * is "available on all actions", including `delay` — was previously wired
 * into ActionFields.tsx's branches only, missing here.
 */
export function DelayFields({ node, onChange }: DelayFieldsProps) {
  const { t } = useTranslation(['nodes', 'common']);
  const { getFieldError } = useNodeErrors(node.id);
  const continueOnError = node.data.continue_on_error === true;

  const delayValue = node.data.delay;
  const isTemplateMode = typeof delayValue === 'string' && !DURATION_STRING_RE.test(delayValue);
  const mode = isTemplateMode ? 'template' : 'duration';

  const handleModeChange = (newMode: string) => {
    onChange('delay', newMode === 'template' ? '' : {});
  };

  return (
    <>
      <FormField label={t('nodes:delayFields.modeLabel')}>
        <HaSelect
          value={mode}
          onChange={(v) => handleModeChange(String(v))}
          options={[
            { value: 'duration', label: t('nodes:delayFields.modeDuration') },
            { value: 'template', label: t('nodes:delayFields.modeTemplate') },
          ]}
          fallback={
            <Select value={mode} onValueChange={handleModeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="duration">{t('nodes:delayFields.modeDuration')}</SelectItem>
                <SelectItem value="template">{t('nodes:delayFields.modeTemplate')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </FormField>

      {isTemplateMode ? (
        <FormField label={t('nodes:delayFields.templateLabel')}>
          <HaSelector
            selector={{ template: {} }}
            value={typeof delayValue === 'string' ? delayValue : ''}
            onChange={(v) => onChange('delay', typeof v === 'string' ? v : '')}
            fallback={
              <Textarea
                value={typeof delayValue === 'string' ? delayValue : ''}
                onChange={(e) => onChange('delay', e.target.value)}
                placeholder={t('common:placeholders.enterTemplate')}
                className="font-mono text-sm"
                rows={3}
              />
            }
          />
        </FormField>
      ) : (
        <DurationField
          label="Delay"
          value={
            typeof delayValue === 'string' ? parseDurationString(delayValue) : (delayValue ?? {})
          }
          onChange={(val) => onChange('delay', val)}
        />
      )}
      <FieldError message={getFieldError('delay')} />
      <ContinueOnErrorField
        checked={continueOnError}
        onChange={(checked) => onChange('continue_on_error', checked || undefined)}
      />
    </>
  );
}
