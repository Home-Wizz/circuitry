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
import {
  getThresholdRange,
  getThresholdUnit,
  getTriggerBehaviorVariant,
  getTriggerThresholdShape,
  triggerAllowsAnyThreshold,
  triggerHasFor,
  triggerIsTargetless,
  type TypedThreshold,
} from '@/lib/nativeThreshold';
import { HaSelect } from '@/ha';
import { getTriggerDurationField } from '@/lib/triggerDurationField';
import { getTriggerEnumField } from '@/lib/triggerEnumField';
import {
  getTriggerOffsetField,
  TRIGGER_TWILIGHT_TYPES,
  type TriggerOffsetType,
} from '@/lib/triggerOffsetField';
import { getNodeDataObject, toStringArray } from '@/utils/nodeData';
import { DurationField, type DurationValue } from './DurationField';
import { NativeTargetField, type TargetValue } from './NativeTargetField';
import { ThresholdTypeField } from './ThresholdTypeField';
import { ThresholdValueField } from './ThresholdValueField';

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
 * threshold-bearing types), so both default to shown; see
 * lib/nativeThreshold.ts's `triggerHasFor`/`triggerHasNoOptions` for the
 * short, individually-confirmed exception lists. `behavior`'s literal
 * values (each/first/all vs the older any/first/last) are per-type — see
 * `getTriggerBehaviorVariant` — a genuine, HA-acknowledged split
 * (home-assistant/frontend#29731) rather than something to normalize away.
 */
interface NativeTriggerFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  /** The dotted trigger type, e.g. `light.brightness_crossed_threshold` or `illuminance.crossed_threshold` — determines which threshold shape (if any) to render. */
  triggerType: string;
}

// home-assistant.io/triggers/moon.phase_changed/: "Accepts `any` (every
// phase change) or one of `new_moon`, `waxing_crescent`, `first_quarter`,
// `waxing_gibbous`, `full_moon`, `waning_gibbous`, `last_quarter`, or
// `waning_crescent`." Default `any`.
const MOON_PHASES = [
  'any',
  'new_moon',
  'waxing_crescent',
  'first_quarter',
  'waxing_gibbous',
  'full_moon',
  'waning_gibbous',
  'last_quarter',
  'waning_crescent',
] as const;

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

export function NativeTriggerFields({ node, onChange, triggerType }: NativeTriggerFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const target = getNodeDataObject<TargetValue>(node, 'target');
  const options = getNodeDataObject<NativeTriggerOptions>(node, 'options');
  const shape = getTriggerThresholdShape(triggerType);
  const unit = getThresholdUnit(triggerType);
  const range = getThresholdRange(triggerType);
  const behaviorVariant = getTriggerBehaviorVariant(triggerType);
  const showBehavior = behaviorVariant !== 'none';
  const showFor = triggerHasFor(triggerType);
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
  const isTargetless = triggerIsTargetless(triggerType);
  const isMoonPhase = triggerType === 'moon.phase_changed';

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
      {!isTargetless && <NativeTargetField target={target} onChange={(v) => onChange('target', v)} />}

      {showBehavior && (
        <FormField
          label={t('nodes:triggers.native.behaviorLabel')}
          description={t('nodes:triggers.native.behaviorDescription')}
        >
          <Select
            value={options.behavior ?? (behaviorVariant === 'any-first-last' ? 'any' : 'each')}
            onValueChange={(v) => updateOptions({ behavior: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {behaviorVariant === 'any-first-last' ? (
                <SelectItem value="any">{t('nodes:triggers.native.behaviorAny')}</SelectItem>
              ) : (
                <SelectItem value="each">{t('nodes:triggers.native.behaviorEach')}</SelectItem>
              )}
              <SelectItem value="first">{t('nodes:triggers.native.behaviorFirst')}</SelectItem>
              {behaviorVariant === 'any-first-last' ? (
                <SelectItem value="last">{t('nodes:triggers.native.behaviorLast')}</SelectItem>
              ) : (
                <SelectItem value="all">{t('nodes:triggers.native.behaviorAll')}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </FormField>
      )}

      {enumField && (
        <FormField
          label={t(`nodes:triggers.native.enumFieldLabels.${enumField.labelKey}`)}
          description={t('nodes:triggers.native.enumFieldDescription')}
        >
          <IdList
            values={toStringArray(options[enumField.optionsKey])}
            onChange={(vals) => updateOptions({ [enumField.optionsKey]: vals })}
            placeholder={t('nodes:triggers.native.enumFieldPlaceholder')}
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
                  <Select value={options.type ?? 'civil'} onValueChange={(v) => updateOptions({ type: v })}>
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
                <SelectItem value="before">{t('nodes:triggers.native.offsetTypeBefore')}</SelectItem>
                <SelectItem value="after">{t('nodes:triggers.native.offsetTypeAfter')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </>
      )}

      {isMoonPhase && (
        <FormField label={t('nodes:triggers.native.moonPhaseLabel')}>
          <HaSelect
            value={options.phase ?? 'any'}
            onChange={(v) => updateOptions({ phase: String(v) })}
            options={MOON_PHASES.map((phase) => ({
              value: phase,
              label: t(`nodes:triggers.native.moonPhases.${phase}`),
            }))}
            fallback={
              <Select value={options.phase ?? 'any'} onValueChange={(v) => updateOptions({ phase: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOON_PHASES.map((phase) => (
                    <SelectItem key={phase} value={phase}>
                      {t(`nodes:triggers.native.moonPhases.${phase}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </FormField>
      )}

      {shape === 'flat' && (
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

      {shape === 'typed' && (
        <ThresholdTypeField
          threshold={typedThreshold}
          onChange={(next) => updateOptions({ threshold: next })}
          forValue={showFor ? (options.for ?? {}) : undefined}
          onForChange={showFor ? (v) => updateOptions({ for: v }) : undefined}
          unit={unit}
          min={range?.min}
          max={range?.max}
          allowAny={triggerAllowsAnyThreshold(triggerType)}
        />
      )}

      {/* The `typed` shape renders its own `for` field inline via
          ThresholdTypeField above — every other shape (flat/none, including
          plain boolean triggers like lock.locked or door.opened, and the
          enum-mode ones just above) gets it here instead. */}
      {shape !== 'typed' && showFor && (
        <DurationField
          label={t('nodes:triggers.native.thresholdForLabel')}
          description={t('nodes:triggers.native.thresholdForDescription')}
          value={options.for ?? {}}
          onChange={(v) => updateOptions({ for: v })}
        />
      )}
    </>
  );
}
