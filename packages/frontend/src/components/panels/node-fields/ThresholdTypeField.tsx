import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HaSelect } from '@/ha';
import {
  THRESHOLD_CROSSING_TYPES,
  type ThresholdCrossingType,
  type TypedThreshold,
} from '@/lib/nativeThreshold';
import { DurationInput, type DurationValue } from './DurationField';
import { ThresholdValueField } from './ThresholdValueField';

interface ThresholdTypeFieldProps {
  threshold: TypedThreshold;
  onChange: (threshold: TypedThreshold) => void;
  /**
   * Omit both (rather than passing a no-op) for the rare TYPED condition
   * that HA documents with no sibling `for` field at all — confirmed for
   * `sun.elevation` (home-assistant.io/conditions/sun.elevation/ shows no
   * `for` option, unlike every other TYPED condition/trigger this session
   * verified, which all have one).
   */
  forValue?: DurationValue;
  onForChange?: (value: DurationValue) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /**
   * Adds an `any` crossing type — used by HA's `.changed` (not
   * `crossed_threshold`) purpose-specific triggers (illuminance.changed,
   * battery.level_changed, humidity.changed, temperature.changed), which
   * fire on any value change with no bound to configure. Selecting `any`
   * hides the value/value_min/value_max fields entirely, since HA's
   * `type: any` shape takes none. See lib/nativeThreshold.ts's
   * TRIGGER_FIELD_CONFIG.
   */
  allowAny?: boolean;
}

/**
 * Editor for the TYPED `options.threshold` shape used by every
 * purpose-specific trigger/condition except light's brightness ones (see
 * lib/nativeThreshold.ts): a crossing `type` (above/below/between/outside)
 * plus one or two threshold bounds, and (usually) a sibling `for` duration.
 */
export function ThresholdTypeField({
  threshold,
  onChange,
  forValue,
  onForChange,
  min,
  max,
  step,
  unit,
  allowAny,
}: ThresholdTypeFieldProps) {
  const { t } = useTranslation(['nodes']);
  const crossingType = threshold.type ?? (allowAny ? 'any' : 'above');
  const isAny = crossingType === 'any';
  const isRange = crossingType === 'between' || crossingType === 'outside';
  const crossingTypes: ThresholdCrossingType[] = allowAny
    ? ['any', ...THRESHOLD_CROSSING_TYPES]
    : THRESHOLD_CROSSING_TYPES;

  const handleTypeChange = (newType: string) => {
    onChange({ ...threshold, type: newType as ThresholdCrossingType });
  };

  return (
    <>
      <FormField label={t('nodes:triggers.native.thresholdTypeLabel')}>
        <HaSelect
          value={crossingType}
          onChange={(v) => handleTypeChange(String(v))}
          options={crossingTypes.map((type) => ({
            value: type,
            label: t(`nodes:triggers.native.thresholdTypes.${type}`),
          }))}
          fallback={
            <Select value={crossingType} onValueChange={handleTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {crossingTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`nodes:triggers.native.thresholdTypes.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </FormField>

      {isAny ? null : isRange ? (
        <>
          <FormField label={t('nodes:triggers.native.thresholdMinLabel')}>
            <ThresholdValueField
              value={threshold.value_min}
              onChange={(v) => onChange({ ...threshold, value_min: v })}
              min={min}
              max={max}
              step={step}
              unit={unit}
            />
          </FormField>
          <FormField label={t('nodes:triggers.native.thresholdMaxLabel')}>
            <ThresholdValueField
              value={threshold.value_max}
              onChange={(v) => onChange({ ...threshold, value_max: v })}
              min={min}
              max={max}
              step={step}
              unit={unit}
            />
          </FormField>
        </>
      ) : (
        <FormField label={t('nodes:triggers.native.thresholdLabel')}>
          <ThresholdValueField
            value={threshold.value}
            onChange={(v) => onChange({ ...threshold, value: v })}
            min={min}
            max={max}
            step={step}
            unit={unit}
          />
        </FormField>
      )}

      {onForChange && (
        <FormField
          label={t('nodes:triggers.native.thresholdForLabel')}
          description={t('nodes:triggers.native.thresholdForDescription')}
        >
          <DurationInput value={forValue ?? {}} onChange={onForChange} />
        </FormField>
      )}
    </>
  );
}
