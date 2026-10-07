import type { FlowNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { IdList } from '@/components/ui/IdList';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HaSelect } from '@/ha';
import { useNativeDescription } from '@/hooks/useNativeDescriptions';
import { handledTriggerOptions } from '@/lib/describedFields';
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
  type TypedThreshold,
  triggerAllowsAnyThreshold,
} from '@/lib/nativeThreshold';
import { getSunPeriodField } from '@/lib/sunPeriodField';
import { getTriggerDurationField } from '@/lib/triggerDurationField';
import { getTriggerEnumField } from '@/lib/triggerEnumField';
import {
  getTriggerOffsetField,
  TRIGGER_TWILIGHT_TYPES,
  type TriggerOffsetType,
} from '@/lib/triggerOffsetField';
import { getNodeDataObject, toStringArray } from '@/utils/nodeData';
import { holdForValue, HoldForField } from '@/components/nodes/holdFor';
import { BehaviorSegment } from './BehaviorSegment';
import { DescribedOptionFields } from './DescribedOptionFields';
import { DurationField, type DurationValue } from './DurationField';
import { NativeTargetField, type TargetValue } from './NativeTargetField';
import { OptionSelectField } from './OptionSelectField';
import { ThresholdTypeField } from './ThresholdTypeField';
import { ThresholdValueField } from './ThresholdValueField';
import { PanelTargets } from '../PanelSection';

/**
 * Field editor for HA's purpose-specific triggers (2025.12+, e.g.
 * `light.turned_on`) — the `target: { entity_id/device_id/area_id/floor_id/
 * label_id }` + `options: { behavior }` shape lib/triggerNodeData.ts commits
 * for these (see its 'recipe' case), as opposed to the legacy platforms'
 * static field lists in config/triggerFields.ts (`state`'s entity_id/to/
 * from, `numeric_state`'s above/below, ...).
 *
 * Threshold rendering is shape-driven (see lib/nativeThreshold.ts) rather
 * than the single `hasThreshold={type.includes('brightness')}` boolean this
 * used to take — that matched only light's brightness triggers, missing
 * illuminance/battery/humidity/temperature/power/water_heater's `.changed`
 * and `crossed_threshold` triggers entirely.
 *
 * `behavior` and `for` turned out to apply to nearly EVERY dotted trigger
 * (a catalog-wide audit found them on plain boolean ones too —
 * `lock.locked`, `door.opened`, `alarm_control_panel.armed`, ... — not just
 * threshold-bearing types); lib/nativeDescriptions.ts says which take them:
 * what the connected HA describes, else tables checked against HA 2026.9.3's
 * own validators (#117).
 */
interface NativeTriggerFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  /** The dotted trigger type, e.g. `light.brightness_crossed_threshold` or `illuminance.crossed_threshold` — determines which threshold shape (if any) to render. */
  triggerType: string;
  /** The card's "+ more": leaves out what the card edits itself (the
   * target, the threshold, a "for" already set), the behaviour as buttons. */
  compact?: boolean;
}

// moon.phase_changed's `phase`: `any` (its default: every change) or one
// phase.
const TRIGGER_MOON_PHASES = ['any', ...MOON_PHASES] as const;

/** The label for each behavior value HA has used for a trigger. */
const TRIGGER_BEHAVIOR_LABELS = {
  each: 'nodes:triggers.native.behaviorEach',
  first: 'nodes:triggers.native.behaviorFirst',
  all: 'nodes:triggers.native.behaviorAll',
  any: 'nodes:triggers.native.behaviorAny',
  last: 'nodes:triggers.native.behaviorLast',
} as const;

const hasBehaviorLabel = (value: string): value is keyof typeof TRIGGER_BEHAVIOR_LABELS =>
  value in TRIGGER_BEHAVIOR_LABELS;

type NativeTriggerOptions = {
  behavior?: string;
  threshold?: number | string | TypedThreshold;
  for?: DurationValue;
  offset?: DurationValue;
  offset_type?: TriggerOffsetType;
  type?: string;
  phase?: string;
  /**
   * `humidifier.mode_changed`'s `mode` / `water_heater.operation_mode_changed`'s
   * `operation_mode` store their real value here — see lib/triggerEnumField.ts.
   * An index signature is needed since the key itself is dynamic.
   */
  [key: string]: unknown;
};

export function NativeTriggerFields({
  node,
  onChange,
  triggerType,
  compact = false,
}: NativeTriggerFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const target = getNodeDataObject<TargetValue>(node, 'target');
  const options = getNodeDataObject<NativeTriggerOptions>(node, 'options');
  const unit = getThresholdUnit(triggerType);
  const range = getThresholdRange(triggerType);
  // What the connected HA describes for this trigger, else the tables
  // (lib/nativeDescriptions.ts): the same fields either way on HA 2026.9.
  const description = useNativeDescription('trigger', triggerType);
  // The threshold as the connected HA has it: none where it describes the
  // type without one (an HA from before the threshold rework, whose bounds
  // are its own fields, below).
  const shape = describedThresholdShape('trigger', triggerType, description);
  const { behavior: behaviorField, hasFor: showFor } = resolveOptionFields(
    'trigger',
    triggerType,
    description
  );
  // A value the automation already holds that isn't offered (the older
  // `any`/`last` of an imported one, say) is listed too, so the panel shows
  // what the automation does.
  const behaviors =
    behaviorField && options.behavior && !behaviorField.values.includes(options.behavior)
      ? [...behaviorField.values, options.behavior]
      : behaviorField?.values;
  const enumField = getTriggerEnumField(triggerType);
  const durationField = getTriggerDurationField(triggerType);
  const offsetField = getTriggerOffsetField(triggerType);
  // Every `sun.*` trigger is a singleton — HA hardcodes `sun.sun` internally,
  // no user-selectable target — mirrors NativeConditionFields.tsx's
  // `isSunSingleton` branch, which this component previously had no
  // equivalent of at all. `moon.phase_changed` and
  // `zone.occupancy_detected`/`occupancy_cleared` are targetless for their
  // own, individually-confirmed reasons — see triggerIsTargetless's doc
  // comment in lib/nativeThreshold.ts.
  const isTargetless = resolveTargetless('trigger', triggerType, description);
  const isMoonPhase = triggerType === 'moon.phase_changed';
  const periodField = getSunPeriodField(triggerType);

  const updateOptions = (patch: Partial<NativeTriggerOptions>) =>
    onChange('options', { ...options, ...patch });

  const typedThreshold: TypedThreshold =
    shape === 'typed' &&
    typeof options.threshold === 'object' &&
    options.threshold !== null &&
    !Array.isArray(options.threshold)
      ? options.threshold
      : {};

  const flatThreshold: number | string | undefined =
    typeof options.threshold === 'number' || typeof options.threshold === 'string'
      ? options.threshold
      : undefined;

  return (
    <>
      {!isTargetless && !compact && (
        <PanelTargets>
          <NativeTargetField
            target={target}
            onChange={(v) => onChange('target', v)}
            described={description?.target}
          />
        </PanelTargets>
      )}

      {compact && behaviorField && behaviors && (
        <BehaviorSegment
          kind="trigger"
          values={behaviors}
          value={options.behavior ?? behaviorField.default}
          onChange={(behavior) => updateOptions({ behavior })}
        />
      )}

      {!compact && behaviorField && behaviors && (
        <FormField
          label={t('nodes:triggers.native.behaviorLabel')}
          description={t('nodes:triggers.native.behaviorDescription')}
        >
          <Select
            value={options.behavior ?? behaviorField.default}
            onValueChange={(v) => updateOptions({ behavior: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {behaviors.map((behavior) => (
                <SelectItem key={behavior} value={behavior}>
                  {hasBehaviorLabel(behavior) ? t(TRIGGER_BEHAVIOR_LABELS[behavior]) : behavior}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}

      {enumField && (
        <FormField
          label={t(`nodes:triggers.native.enumFieldLabels.${enumField.labelKey}`)}
          description={t(`nodes:triggers.native.enumFieldDescriptions.${enumField.labelKey}`)}
        >
          <IdList
            values={toStringArray(options[enumField.optionsKey])}
            onChange={(vals) => updateOptions({ [enumField.optionsKey]: vals })}
            placeholder={t(`nodes:triggers.native.enumFieldPlaceholders.${enumField.labelKey}`)}
          />
        </FormField>
      )}

      {durationField && (
        <DurationField
          label={t(`nodes:triggers.native.durationFieldLabels.${durationField.labelKey}`)}
          description={t('nodes:triggers.native.durationFieldDescription')}
          value={(options[durationField.optionsKey] as DurationValue) ?? {}}
          onChange={(v) => updateOptions({ [durationField.optionsKey]: v })}
        />
      )}

      {offsetField && (
        <>
          {offsetField.hasTwilightType && (
            <FormField label={t('nodes:triggers.native.twilightTypeLabel')}>
              <HaSelect
                value={options.type ?? 'civil'}
                onChange={(v) => updateOptions({ type: String(v) })}
                options={TRIGGER_TWILIGHT_TYPES.map((type) => ({
                  value: type,
                  label: t(`nodes:triggers.native.twilightTypes.${type}`),
                }))}
                fallback={
                  <Select
                    value={options.type ?? 'civil'}
                    onValueChange={(v) => updateOptions({ type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGER_TWILIGHT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`nodes:triggers.native.twilightTypes.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </FormField>
          )}
          <DurationField
            label={t('nodes:triggers.native.offsetLabel')}
            description={t(
              offsetField.required
                ? 'nodes:triggers.native.offsetDescriptionRequired'
                : 'nodes:triggers.native.offsetDescription'
            )}
            value={options.offset ?? {}}
            onChange={(v) => updateOptions({ offset: v })}
          />
          <FormField
            label={t('nodes:triggers.native.offsetTypeLabel')}
            description={t('nodes:triggers.native.offsetTypeDescription')}
          >
            <Select
              value={options.offset_type ?? 'before'}
              onValueChange={(v) => updateOptions({ offset_type: v as TriggerOffsetType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">
                  {t('nodes:triggers.native.offsetTypeBefore')}
                </SelectItem>
                <SelectItem value="after">{t('nodes:triggers.native.offsetTypeAfter')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </>
      )}

      {isMoonPhase && (
        <OptionSelectField
          label={t('nodes:triggers.native.moonPhaseLabel')}
          value={options.phase ?? 'any'}
          options={TRIGGER_MOON_PHASES.map((phase) => ({
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

      {!compact && shape === 'flat' && (
        <FormField
          label={t('nodes:triggers.native.thresholdLabel')}
          description={t('nodes:triggers.native.thresholdDescription')}
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

      {!compact && shape === 'typed' && (
        <ThresholdTypeField
          threshold={typedThreshold}
          onChange={(next) => updateOptions({ threshold: next })}
          forValue={showFor ? (options.for ?? {}) : undefined}
          onForChange={showFor ? (v) => updateOptions({ for: v }) : undefined}
          unit={unit}
          units={resolveThresholdUnits(triggerType, description)}
          min={range?.min}
          max={range?.max}
          allowAny={triggerAllowsAnyThreshold(triggerType)}
        />
      )}

      {/* The `typed` shape renders its own `for` field inline via
          ThresholdTypeField above — every other shape (flat/none, including
          plain boolean triggers like lock.locked or door.opened, and the
          enum-mode ones just above) gets it here instead. */}
      {/* On the card: the For pill once set, and a threshold pill asks it
          too; until then, a type without a threshold asks it here. */}
      {compact &&
        showFor &&
        shape !== 'flat' &&
        shape !== 'typed' &&
        holdForValue('trigger', node.data) === undefined && (
          <HoldForField
            kind="trigger"
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

      {/* Whatever else HA describes for it, by HA's own selectors. */}
      <DescribedOptionFields
        kind="trigger"
        type={triggerType}
        description={description}
        handled={handledTriggerOptions(triggerType, description)}
        options={options}
        onChange={(key, value) => updateOptions({ [key]: value })}
      />
    </>
  );
}
