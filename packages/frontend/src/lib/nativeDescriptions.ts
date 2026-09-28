import {
  CONDITION_BEHAVIORS,
  conditionIsTargetless,
  conditionOptionFields,
  getThresholdUnits,
  type NativeOptionFields,
  TRIGGER_BEHAVIORS,
  triggerIsTargetless,
  triggerOptionFields,
} from '@/lib/nativeThreshold';
import { isRecord } from '@/lib/utils';

/**
 * The option fields the running Home Assistant describes for its
 * purpose-specific triggers and conditions (`trigger_platforms/subscribe`,
 * `condition_platforms/subscribe`: what HA's own editor shows), read so the
 * panel offers exactly what that version of HA takes. HA changed them
 * between releases -- before 2026.5 a trigger's behavior was any/first/last
 * and nothing took `for` -- while lib/nativeThreshold.ts's tables match HA
 * 2026.9.3. Where HA sends no description (an older HA, or not connected),
 * the tables answer; on 2026.9 the two give the same answer
 * (native-descriptions.test.ts), so nothing looks or works differently
 * there.
 */
export interface NativeFieldDescription {
  required?: boolean;
  default?: unknown;
  selector?: Record<string, unknown>;
}

export interface NativeDescription {
  fields?: Record<string, NativeFieldDescription>;
  target?: unknown;
}

/** Descriptions by type, as HA sends them (`null` for a legacy platform). */
export type NativeDescriptions = Record<string, NativeDescription | null>;

type Kind = 'trigger' | 'condition';

/** A behavior field's values: a `select`'s options (HA before 2026.5), or
 * the values HA's `automation_behavior` selector stands for. */
function behaviorValues(kind: Kind, selector: Record<string, unknown> | undefined): string[] | undefined {
  const select = selector?.select;
  if (isRecord(select) && Array.isArray(select.options)) {
    const values = select.options
      .map((option) => (isRecord(option) ? option.value : option))
      .filter((value): value is string => typeof value === 'string');
    return values.length > 0 ? values : undefined;
  }
  if (isRecord(selector?.automation_behavior)) {
    return kind === 'trigger' ? TRIGGER_BEHAVIORS : CONDITION_BEHAVIORS;
  }
  return undefined;
}

const tableFields = (kind: Kind, type: string): NativeOptionFields =>
  kind === 'trigger' ? triggerOptionFields(type) : conditionOptionFields(type);

/** What the panel offers for `behavior` and `for`: from HA's description
 * when there is one, else from the tables. */
export function resolveOptionFields(
  kind: Kind,
  type: string,
  description: NativeDescription | null | undefined
): NativeOptionFields {
  if (!description) return tableFields(kind, type);
  const fields = description.fields ?? {};
  const behaviorField = fields.behavior;
  if (!behaviorField) return { hasFor: 'for' in fields };
  const values = behaviorValues(kind, behaviorField.selector);
  // A behavior selector this editor doesn't know: the tables' reading.
  if (!values) return { ...tableFields(kind, type), hasFor: 'for' in fields };
  const described = behaviorField.default;
  const fallback = values[0] ?? '';
  return {
    behavior: {
      values,
      default: typeof described === 'string' && values.includes(described) ? described : fallback,
    },
    hasFor: 'for' in fields,
  };
}

/** The units HA takes for a threshold's number, where it takes several. */
export function resolveThresholdUnits(
  type: string,
  description: NativeDescription | null | undefined
): string[] | undefined {
  const selector = description?.fields?.threshold?.selector?.numeric_threshold;
  if (!description || !isRecord(selector)) return getThresholdUnits(type);
  const units = selector.unit_of_measurement;
  return Array.isArray(units) && units.length > 0 ? units.filter((u): u is string => typeof u === 'string') : undefined;
}

/** Whether the type has no target: HA describes none for it. */
export function resolveTargetless(
  kind: Kind,
  type: string,
  description: NativeDescription | null | undefined
): boolean {
  if (!description) return kind === 'trigger' ? triggerIsTargetless(type) : conditionIsTargetless(type);
  return description.target === undefined;
}
