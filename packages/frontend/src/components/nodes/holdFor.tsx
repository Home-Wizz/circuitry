import { useTranslation } from 'react-i18next';
import { DurationInput, type DurationValue } from '@/components/panels/node-fields/DurationField';
import { FieldHeading } from '@/components/ui/field-heading';
import type { NativeDescription } from '@/lib/nativeDescriptions';
import { isRecord } from '@/lib/utils';

type Kind = 'trigger' | 'condition';

/** A duration a step has: a number, text, or an object with something in it. */
export function isDuration(value: unknown): value is DurationValue {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return value.trim() !== '';
  return isRecord(value) && Object.keys(value).length > 0;
}

/** Whether the step is one of HA's purpose-specific types (`door.opened`),
 * which keep their "for" in `options`. */
function isNative(kind: Kind, data: Readonly<Record<string, unknown>>): boolean {
  const type = data[kind];
  return typeof type === 'string' && type.includes('.');
}

/** How long the step's state must hold, where it keeps it: a purpose-
 * specific type's `options.for`, a State or Numeric state one's `for`. */
export function holdForValue(
  kind: Kind,
  data: Readonly<Record<string, unknown>>
): DurationValue | undefined {
  const options = isRecord(data.options) ? data.options : {};
  const value = isNative(kind, data) ? options.for : data.for;
  return isDuration(value) ? value : undefined;
}

/**
 * The change that sets how long it must hold, written where it's kept. An
 * empty duration is no "for" at all: the key is dropped (left undefined),
 * never saved empty.
 */
export function holdForPatch(
  kind: Kind,
  data: Readonly<Record<string, unknown>>,
  next: DurationValue | undefined
): Record<string, unknown> {
  const value = isDuration(next) ? next : undefined;
  if (!isNative(kind, data)) return { for: value };
  const { for: _old, ...rest } = isRecord(data.options) ? data.options : {};
  return { options: value === undefined ? rest : { ...rest, for: value } };
}

/** Whether the step can be asked to hold: a State or Numeric state one,
 * or a purpose-specific type HA describes a `for` for. */
export function canHoldFor(
  kind: Kind,
  data: Readonly<Record<string, unknown>>,
  describe: (type: string) => NativeDescription | null | undefined
): boolean {
  const type = data[kind];
  if (typeof type !== 'string') return false;
  if (type === 'state' || type === 'numeric_state') return true;
  const fields = describe(type)?.fields;
  return type.includes('.') && isRecord(fields) && 'for' in fields;
}

/** "For at least (optional)" and its duration, as the Fill in column and
 * the card's pills ask it. */
export function HoldForField({
  kind,
  data,
  onPatch,
}: {
  kind: Kind;
  data: Readonly<Record<string, unknown>>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation(['nodes']);
  return (
    <FieldHeading label={t('nodes:pickerConfig.forAtLeast')}>
      <DurationInput
        value={holdForValue(kind, data) ?? ''}
        onChange={(next) => onPatch(holdForPatch(kind, data, next))}
      />
    </FieldHeading>
  );
}
