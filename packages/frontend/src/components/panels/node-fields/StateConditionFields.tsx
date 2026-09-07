import type { FlowNode } from '@circuitry/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import { Input } from '@/components/ui/input';
import { MultiEntitySelector } from '@/components/ui/MultiEntitySelector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getConditionFields } from '@/config/conditionFields';
import { useHass } from '@/contexts/HassContext';
import { HaSelector } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { HassEntity } from '@/types/hass';
import { getNodeDataString } from '@/utils/nodeData';
import { GENERIC_STATES, getStateSuggestions, StateValueListField } from './StateValueCombobox';

/** Narrows an `ha-selector` `value-changed` payload to a plain string, or `undefined` if empty/non-string. */
function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

interface StateConditionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

export function StateConditionFields({ node, onChange, entities }: StateConditionFieldsProps) {
  const { t } = useTranslation(['nodes', 'common']);
  const { getFieldError } = useNodeErrors(node.id);
  const { entities: contextEntities } = useHass();

  const allEntities = entities.length > 0 ? entities : contextEntities;

  const nodeData = node.data as Record<string, unknown>;
  const entityIdRaw = nodeData.entity_id;
  const entityIds: string[] = Array.isArray(entityIdRaw)
    ? entityIdRaw
    : typeof entityIdRaw === 'string' && entityIdRaw
      ? [entityIdRaw]
      : [];

  const stateValueRaw = nodeData.state;
  const stateValue: string | string[] = Array.isArray(stateValueRaw)
    ? (stateValueRaw as string[])
    : typeof stateValueRaw === 'string'
      ? stateValueRaw
      : '';
  const attributeValue = getNodeDataString(node, 'attribute');
  const matchValue = getNodeDataString(node, 'match', 'all');

  const stateSuggestions = useMemo(() => {
    if (entityIds.length === 0) return GENERIC_STATES;
    const all = new Set<string>();
    for (const id of entityIds) {
      for (const s of getStateSuggestions(id, allEntities)) {
        all.add(s);
      }
    }
    return Array.from(all);
  }, [entityIds, allEntities]);

  const forField = getConditionFields('state').find((f) => f.name === 'for');

  return (
    <>
      <FormField label={t('nodes:fieldLabels.entity_id')} required>
        <HaSelector
          selector={{ entity: { multiple: true } }}
          value={entityIds}
          onChange={(value) => onChange('entity_id', value)}
          fallback={
            <MultiEntitySelector
              value={entityIds}
              onChange={(value) => onChange('entity_id', value)}
              entities={allEntities}
              placeholder={t('common:placeholders.selectEntity')}
            />
          }
        />
        <FieldError message={getFieldError('entity_id')} />
      </FormField>

      {entityIds.length > 1 && (
        <FormField
          label={t('nodes:fieldLabels.match')}
          description={t('nodes:fieldDescriptions.match')}
        >
          <Select value={matchValue} onValueChange={(v) => onChange('match', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('nodes:fieldOptions.match.all')}</SelectItem>
              <SelectItem value="any">{t('nodes:fieldOptions.match.any')}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      )}

      <FormField label={t('nodes:fieldLabels.state')} required>
        <HaSelector
          selector={{
            state: { entity_id: entityIds, attribute: attributeValue || undefined, multiple: true },
          }}
          value={Array.isArray(stateValue) ? stateValue : stateValue ? [stateValue] : []}
          onChange={(v) => {
            const list = Array.isArray(v) ? (v as string[]) : [];
            onChange('state', list.length === 0 ? undefined : list.length === 1 ? list[0] : list);
          }}
          fallback={
            <StateValueListField
              value={stateValue}
              onChange={(v) => onChange('state', v)}
              suggestions={stateSuggestions}
              placeholder={t('nodes:fieldPlaceholders.state')}
            />
          }
        />
        <FieldError message={getFieldError('state')} />
      </FormField>

      <FormField label={t('nodes:fieldLabels.attribute')}>
        <HaSelector
          selector={{ attribute: { entity_id: entityIds } }}
          value={attributeValue}
          onChange={(v) => onChange('attribute', toOptionalString(v))}
          fallback={
            <Input
              type="text"
              value={attributeValue}
              onChange={(e) => onChange('attribute', e.target.value || undefined)}
              placeholder={t('nodes:fieldPlaceholders.attribute')}
            />
          }
        />
      </FormField>

      {forField && (
        <DynamicFieldRenderer
          field={forField}
          value={nodeData[forField.name]}
          onChange={(value) => onChange(forField.name, value)}
          entities={allEntities}
          error={getFieldError(forField.name)}
        />
      )}
    </>
  );
}
