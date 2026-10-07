import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  asServiceField,
  ServiceDataField,
  ServiceDataFields,
} from '@/components/panels/node-fields/ServiceDataFields';
import { useHass } from '@/contexts/HassContext';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { nameFromEntityId } from '@/lib/entityNames';
import type { NodeColorToken } from '@/lib/node-colors';
import { selectOptions, serviceFieldList, withServiceDataField } from '@/lib/serviceFields';
import { isRecord, prettify } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { durationUnits, formatDuration } from './formatDuration';

/** Fields whose value says what it is on its own ("40 %", "2700 K"): a
 * card shows them after "at", without their name. */
const LEVEL_FIELDS: ReadonlySet<string> = new Set(['brightness_pct', 'color_temp_kelvin']);

/** How many values a card shows; the rest are counted. */
const MAX_SHOWN = 3;

/**
 * A value as a card shows it, from its field's selector: "40 %", "on",
 * a select's label, a colour's swatch and hex, a duration, an entity's
 * name.
 */
export function formatServiceValue(
  selector: Record<string, unknown> | undefined,
  value: unknown,
  t: TFunction<['nodes']>,
  entityNames: (entityIds: readonly string[]) => string = (ids) =>
    ids.map(nameFromEntityId).join(', ')
): string {
  const type = selector ? Object.keys(selector)[0] : undefined;
  const config = type && selector && isRecord(selector[type]) ? selector[type] : {};
  if (typeof value === 'boolean') return value ? t('nodes:pill.on') : t('nodes:pill.off');
  if (typeof value === 'number') {
    const unit = typeof config.unit_of_measurement === 'string' ? config.unit_of_measurement : '';
    const kelvin = type === 'color_temp' && config.unit === 'kelvin';
    return [value, unit || (kelvin ? 'K' : '')].filter((part) => part !== '').join(' ');
  }
  if (type === 'select' && typeof value === 'string') {
    return selectOptions(config).find((o) => o.value === value)?.label ?? value;
  }
  if (type === 'color_rgb' && Array.isArray(value) && value.length === 3) {
    return `#${value.map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
  }
  if (type === 'duration' && (isRecord(value) || typeof value === 'string')) {
    return formatDuration(value as Parameters<typeof formatDuration>[0], durationUnits(t));
  }
  // An entity field's value by name, never its id.
  if (type === 'entity' && typeof value === 'string') return entityNames([value]);
  if (type === 'entity' && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return entityNames(value);
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) return value.join(', ');
  return '…';
}

interface ValuePillsProps {
  nodeId: string;
  data: Readonly<Record<string, unknown>>;
  tone: NodeColorToken;
}

/**
 * An action's settings as pills in its card's sentence ("with [Brightness
 * 40 %]"): the fields its service call sets, in the order Home Assistant
 * describes them. A click opens the property panel's own editor for that
 * field, and each change goes through the store, as the panel's does.
 */
export function ValuePills({ nodeId, data, tone }: ValuePillsProps) {
  const { t } = useTranslation(['nodes']);
  const { getServiceDefinition } = useHass();
  const service = typeof data.service === 'string' ? data.service : '';
  const current = isRecord(data.data) ? data.data : {};
  const described = getServiceDefinition(service)?.fields;
  const fields = serviceFieldList(described).filter(([name]) => current[name] !== undefined);
  // The values it doesn't show: "+2 more", opening every setting it can
  // have. (A selected card offers all of a step's settings anyway,
  // StepSettingsPill.)
  const hidden = Math.max(fields.length - MAX_SHOWN, 0);
  const more = hidden > 0 && (
    <>
      {' '}
      <MoreSettingsPill
        nodeId={nodeId}
        serviceFields={described}
        data={current}
        hidden={hidden}
        tone={tone}
      />
    </>
  );
  if (fields.length === 0) return null;
  // A level reads "at [40 %] [2700 K]", the rest "with [Transition 2 s]".
  const shown = fields.slice(0, MAX_SHOWN);
  const levels = shown.filter(([name]) => LEVEL_FIELDS.has(name));
  const others = shown.filter(([name]) => !LEVEL_FIELDS.has(name));
  const group = (word: string, list: typeof shown) =>
    list.length > 0 && (
      <>
        {` ${word} `}
        {list.map(([name, raw], index) => (
          <span key={name}>
            {index > 0 && ' '}
            <ValuePill
              nodeId={nodeId}
              name={name}
              field={raw}
              data={current}
              tone={tone}
              bare={LEVEL_FIELDS.has(name)}
            />
          </span>
        ))}
      </>
    );
  return (
    <>
      {group(t('nodes:pill.at'), levels)}
      {group(t('nodes:pill.with'), others)}
      {more}
    </>
  );
}

/**
 * The values an action's card doesn't show ("+2 more"): it opens the
 * property panel's editors for every setting its service has.
 */
function MoreSettingsPill({
  nodeId,
  serviceFields,
  data,
  hidden,
  tone,
}: {
  nodeId: string;
  serviceFields: unknown;
  data: Record<string, unknown>;
  hidden: number;
  tone: NodeColorToken;
}) {
  const { t } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  return (
    <EditPill
      tone={tone}
      testId="more-settings-pill"
      ariaLabel={t('nodes:pill.moreSettings')}
      contentClassName="max-h-[60vh] w-80 overflow-y-auto"
      editor={() => (
        <ServiceDataFields
          framed={false}
          serviceFields={serviceFields}
          currentData={data}
          onChange={(name, next) =>
            updateNodeData(nodeId, { data: withServiceDataField(data, name, next) })
          }
        />
      )}
    >
      <span className={PILL_TEXT}>{t('nodes:pill.moreValues', { count: hidden })}</span>
    </EditPill>
  );
}

function ValuePill({
  nodeId,
  name,
  field: raw,
  data,
  tone,
  bare = false,
}: {
  nodeId: string;
  name: string;
  field: Record<string, unknown>;
  data: Record<string, unknown>;
  tone: NodeColorToken;
  /** Its value alone, without the field's name (a level, LEVEL_FIELDS). */
  bare?: boolean;
}) {
  const { t } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const field = asServiceField(raw);
  const label = field.name || prettify(name);
  const value = data[name];
  const { entityNames } = useNodeCardDisplay();
  const text = formatServiceValue(field.selector, value, t, entityNames);
  const swatch =
    field.selector && 'color_rgb' in field.selector && Array.isArray(value) && value.length === 3
      ? `rgb(${value.join(', ')})`
      : undefined;
  return (
    <EditPill
      tone={tone}
      testId="value-pill"
      ariaLabel={t('nodes:pill.editValue', { field: label })}
      editor={() => (
        <ServiceDataField
          fieldName={name}
          field={field}
          value={value}
          onChange={(next) =>
            updateNodeData(nodeId, { data: withServiceDataField(data, name, next) })
          }
        />
      )}
    >
      {swatch && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
          style={{ backgroundColor: swatch }}
        />
      )}
      <span className={PILL_TEXT}>
        {!bare && <span className="font-normal opacity-80">{label} </span>}
        {text}
      </span>
    </EditPill>
  );
}
