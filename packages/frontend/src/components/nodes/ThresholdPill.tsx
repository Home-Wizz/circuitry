import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNativeDescriptions, useThresholdShape } from '@/hooks/useNativeDescriptions';
import type { NodeColorToken } from '@/lib/node-colors';
import {
  getThresholdRange,
  getThresholdUnit,
  getThresholdUnits,
  isNumberThresholdValue,
  type ThresholdValue,
  type TypedThreshold,
  triggerAllowsAnyThreshold,
} from '@/lib/nativeThreshold';
import { isRecord } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { DottedThresholdInlineEditor } from './DottedThresholdInlineEditor';
import { EditPill, PILL_TEXT } from './EditPill';
import { canHoldFor, HoldForField } from './holdFor';
import { NumericStateInlineEditor } from './NumericStateInlineEditor';
import { phraseAfterName, startLower } from './StepCard';

const withUnit = (n: number, unit: string | undefined) => (unit ? `${n} ${unit}` : String(n));

/** A bound as a card shows it: its number and unit; null for an entity's value. */
function boundText(value: ThresholdValue | undefined, unit: string | undefined): string | null {
  if (value === undefined) return '—';
  if (!isNumberThresholdValue(value)) return null;
  return withUnit(value.number, value.unit_of_measurement || unit);
}

/**
 * A threshold as a card shows it ("above 200 lx", "between 17 and 25 °C",
 * "any change"), or null when a bound is another entity's value (the
 * property panel edits those).
 */
export function thresholdText(
  threshold: unknown,
  shape: 'flat' | 'typed',
  unit: string | undefined,
  allowAny: boolean,
  t: TFunction<['nodes']>
): string | null {
  if (shape === 'flat') {
    if (typeof threshold === 'number') return withUnit(threshold, unit);
    return threshold === undefined ? '—' : null;
  }
  const typed: TypedThreshold = isRecord(threshold) ? (threshold as TypedThreshold) : {};
  const type = typed.type ?? (allowAny ? 'any' : 'above');
  const label = t(`nodes:triggers.native.thresholdTypes.${type}`);
  if (type === 'any') return label;
  if (type === 'between' || type === 'outside') {
    const low = boundText(typed.value_min, undefined);
    const high = boundText(typed.value_max, unit);
    return low === null || high === null ? null : t(`nodes:cardVerbs.${type}`, { low, high });
  }
  const bound = boundText(typed.value, unit);
  return bound === null ? null : `${label} ${bound}`;
}

/** A State-number step's Above and Below as a card shows them ("above 20",
 * "between 20 and 25"). */
function aboveBelowText(
  data: Readonly<Record<string, unknown>>,
  t: TFunction<['nodes']>,
  language: string
) {
  const part = (key: 'above' | 'below') => {
    const value = data[key];
    return typeof value === 'number'
      ? phraseAfterName(`${t(`nodes:fieldLabels.short.${key}`)} ${value}`, language)
      : '';
  };
  // Both: a range ("between 20 and 26"), as HA runs it (above and below).
  if (typeof data.above === 'number' && typeof data.below === 'number') {
    return t('nodes:cardVerbs.between', { low: data.above, high: data.below });
  }
  const parts = [part('above'), part('below')].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

/**
 * A trigger's or condition's threshold: its text ("above 22 °C") and its
 * editor, writing a patch for the step's data. A purpose-specific type's
 * `options.threshold`, or a Numeric state step's Above / Below; null when
 * the type has no threshold, or a bound is another entity's value (the
 * property panel edits those). Shared by the card's pill and the pickers'
 * Fill in column.
 */
export function useThreshold(
  data: Readonly<Record<string, unknown>>,
  kind: 'trigger' | 'condition',
  enabled = true
): {
  text: string;
  /** `wide`: laid out for the Fill in column, under headings of its own. */
  editor: (patch: (next: Record<string, unknown>) => void, layout?: 'inline' | 'wide') => ReactNode;
  /** Whether the wide editor brings its own headings (a Numeric state step's doesn't). */
  headed: boolean;
} | null {
  const { t, i18n } = useTranslation(['nodes']);
  const type = typeof data[kind] === 'string' ? (data[kind] as string) : '';
  const dotted = enabled && type.includes('.');
  // As the connected HA describes the type: none for a type without one.
  const shape = useThresholdShape(kind, dotted ? type : '');
  const options = isRecord(data.options) ? data.options : {};

  if (type === 'numeric_state') {
    return {
      text: startLower(aboveBelowText(data, t, i18n.language)),
      editor: (patch) => (
        <NumericStateInlineEditor
          above={typeof data.above === 'number' ? data.above : undefined}
          below={typeof data.below === 'number' ? data.below : undefined}
          onChange={patch}
        />
      ),
      headed: false,
    };
  }
  if (!dotted || (shape !== 'flat' && shape !== 'typed')) return null;
  const unit = getThresholdUnit(type);
  const allowAny = kind === 'trigger' && triggerAllowsAnyThreshold(type);
  const text = thresholdText(options.threshold, shape, unit, allowAny, t);
  if (text === null) return null;
  return {
    text: startLower(text),
    editor: (patch, layout) => (
      <DottedThresholdInlineEditor
        layout={layout}
        crossingLabel={t(`nodes:pickerConfig.${kind === 'trigger' ? 'goes' : 'is'}`)}
        shape={shape}
        threshold={options.threshold as number | string | TypedThreshold | undefined}
        unit={unit}
        units={getThresholdUnits(type)}
        min={getThresholdRange(type)?.min}
        max={getThresholdRange(type)?.max}
        allowAny={allowAny}
        onChange={(next) => patch({ options: { ...options, threshold: next } })}
      />
    ),
    headed: true,
  };
}

/**
 * A trigger's or condition's threshold as a pill in its card's sentence
 * (useThreshold). It opens the same small editor the card had inline, with
 * how long it must hold where the type can, and writes what they write.
 */
export function ThresholdPill({
  nodeId,
  data,
  kind,
  tone,
  enabled = true,
}: {
  nodeId: string;
  data: Readonly<Record<string, unknown>>;
  kind: 'trigger' | 'condition';
  tone: NodeColorToken;
  /** False where the card has no purpose-specific threshold of its own (a block's entry, a group). */
  enabled?: boolean;
}) {
  const { t } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const threshold = useThreshold(data, kind, enabled);
  const descriptions = useNativeDescriptions(kind);
  if (!threshold) return null;
  const canHold = canHoldFor(kind, data, (type) => descriptions[type]);
  const write = (patch: Record<string, unknown>) => updateNodeData(nodeId, patch);
  return (
    <>
      {' '}
      <EditPill
        tone={tone}
        testId="threshold-pill"
        ariaLabel={t('nodes:pill.editThreshold')}
        contentClassName={canHold ? 'w-80' : 'w-auto'}
        editor={() => (
          <div className="flex flex-col gap-3">
            {threshold.editor(write)}
            {canHold && <HoldForField kind={kind} data={data} onPatch={write} />}
          </div>
        )}
      >
        <span className={PILL_TEXT}>{threshold.text}</span>
      </EditPill>
    </>
  );
}
