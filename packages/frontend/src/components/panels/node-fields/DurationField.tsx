import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HaSelector } from '@/ha';

export type DurationObject = {
  hours?: number | string;
  minutes?: number | string;
  seconds?: number | string;
  milliseconds?: number | string;
};

/**
 * A duration as Home Assistant takes it: an "HH:MM[:SS]" string, a number
 * of seconds (`5`, `1.5`, or the same as a string), a template, or the
 * object form.
 */
export type DurationValue = string | number | DurationObject;

/** Seconds, whole or with up to three decimals, as HA reads a plain number string. */
const SECONDS_RE = /^\d+(?:\.\d{1,3})?$/;
/** "H:MM" or "H:MM:SS[.fff]", as HA's time_period_str reads it (hours and minutes whole). */
const CLOCK_RE = /^(\d+):(\d+)(?::(\d+(?:\.\d{1,3})?))?$/;

/** A number of seconds as whole seconds plus milliseconds (1.5 -> 1 s 500 ms). */
function secondsToObject(total: number): DurationObject {
  const totalMs = Math.round(total * 1000);
  const milliseconds = totalMs % 1000;
  return {
    seconds: (totalMs - milliseconds) / 1000,
    ...(milliseconds ? { milliseconds } : {}),
  };
}

/**
 * The duration picker's object form of a duration, read the way HA reads
 * it, or `null` when the picker can't show it (a template, or a string HA
 * reads in some other way): those are kept as written and edited as text.
 *
 * HA reads "00:00:01.5" as 1.5 seconds; this used to show it as 1 second
 * and 5 milliseconds, and any edit in the picker then saved 1.005 seconds
 * (bug #68). A number of seconds (`delay: 5`) used to reach the picker as
 * a bare number, which it can't show (bug #60).
 */
export function durationToObject(value: DurationValue | undefined): DurationObject | null {
  if (value === undefined || value === null) return {};
  if (typeof value === 'number') return Number.isFinite(value) ? secondsToObject(value) : null;
  if (typeof value !== 'string') return value;
  if (SECONDS_RE.test(value)) return secondsToObject(Number(value));
  const match = CLOCK_RE.exec(value);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return {
    hours: Number(hours),
    minutes: Number(minutes),
    ...secondsToObject(seconds === undefined ? 0 : Number(seconds)),
  };
}

export interface DurationInputProps {
  value: DurationValue;
  onChange: (val: DurationValue) => void;
}

/**
 * Reusable duration input component without label/description wrapper.
 * Reads string ("HH:MM:SS") and number-of-seconds values (see
 * durationToObject), but always writes the
 * `{ hours, minutes, seconds, milliseconds }` object HA's
 * native duration selector uses — both formats are equally valid in HA
 * automation YAML, and only the object form has a native picker.
 */
export function DurationInput({ value, onChange }: DurationInputProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const obj: DurationObject = durationToObject(value) ?? {};

  const handleObjChange = (field: 'hours' | 'minutes' | 'seconds' | 'milliseconds', v: string) => {
    const num = v === '' ? undefined : Number(v);
    const updated = {
      ...obj,
      [field]: Number.isNaN(num) ? undefined : num,
    };
    Object.keys(updated).forEach((k) => {
      const v = updated[k as keyof typeof updated];
      if (v === undefined || v === null) {
        delete updated[k as keyof typeof updated];
      }
    });
    onChange(updated);
  };

  return (
    <HaSelector
      selector={{ duration: { enable_millisecond: true } }}
      value={obj}
      onChange={(v) => {
        if (!v || typeof v !== 'object') return;
        const cleaned = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(
            ([, val]) => val !== undefined && val !== null
          )
        );
        onChange(cleaned);
      }}
      fallback={
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-muted-foreground text-xs">
              {t('nodes:durationField.hours')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.hours ?? ''}
              onChange={(e) => handleObjChange('hours', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div className="flex-1">
            <Label className="text-muted-foreground text-xs">
              {t('nodes:durationField.minutes')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.minutes ?? ''}
              onChange={(e) => handleObjChange('minutes', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div className="flex-1">
            <Label className="text-muted-foreground text-xs">
              {t('nodes:durationField.seconds')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.seconds ?? ''}
              onChange={(e) => handleObjChange('seconds', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div className="flex-1">
            <Label className="text-muted-foreground text-xs">
              {t('nodes:durationField.milliseconds')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.milliseconds ?? ''}
              onChange={(e) => handleObjChange('milliseconds', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
        </div>
      }
    />
  );
}

export interface DurationFieldProps {
  label?: string;
  description?: string;
  value: DurationValue;
  onChange: (val: DurationValue) => void;
  fieldKey?: string; // e.g. 'delay' or 'timeout'
}

/**
 * Duration field with FormField wrapper for label and description.
 */
export function DurationField({ label, description, value, onChange }: DurationFieldProps) {
  const { t } = useTranslation(['common', 'nodes']);

  return (
    <FormField
      label={label ?? t('nodes:durationField.label')}
      description={description || t('nodes:durationField.description')}
    >
      <DurationInput value={value} onChange={onChange} />
    </FormField>
  );
}
