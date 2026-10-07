import { Check, ChevronDown, ChevronRight, Home, Search } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { DEFAULT_DOMAIN_COLOR, type DomainColor } from '@/lib/domain-colors';
import { readStored, writeStored } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { getPickerIcon, type PickerIcon, PickerIconBadge } from '@/components/nodes/StepIcon';
import { CurrentChip, PickerChosenProvider, useIsCurrent } from './pickerCurrent';

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
  'flex h-[75vh] max-w-5xl flex-col gap-0 p-0 left-[calc(50%+9rem)] border border-foreground/15 shadow-2xl';

/**
 * The picker's lines (column edges, heads, dividers): the text colour at low
 * strength, so they show on HA's white page and in dark mode alike (HA's own
 * divider colour is too faint on white).
 */
export const PICKER_LINE = 'border-foreground/15';

/** A column's head: one height and a faint band in every column, so the
 * columns line up. */
export function ColumnHead({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-muted/40 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide',
        PICKER_LINE
      )}
    >
      {children}
    </div>
  );
}

const PICKER_SIZE_KEY = 'circuitry.picker.size';
const PICKER_MIN = { width: 640, height: 420 };

function readPickerSize(): { width: number; height: number } | null {
  try {
    const stored = JSON.parse(readStored(PICKER_SIZE_KEY) ?? 'null');
    return stored && typeof stored.width === 'number' && typeof stored.height === 'number'
      ? { width: stored.width, height: stored.height }
      : null;
  } catch {
    return null;
  }
}

/**
 * The pickers' size, set by dragging the grip in their bottom-right corner
 * and kept for next time (the three pickers share it). The dialog is
 * centred, so it grows on both sides: twice the pointer's movement. At
 * least 640x420, and never past the window's edges.
 */
export function usePickerSize() {
  const [size, setSize] = useState(readPickerSize);
  const dragRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    /** The widest and tallest it can be, centred where it is, 8 px inside the window. */
    maxWidth: number;
    maxHeight: number;
  } | null>(null);
  const grip = (
    <div
      role="separator"
      aria-label="Resize"
      data-testid="picker-resize-grip"
      onPointerDown={(e) => {
        e.preventDefault();
        const box = e.currentTarget.parentElement?.getBoundingClientRect();
        if (!box) return;
        const centreX = box.left + box.width / 2;
        const centreY = box.top + box.height / 2;
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          width: box.width,
          height: box.height,
          maxWidth: 2 * Math.min(centreX, window.innerWidth - centreX) - 16,
          maxHeight: 2 * Math.min(centreY, window.innerHeight - centreY) - 16,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const start = dragRef.current;
        if (!start) return;
        const width = start.width + 2 * (e.clientX - start.x);
        const height = start.height + 2 * (e.clientY - start.y);
        setSize({
          width: Math.round(Math.max(PICKER_MIN.width, Math.min(start.maxWidth, width))),
          height: Math.round(Math.max(PICKER_MIN.height, Math.min(start.maxHeight, height))),
        });
      }}
      onPointerUp={(e) => {
        dragRef.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setSize((current) => {
          if (current) writeStored(PICKER_SIZE_KEY, JSON.stringify(current));
          return current;
        });
      }}
      className="absolute right-0 bottom-0 z-20 h-4 w-4 cursor-nwse-resize text-muted-foreground/60 hover:text-foreground"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
        <path
          d="M14 6 6 14M14 10l-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
  const style = size ? { width: size.width, height: size.height, maxWidth: 'none' } : undefined;
  return { style, grip };
}

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
 * Set inside a stacked column slot (ColumnSlot): a column there fills its
 * half instead of taking a width of its own, and has no drag handle (the
 * slot has one).
 */
const StackedContext = createContext(false);

/** A column's width and its drag handle, for ResizableColumn and a stacked
 * ColumnSlot alike. */
function useColumnResize(
  initialWidth: number | null,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number
) {
  const [width, setWidth] = useState<number | null>(initialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handle = (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        const startWidth = containerRef.current?.getBoundingClientRect().width ?? defaultWidth;
        dragRef.current = { startX: e.clientX, startWidth };
        setIsResizing(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        const delta = e.clientX - dragRef.current.startX;
        setWidth(Math.max(minWidth, Math.min(maxWidth, dragRef.current.startWidth + delta)));
      }}
      onPointerUp={(e) => {
        dragRef.current = null;
        setIsResizing(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      className={cn(
        'absolute top-0 right-0 bottom-0 z-10 w-1.5 shrink-0 translate-x-1/2 cursor-col-resize hover:bg-primary/20',
        isResizing && 'bg-primary/30'
      )}
    />
  );
  return { width, containerRef, handle };
}

/**
 * Wraps a single Miller column with a drag handle on its trailing edge — per
 * user request ("in the miller panels those should be adjustable as well to
 * adjust the width of the coluum"): an explicit pixel width in local
 * per-column state, as Finder's column view resizes each column on its own.
 * Inside a stacked slot, the column fills its half instead (same elements,
 * so its contents and their scroll position survive being stacked).
 */
export function ResizableColumn({
  defaultWidth,
  minWidth = 200,
  maxWidth = 640,
  fillRemaining = false,
  className,
  children,
}: ResizableColumnProps) {
  const stacked = useContext(StackedContext);
  const { width, containerRef, handle } = useColumnResize(
    fillRemaining ? null : defaultWidth,
    defaultWidth,
    minWidth,
    maxWidth
  );
  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full',
        stacked ? 'min-h-0 w-full min-w-0' : cn('shrink-0 border-r', PICKER_LINE),
        !stacked && width === null && 'flex-1',
        className
      )}
      style={stacked ? undefined : width === null ? { minWidth } : { width }}
    >
      <div className="h-full min-w-0 flex-1 overflow-hidden">{children}</div>
      {!stacked && handle}
    </div>
  );
}

const STACK_WIDTH = { defaultWidth: 380, minWidth: 300, maxWidth: 720 };

/**
 * Fits a stacked slot's top half to the card picked in it, and brings that
 * card into view the first time it's shown there: the list stays (scroll it
 * to pick another), but the room goes to the targets below. Without layout
 * (nothing measured yet) or a picked card, it keeps its default share.
 */
export function fitTopToPicked(top: HTMLElement, shown: { current: Element | null }) {
  const picked = top.querySelector<HTMLElement>('[aria-pressed="true"]');
  const list = picked?.closest<HTMLElement>('.overflow-y-auto');
  if (!picked || !list || picked.offsetHeight === 0) {
    top.style.flexBasis = '';
    return;
  }
  const pad = Number.parseFloat(getComputedStyle(list).paddingTop) || 0;
  const above = list.getBoundingClientRect().top - top.getBoundingClientRect().top;
  const border = top.offsetHeight - top.clientHeight;
  top.style.flexBasis = `${Math.ceil(above + picked.offsetHeight + 2 * pad + border)}px`;
  if (shown.current !== picked) {
    list.scrollTop += picked.getBoundingClientRect().top - list.getBoundingClientRect().top - pad;
    shown.current = picked;
  }
}

/**
 * One column's slot. With a `bottom`, the slot is split in two, top and
 * bottom: the column a pick was made in (kept, shorter, its pick still
 * highlighted) and that pick's setup below it (its targets, then its
 * settings) -- so setting a pick up never opens a further column. The top
 * column keeps the same elements either way (only its context changes), so
 * it isn't rebuilt and keeps its scroll position when the setup opens.
 */
function ColumnSlot({ top, bottom }: { top: ReactNode; bottom: ReactNode | null }) {
  const stacked = bottom !== null;
  // Until it's dragged, a stacked slot takes the room left in the strip, so
  // its cards are as wide as the picker allows (a settings column beside it
  // keeps its own width).
  const { width, containerRef, handle } = useColumnResize(
    null,
    STACK_WIDTH.defaultWidth,
    STACK_WIDTH.minWidth,
    STACK_WIDTH.maxWidth
  );
  const topRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<Element | null>(null);
  // After every render: the picked card can change, or load, while stacked.
  useLayoutEffect(() => {
    const topEl = topRef.current;
    if (!topEl) return;
    if (stacked) fitTopToPicked(topEl, shownRef);
    else {
      topEl.style.flexBasis = '';
      shownRef.current = null;
    }
  });
  return (
    // Unstacked, the slot and its top wrapper are `contents`: no boxes of
    // their own, so the column sizes in the strip exactly as it would alone.
    <div
      ref={containerRef}
      className={cn(
        stacked
          ? cn(
              'relative flex h-full min-h-0 shrink-0 flex-col border-r',
              PICKER_LINE,
              width === null && 'flex-1'
            )
          : 'contents'
      )}
      style={
        stacked ? (width === null ? { minWidth: STACK_WIDTH.defaultWidth } : { width }) : undefined
      }
      data-column-slot=""
      data-testid={stacked ? 'stacked-columns' : undefined}
    >
      <StackedContext.Provider value={stacked}>
        <div
          ref={topRef}
          data-testid={stacked ? 'stacked-top' : undefined}
          className={cn(
            stacked
              ? cn('flex min-h-0 shrink-0 basis-[38%] flex-col border-b', PICKER_LINE)
              : 'contents'
          )}
        >
          {top}
        </div>
        {stacked && <div className="flex min-h-0 flex-1 flex-col">{bottom}</div>}
      </StackedContext.Provider>
      {stacked && handle}
    </div>
  );
}

/**
 * Renders a picker's columns, stacking a pick's setup columns (`isSetup`)
 * under the column the pick was made in: the last of them shows, below it.
 */
export function renderStackedColumns<C>(
  columns: C[],
  isSetup: (column: C) => boolean,
  render: (column: C, index: number) => ReactNode
): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i] as C;
    let last = i;
    while (last + 1 < columns.length && isSetup(columns[last + 1] as C)) last++;
    const stacks = last > i && !isSetup(column);
    out.push(
      <ColumnSlot
        key={`slot:${i}`}
        top={render(column, i)}
        bottom={stacks ? render(columns[last] as C, last) : null}
      />
    );
    if (stacks) i = last;
  }
  return out;
}

/** A picker's header: its title, a centred search box, and (when the
 * picker can become another one) its When / And / Then switch. */
export function PickerHeader({
  title,
  icon,
  search,
  onSearchChange,
  placeholder,
  kindSwitch,
}: {
  title: string;
  /** The step's own round icon, in its colour, before the title. */
  icon?: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  kindSwitch?: ReactNode;
}) {
  return (
    <DialogHeader
      className={cn(
        'grid grid-cols-[1fr_minmax(12rem,28rem)_1fr] items-center gap-3 space-y-0 border-b py-3 pr-14 pl-6',
        PICKER_LINE
      )}
    >
      <DialogTitle className="flex min-w-0 items-center gap-2.5">
        {icon}
        <span className="truncate">{title}</span>
      </DialogTitle>
      <div className="flex items-center gap-2 rounded-md bg-muted px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker opens to type in its search, as it always has
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="justify-self-end">{kindSwitch}</div>
    </DialogHeader>
  );
}

export type PickerKind = 'when' | 'and' | 'then';

/** The When / And / Then switch in a picker's header. */
export function PickerKindSwitch({
  current,
  onSwitch,
}: {
  current: PickerKind;
  onSwitch: (kind: PickerKind) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const kinds: PickerKind[] = ['when', 'and', 'then'];
  // Home Assistant's own section names: When, And if, Then do.
  return (
    <Segmented
      value={current}
      options={kinds.map((kind) => ({
        value: kind,
        label: t(`nodes:picker.sectionNames.${kind}`),
      }))}
      onChange={onSwitch}
    />
  );
}

export interface NavRow {
  key: string;
  label: string;
  /** Device-class icon (lib/domain-icons.ts) shown left of the label — matches native HA's own "Add trigger"/"Add condition" dialogs, which icon every domain row in its category list, not just the results panel. Rows without a natural domain (areas, plain devices) render without one. */
  icon?: PickerIcon;
  /** Icon badge color (lib/domain-colors.ts) — defaults to a neutral badge when omitted, same fallback as TriggerResultRow.tsx. */
  color?: DomainColor;
  /** Clicking the row body — shows the result of this exact item in the next column. */
  onSelect?: () => void;
  /** Clicking the trailing chevron — shows this item's children in the next column. */
  onDrill?: () => void;
  /** The pick this row makes (pickerCurrent.tsx): marked "Current" when it
   * is the step a Replace… started from. */
  pickKey?: string;
}

export interface NavSection {
  /** The section's heading; a heading folds its section (and the untitled
   * sections after it) away when clicked. */
  title?: string;
  /** A small heading over this section's rows: a floor's name under Home, a
   * group's name under the last section. */
  subtitle?: string;
  /** Starts a part of its own (a line above it): no heading's fold reaches it. */
  separate?: boolean;
  rows: NavRow[];
}

const FOLDED_KEY = 'circuitry_picker_folded';

function readFolded(): Set<string> {
  try {
    const stored = readStored(FOLDED_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    );
  } catch {
    return new Set();
  }
}

function writeFolded(folded: Set<string>) {
  // Folding is a convenience: without storage it lasts until the picker closes.
  writeStored(FOLDED_KEY, JSON.stringify([...folded]));
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
        {title && <ColumnHead>{title}</ColumnHead>}
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
  title,
}: {
  sections: NavSection[];
  selectedKey?: string | null;
  /** A heading over the column, as NavColumnList has. */
  title?: string;
}) {
  const [folded, setFolded] = useState<Set<string>>(readFolded);
  const toggle = (title: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      writeFolded(next);
      return next;
    });
  let foldedTitle: string | null = null;
  return (
    <ResizableColumn defaultWidth={260} minWidth={180} maxWidth={420}>
      <div className="flex h-full flex-col">
        {title && <ColumnHead>{title}</ColumnHead>}
        <div className="flex-1 overflow-y-auto p-1.5">
          {sections.map((section, i) => {
            if (section.title) foldedTitle = folded.has(section.title) ? section.title : null;
            else if (section.separate) foldedTitle = null;
            if (section.rows.length === 0) return null;
            const isFolded = foldedTitle !== null;
            return (
              <div
                key={section.title ?? section.subtitle ?? i}
                className={cn('mb-2', section.separate && cn('mt-1 border-t pt-2', PICKER_LINE))}
              >
                {section.title && (
                  <button
                    type="button"
                    aria-expanded={!isFolded}
                    onClick={() => toggle(section.title as string)}
                    className="flex w-full items-center justify-between rounded px-1.5 py-1 font-semibold text-muted-foreground text-sm uppercase tracking-wide hover:bg-muted"
                  >
                    <span>{section.title}</span>
                    {isFolded ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {!isFolded && section.subtitle && (
                  <div className="px-1.5 pt-1 pb-0.5 text-muted-foreground text-xs">
                    {section.subtitle}
                  </div>
                )}
                {!isFolded &&
                  section.rows.map((row) => (
                    <NavRowView key={row.key} row={row} active={selectedKey === row.key} />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </ResizableColumn>
  );
}

export function NavRowView({ row, active }: { row: NavRow; active: boolean }) {
  const Icon = row.icon;
  const isCurrent = useIsCurrent(row.pickKey);
  return (
    // `bg-muted`, not `bg-accent`: inside real HA, ha-theme.ts mirrors
    // `--accent` to HA's own bright orange `accent-color`, so an "active"
    // row here used to render as a solid orange fill — much louder than a
    // plain selected-row highlight needs to be, and hard to read against
    // (see TriggerResultRow.tsx's identical note).
    <div
      className={cn(
        'flex items-center gap-1 rounded text-base',
        // The picked row: a blue bar and tint (HA's primary blue).
        active && 'bg-primary/10 text-foreground shadow-[inset_3px_0_0_var(--color-primary)]'
      )}
    >
      <button
        type="button"
        onClick={row.onSelect ?? row.onDrill}
        className="flex min-w-0 flex-1 items-center gap-2 truncate rounded px-2 py-1.5 text-left hover:bg-muted"
      >
        {Icon && (
          <PickerIconBadge icon={Icon} color={row.color ?? DEFAULT_DOMAIN_COLOR} size="sm" />
        )}
        <TruncatedTooltip content={row.label}>
          <span className="truncate">{row.label}</span>
        </TruncatedTooltip>
        {isCurrent && <CurrentChip />}
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
  icon: PickerIcon;
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
  wholeArea,
}: {
  title: string;
  rows: TargetPickerRow[];
  labels: MultiTargetPanelLabels;
  onCommit: (entityIds: string[]) => void;
  /** "Anything in <room>": the room itself as the target (so devices added
   * to it later count too), picked at once, listed above its devices with
   * an edge down its side; once picked it's marked chosen, in the primary
   * colour like every other choice in the picker, until a device is ticked. */
  wholeArea?: { label: string; onSelect: () => void };
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wholeChosen, setWholeChosen] = useState(false);

  const toggle = (entityId: string) => {
    setWholeChosen(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <ResizableColumn defaultWidth={320} minWidth={280} maxWidth={640} fillRemaining>
      <div className="flex h-full flex-col">
        <ColumnHead>
          <span className="truncate">{title}</span>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.entityId)))
              }
              className="shrink-0 font-medium text-primary text-sm hover:underline"
            >
              {allSelected ? labels.clearAllLabel : labels.addAllLabel}
            </button>
          )}
        </ColumnHead>

        <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
          {wholeArea && (
            <button
              type="button"
              onClick={() => {
                setWholeChosen(true);
                wholeArea.onSelect();
              }}
              data-testid="whole-area-target"
              aria-pressed={wholeChosen}
              className={cn(
                'pick-room-target flex w-full select-none items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                wholeChosen ? 'border-primary bg-primary/10' : PICKER_LINE
              )}
            >
              <PickerIconBadge
                icon={getPickerIcon('homeassistant', Home)}
                color={DEFAULT_DOMAIN_COLOR}
                size="md"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{wholeArea.label}</span>
            </button>
          )}
          {rows.length === 0 && !wholeArea && (
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
                onDoubleClick={() => onCommit(Array.from(new Set([...selected, row.entityId])))}
                className={cn(
                  'flex w-full select-none items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                  isChecked && 'border-primary bg-primary/10'
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    isChecked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40'
                  )}
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </span>
                <PickerIconBadge icon={Icon} color={row.color ?? DEFAULT_DOMAIN_COLOR} size="md" />
                <TruncatedTooltip content={row.label}>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                </TruncatedTooltip>
              </button>
            );
          })}
        </div>

        <div className={cn('border-t p-2', PICKER_LINE)}>
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

/**
 * The picker's columns side by side. When one opens past the right edge
 * (a Fill in column after three others), the row scrolls to show it
 * rather than leaving it cut off.
 */
export function PickerColumnRow({
  columnCount,
  children,
}: {
  columnCount: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(columnCount);
  useEffect(() => {
    const row = ref.current;
    if (row && columnCount > previous.current) {
      row.scrollTo?.({ left: row.scrollWidth, behavior: 'smooth' });
    }
    previous.current = columnCount;
  }, [columnCount]);
  return (
    <div ref={ref} data-testid="picker-columns" className="flex min-h-0 flex-1 overflow-x-auto">
      {children}
    </div>
  );
}

export function ResultsColumn({
  title,
  children,
  chosenKey,
  width,
}: {
  title: string;
  children: ReactNode;
  /** The key of the row chosen in it (pickerCurrent.tsx's useIsChosen). */
  chosenKey?: string | null;
  /** A width of its own (a settings column); otherwise it takes the room
   * left in the strip. */
  width?: number;
}) {
  return (
    <ResizableColumn
      defaultWidth={width ?? 320}
      minWidth={280}
      maxWidth={640}
      fillRemaining={width === undefined}
    >
      <div className="flex h-full flex-col">
        <ColumnHead>{title}</ColumnHead>
        <PickerChosenProvider value={chosenKey}>
          <div className="flex-1 overflow-y-auto p-1.5">{children}</div>
        </PickerChosenProvider>
      </div>
    </ResizableColumn>
  );
}
