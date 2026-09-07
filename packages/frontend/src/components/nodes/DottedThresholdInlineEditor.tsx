import { useTranslation } from 'react-i18next';
import {
  isNumberThresholdValue,
  THRESHOLD_CROSSING_TYPES,
  type ThresholdCrossingType,
  type ThresholdShape,
  type ThresholdValue,
  type TypedThreshold,
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
}

/**
 * Inline threshold editor for purpose-specific (dotted) trigger/condition
 * cards, e.g. "Illuminance crossed threshold: Above 200" or "Light
 * brightness changed: 10%". Mirrors NumericStateInlineEditor.tsx's
 * card-level editing pattern (same nodrag/stopPropagation wiring) for the
 * newer dotted-type threshold shapes from lib/nativeThreshold.ts, covering
 * both FLAT (`options.threshold` = bare number) and TYPED (`{type, value/
 * value_min/value_max}`) shapes — the property panel's ThresholdValueField/
 * ThresholdTypeField remain the full editor (target, behavior, `for`, entity
 * refs); this only surfaces the number(s) most worth quick access on the
 * canvas, same "reduces to something simple" restriction DelayNode.tsx's
 * inline Sec/Min editor uses for durations.
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
  min,
  max,
  allowAny,
}: DottedThresholdInlineEditorProps) {
  const { t } = useTranslation(['nodes']);

  if (shape === 'flat') {
    if (typeof threshold === 'string') return null; // entity ref — panel only
    const value = typeof threshold === 'number' ? threshold : undefined;
    return (
      <div
        className="nodrag flex items-center gap-1.5 pt-0.5"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          type="number"
          min={min}
          max={max}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          placeholder="—"
          className="h-6 w-14 rounded border bg-background px-1.5 text-xs"
        />
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

  const setBound = (key: 'value' | 'value_min' | 'value_max', raw: string) => {
    onChange({
      ...typed,
      [key]:
        raw === ''
          ? undefined
          : { number: Number(raw), ...(unit ? { unit_of_measurement: unit } : {}) },
    });
  };

  return (
    <div
      className="nodrag flex flex-wrap items-center gap-1.5 pt-0.5"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <select
        value={crossingType}
        onChange={(e) => setType(e.target.value)}
        className="h-6 rounded border bg-background px-1 text-xs"
      >
        {crossingTypes.map((type) => (
          <option key={type} value={type}>
            {t(`nodes:triggers.native.thresholdTypes.${type}`)}
          </option>
        ))}
      </select>

      {!isAny &&
        (isRange ? (
          <>
            <input
              type="number"
              value={numberOf(typed.value_min) ?? ''}
              onChange={(e) => setBound('value_min', e.target.value)}
              placeholder="—"
              className="h-6 w-14 rounded border bg-background px-1.5 text-xs"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="number"
              value={numberOf(typed.value_max) ?? ''}
              onChange={(e) => setBound('value_max', e.target.value)}
              placeholder="—"
              className="h-6 w-14 rounded border bg-background px-1.5 text-xs"
            />
          </>
        ) : (
          <input
            type="number"
            value={numberOf(typed.value) ?? ''}
            onChange={(e) => setBound('value', e.target.value)}
            placeholder="—"
            className="h-6 w-14 rounded border bg-background px-1.5 text-xs"
          />
        ))}

      {unit && !isAny && <span className="text-muted-foreground">{unit}</span>}
    </div>
  );
}
