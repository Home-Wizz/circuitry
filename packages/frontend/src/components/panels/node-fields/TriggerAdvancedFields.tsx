import type { FlowNode } from '@circuitry/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import type { FieldConfig } from '@/config/triggerFields';
import { cn } from '@/lib/utils';
import { getNodeDataObject } from '@/utils/nodeData';

const VARIABLES_FIELD: FieldConfig = {
  name: 'variables',
  label: 'Variables',
  type: 'object',
  required: false,
};

interface TriggerAdvancedFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
}

/**
 * `variables` — the one universal HA trigger field (see
 * home-assistant.io/docs/automation/trigger/#trigger-variables) that doesn't
 * already have dedicated UI elsewhere: `id` and `enabled` are handled
 * generically for every trigger by PropertyPanel.tsx (its "Trigger ID(s)"
 * input and the header Enabled switch), so duplicating them here would
 * violate CLAUDE.md's DRY mandate. `variables` is trigger-specific (no other
 * node type has it), so it gets its own small section — collapsed to a
 * one-line summary chip by default, the same convention NativeTargetField.tsx
 * established this session for the purpose-specific trigger/condition target
 * picker, since most triggers never set it.
 */
export function TriggerAdvancedFields({ node, onChange }: TriggerAdvancedFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const variables = getNodeDataObject<Record<string, unknown>>(node, 'variables', {});
  const variableCount = Object.keys(variables).length;
  const [open, setOpen] = useState(false);

  return (
    <FormField
      label={t('nodes:triggers.advanced.label')}
      description={t('nodes:fieldDescriptions.variables')}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
          >
            <span className={cn(variableCount === 0 && 'text-muted-foreground')}>
              {variableCount === 0
                ? t('nodes:triggers.advanced.empty')
                : t('nodes:variables.variableCount', { count: variableCount })}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <DynamicFieldRenderer
            field={VARIABLES_FIELD}
            value={variableCount > 0 ? variables : undefined}
            onChange={(value) => onChange('variables', value)}
          />
        </CollapsibleContent>
      </Collapsible>
    </FormField>
  );
}
