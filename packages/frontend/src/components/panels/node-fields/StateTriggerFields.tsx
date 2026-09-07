import type { FlowNode } from '@circuitry/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import { MultiEntitySelector } from '@/components/ui/MultiEntitySelector';
import { Switch } from '@/components/ui/switch';
import { getTriggerFields } from '@/config/triggerFields';
import { useHass } from '@/contexts/HassContext';
import { HaSelector, HaSwitch } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { HassEntity } from '@/types/hass';
import { GENERIC_STATES, getStateSuggestions, StateValueListField } from './StateValueCombobox';

/** Narrows an `ha-selector` `value-changed` payload (a string or an array of strings for multiple:true) to the trigger's from/to shape: a bare string for one value, an array for 2+, or undefined for none. */
function toStateListValue(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === 'string');
    return strings.length === 0 ? undefined : strings.length === 1 ? strings[0] : strings;
  }
  return typeof value === 'string' && value ? value : undefined;
}

interface StateTriggerFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

/**
 * Fields for the `state` trigger platform.
 * Renders entity_id, from/to (with not_from/not_to and explicit-null "any
 * state" support — see StateTransitionField), and the `for` duration.
 */
export function StateTriggerFields({ node, onChange, entities }: StateTriggerFieldsProps) {
  const { t } = useTranslation(['nodes', 'common']);
  const { getFieldError } = useNodeErrors(node.id);
  const { entities: contextEntities } = useHass();

  const allEntities = entities.length > 0 ? entities : contextEntities;

  const data = node.data as Record<string, unknown>;
  const entityIdRaw = data.entity_id;
  const entityIds: string[] = Array.isArray(entityIdRaw)
    ? entityIdRaw
    : typeof entityIdRaw === 'string' && entityIdRaw
      ? [entityIdRaw]
      : [];

  // Collect state suggestions from all selected entities
  const stateSuggestions = useMemo(() => {
    if (entityIds.length === 0) return GENERIC_STATES;
    const allSuggestions = new Set<string>();
    for (const id of entityIds) {
      for (const s of getStateSuggestions(id, allEntities)) {
        allSuggestions.add(s);
      }
    }
    return Array.from(allSuggestions);
  }, [entityIds, allEntities]);

  // The `for`/`attribute` fields use the existing DynamicFieldRenderer
  const forField = getTriggerFields('state').find((f) => f.name === 'for');
  const attributeField = getTriggerFields('state').find((f) => f.name === 'attribute');

  return (
    <>
      {/* Entity selector */}
      <FormField label={t('nodes:triggers.fields.entityId')} required>
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

      {/* From / Not From */}
      <StateTransitionField
        direction="from"
        // Read raw values (not getNodeDataString) so an explicit `null` —
        // "any state, including the first ever recorded" — stays
        // distinguishable from simply unset.
        value={data.from}
        notValue={data.not_from}
        onChangeValue={(v) => onChange('from', v)}
        onChangeNotValue={(v) => onChange('not_from', v)}
        entityIds={entityIds}
        stateSuggestions={stateSuggestions}
      />

      {/* To / Not To */}
      <StateTransitionField
        direction="to"
        value={data.to}
        notValue={data.not_to}
        onChangeValue={(v) => onChange('to', v)}
        onChangeNotValue={(v) => onChange('not_to', v)}
        entityIds={entityIds}
        stateSuggestions={stateSuggestions}
      />

      {/* Attribute (optional) */}
      {attributeField && (
        <DynamicFieldRenderer
          field={attributeField}
          value={data[attributeField.name]}
          onChange={(value) => onChange(attributeField.name, value)}
          entities={allEntities}
          error={getFieldError(attributeField.name)}
        />
      )}

      {/* For Duration */}
      {forField && (
        <DynamicFieldRenderer
          field={forField}
          value={data[forField.name]}
          onChange={(value) => onChange(forField.name, value)}
          entities={allEntities}
          error={getFieldError(forField.name)}
        />
      )}
    </>
  );
}

interface StateTransitionFieldProps {
  /** Which pair of HA fields this editor drives: `from`/`not_from` or `to`/`not_to`. */
  direction: 'from' | 'to';
  /** Raw `node.data[direction]` — a string, a string list (OR-match), `null` (explicit "any state"), or `undefined` (unset). */
  value: unknown;
  /** Raw `node.data['not_' + direction]` — a string, a string list, or `undefined` (unset). */
  notValue: unknown;
  onChangeValue: (value: string | string[] | null | undefined) => void;
  onChangeNotValue: (value: string | string[] | undefined) => void;
  entityIds: string[];
  stateSuggestions: string[];
}

/**
 * One side (`from` or `to`) of the state trigger's transition fields, with a
 * mode toggle for HA's mutually-exclusive `from`/`not_from` (and `to`/
 * `not_to`) pair, plus — positive mode only, since `not_from`/`not_to` have
 * no `null` meaning per HA's docs — an explicit "any state (ignoring
 * attribute changes)" toggle that writes YAML `null` rather than just
 * leaving the field unset. Used twice (from, to) by StateTriggerFields
 * rather than duplicating this logic per CLAUDE.md's DRY mandate.
 *
 * `to`/`from` (and `not_to`/`not_from`) all accept either a single state or
 * a list — HA's schema is `vol.Any(str, [str], None)` — matching multiple
 * states OR-style ("trigger if the new state is any of these"). Previously
 * this only ever wrote a single string, so a user who wanted e.g. "trigger
 * when state becomes 'home' OR 'extended_away'" had no way to express it
 * here at all.
 */
function StateTransitionField({
  direction,
  value,
  notValue,
  onChangeValue,
  onChangeNotValue,
  entityIds,
  stateSuggestions,
}: StateTransitionFieldProps) {
  const { t } = useTranslation(['nodes']);

  const isNegated = notValue !== undefined;
  const isAnyState = value === null;
  const listValue: string | string[] = Array.isArray(value)
    ? (value as string[])
    : typeof value === 'string'
      ? value
      : '';
  const notListValue: string | string[] = Array.isArray(notValue)
    ? (notValue as string[])
    : typeof notValue === 'string'
      ? notValue
      : '';
  const listValueArray = Array.isArray(listValue) ? listValue : listValue ? [listValue] : [];
  const notListValueArray = Array.isArray(notListValue)
    ? notListValue
    : notListValue
      ? [notListValue]
      : [];

  const label =
    direction === 'from' ? t('nodes:triggers.fields.fromState') : t('nodes:triggers.fields.toState');
  const notLabel =
    direction === 'from'
      ? t('nodes:triggers.stateTransition.notFrom')
      : t('nodes:triggers.stateTransition.notTo');
  const placeholder =
    direction === 'from'
      ? t('nodes:triggers.fields.fromStatePlaceholder')
      : t('nodes:triggers.fields.toStatePlaceholder');

  const switchToPositive = () => onChangeNotValue(undefined);
  const switchToNegated = () => {
    onChangeValue(undefined);
    onChangeNotValue('');
  };
  const toggleAnyState = (checked: boolean) => onChangeValue(checked ? null : undefined);

  return (
    <FormField
      label={label}
      description={isNegated ? t('nodes:triggers.stateTransition.negatedDescription') : undefined}
    >
      <div className="mb-2 flex gap-1">
        <Button
          type="button"
          variant={isNegated ? 'outline' : 'secondary'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={switchToPositive}
        >
          {label}
        </Button>
        <Button
          type="button"
          variant={isNegated ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={switchToNegated}
        >
          {notLabel}
        </Button>
      </div>

      {isNegated ? (
        <HaSelector
          selector={{ state: { entity_id: entityIds, multiple: true } }}
          value={notListValueArray}
          onChange={(v) => onChangeNotValue(toStateListValue(v))}
          fallback={
            <StateValueListField
              value={notListValue}
              onChange={onChangeNotValue}
              suggestions={stateSuggestions}
              placeholder={placeholder}
            />
          }
        />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <HaSwitch
              checked={isAnyState}
              onChange={toggleAnyState}
              fallback={<Switch checked={isAnyState} onCheckedChange={toggleAnyState} />}
            />
            <span className="text-muted-foreground text-xs">
              {t('nodes:triggers.stateTransition.anyState')}
            </span>
          </div>
          {!isAnyState && (
            <HaSelector
              selector={{ state: { entity_id: entityIds, multiple: true } }}
              value={listValueArray}
              onChange={(v) => onChangeValue(toStateListValue(v))}
              fallback={
                <StateValueListField
                  value={listValue}
                  onChange={onChangeValue}
                  suggestions={stateSuggestions}
                  placeholder={placeholder}
                />
              }
            />
          )}
        </>
      )}
    </FormField>
  );
}
