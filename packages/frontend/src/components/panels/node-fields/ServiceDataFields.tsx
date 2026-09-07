import type React from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { EntitySelector } from '@/components/ui/EntitySelector';
import { IdList } from '@/components/ui/IdList';
import { Input } from '@/components/ui/input';
import { MultiEntitySelector } from '@/components/ui/MultiEntitySelector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HaSelector, HaSwitch } from '@/ha';
import { DurationInput, type DurationValue } from './DurationField';

interface ServiceField {
  name?: string;
  description?: string;
  example?: unknown;
  required?: boolean;
  selector?: Record<string, unknown>;
}

interface ServiceDataFieldsProps {
  serviceFields: Record<string, ServiceField>;
  currentData: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}

/**
 * Renders dynamic service data fields based on a live service definition
 * (`useHass().getServiceDefinition()`), one per `selector`-typed field HA's
 * own service registry declares.
 *
 * Every case here delegates its *primary* rendering to `HaSelector` (the
 * `ha-selector` custom element, when embedded in real Home Assistant) —
 * `ha-selector` is generic-by-design and already renders the exact same
 * widget real HA's own "Perform action" editor would for that field (color
 * wheel, duration picker, date/time picker, target picker, ...). The bespoke
 * fallback UI per case only matters for the standalone/no-HA-connection
 * scenario.
 *
 * Before this rewrite, only `number`/`select`/`boolean`/`entity` had a real
 * case — every other selector type (`color_rgb`, `color_temp`, `template`,
 * `object`, `duration`, `time`/`date`/`datetime`, `device`/`area`/`label`/
 * `floor`/`target`, `icon`, `media`, `action`, ...) silently fell through to
 * a bare text `<Input>`, even when running inside real HA where `ha-selector`
 * could render the correct widget — a genuine functional-parity gap versus
 * HA's own action editor (e.g. `light.turn_on`'s `rgb_color` needed the user
 * to hand-type a comma-separated string instead of getting a color picker).
 * The `default` case below closes this for good: any selector type not
 * explicitly cased still gets handed to `HaSelector` verbatim (the raw
 * `field.selector` object, whatever its shape), rather than defaulting to
 * plain text — so a newly-introduced HA selector type "just works" here too,
 * degrading only to text in the no-HA-connection fallback path.
 */
export function ServiceDataFields({
  serviceFields,
  currentData,
  onChange,
}: ServiceDataFieldsProps) {
  const { t } = useTranslation(['common', 'nodes']);
  if (Object.keys(serviceFields).length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3">
      <h4 className="mb-3 font-semibold text-muted-foreground text-xs">
        {t('nodes:serviceDataFields.heading')}
      </h4>
      {Object.entries(serviceFields).map(([fieldName, field]) => (
        <ServiceDataField
          key={fieldName}
          fieldName={fieldName}
          field={field}
          value={currentData[fieldName]}
          onChange={(value) => onChange(fieldName, value)}
        />
      ))}
    </div>
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

interface ServiceDataFieldProps {
  fieldName: string;
  field: ServiceField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ServiceDataField({ fieldName, field, value, onChange }: ServiceDataFieldProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const selector = field.selector ?? {};
  const selectorType = Object.keys(selector)[0];
  const selectorConfig = (selector[selectorType] ?? {}) as Record<string, unknown>;
  const isMultiple = selectorConfig.multiple === true;
  const fieldLabel =
    field.name || fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const placeholder = field.example !== undefined ? String(field.example) : undefined;

  const wrap = (control: React.ReactNode, labelSuffix?: string) => (
    <FormField
      label={labelSuffix ? `${fieldLabel} (${labelSuffix})` : fieldLabel}
      required={field.required}
      description={field.description}
    >
      {control}
    </FormField>
  );

  switch (selectorType) {
    case 'number': {
      const config = selectorConfig as { min?: number; max?: number; unit_of_measurement?: string };
      return wrap(
        <HaSelector
          selector={{ number: { min: config.min, max: config.max, mode: 'box', unit_of_measurement: config.unit_of_measurement } }}
          value={typeof value === 'number' ? value : undefined}
          onChange={(v) => onChange(typeof v === 'number' ? v : v ? Number(v) : undefined)}
          required={field.required}
          fallback={
            <Input
              type="number"
              value={(value as number) ?? ''}
              onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
              min={config.min}
              max={config.max}
              placeholder={placeholder}
            />
          }
        />,
        config.unit_of_measurement
      );
    }

    case 'select': {
      const config = selectorConfig as { options?: unknown[] };
      const options = (config.options ?? []).map((opt) =>
        typeof opt === 'string' ? { value: opt, label: opt } : (opt as { value: string; label: string })
      );

      if (isMultiple) {
        const values = toStringArray(value);
        return wrap(
          <HaSelector
            selector={{ select: { options, multiple: true } }}
            value={values}
            onChange={(v) => onChange(Array.isArray(v) ? v : [])}
            fallback={<IdList values={values} onChange={onChange} placeholder={t('placeholders.addValue')} />}
          />
        );
      }

      return wrap(
        <HaSelector
          selector={field.selector ?? { select: { options } }}
          value={value ?? ''}
          onChange={(v) => onChange(v ?? undefined)}
          fallback={
            <Select
              value={String(value === '' || value === undefined ? '__NONE__' : value)}
              onValueChange={(v) => onChange(v === '__NONE__' ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('placeholders.none')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__">{t('placeholders.none')}</SelectItem>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      );
    }

    case 'boolean':
      return wrap(
        <HaSwitch
          checked={(value as boolean) ?? false}
          onChange={onChange}
          fallback={<Switch checked={(value as boolean) ?? false} onCheckedChange={onChange} />}
        />
      );

    case 'entity': {
      if (isMultiple) {
        const values = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
        return wrap(
          <HaSelector
            selector={{ entity: { multiple: true } }}
            value={values}
            onChange={(v) => onChange(Array.isArray(v) ? v : [])}
            fallback={
              <MultiEntitySelector value={values} onChange={onChange} placeholder={placeholder} />
            }
          />
        );
      }
      return wrap(
        <HaSelector
          selector={{ entity: {} }}
          value={value ?? ''}
          onChange={onChange}
          fallback={
            <EntitySelector value={String(value ?? '')} onChange={onChange} placeholder={placeholder} />
          }
        />
      );
    }

    case 'device':
    case 'area':
    case 'label':
    case 'floor': {
      const values = toStringArray(Array.isArray(value) ? value : value ? [value] : []);
      return wrap(
        <HaSelector
          selector={{ [selectorType]: { multiple: isMultiple } }}
          value={isMultiple ? values : values[0]}
          onChange={(v) => onChange(isMultiple ? (Array.isArray(v) ? v : []) : v)}
          fallback={<IdList values={values} onChange={onChange} placeholder={t('placeholders.addValue')} />}
        />
      );
    }

    // A field of type `target` itself (rare — most services declare `target`
    // at the service level, handled separately by ActionFields.tsx's own
    // entity/device/area/label/floor selectors) — a plain object with the
    // same entity_id/device_id/area_id/label_id/floor_id keys.
    case 'target': {
      const targetValue = (value ?? {}) as Record<string, unknown>;
      return wrap(
        <HaSelector
          selector={{ target: {} }}
          value={targetValue}
          onChange={(v) => onChange(v ?? {})}
          fallback={
            <div className="space-y-2">
              <IdList
                values={toStringArray(targetValue.entity_id)}
                onChange={(ids) => onChange({ ...targetValue, entity_id: ids })}
                placeholder={t('nodes:actions.addEntityId')}
              />
              <IdList
                values={toStringArray(targetValue.device_id)}
                onChange={(ids) => onChange({ ...targetValue, device_id: ids })}
                placeholder={t('nodes:actions.addDeviceId')}
              />
              <IdList
                values={toStringArray(targetValue.area_id)}
                onChange={(ids) => onChange({ ...targetValue, area_id: ids })}
                placeholder={t('nodes:actions.addAreaId')}
              />
            </div>
          }
        />
      );
    }

    case 'template':
      return wrap(
        <HaSelector
          selector={{ template: {} }}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          required={field.required}
          fallback={
            <Textarea
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || t('placeholders.enterTemplate')}
              className="font-mono text-sm"
              rows={3}
            />
          }
        />
      );

    case 'object':
      return wrap(
        <HaSelector
          selector={{ object: {} }}
          value={value}
          onChange={onChange}
          fallback={
            <Textarea
              value={typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : ((value as string) ?? '')}
              onChange={(e) => {
                try {
                  onChange(JSON.parse(e.target.value));
                } catch {
                  onChange(e.target.value);
                }
              }}
              placeholder={placeholder || t('placeholders.jsonExample')}
              className="font-mono text-sm"
              rows={3}
            />
          }
        />
      );

    case 'duration':
      return wrap(<DurationInput value={(value as DurationValue) ?? {}} onChange={onChange} />);

    case 'time':
      return wrap(
        <HaSelector
          selector={{ time: {} }}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          fallback={
            <Input type="time" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
          }
        />
      );

    case 'date':
      return wrap(
        <HaSelector
          selector={{ date: {} }}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          fallback={
            <Input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
          }
        />
      );

    // `datetime` — a combined date+time selector distinct from the two
    // above (e.g. `todo.add_item`'s `due_datetime`, `calendar.create_event`'s
    // start/end) — not handled anywhere in Circuitry before this rewrite.
    case 'datetime':
      return wrap(
        <HaSelector
          selector={{ datetime: {} }}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          fallback={
            <Input
              type="datetime-local"
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
            />
          }
        />
      );

    // `color_rgb` — e.g. `light.turn_on`'s `rgb_color`, a 3-number [r,g,b]
    // tuple. Real HA renders a color wheel here; the fallback is a plain
    // 3-number row rather than requiring the user to hand-type a JSON array.
    case 'color_rgb': {
      const rgb = Array.isArray(value) ? (value as number[]) : [0, 0, 0];
      const setChannel = (i: number, raw: string) => {
        const next = [...rgb];
        next[i] = raw === '' ? 0 : Number(raw);
        onChange(next);
      };
      return wrap(
        <HaSelector
          selector={{ color_rgb: {} }}
          value={rgb}
          onChange={(v) => onChange(Array.isArray(v) ? v : rgb)}
          fallback={
            <div className="flex gap-2">
              {(['R', 'G', 'B'] as const).map((label, i) => (
                <Input
                  key={label}
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[i] ?? 0}
                  onChange={(e) => setChannel(i, e.target.value)}
                  placeholder={label}
                />
              ))}
            </div>
          }
        />
      );
    }

    // Anything else — `color_temp`, `icon`, `media`, `action`, `condition`,
    // `trigger`, `config_entry`, `addon`, `assist_pipeline`,
    // `backup_location`, `constant`, `country`, `language`, `location`,
    // `qr_code`, `state`, `statistic`, `stt`, `tts`, `theme`, `file`,
    // `image`, `attribute`, `button_toggle`, `text` (see note below), and any
    // future selector type HA introduces — hand the RAW selector object
    // straight to `ha-selector` rather than guessing at a bespoke widget for
    // each. `text` deliberately lands here too (not a dedicated case): a
    // plain `Input` is already the correct fallback for it, identical to
    // this default branch's own fallback.
    default: {
      if (isMultiple) {
        const values = toStringArray(value);
        return wrap(
          <HaSelector
            selector={field.selector ?? { text: { multiple: true } }}
            value={values}
            onChange={(v) => onChange(Array.isArray(v) ? v : [])}
            fallback={<IdList values={values} onChange={onChange} placeholder={placeholder || t('placeholders.addValue')} />}
          />
        );
      }
      return wrap(
        <HaSelector
          selector={field.selector ?? { text: {} }}
          value={value ?? ''}
          onChange={onChange}
          required={field.required}
          fallback={
            <Input
              type="text"
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
            />
          }
        />
      );
    }
  }
}
