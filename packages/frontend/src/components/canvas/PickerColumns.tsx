import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { DEFAULT_DOMAIN_COLOR, type DomainColor } from '@/lib/domain-colors';
import { cn } from '@/lib/utils';

/**
 * Shared Miller-column ("Finder-style cascading columns") primitives, split
 * out of WhenTriggerDialog.tsx so AndConditionDialog.tsx (and, eventually,
 * a Then/Action dialog) can reuse the exact same column/row/multi-select
 * rendering instead of copy-pasting it — see CLAUDE.md's zero-tolerance DRY
 * mandate. None of this is trigger-specific: every string a caller might
 * want translated (empty-state text, the multi-select panel's four labels)
 * is a prop, not a baked-in i18n key, so each dialog supplies its own
 * wording ("Add trigger" vs. "Add condition" vs. "Add action") without this
 * file needing to know which domain it's being used for.
 */

/**
 * Shared `<DialogContent className>` for all three Miller dialogs (When/And/
 * Then) — shifted right of dead-center by half the left sidebar's width
 * (`aside` in App.tsx is a fixed `w-72`/288px, so 9rem/144px) per explicit
 * user request: dead-centering on the *whole* viewport (dialog.tsx's
 * default `left-[50%]`) let a wide dialog sit on top of the sidebar,
 * hiding the node list the user still wants visible/reachable while the
 * dialog is open. `left-[calc(50%+9rem)]` re-centers the dialog within just
 * the canvas area to the sidebar's right instead — `translate-x-[-50%]`
 * (kept from dialog.tsx's own default, not overridden) still centers the
 * dialog *on* that shifted point the same way it always centered it on
 * plain 50%.
 */
export const MILLER_DIALOG_CONTENT_CLASS =
  'flex h-[75vh] max-w-5xl flex-col gap-0 p-0 left-[calc(50%+9rem)]';

export interface ResizableColumnProps {
  /** Starting width in px — matches whatever fixed Tailwind width class this column used to render, so nothing shifts until the user actually drags. */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  /** When true, the column fills any remaining dialog width (like the old `flex-1` terminal columns did) until the user drags it — at which point it switches to the dragged fixed width, same as every other column. Used by MultiTargetPanel/ResultsColumn, the two columns that always sit last. */
  fillRemaining?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps a single Miller column with a drag handle on its trailing edge — per
 * user request ("in the miller panels those should be adjustable as well to
 * adjust the width of the coluum"). Every column across WhenTriggerDialog/
 * AndConditionDialog/ThenActionDialog used a fixed Tailwind width class
 * (w-60/w-80/w-96) until now; this replaces that with an explicit pixel
 * width in local per-column state (not persisted or shared across columns/
 * dialogs — simplest model, matches how Finder's own column view resizes
 * each column independently). Mirrors ui/resizable-panel.tsx's drag
 * handling, reused here (rather than copy-pasted, per CLAUDE.md's DRY rule)
 * as a lighter per-column wrapper — no left/right `side` prop needed since
 * every Miller column only ever grows from its trailing (right) edge.
 */
export function ResizableColumn({
  defaultWidth,
  minWidth = 200,
  maxWidth = 640,
  fillRemaining = false,
  className,
  children,
}: ResizableColumnProps) {
  const [width, setWidth] = useState<number | null>(fillRemaining ? null : defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startWidth = containerRef.current?.getBoundingClientRect().width ?? defaultWidth;
    dragRef.current = { startX: e.clientX, startWidth };
    setIsResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    setWidth(Math.max(minWidth, Math.min(maxWidth, dragRef.current.startWidth + delta)));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setIsResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative flex h-full shrink-0', width === null && 'flex-1', className)}
      style={width === null ? { minWidth } : { width }}
    >
      <div className="h-full min-w-0 flex-1 overflow-hidden">{children}</div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mirrors ui/resizable-panel.tsx's own resize handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          'absolute top-0 right-0 bottom-0 z-10 w-1.5 shrink-0 translate-x-1/2 cursor-col-resize hover:bg-primary/20',
          isResizing && 'bg-primary/30'
        )}
      />
    </div>
  );
}

export interface NavRow {
  key: string;
  label: string;
  /** Device-class icon (lib/domain-icons.ts) shown left of the label — matches native HA's own "Add trigger"/"Add condition" dialogs, which icon every domain row in its category list, not just the results panel. Rows without a natural domain (areas, plain devices) render without one. */
  icon?: LucideIcon;
  /** Icon badge color (lib/domain-colors.ts) — defaults to a neutral badge when omitted, same fallback as TriggerResultRow.tsx. */
  color?: DomainColor;
  /** Clicking the row body — shows the result of this exact item in the next column. */
  onSelect?: () => void;
  /** Clicking the trailing chevron — shows this item's children in the next column. */
  onDrill?: () => void;
}

export interface NavSection {
  title?: string;
  rows: NavRow[];
}

export function NavColumnList({
  title,
  rows,
  selectedKey,
  emptyLabel,
}: {
  title?: string;
  rows: NavRow[];
  selectedKey?: string | null;
  emptyLabel?: string;
}) {
  return (
    <ResizableColumn defaultWidth={240} minWidth={180} maxWidth={420}>
      <div className="flex h-full flex-col">
        {title && (
          <div className="border-b px-3 py-2 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
            {title}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-1.5">
          {rows.length === 0 && emptyLabel && (
            <p className="p-2 text-center text-muted-foreground text-sm">{emptyLabel}</p>
          )}
          {rows.map((row) => (
            <NavRowView key={row.key} row={row} active={selectedKey === row.key} />
          ))}
        </div>
      </div>
    </ResizableColumn>
  );
}

export function NavColumnSections({
  sections,
  selectedKey,
}: {
  sections: NavSection[];
  selectedKey?: string | null;
}) {
  return (
    <ResizableColumn defaultWidth={240} minWidth={180} maxWidth={420}>
      <div className="flex h-full flex-col overflow-y-auto p-1.5">
        {sections.map(
          (section, i) =>
            section.rows.length > 0 && (
              <div key={section.title ?? i} className="mb-2">
                {section.title && (
                  <div className="px-1.5 py-1 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                    {section.title}
                  </div>
                )}
                {section.rows.map((row) => (
                  <NavRowView key={row.key} row={row} active={selectedKey === row.key} />
                ))}
              </div>
            )
        )}
      </div>
    </ResizableColumn>
  );
}

export function NavRowView({ row, active }: { row: NavRow; active: boolean }) {
  const Icon = row.icon;
  return (
    // `bg-muted`, not `bg-accent`: inside real HA, ha-theme.ts mirrors
    // `--accent` to HA's own bright orange `accent-color`, so an "active"
    // row here used to render as a solid orange fill — much louder than a
    // plain selected-row highlight needs to be, and hard to read against
    // (see TriggerResultRow.tsx's identical note).
    <div className={cn('flex items-center gap-1 rounded text-base', active && 'bg-muted text-foreground')}>
      <button
        type="button"
        onClick={row.onSelect ?? row.onDrill}
        className="flex min-w-0 flex-1 items-center gap-2 truncate rounded px-2 py-1.5 text-left hover:bg-muted"
      >
        {Icon && (
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
              (row.color ?? DEFAULT_DOMAIN_COLOR).bg
            )}
          >
            <Icon className={cn('h-3.5 w-3.5', (row.color ?? DEFAULT_DOMAIN_COLOR).fg)} />
          </span>
        )}
        <TruncatedTooltip content={row.label}>
          <span className="truncate">{row.label}</span>
        </TruncatedTooltip>
      </button>
      {row.onDrill && (
        <button
          type="button"
          onClick={row.onDrill}
          className="shrink-0 rounded p-1.5 hover:bg-muted"
          aria-label="Expand"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

export interface TargetPickerRow {
  entityId: string;
  label: string;
  icon: LucideIcon;
  /** Icon badge color (lib/domain-colors.ts) — defaults to a neutral badge when omitted, same fallback as TriggerResultRow.tsx/NavRowView. */
  color?: DomainColor;
}

export interface MultiTargetPanelLabels {
  /** Shown top-right when there's more than one row — toggles between selecting and clearing every row. */
  addAllLabel: string;
  clearAllLabel: string;
  /** Shown in place of the row list when `rows` is empty. */
  noResultsLabel: string;
  /** Shown on the bottom commit button while nothing is selected. */
  selectPromptLabel: string;
  /** Shown on the bottom commit button once ≥1 row is selected — receives the selected count. */
  commitLabel: (count: number) => string;
}

/**
 * Terminal column for both "By type" and "By target" once a recipe is down
 * to an actual list of candidate entities — a multi-select checklist rather
 * than a single-click-and-commit row, since picking a specific set of
 * entities (say, lights) out of "every light in the Living Room" is the
 * whole point of this column. Clicking a row adds it to the selection
 * (doesn't close the dialog), "Add all" is a one-click shortcut for
 * selecting everything, and nothing is actually created until the bottom
 * button is pressed — a "click each one to add it" flow
 * rather than committing on the first click. Shared by
 * WhenTriggerDialog.tsx and AndConditionDialog.tsx (and eventually a
 * Then/Action dialog) rather than redefined per dialog.
 */
export function MultiTargetPanel({
  title,
  rows,
  labels,
  onCommit,
}: {
  title: string;
  rows: TargetPickerRow[];
  labels: MultiTargetPanelLabels;
  onCommit: (entityIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (entityId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <ResizableColumn defaultWidth={320} minWidth={280} maxWidth={640} fillRemaining>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">{title}</span>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.entityId)))}
              className="shrink-0 font-medium text-primary text-sm hover:underline"
            >
              {allSelected ? labels.clearAllLabel : labels.addAllLabel}
            </button>
          )}
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <p className="p-2 text-center text-muted-foreground text-sm">{labels.noResultsLabel}</p>
          )}
          {rows.map((row) => {
            const isChecked = selected.has(row.entityId);
            const Icon = row.icon;
            return (
              <button
                key={row.entityId}
                type="button"
                onClick={() => toggle(row.entityId)}
                // Double-click commits immediately, skipping the extra trip
                // to the "Add" button below — matches Finder-style Miller
                // columns, where a single click selects and a double-click
                // opens/confirms. Unions with whatever's already checked
                // (rather than just this row alone) so double-clicking one
                // more row after checking several doesn't discard them; by
                // the time this fires, the native click that always
                // precedes a dblclick has already toggled `row.entityId`
                // itself, so re-adding it here is what guarantees it's
                // actually in the committed set regardless of which parity
                // that toggle left it at.
                onDoubleClick={() =>
                  onCommit(Array.from(new Set([...selected, row.entityId])))
                }
                className={cn(
                  'flex w-full select-none items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                  isChecked && 'border-primary bg-primary/10'
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    isChecked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                  )}
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </span>
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    (row.color ?? DEFAULT_DOMAIN_COLOR).bg
                  )}
                >
                  <Icon className={cn('h-4 w-4', (row.color ?? DEFAULT_DOMAIN_COLOR).fg)} />
                </span>
                <TruncatedTooltip content={row.label}>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                </TruncatedTooltip>
              </button>
            );
          })}
        </div>

        <div className="border-t p-2">
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onCommit(Array.from(selected))}
            className="w-full rounded-md bg-primary px-3 py-2 text-center font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selected.size === 0 ? labels.selectPromptLabel : labels.commitLabel(selected.size)}
          </button>
        </div>
      </div>
    </ResizableColumn>
  );
}

export function ResultsColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ResizableColumn defaultWidth={320} minWidth={280} maxWidth={640} fillRemaining>
      <div className="flex h-full flex-col">
        <div className="border-b px-3 py-2 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
          {title}
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">{children}</div>
      </div>
    </ResizableColumn>
  );
}
