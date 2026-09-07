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
import { getConditionEnumField, hasConditionSingleValueField } from '@/lib/conditionEnumField';
import {
  conditionHasFor,
  getConditionBehaviorVariant,
  getConditionThresholdShape,
  getThresholdRange,
  getThresholdUnit,
  type SimpleThreshold,
  type TypedThreshold,
} from '@/lib/nativeThreshold';
import { getNodeDataObject, toStringArray } from '@/utils/nodeData';
import { DurationField, type DurationValue } from './DurationField';
import { NativeTargetField, type TargetValue } from './NativeTargetField';
import { SimpleThresholdField } from './SimpleThresholdField';
import { ThresholdTypeField } from './ThresholdTypeField';
import { ThresholdValueField } from './ThresholdValueField';

/**
 * Field editor for HA's purpose-specific conditions (2025.12+, e.g.
 * `light.is_brightness`, `humidity.is_value`, `lock.is_locked`) — mirrors
 * NativeTriggerFields.tsx's target/threshold editor (sharing
 * NativeTargetField, ThresholdTypeField, ThresholdValueField and
 * SimpleThresholdField per CLAUDE.md's DRY mandate), but conditions
 * uniformly use `behavior: any|all` (triggers vary by type — see
 * NativeTriggerFields.tsx). `behavior` and `for` turned out to apply to
 * nearly EVERY dotted condition (a catalog-wide audit found them on plain
 * boolean ones too — `lock.is_locked`, `fan.is_on`, `motion.is_detected`,
 * ... — not just threshold-bearing types), so both default to shown. An
 * earlier pass here also excluded light's is_on/is_off/is_brightness and the
 * whole air_quality domain as supposed "confirmed" exceptions to `for` —
 * re-verified directly against each domain's strings.json (the literal UI
 * field schema HA ships) and found to be wrong for all of them; see
 * lib/nativeThreshold.ts's `conditionHasFor` doc comment for the correction.
 * The only real exceptions left are `sun.*` (handled below) and — on the
 * trigger side only — `light.brightness_changed`.
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

export function NativeConditionFields({ node, onChange, conditionType }: NativeConditionFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const target = getNodeDataObject<TargetValue>(node, 'target');
  const options = getNodeDataObject<NativeConditionOptions>(node, 'options');
  const shape = getConditionThresholdShape(conditionType);
  const unit = getThresholdUnit(conditionType);
  const range = getThresholdRange(conditionType);
  const isSunSingleton = conditionType.startsWith('sun.');
  // Uniform `any`/`all` across every domain audited this session — kept as
  // a function call (not a hardcoded literal) for symmetry with
  // NativeTriggerFields.tsx and in case a future HA release adds an
  // exception. Sun conditions have no `behavior` at all (singleton target).
  const behaviorVariant = isSunSingleton ? 'none' : getConditionBehaviorVariant(conditionType);
  const showBehavior = behaviorVariant !== 'none';
  // `for` turned out to be the rule, not the exception, across the whole
  // catalog (see nativeThreshold.ts's catalog-wide audit doc comment) — only
  // light's is_on/is_off/is_brightness and the whole air_quality domain
  // (boolean + numeric) confirmed to lack it, plus every sun.* singleton.
  const showFor = !isSunSingleton && conditionHasFor(conditionType);
  const isTwilight =
    conditionType === 'sun.is_morning_twilight' || conditionType === 'sun.is_evening_twilight';
  const enumField = getConditionEnumField(conditionType);
  const isSingleValue = hasConditionSingleValueField(conditionType);
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
  const isBareBoolean = isSunSingleton && shape === 'none' && !enumField && !isSingleValue && !isTwilight;

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
      {isBareBoolean && (
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
          {t('nodes:conditions.native.bareBooleanNotice', { conditionType })}
        </p>
      )}

      {!isSunSingleton && <NativeTargetField target={target} onChange={(v) => onChange('target', v)} />}

      {showBehavior && (
        <FormField
          label={t('nodes:conditions.native.behaviorLabel')}
          description={t('nodes:conditions.native.behaviorDescription')}
        >
          <RadioCardGroup
            value={options.behavior ?? 'all'}
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

      {shape === 'flat' && (
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

      {shape === 'typed' && (
        <ThresholdTypeField
          threshold={typedThreshold}
          onChange={(next) => updateOptions({ threshold: next })}
          forValue={showFor ? (options.for ?? {}) : undefined}
          onForChange={showFor ? (v) => updateOptions({ for: v }) : undefined}
          unit={unit}
          min={range?.min}
          max={range?.max}
        />
      )}

      {enumField && (
        <FormField
          label={t(`nodes:conditions.native.enumFieldLabels.${enumField.labelKey}`)}
          description={t('nodes:conditions.native.enumFieldDescription')}
        >
          <IdList
            values={toStringArray(options[enumField.optionsKey])}
            onChange={(vals) => updateOptions({ [enumField.optionsKey]: vals })}
            placeholder={t('nodes:conditions.native.enumFieldPlaceholder')}
          />
        </FormField>
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
      {shape !== 'typed' && showFor && (
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
              <Select value={options.type ?? 'any'} onValueChange={(v) => updateOptions({ type: v })}>
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
    </>
  );
}
