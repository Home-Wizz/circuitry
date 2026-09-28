import type { ActionNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { opaqueStepYaml } from '@/lib/opaqueStep';

interface OpaqueStepFieldsProps {
  node: ActionNode;
}

/**
 * A step Circuitry doesn't know (`scene:`, the legacy `service_template:`,
 * a step type Home Assistant adds later), kept exactly as written (bug
 * #57): its YAML, read-only. The alias and the enabled switch above still
 * work; changing the step itself happens in Home Assistant's YAML editor.
 */
export function OpaqueStepFields({ node }: OpaqueStepFieldsProps) {
  const { t } = useTranslation(['nodes']);
  return (
    <FormField
      label={t('nodes:actions.opaqueStepTitle')}
      description={t('nodes:actions.opaqueStepPanelDescription')}
    >
      <pre className="overflow-x-auto whitespace-pre rounded-md border bg-muted p-3 font-mono text-xs">
        {opaqueStepYaml(node.data)}
      </pre>
    </FormField>
  );
}
