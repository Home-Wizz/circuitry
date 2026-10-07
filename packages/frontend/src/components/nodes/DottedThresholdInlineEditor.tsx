import { useTranslation } from 'react-i18next';
import { FieldHeading } from '@/components/ui/field-heading';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import {
  isNumberThresholdValue,
  THRESHOLD_CROSSING_TYPES,
  type ThresholdCrossingType,
  type ThresholdShape,
  type ThresholdValue,
  type TypedThreshold,
  thresholdNumber,
} from '@/lib/nativeThreshold';

/** True for an unset bound or one already in the wrapped `{number, ...}` shape — never for an entity-ref bound. */
function isPlainOrUnset(value: ThresholdValue | undefined): boolean {
  return value === undefined || isNumberThresholdValue(value);
}

interface DottedThresholdInlineEditorProps {
  shape: Extract<ThresholdShape, 'flat' | 'typed'>;
  /** Raw `options.threshold` value — a bare number/string for FLAT, a `TypedThreshold` object for TYPED. */
  threshold: number | string | TypedThreshold | undefined;
  onChange: (threshold: number | TypedThreshold) => void;
  /** Matches ThresholdValueField.tsx's `emitNumber`, which stamps this onto every wrapped (TYPED) bound it writes. For FLAT, purely a display suffix (e.g. "%") — the FLAT wire shape has no `unit_of_measurement` key to write it into. */
  unit?: string;
  /** See ThresholdValueField's `units`: a bound keeps its own unit if HA
   * takes it; the unit is picked in the panel (#119). */
  units?: string[];
  /**
   * Bounds for the FLAT shape's bare number input — see
   * lib/nativeThreshold.ts's `getThresholdRange`. Light's brightness fields
   * are 0-100%; the 13 air_quality `_value` conditions have no fixed upper
   * bound (ppm/µg per m³ readings routinely exceed 100), so these are
   * `undefined` for them rather than hardcoded — a real bug found via live
   * HA testing: this field used to hardcode `min={0} max={100}` and a
   * literal "%" regardless of type, silently capping air_quality thresholds
   * (e.g. a 1000ppm CO2 threshold) at 100.
   */
  min?: number;
  max?: number;
  /** See ThresholdTypeField.tsx's `allowAny` — adds an "Any change" crossing type with no value fields, for the 4 `.changed` triggers. */
  allowAny?: boolean;
  /**
   * `wide`: the pickers' Fill in column -- the crossing type as buttons
   * under `crossingLabel`, each level under its own heading, with a slider
   * when the type has a fixed range. `inline` (default): the card's pill.
   */
  layout?: 'inline' | 'wide';
  crossingLabel?: string;
}

const INLINE_INPUT = 'h-6 w-14 rounded border bg-background px-1.5 text-xs';

/**
 * One level: a number box (the pill's small one, or the Fill in column's
 * larger one with a slider beside it when there's a fixed range) and its
 * unit. Empty is reported as ''.
 */
function LevelInput({
  value,
  onChange,
  unit,
  min,
  max,
  wide,
}: {
  value: number | undefined;
  onChange: (raw: string) => void;
  unit?: string;
  min?: number;
  max?: number;
  wide: boolean;
}) {
  const input = (
    <input
      type="number"
      min={min}
      max={max}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="—"
      className={wide ? 'h-8 w-20 rounded-md border bg-background px-2 text-sm' : INLINE_INPUT}
    />
  );
  if (!wide) return input;
  const ranged = min !== undefined && max !== undefined;
  return (
    <div className="flex items-center gap-3">
      {ranged && (
        <Slider
          className="flex-1"
          min={min}
          max={max}
          step={1}
          value={[value ?? min]}
          onValueChange={([next]) => next !== undefined && onChange(String(next))}
        />
      )}
      {input}
      {unit && <span className="text-muted-foreground text-sm">{unit}</span>}
    </div>
  );
}

/**
 * The threshold editor opened from a card's threshold pill (ThresholdPill.tsx)
 * for purpose-specific (dotted) trigger/condition
 * cards, e.g. "Illuminance crossed threshold: Above 200" or "Light
 * brightness changed: 10%", and the pickers' Fill in column (`layout:
 * 'wide'`). Mirrors NumericStateInlineEditor.tsx's
 * card-level editing pattern (same nodrag/stopPropagation wiring) for the
 * newer dotted-type threshold shapes from lib/nativeThreshold.ts, covering
 * both FLAT (`options.threshold` = bare number) and TYPED (`{type, value/
 * value_min/value_max}`) shapes — the property panel's ThresholdValueField/
 * ThresholdTypeField remain the full editor (target, behavior, `for`, entity
 * refs); this only surfaces the number(s) most worth quick access.
 *
 * Only rendered when every bound in play is a plain number — an entity-ref
 * bound returns null so the card falls back to its normal read-only
 * subtitle/detail text, edited via the property panel instead.
 */
export function DottedThresholdInlineEditor({
  shape,
  threshold,
  onChange,
  unit,
  units,
  min,
  max,
  allowAny,
  layout = 'inline',
  crossingLabel,
}: DottedThresholdInlineEditorProps) {
  const { t } = useTranslation(['nodes']);
  const wide = layout === 'wide';
  const stop = {
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };

  if (shape === 'flat') {
    if (typeof threshold === 'string') return null; // entity ref — panel only
    const value = typeof threshold === 'number' ? threshold : undefined;
    const level = (
      <LevelInput
        value={value}
        onChange={(raw) => onChange(raw === '' ? 0 : Number(raw))}
        unit={unit}
        min={min}
        max={max}
        wide={wide}
      />
    );
    if (wide) return <FieldHeading label={t('nodes:pickerConfig.level')}>{level}</FieldHeading>;
    return (
      <div className="nodrag flex items-center gap-1.5 pt-0.5" {...stop}>
        {level}
        {unit && <span className="text-muted-foreground">{unit}</span>}
      </div>
    );
  }

  const typed: TypedThreshold =
    typeof threshold === 'object' && threshold !== null && !Array.isArray(threshold)
      ? threshold
      : {};
  const crossingType = typed.type ?? (allowAny ? 'any' : 'above');
  const isAny = crossingType === 'any';
  const isRange = crossingType === 'between' || crossingType === 'outside';

  const boundsAreClean = isRange
    ? isPlainOrUnset(typed.value_min) && isPlainOrUnset(typed.value_max)
    : isPlainOrUnset(typed.value);
  if (!boundsAreClean) return null; // an entity-ref bound — panel only

  const crossingTypes: ThresholdCrossingType[] = allowAny
    ? ['any', ...THRESHOLD_CROSSING_TYPES]
    : THRESHOLD_CROSSING_TYPES;

  const numberOf = (value: ThresholdValue | undefined) =>
    isNumberThresholdValue(value) ? value.number : undefined;

  const setType = (newType: string) => {
    onChange({ ...typed, type: newType as ThresholdCrossingType });
  };

  // The unit the bounds are in (their own, when they have one).
  const firstBound = isRange ? typed.value_min : typed.value;
  const shownUnit = (isNumberThresholdValue(firstBound) && firstBound.unit_of_measurement) || unit;

  const setBound = (key: 'value' | 'value_min' | 'value_max', raw: string) => {
    onChange({
      ...typed,
      [key]: raw === '' ? undefined : thresholdNumber(Number(raw), typed[key], unit, units),
    });
  };
  const level = (key: 'value' | 'value_min' | 'value_max') => (
    <LevelInput
      value={numberOf(typed[key])}
      onChange={(raw) => setBound(key, raw)}
      unit={shownUnit}
      min={min}
      max={max}
      wide={wide}
    />
  );
  const typeLabel = (type: ThresholdCrossingType) =>
    t(`nodes:triggers.native.thresholdTypes.${type}`);

  if (wide) {
    return (
      <div className="flex flex-col gap-4">
        <FieldHeading label={crossingLabel ?? t('nodes:pickerConfig.level')}>
          <Segmented
            tone="primary"
            className="self-start"
            value={crossingType}
            options={crossingTypes.map((type) => ({ value: type, label: typeLabel(type) }))}
            onChange={setType}
          />
        </FieldHeading>
        {!isAny &&
          (isRange ? (
            <>
              <FieldHeading label={t('nodes:triggers.native.thresholdMinLabel')}>
                {level('value_min')}
              </FieldHeading>
              <FieldHeading label={t('nodes:triggers.native.thresholdMaxLabel')}>
                {level('value_max')}
              </FieldHeading>
            </>
          ) : (
            <FieldHeading label={t('nodes:pickerConfig.level')}>{level('value')}</FieldHeading>
          ))}
      </div>
    );
  }

  return (
    <div className="nodrag flex flex-wrap items-center gap-1.5 pt-0.5" {...stop}>
      <select
        value={crossingType}
        onChange={(e) => setType(e.target.value)}
        className="h-6 rounded border bg-background px-1 text-xs"
      >
        {crossingTypes.map((type) => (
          <option key={type} value={type}>
            {typeLabel(type)}
          </option>
        ))}
      </select>

      {!isAny &&
        (isRange ? (
          <>
            {level('value_min')}
            <span className="text-muted-foreground">–</span>
            {level('value_max')}
          </>
        ) : (
          level('value')
        ))}

      {shownUnit && !isAny && <span className="text-muted-foreground">{shownUnit}</span>}
    </div>
  );
}
