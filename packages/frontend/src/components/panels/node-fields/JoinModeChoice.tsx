import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NODE_COLORS } from '@/lib/node-colors';
import { cn } from '@/lib/utils';

export type JoinMode = 'all' | 'any';

/** How a join's paths are named: "all paths" until two are connected,
 * "both paths" for two, "all 3 paths" for more (counted forms, not the
 * language's plural rules, which have no "two" in English). */
export type PathCountForm = 'unconnected' | 'two' | 'many';
export const pathCountForm = (count: number): PathCountForm =>
  count < 2 ? 'unconnected' : count === 2 ? 'two' : 'many';

interface JoinModeChoiceProps {
  mode: JoinMode;
  /** How many paths come into the join (its incoming connections). */
  pathCount: number;
  onChange: (mode: JoinMode) => void;
}

/**
 * What a join waits for, as a choice of two with what each does: "All
 * paths" (HA's native `parallel:`, which waits for every branch) and "Any
 * path", offered but not selectable -- HA can't stop a branch part-way, so
 * a real "first one wins" can only be approximated, and that isn't built.
 * Shared by the card's pill and the property panel, so they never differ.
 */
export function JoinModeChoice({ mode, pathCount, onChange }: JoinModeChoiceProps) {
  const { t } = useTranslation(['nodes']);
  // Its own group: the card's pill and the panel can be open at once.
  const groupName = useId();
  const options: { value: JoinMode; label: string; description: string; soon?: boolean }[] = [
    {
      value: 'all',
      label: t('nodes:joinFields.optionAll'),
      description: t(`nodes:joinFields.optionAllDescription.${pathCountForm(pathCount)}`, {
        count: pathCount,
      }),
    },
    {
      value: 'any',
      label: t('nodes:joinFields.optionAny'),
      description: t('nodes:joinFields.optionAnyDescription'),
      soon: true,
    },
  ];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">{t('nodes:joinFields.mode')}</legend>
      {options.map((option) => {
        const checked = mode === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left',
              checked ? NODE_COLORS.join.chip : 'cursor-pointer hover:bg-muted',
              option.soon && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary'
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={checked}
              disabled={option.soon}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              className={cn(
                'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[1.5px]',
                checked ? NODE_COLORS.join.border : 'border-muted-foreground'
              )}
            >
              {checked && <span className="h-1.5 w-1.5 rounded-full bg-join" />}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-sm">
                {option.label}
                {option.soon && (
                  <span className="ml-1.5 rounded-full border px-1.5 align-[1px] font-bold text-[10px] text-muted-foreground uppercase">
                    {t('nodes:joinFields.soon')}
                  </span>
                )}
              </span>
              <span className="block text-muted-foreground text-xs">{option.description}</span>
            </span>
          </label>
        );
      })}
      <p className="mt-1 border-t px-2.5 pt-2 text-muted-foreground text-xs">
        {t('nodes:joinFields.runsToEnd')}
      </p>
    </fieldset>
  );
}
