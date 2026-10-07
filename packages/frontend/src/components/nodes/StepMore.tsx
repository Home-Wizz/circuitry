import type { ConditionType, FlowNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { hasShortForm, TriggerShortForm } from '@/components/canvas/fillInForms';
import { NodeFields } from '@/components/panels/NodeFields';
import { TriggerIdField } from '@/components/panels/PropertyPanel';
import { ContinueOnErrorField } from '@/components/panels/node-fields/ContinueOnErrorField';
import { NativeConditionFields } from '@/components/panels/node-fields/NativeConditionFields';
import { NativeTriggerFields } from '@/components/panels/node-fields/NativeTriggerFields';
import { ServiceDataFields } from '@/components/panels/node-fields/ServiceDataFields';
import {
  AttributeField,
  stateConditionEntityIds,
} from '@/components/panels/node-fields/StateConditionFields';
import { ExtraTargets } from '@/components/panels/node-fields/ExtraTargets';
import { TriggerAdvancedFields } from '@/components/panels/node-fields/TriggerAdvancedFields';
import { TriggerConfigFields } from '@/components/panels/node-fields/TriggerFields';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import { FieldHeading } from '@/components/ui/field-heading';
import { Input } from '@/components/ui/input';
import { getConditionFields } from '@/config/conditionFields';
import { getTriggerFields } from '@/config/triggerFields';
import { useHass } from '@/contexts/HassContext';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import { serviceFieldList, withServiceDataField } from '@/lib/serviceFields';
import { isRecord } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';

type Change = (key: string, value: unknown) => void;

/** How many of an action's values its card shows (ValuePills.tsx). */
const VALUES_ON_CARD = 3;

/** A legacy step's own field from the panel's field table, if it has it. */
function ConfigField({
  fields,
  name,
  data,
  onChange,
  entities,
}: {
  fields: ReturnType<typeof getTriggerFields>;
  name: string;
  data: Record<string, unknown>;
  onChange: Change;
  entities: HassEntity[];
}) {
  const field = fields.find((f) => f.name === name);
  if (!field) return null;
  return (
    <DynamicFieldRenderer
      field={field}
      value={data[name]}
      onChange={(value) => onChange(name, value)}
      entities={entities}
    />
  );
}

/** State and Numeric state: an attribute instead of the state (and a
 * Numeric state's value template). Their entities, levels and "for" are
 * on the card. */
function StateExtras({
  kind,
  node,
  onChange,
  entities,
}: {
  kind: 'trigger' | 'condition';
  node: FlowNode;
  onChange: Change;
  entities: HassEntity[];
}) {
  const { t } = useTranslation(['nodes']);
  const data = node.data as Record<string, unknown>;
  const type = String(data[kind]);
  const fields =
    kind === 'trigger' ? getTriggerFields(type) : getConditionFields(type as ConditionType);
  return (
    <>
      <AttributeField
        entityIds={stateConditionEntityIds(data)}
        value={typeof data.attribute === 'string' ? data.attribute : ''}
        onChange={(v) => onChange('attribute', v)}
        label={`${t('nodes:more.attribute')} ${t('nodes:more.optional')}`}
        description={t('nodes:more.attributeHint')}
      />
      {type === 'numeric_state' && (
        <ConfigField
          fields={fields}
          name="value_template"
          data={data}
          onChange={onChange}
          entities={entities}
        />
      )}
    </>
  );
}

function TriggerMore({ node, onChange, entities }: MoreProps) {
  const type = String((node.data as Record<string, unknown>).trigger ?? '');
  const body = type.includes('.') ? (
    <>
      <NativeTriggerFields compact node={node} onChange={onChange} triggerType={type} />
      <TriggerAdvancedFields node={node} onChange={onChange} />
    </>
  ) : type === 'state' || type === 'numeric_state' ? (
    <>
      <StateExtras kind="trigger" node={node} onChange={onChange} entities={entities} />
      <TriggerAdvancedFields node={node} onChange={onChange} />
    </>
  ) : hasShortForm(node.data as Record<string, unknown>) ? (
    // A time, sun, zone or template trigger: its short form, as Fill in has it.
    <>
      <TriggerShortForm
        data={node.data as Record<string, unknown>}
        onPatch={(patch) => {
          for (const [key, value] of Object.entries(patch)) onChange(key, value);
        }}
      />
      <TriggerAdvancedFields node={node} onChange={onChange} />
    </>
  ) : (
    // Its own fields (an event, MQTT, a webhook...) and its variables.
    <TriggerConfigFields node={node} onChange={onChange} entities={entities} />
  );
  return (
    <>
      <TriggerIdField plain node={node} onChange={onChange} />
      {body}
    </>
  );
}

function ConditionMore({ node, onChange, entities }: MoreProps) {
  const type = String((node.data as Record<string, unknown>).condition ?? '');
  if (type.includes('.'))
    return <NativeConditionFields compact node={node} onChange={onChange} conditionType={type} />;
  if (type === 'state' || type === 'numeric_state')
    return <StateExtras kind="condition" node={node} onChange={onChange} entities={entities} />;
  // A time, sun, zone or template condition, a group's conditions...
  return <NodeFields node={node} onChange={onChange} entities={entities} />;
}

function ActionMore({ node, onChange, entities }: MoreProps) {
  const { t } = useTranslation(['nodes']);
  const { getServiceDefinition } = useHass();
  const data = node.data as Record<string, unknown>;
  const service = typeof data.service === 'string' ? data.service : '';
  // Anything but a service call (an event, Stop, a repeat...): its fields.
  if (!service || typeof data.stop === 'string' || data.event !== undefined)
    return <NodeFields node={node} onChange={onChange} entities={entities} />;
  const definition = getServiceDefinition(service);
  const current = isRecord(data.data) ? data.data : {};
  // What its card doesn't show: the settings not set yet, and the values
  // past the ones the card shows.
  const set = serviceFieldList(definition?.fields)
    .filter(([name]) => current[name] !== undefined)
    .map(([name]) => name);
  const onCard = new Set(set.slice(0, VALUES_ON_CARD));
  const rest = Object.fromEntries(
    serviceFieldList(definition?.fields).filter(([name]) => !onCard.has(name))
  );
  return (
    <>
      {Object.keys(rest).length > 0 && (
        <FieldHeading label={t('nodes:more.alsoSet')}>
          <ServiceDataFields
            framed={false}
            serviceFields={rest}
            currentData={current}
            onChange={(name, next) => onChange('data', withServiceDataField(current, name, next))}
          />
        </FieldHeading>
      )}
      {definition?.target && (
        <ExtraTargets
          target={data.target}
          onChange={onChange}
          heading={t('nodes:more.alsoActOn')}
        />
      )}
      {definition?.response && (
        <FieldHeading label={`${t('nodes:more.response')} ${t('nodes:more.optional')}`}>
          <Input
            value={typeof data.response_variable === 'string' ? data.response_variable : ''}
            onChange={(e) => onChange('response_variable', e.target.value || undefined)}
          />
        </FieldHeading>
      )}
      <ContinueOnErrorField
        plain
        checked={data.continue_on_error === true}
        onChange={(checked) => onChange('continue_on_error', checked || undefined)}
      />
    </>
  );
}

interface MoreProps {
  node: FlowNode;
  onChange: Change;
  entities: HassEntity[];
}

/**
 * What a selected card's "+ more" holds: the step's settings its card
 * doesn't show, in plain words. What's
 * on the card (its targets, level, "for") isn't repeated; changing the
 * step's type is Replace…'s, not this. A delay, a wait or variables show
 * their own fields.
 */
export function StepMore({ node, onChange }: { node: FlowNode; onChange: Change }) {
  const entities = useResolvedEntities();
  const props = { node, onChange, entities };
  switch (node.type) {
    case 'trigger':
      return <TriggerMore {...props} />;
    case 'condition':
      return <ConditionMore {...props} />;
    case 'action':
      return <ActionMore {...props} />;
    default:
      return <NodeFields node={node} onChange={onChange} entities={entities} />;
  }
}
