import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import type { SimpleThreshold } from '@/lib/nativeThreshold';
import { ThresholdValueField } from './ThresholdValueField';

interface SimpleThresholdFieldProps {
  threshold: SimpleThreshold;
  onChange: (threshold: SimpleThreshold) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/**
 * Editor for the FLAT-SIMPLE `options.threshold` shape — confirmed unique
 * to `humidifier.is_target_humidity` (see lib/nativeThreshold.ts):
 * `{ above?, below? }`, bare `ThresholdValue`s (`{number}`/`{entity}`)
 * directly under `threshold`, with NO `type` selector the way
 * ThresholdTypeField's shape has. Setting both bounds is HA's own
 * documented way to express an "in range" check for this one condition —
 * there's no YAML form for "outside range" here (unlike its sibling
 * `climate.is_target_humidity`, which uses the richer TYPED shape and does
 * support it), so this only offers the two bounds, not a crossing-type
 * selector.
 */
export function SimpleThresholdField({
  threshold,
  onChange,
  min,
  max,
  step,
  unit,
}: SimpleThresholdFieldProps) {
  const { t } = useTranslation(['nodes']);

  return (
    <>
      <FormField label={t('nodes:triggers.native.thresholdAboveLabel')}>
        <ThresholdValueField
          value={threshold.above}
          onChange={(v) => onChange({ ...threshold, above: v })}
          min={min}
          max={max}
          step={step}
          unit={unit}
        />
      </FormField>
      <FormField label={t('nodes:triggers.native.thresholdBelowLabel')}>
        <ThresholdValueField
          value={threshold.below}
          onChange={(v) => onChange({ ...threshold, below: v })}
          min={min}
          max={max}
          step={step}
          unit={unit}
        />
      </FormField>
    </>
  );
}
