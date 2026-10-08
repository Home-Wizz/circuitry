import { type StateForRefusal, stateForBlocked } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import {
  DurationInput,
  type DurationValue,
  hasMilliseconds,
} from '@/components/panels/node-fields/DurationField';
import { FieldHeading } from '@/components/ui/field-heading';
import type { NativeDescription } from '@/lib/nativeDescriptions';
import { cn, isRecord } from '@/lib/utils';

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

/** Why the step can't be asked to hold (bug #182: a State condition with
 * several states, an attribute or a helper's state, which HA 2026.10
 * refuses with a "for"), or null. */
export function holdForBlocked(
  kind: Kind,
  data: Readonly<Record<string, unknown>>
): StateForRefusal | null {
  return kind === 'condition' ? stateForBlocked(data) : null;
}

/** The i18n key of what's said under a "for" the step can't use. */
export const holdForBlockedNote = (
  reason: StateForRefusal
): `nodes:pickerConfig.forBlocked.${StateForRefusal}` => `nodes:pickerConfig.forBlocked.${reason}`;

/** "For at least (optional)" and its duration, as the Fill in column and
 * the card's pills ask it. Off, with the reason, where the step can't use
 * one; one already set stays editable (to clear it), the reason in red. */
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
  const value = holdForValue(kind, data);
  const blocked = holdForBlocked(kind, data);
  const off = blocked !== null && value === undefined;
  return (
    <FieldHeading label={t('nodes:pickerConfig.forAtLeast')}>
      <DurationInput
        value={value ?? ''}
        onChange={(next) => onPatch(holdForPatch(kind, data, next))}
        disabled={off}
        milliseconds={hasMilliseconds(value)}
      />
      {blocked && (
        <p
          data-testid="hold-for-blocked"
          className={cn('text-xs', off ? 'text-muted-foreground' : 'text-destructive')}
        >
          {t(holdForBlockedNote(blocked))}
        </p>
      )}
    </FieldHeading>
  );
}
