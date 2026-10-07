import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { DEFAULT_DOMAIN_COLOR, type DomainColor } from '@/lib/domain-colors';
import { cn } from '@/lib/utils';
import { type PickerIcon, PickerIconBadge } from '@/components/nodes/StepIcon';
import { CurrentChip, useIsChosen, useIsCurrent } from '@/components/canvas/pickerCurrent';

/** Covers both `lucide-react`'s own `LucideIcon` type and the narrower
 * `React.ComponentType<{ className?: string }>` PLATFORM_ICONS
 * (TriggerTypePicker.tsx) is typed as — both are just "a component that
 * takes a className", so this row doesn't need the stricter lucide-specific
 * type to render either one. */

/**
 * One selectable trigger/recipe row — shared by `TargetResultsPanel`
 * (TriggerTargetPicker.tsx) and `TypeResultsPanel` (TriggerTypePicker.tsx),
 * which both used to render their own near-identical single-line button
 * (small icon, small text, a trailing chip and a `+`). Redesigned to match
 * real HA's own "Add trigger" results list — a taller card-style row with a
 * larger icon, a bold title, and a muted description line beneath it — per
 * direct user feedback that the old rows read too small/cramped next to
 * native HA's. Deliberately no trailing `+`: the whole row is already the
 * click target, so a separate icon-button for the same action was pure
 * visual noise once the row itself is legible enough to read as a button.
 *
 * The icon itself sits in a solid-color circular badge (`color`, from
 * lib/domain-colors.ts) rather than a bare gray line icon — per user
 * request to bring the picker closer to a reference "Add card" dialog
 * style, where every row's icon is a small colorful badge, not a plain
 * outline.
 * `color` is optional: rows with no real domain (platform triggers,
 * condition/action Blocks) fall back to a neutral badge rather than no
 * background at all, so every row in a given column still reads
 * consistently as "an icon in a badge".
 */
export function TriggerResultRow({
  icon: Icon,
  label,
  description,
  chip,
  color,
  onSelect,
  pickKey,
  choiceKey,
}: {
  icon: PickerIcon;
  label: string;
  /** Real HA's own trigger-doc wording where verified (see lib/triggerRecipes.ts) — omitted rather than guessed for recipes without confirmed copy. */
  description?: string;
  /** Which entity/device this row applies to, when relevant (e.g. browsing a whole area's results). */
  chip?: string | null;
  /** Icon badge color — see lib/domain-colors.ts. Defaults to a neutral gray badge for non-domain-specific rows (platforms, Blocks). */
  color?: DomainColor;
  onSelect: () => void;
  /** The pick this row makes, marked "Current" when it is the step being
   * replaced (canvas/pickerCurrent.tsx). */
  pickKey?: string;
  /** The key it's chosen by in its column (useIsChosen): marked chosen
   * while the column it opened is showing. */
  choiceKey?: string;
}) {
  const { bg, fg } = color ?? DEFAULT_DOMAIN_COLOR;
  const isCurrent = useIsCurrent(pickKey);
  const isChosen = useIsChosen(choiceKey);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3.5 rounded-xl border border-foreground/15 px-4 py-3.5 text-left',
        // Deliberately `bg-muted` rather than `bg-accent` for the hover
        // state: inside real HA, `--accent` is HA's bright orange
        // `accent-color` (ha-theme.ts mirrors HA's own theme, not a neutral
        // shadcn gray), which turned the whole row solid orange on hover —
        // fine for the icon/title, but the muted-foreground description
        // line stayed gray-on-orange, which read as genuinely hard to read
        // rather than just "colorful". `bg-muted` (HA's neutral
        // secondary-background-color) keeps the same hover affordance
        // without fighting the description text's own color.
        'transition-colors hover:border-foreground/20 hover:bg-muted',
        isCurrent && 'border-primary/50',
        isChosen && 'border-primary bg-primary/10 hover:border-primary hover:bg-primary/10'
      )}
      aria-pressed={choiceKey === undefined ? undefined : isChosen}
    >
      <PickerIconBadge icon={Icon} color={{ bg, fg }} size="lg" />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2 font-medium text-lg">
          {label}
          {isCurrent && <CurrentChip />}
        </div>
        {description && (
          // At most two lines; the rest in a tooltip when it's cut.
          <TruncatedTooltip content={description}>
            <div className="mt-1 line-clamp-2 text-muted-foreground text-base leading-relaxed">
              {description}
            </div>
          </TruncatedTooltip>
        )}
      </div>
      {chip && (
        <TruncatedTooltip content={chip}>
          <span className="mt-0.5 shrink-0 truncate rounded border px-2 py-0.5 text-muted-foreground text-sm">
            {chip}
          </span>
        </TruncatedTooltip>
      )}
    </button>
  );
}
