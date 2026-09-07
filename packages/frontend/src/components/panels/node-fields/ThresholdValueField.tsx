import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HaSelector } from '@/ha';
import {
  isEntityThresholdValue,
  isNumberThresholdValue,
  type ThresholdValue,
} from '@/lib/nativeThreshold';

/** The bare (unwrapped) shape used by light's FLAT `options.threshold` — a plain number or a plain entity-id string, as opposed to the TYPED shape's `{number,...}`/`{entity}` wrapped values. */
export type BareThresholdValue = number | string;

interface ThresholdValueFieldPropsBase {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

interface WrappedThresholdValueFieldProps extends ThresholdValueFieldPropsBase {
  bare?: false;
  value: ThresholdValue | undefined;
  onChange: (value: ThresholdValue) => void;
}

interface BareThresholdValueFieldProps extends ThresholdValueFieldPropsBase {
  bare: true;
  value: BareThresholdValue | undefined;
  onChange: (value: BareThresholdValue) => void;
}

type ThresholdValueFieldProps = WrappedThresholdValueFieldProps | BareThresholdValueFieldProps;

/**
 * Editor for a single native-threshold bound — HA's purpose-specific
 * triggers/conditions accept either a literal number or a live entity
 * reference for every threshold value (see lib/nativeThreshold.ts). Two wire
 * shapes exist: TYPED's `value`/`value_min`/`value_max` sub-fields are
 * wrapped (`{number, unit_of_measurement?}`/`{entity}`), while light's FLAT
 * `options.threshold` is a bare `number`/entity-id `string` — the `bare`
 * prop switches which one this reads and writes.
 *
 * Native HA's own editor toggles between number/entity via its internal
 * `choose` selector wire format; that wire shape wasn't directly confirmed
 * from source during this session, so rather than guess at it we drive the
 * same two real HA pickers (`number`/`entity` selectors, both already used
 * elsewhere in Circuitry) from an explicit toggle we control ourselves. The
 * saved YAML is identical either way — only the final value shape matters
 * there, not the widget that produced it.
 */
export function ThresholdValueField(props: ThresholdValueFieldProps) {
  const { value, onChange, min, max, step, unit, bare } = props;
  const { t } = useTranslation(['nodes']);
  const isEntity = bare ? typeof value === 'string' : isEntityThresholdValue(value);
  const numberValue = bare
    ? typeof value === 'number'
      ? value
      : 0
    : isNumberThresholdValue(value)
      ? value.number
      : 0;
  const entityValue = bare ? (typeof value === 'string' ? value : '') : isEntityThresholdValue(value) ? value.entity : '';

  const emitNumber = (n: number) => {
    if (bare) {
      (onChange as BareThresholdValueFieldProps['onChange'])(n);
    } else {
      (onChange as WrappedThresholdValueFieldProps['onChange'])({
        number: n,
        ...(unit ? { unit_of_measurement: unit } : {}),
      });
    }
  };

  const emitEntity = (entityId: string) => {
    if (bare) {
      (onChange as BareThresholdValueFieldProps['onChange'])(entityId);
    } else {
      (onChange as WrappedThresholdValueFieldProps['onChange'])({ entity: entityId });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Button
          type="button"
          variant={isEntity ? 'outline' : 'secondary'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={() => emitNumber(0)}
        >
          {t('nodes:triggers.native.thresholdModeNumber')}
        </Button>
        <Button
          type="button"
          variant={isEntity ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={() => emitEntity('')}
        >
          {t('nodes:triggers.native.thresholdModeEntity')}
        </Button>
      </div>

      {isEntity ? (
        <HaSelector
          selector={{ entity: {} }}
          value={entityValue}
          onChange={(v) => emitEntity(typeof v === 'string' ? v : '')}
          fallback={
            <Input
              value={entityValue}
              onChange={(e) => emitEntity(e.target.value)}
              placeholder="sensor.example"
            />
          }
        />
      ) : (
        <HaSelector
          selector={{ number: { min, max, step, mode: 'box', unit_of_measurement: unit } }}
          value={numberValue}
          onChange={(v) => emitNumber(typeof v === 'number' ? v : Number(v) || 0)}
          fallback={
            <Input
              type="number"
              min={min}
              max={max}
              step={step}
              value={numberValue}
              onChange={(e) => emitNumber(Number(e.target.value))}
            />
          }
        />
      )}
    </div>
  );
}
