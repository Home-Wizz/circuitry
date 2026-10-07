import { type NodeValidationError, validateNodeData } from '@circuitry/shared';
import { getConditionEnumField, hasConditionSingleValueField } from '@/lib/conditionEnumField';
import { describedThresholdShape, type NativeDescription } from '@/lib/nativeDescriptions';
import { conditionIsTargetless, triggerIsTargetless } from '@/lib/nativeThreshold';
import { type ServiceRequiredFields, serviceFieldIssues } from '@/lib/serviceRequired';
import { type ServiceTargetContext, unsupportedTargetIssues } from '@/lib/serviceTargets';
import { getTriggerDurationField } from '@/lib/triggerDurationField';
import { getTriggerEnumField } from '@/lib/triggerEnumField';
import { getTriggerOffsetField } from '@/lib/triggerOffsetField';
import { isEmptyValue, isRecord } from '@/lib/utils';

/**
 * The options a purpose-specific trigger or condition can't be saved
 * without (#122): HA refuses the automation while one is missing, so the
 * editor flags the node the way it flags a legacy trigger's missing entity.
 * Read from the same lookups the property panel renders its fields from;
 * native-options.test.tsx holds the result to what HA 2026.9.3's own
 * validators require.
 */
export function nativeRequiredOptions(
  kind: 'trigger' | 'condition',
  type: string,
  description?: NativeDescription | null
): string[] {
  const required: string[] = [];
  // No threshold where the connected HA describes none (an HA from before
  // the threshold rework; describedThresholdShape).
  const thresholded = describedThresholdShape(kind, type, description) !== 'none';
  if (kind === 'trigger') {
    if (thresholded) required.push('threshold');
    const enumField = getTriggerEnumField(type);
    if (enumField?.required) required.push(enumField.optionsKey);
    const duration = getTriggerDurationField(type);
    if (duration?.required) required.push(duration.optionsKey);
    if (getTriggerOffsetField(type)?.required) required.push('offset');
  } else {
    if (thresholded) required.push('threshold');
    const enumField = getConditionEnumField(type);
    if (enumField?.required) required.push(enumField.optionsKey);
    if (hasConditionSingleValueField(type)) required.push('value');
    if (type === 'moon.is_phase') required.push('phase');
  }
  return required.sort();
}

const isEmpty = isEmptyValue;

/** A threshold bound HA takes: a number, or a (non-empty) entity. */
const boundGiven = (bound: unknown): boolean =>
  isRecord(bound) && (typeof bound.number === 'number' || (typeof bound.entity === 'string' && bound.entity !== ''));

/** Whether a threshold is one HA takes: a bare number or entity (the FLAT
 * shape), `{above?, below?}` with one of them (FLAT-SIMPLE), or a TYPED
 * `{type, value}` / `{type, value_min, value_max}` / `{type: any}`. */
function thresholdGiven(threshold: unknown): boolean {
  if (typeof threshold === 'number') return true;
  if (typeof threshold === 'string') return threshold !== '';
  if (!isRecord(threshold)) return false;
  const t = threshold;
  switch (t.type) {
    case 'any':
      return true;
    case 'above':
    case 'below':
      return boundGiven(t.value);
    case 'between':
    case 'outside':
      return boundGiven(t.value_min) && boundGiven(t.value_max);
    default:
      return t.type === undefined && (boundGiven(t.above) || boundGiven(t.below));
  }
}

/** An issue for each required option the node's `options` lack. */
export function nativeOptionIssues(
  kind: 'trigger' | 'condition',
  type: string,
  options: Record<string, unknown>,
  description?: NativeDescription | null
): NodeValidationError[] {
  return nativeRequiredOptions(kind, type, description)
    .filter((key) => (key === 'threshold' ? !thresholdGiven(options.threshold) : isEmpty(options[key])))
    .map((key) => ({
      path: ['options', key],
      message:
        key === 'threshold'
          ? 'errors:validation.native.thresholdRequired'
          : 'errors:validation.native.optionRequired',
    }));
}

const TARGET_KEYS = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'];

/** A purpose-specific trigger's or condition's target: HA refuses one
 * without it (an error), and one naming nothing never fires or matches (a
 * warning, as for a legacy trigger's empty entity list). */
export function targetIssues(target: unknown): NodeValidationError[] {
  if (!isRecord(target)) return [{ path: ['target'], message: 'errors:validation.native.targetRequired' }];
  return targetNamesSomething(target)
    ? []
    : [{ path: ['target'], message: 'errors:validation.native.targetEmpty', severity: 'warning' }];
}

/** Whether a target names anything (an entity, device, area, floor or label). */
export function targetNamesSomething(target: unknown): boolean {
  return isRecord(target) && TARGET_KEYS.some((key) => !isEmpty(target[key]));
}

/** The issues of a node's data, when it is a purpose-specific trigger or
 * condition (a dotted type): its target, where it takes one, and its
 * required options (as the connected HA describes the type, where it
 * does). None otherwise. */
export function nativeNodeIssues(
  nodeType: string,
  data: Record<string, unknown>,
  description?: NativeDescription | null
): NodeValidationError[] {
  const kind = nodeType === 'trigger' ? 'trigger' : nodeType === 'condition' ? 'condition' : undefined;
  const type = kind === 'trigger' ? data.trigger : kind === 'condition' ? data.condition : undefined;
  if (!kind || typeof type !== 'string' || !type.includes('.')) return [];
  const targetless = kind === 'trigger' ? triggerIsTargetless(type) : conditionIsTargetless(type);
  return [
    ...(targetless ? [] : targetIssues(data.target)),
    ...nativeOptionIssues(kind, type, isRecord(data.options) ? data.options : {}, description),
  ];
}

/** Everything the editor flags on a node: the shared schema's checks, a
 * purpose-specific trigger's or condition's missing required options, and
 * (given the connected HA's services and states) an action's empty required
 * fields and entities that can't do it. */
export function editorNodeIssues(
  nodeType: string,
  data: Record<string, unknown>,
  serviceRequired: ServiceRequiredFields = {},
  serviceTargets?: ServiceTargetContext,
  description?: NativeDescription | null
): NodeValidationError[] {
  return [
    ...validateNodeData(nodeType, data),
    ...nativeNodeIssues(nodeType, data, description),
    ...(nodeType === 'action'
      ? [...serviceFieldIssues(data, serviceRequired), ...unsupportedTargetIssues(data, serviceTargets)]
      : []),
  ];
}

/** Validation issues split into errors (block saving) and warnings (shown only; bug #65). */
export function splitIssues(issues: NodeValidationError[]): {
  errors: NodeValidationError[];
  warnings: NodeValidationError[];
} {
  return {
    errors: issues.filter((i) => i.severity !== 'warning'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}
