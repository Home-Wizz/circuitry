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
import { PanelTargets } from '../PanelSection';

/** Narrows an `ha-selector` `value-changed` payload to a plain string, or `undefined` if empty/non-string. */
function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** A State condition's entity ids, one or several. */
export function stateConditionEntityIds(data: Readonly<Record<string, unknown>>): string[] {
  const raw = data.entity_id;
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  return typeof raw === 'string' && raw ? [raw] : [];
}

/**
 * What a State condition tests: the state (or states) its entities must be
 * in, and, for several, whether all or any of them. The property panel's
 * fields, shared with the card's state pill (nodes/StatePill.tsx).
 */
export function StateConditionValueFields({
  data,
  entityIds,
  entities,
  onChange,
  stateError,
}: {
  data: Readonly<Record<string, unknown>>;
  entityIds: string[];
  entities: HassEntity[];
  onChange: (key: string, value: unknown) => void;
  stateError?: string;
}) {
  const { t } = useTranslation(['nodes', 'common']);
  const stateValue: string | string[] = Array.isArray(data.state)
    ? data.state.filter((s): s is string => typeof s === 'string')
    : typeof data.state === 'string'
      ? data.state
      : '';
  const attribute = typeof data.attribute === 'string' ? data.attribute : '';
  const matchValue = typeof data.match === 'string' && data.match ? data.match : 'all';
  const stateSuggestions = useMemo(() => {
    if (entityIds.length === 0) return GENERIC_STATES;
    const all = new Set<string>();
    for (const id of entityIds) for (const s of getStateSuggestions(id, entities)) all.add(s);
    return Array.from(all);
  }, [entityIds, entities]);

  return (
    <>
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
            state: { entity_id: entityIds, attribute: attribute || undefined, multiple: true },
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
        <FieldError message={stateError} />
      </FormField>
    </>
  );
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
  const entityIds = stateConditionEntityIds(nodeData);
  const attributeValue = getNodeDataString(node, 'attribute');

  const forField = getConditionFields('state').find((f) => f.name === 'for');

  return (
    <>
      {/* What it acts on, in the side panel. */}
      <PanelTargets>
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
      </PanelTargets>

      <StateConditionValueFields
        data={nodeData}
        entityIds={entityIds}
        entities={allEntities}
        onChange={onChange}
        stateError={getFieldError('state')}
      />

      <AttributeField
        entityIds={entityIds}
        value={attributeValue}
        onChange={(v) => onChange('attribute', v)}
      />

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

/**
 * An attribute to test instead of the state (a light's brightness, a
 * thermostat's mode), picked from its entities' own attributes. The
 * property panel's field; the card's "+ more" shows it with its own words.
 */
export function AttributeField({
  entityIds,
  value,
  onChange,
  label,
  description,
}: {
  entityIds: string[];
  value: string;
  onChange: (value: string | undefined) => void;
  label?: string;
  description?: string;
}) {
  const { t } = useTranslation(['nodes']);
  return (
    <FormField label={label ?? t('nodes:fieldLabels.attribute')} description={description}>
      <HaSelector
        selector={{ attribute: { entity_id: entityIds } }}
        value={value}
        onChange={(v) => onChange(toOptionalString(v))}
        fallback={
          <Input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder={t('nodes:fieldPlaceholders.attribute')}
          />
        }
      />
    </FormField>
  );
}
