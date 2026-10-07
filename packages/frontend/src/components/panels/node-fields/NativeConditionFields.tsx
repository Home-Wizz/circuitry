import type { FlowNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { RadioCardGroup } from '@/components/forms/RadioCardGroup';
import { IdList } from '@/components/ui/IdList';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HaSelect } from '@/ha';
import { useNativeDescription } from '@/hooks/useNativeDescriptions';
import { handledConditionOptions } from '@/lib/describedFields';
import { getConditionEnumField, hasConditionSingleValueField } from '@/lib/conditionEnumField';
import { MOON_PHASES } from '@/lib/moonPhases';
import {
  describedThresholdShape,
  resolveOptionFields,
  resolveTargetless,
  resolveThresholdUnits,
} from '@/lib/nativeDescriptions';
import {
  getThresholdRange,
  getThresholdUnit,
  type SimpleThreshold,
  type TypedThreshold,
} from '@/lib/nativeThreshold';
import { getSunPeriodField } from '@/lib/sunPeriodField';
import { getNodeDataObject, toStringArray } from '@/utils/nodeData';
import { holdForValue, HoldForField } from '@/components/nodes/holdFor';
import { BehaviorSegment } from './BehaviorSegment';
import { DescribedOptionFields } from './DescribedOptionFields';
import { DurationField, type DurationValue } from './DurationField';
import { NativeTargetField, type TargetValue } from './NativeTargetField';
import { OptionSelectField } from './OptionSelectField';
import { SimpleThresholdField } from './SimpleThresholdField';
import { ThresholdTypeField } from './ThresholdTypeField';
import { ThresholdValueField } from './ThresholdValueField';
import { PanelTargets } from '../PanelSection';

/**
 * Field editor for HA's purpose-specific conditions (2025.12+, e.g.
 * `light.is_brightness`, `humidity.is_value`, `lock.is_locked`) — mirrors
 * NativeTriggerFields.tsx's target/threshold editor (sharing
 * NativeTargetField, ThresholdTypeField, ThresholdValueField and
 * SimpleThresholdField per CLAUDE.md's DRY mandate). Which conditions take
 * `behavior` (any/all) and `for` is lib/nativeDescriptions.ts's reading:
 * what the connected HA describes, else tables checked against HA 2026.9.3's
 * own validators (#117).
 *
 * Before this component existed, ConditionFields.tsx had no branch at all
 * for dotted condition types — they rendered zero fields.
 *
 * The sun integration's 8 dotted conditions (`sun.is_up`, `sun.elevation`,
 * `sun.is_morning_twilight`, ...) are a deliberate exception, confirmed via
 * lib/conditionRecipes.ts's own doc comment and cross-checked directly
 * against home-assistant.io: none of them take a target (the sun is a
 * singleton, `sun.sun`) or a `behavior`/`for` (nothing to combine multiple
 * targets' results for), so `isSunSingleton` below suppresses all three for
 * any `sun.*` condition. `sun.elevation` gets a TYPED threshold with no
 * `behavior`/`for` sibling; the two twilight conditions get their own
 * `type` (any/civil/nautical/astronomical) select instead of a threshold;
 * the remaining 5 (`is_up`/`is_set`/`is_ascending`/`is_descending`/
 * `is_night`) are bare booleans with no options at all, so they render
 * nothing here.
 */
interface NativeConditionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  /** The dotted condition type, e.g. `light.is_brightness` or `humidity.is_value` — determines which threshold shape (if any) to render. */
  conditionType: string;
  /** The card's "+ more": leaves out what the card edits itself (the
   * target, the threshold, a "for" already set), the behaviour as buttons. */
  compact?: boolean;
}

type NativeConditionOptions = {
  behavior?: string;
  threshold?: number | string | TypedThreshold | SimpleThreshold;
  for?: DurationValue;
  type?: string;
  /**
   * Enum-mode conditions (e.g. `climate.is_hvac_mode`) and single-value
   * conditions (`text.is_equal_to`) store their real value under a
   * domain-specific key (`hvac_mode`, `mode`, `operation_mode`, `option`,
   * `value`) rather than one of the fixed fields above — see
   * lib/conditionEnumField.ts. An index signature is needed here since the
   * key itself is dynamic.
   */
  [key: string]: unknown;
};

type TwilightType = 'any' | 'civil' | 'nautical' | 'astronomical';
const TWILIGHT_TYPES: TwilightType[] = ['any', 'civil', 'nautical', 'astronomical'];

export function NativeConditionFields({
  node,
  onChange,
  conditionType,
  compact = false,
}: NativeConditionFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const target = getNodeDataObject<TargetValue>(node, 'target');
  const options = getNodeDataObject<NativeConditionOptions>(node, 'options');
  const unit = getThresholdUnit(conditionType);
  const range = getThresholdRange(conditionType);
  const isSunSingleton = conditionType.startsWith('sun.');
  // Which conditions take `behavior` (any/all) and `for`: what the
  // connected HA describes, else the tables (lib/nativeDescriptions.ts).
  const description = useNativeDescription('condition', conditionType);
  // The threshold as the connected HA has it: none where it describes the
  // type without one (an HA from before the threshold rework, whose bounds
  // are its own fields, below).
  const shape = describedThresholdShape('condition', conditionType, description);
  const { behavior: behaviorField, hasFor: showFor } = resolveOptionFields(
    'condition',
    conditionType,
    description
  );
  const isTwilight =
    conditionType === 'sun.is_morning_twilight' || conditionType === 'sun.is_evening_twilight';
  const enumField = getConditionEnumField(conditionType);
  const isSingleValue = hasConditionSingleValueField(conditionType);
  const periodField = getSunPeriodField(conditionType);
  // Bare-boolean sun singletons (`sun.is_night`/`is_up`/`is_set`/
  // `is_ascending`/`is_descending`) are the one case where every field below
  // is suppressed — `!isSunSingleton` guards target, and behavior/for are
  // forced off for every sun.* condition (see isSunSingleton usage above) —
  // so this component would otherwise render a completely empty fragment.
  // Reported directly: a user selecting one of these nodes said the right
  // panel "doesn't contain any data," reading the blank panel as the
  // condition being broken/unconfigured rather than genuinely needing no
  // configuration. ConditionFields.tsx also hides the condition-type
  // dropdown for every dotted type (by design — see its own comment), so
  // without this fallback nothing in the panel confirms what's even
  // selected. Since none of the field cases above the `for` block apply
  // when this is true, checking their inputs before render would just
  // re-derive the same conditions those JSX blocks already gate on.
  const isBareBoolean =
    isSunSingleton &&
    shape === 'none' &&
    !enumField &&
    !isSingleValue &&
    !isTwilight &&
    !periodField;

  const updateOptions = (patch: Partial<NativeConditionOptions>) =>
    onChange('options', { ...options, ...patch });

  // `options.threshold` is a union of the three object shapes (plus the
  // FLAT scalar) at the type level — cast rather than rely on structural
  // narrowing here, since TypedThreshold and SimpleThreshold are both
  // "weak types" (every property optional) with no property names in
  // common, which TS flags as an error on direct assignment between them.
  const typedThreshold: TypedThreshold =
    shape === 'typed' &&
    typeof options.threshold === 'object' &&
    options.threshold !== null &&
    !Array.isArray(options.threshold)
      ? (options.threshold as TypedThreshold)
      : {};

  const simpleThreshold: SimpleThreshold =
    shape === 'flat-simple' &&
    typeof options.threshold === 'object' &&
    options.threshold !== null &&
    !Array.isArray(options.threshold)
      ? (options.threshold as SimpleThreshold)
      : {};

  const flatThreshold: number | string | undefined =
    typeof options.threshold === 'number' || typeof options.threshold === 'string'
      ? options.threshold
      : undefined;

  return (
    <>
      {!compact && isBareBoolean && (
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
          {t('nodes:conditions.native.bareBooleanNotice', { conditionType })}
        </p>
      )}

      {!compact && !resolveTargetless('condition', conditionType, description) && (
        <PanelTargets>
          <NativeTargetField
            target={target}
            onChange={(v) => onChange('target', v)}
            described={description?.target}
          />
        </PanelTargets>
      )}

      {compact && behaviorField && (
        <BehaviorSegment
          kind="condition"
          values={['any', 'all']}
          value={options.behavior ?? behaviorField.default}
          onChange={(behavior) => updateOptions({ behavior })}
        />
      )}

      {!compact && behaviorField && (
        <FormField
          label={t('nodes:conditions.native.behaviorLabel')}
          description={t('nodes:conditions.native.behaviorDescription')}
        >
          <RadioCardGroup
            value={options.behavior ?? behaviorField.default}
            onChange={(v) => updateOptions({ behavior: v })}
            options={[
              {
                value: 'any',
                label: t('nodes:conditions.native.behaviorAny'),
                description: t('nodes:conditions.native.behaviorAnyDescription'),
              },
              {
                value: 'all',
                label: t('nodes:conditions.native.behaviorAll'),
                description: t('nodes:conditions.native.behaviorAllDescription'),
              },
            ]}
          />
        </FormField>
      )}

      {!compact && shape === 'flat' && (
        <FormField
          label={t('nodes:conditions.native.thresholdLabel')}
          description={t('nodes:conditions.native.thresholdDescription')}
        >
          <ThresholdValueField
            bare
            value={flatThreshold}
            onChange={(v) => updateOptions({ threshold: v })}
            min={range?.min}
            max={range?.max}
            step={1}
            unit={unit}
          />
        </FormField>
      )}

      {shape === 'flat-simple' && (
        <SimpleThresholdField
          threshold={simpleThreshold}
          onChange={(next) => updateOptions({ threshold: next })}
          min={0}
          max={100}
          unit="%"
        />
      )}

      {!compact && shape === 'typed' && (
        <ThresholdTypeField
          threshold={typedThreshold}
          onChange={(next) => updateOptions({ threshold: next })}
          forValue={showFor ? (options.for ?? {}) : undefined}
          onForChange={showFor ? (v) => updateOptions({ for: v }) : undefined}
          unit={unit}
          units={resolveThresholdUnits(conditionType, description)}
          min={range?.min}
          max={range?.max}
        />
      )}

      {enumField && (
        <FormField
          label={t(`nodes:conditions.native.enumFieldLabels.${enumField.labelKey}`)}
          description={t(`nodes:conditions.native.enumFieldDescriptions.${enumField.labelKey}`)}
        >
          <IdList
            values={toStringArray(options[enumField.optionsKey])}
            onChange={(vals) => updateOptions({ [enumField.optionsKey]: vals })}
            placeholder={t(`nodes:conditions.native.enumFieldPlaceholders.${enumField.labelKey}`)}
          />
        </FormField>
      )}

      {conditionType === 'moon.is_phase' && (
        <OptionSelectField
          label={t('nodes:triggers.native.moonPhaseLabel')}
          value={typeof options.phase === 'string' ? options.phase : undefined}
          options={MOON_PHASES.map((phase) => ({
            value: phase,
            label: t(`nodes:triggers.native.moonPhases.${phase}`),
          }))}
          onChange={(phase) => updateOptions({ phase })}
        />
      )}

      {periodField && (
        <OptionSelectField
          label={t('nodes:triggers.native.periodLabel')}
          value={typeof options.period === 'string' ? options.period : periodField.default}
          options={periodField.values.map((period) => ({
            value: period,
            label: t(`nodes:triggers.native.periods.${period}`),
          }))}
          onChange={(period) => updateOptions({ period })}
        />
      )}

      {isSingleValue && (
        <FormField
          label={t('nodes:conditions.native.singleValueLabel')}
          description={t('nodes:conditions.native.singleValueDescription')}
        >
          <Input
            value={typeof options.value === 'string' ? options.value : ''}
            onChange={(e) => updateOptions({ value: e.target.value })}
          />
        </FormField>
      )}

      {/* The `typed` shape renders its own `for` field inline via
          ThresholdTypeField above (alongside the crossing-type selector) —
          every other shape (flat/flat-simple/none, including plain boolean
          conditions like lock.is_locked or fan.is_on, and the enum/
          single-value ones just above) gets it here instead. */}
      {compact &&
        showFor &&
        shape !== 'flat' &&
        shape !== 'typed' &&
        holdForValue('condition', node.data) === undefined && (
          <HoldForField
            kind="condition"
            data={node.data}
            onPatch={(patch) => {
              for (const [key, value] of Object.entries(patch)) onChange(key, value);
            }}
          />
        )}

      {!compact && shape !== 'typed' && showFor && (
        <DurationField
          label={t('nodes:triggers.native.thresholdForLabel')}
          description={t('nodes:triggers.native.thresholdForDescription')}
          value={options.for ?? {}}
          onChange={(v) => updateOptions({ for: v })}
        />
      )}

      {isTwilight && (
        <FormField label={t('nodes:conditions.native.twilightTypeLabel')}>
          <HaSelect
            value={options.type ?? 'any'}
            onChange={(v) => updateOptions({ type: String(v) })}
            options={TWILIGHT_TYPES.map((type) => ({
              value: type,
              label: t(`nodes:conditions.native.twilightTypes.${type}`),
            }))}
            fallback={
              <Select
                value={options.type ?? 'any'}
                onValueChange={(v) => updateOptions({ type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TWILIGHT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`nodes:conditions.native.twilightTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </FormField>
      )}

      {/* Whatever else HA describes for it, by HA's own selectors. */}
      <DescribedOptionFields
        kind="condition"
        type={conditionType}
        description={description}
        handled={handledConditionOptions(conditionType, description)}
        options={options}
        onChange={(key, value) => updateOptions({ [key]: value })}
      />
    </>
  );
}
