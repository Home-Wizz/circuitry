import type React from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { HaSwitch } from '@/ha';

interface ResponseVariableFieldProps {
  /**
   * The live service registry's `response` metadata, when known. `undefined`
   * means the action isn't a recognized service call (e.g. `stop`, or a
   * service Circuitry's registry hasn't seen) — the field still renders (see
   * ActionFields.tsx's call sites), just without the "this action returns
   * data" hint, since `response_variable` is valid HA YAML regardless of
   * whether the service is known to declare a response.
   */
  response: { optional?: boolean } | undefined;
  responseVariable: string | undefined;
  showResponseVariable: boolean;
  setShowResponseVariable: (v: boolean) => void;
  onChange: (key: string, value: unknown) => void;
  handleResponseVariableChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ResponseVariableField({
  response,
  responseVariable,
  showResponseVariable,
  setShowResponseVariable,
  onChange,
  handleResponseVariableChange,
}: ResponseVariableFieldProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const inputAndAlert = (
    <>
      <Input
        type="text"
        value={responseVariable ?? ''}
        onChange={handleResponseVariableChange}
        placeholder={t('nodes:responseVariableField.placeholder')}
      />
      {responseVariable?.trim() === 'current_node' && (
        <Alert variant="destructive" className="mt-2 border-0 px-0">
          <AlertTitle>{t('labels.warning')}</AlertTitle>
          <AlertDescription>{t('nodes:responseVariableField.currentNodeWarning')}</AlertDescription>
        </Alert>
      )}
    </>
  );
  const handleToggle = (checked: boolean) => {
    setShowResponseVariable(checked);
    if (!checked) {
      onChange('response_variable', undefined);
    }
  };
  // `response.optional === false` is the one case the live service registry
  // guarantees a response every call — surfacing the field un-toggled would
  // just be extra friction for something you always need. Every other case
  // (declared-optional response, or no service metadata at all) gets the
  // same toggle-based manual UI, just with a description tailored to
  // whether a response was actually detected.
  if (response && response.optional === false) {
    return (
      <FormField
        label={t('nodes:responseVariableField.label')}
        description={t('nodes:responseVariableField.requiredDescription')}
      >
        {inputAndAlert}
      </FormField>
    );
  }
  return (
    <FormField
      label={t('nodes:responseVariableField.label')}
      description={
        response
          ? t('nodes:responseVariableField.optionalDescription')
          : t('nodes:responseVariableField.manualDescription')
      }
    >
      <div className="mb-2 flex items-center gap-3">
        <HaSwitch
          checked={showResponseVariable}
          onChange={handleToggle}
          fallback={
            <Switch
              checked={showResponseVariable}
              onCheckedChange={handleToggle}
              id="response-variable-switch"
            />
          }
        />
        <label htmlFor="response-variable-switch" className="cursor-pointer select-none text-sm">
          {t('nodes:responseVariableField.useResponseVariable')}
        </label>
      </div>
      {showResponseVariable && inputAndAlert}
    </FormField>
  );
}
