import {
  ChevronLeft,
  DiamondPlus,
  Eye,
  EyeOff,
  FileCode,
  FolderOpen,
  GripVertical,
  HelpCircle,
  type LucideIcon,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  PlusSquare,
  Radio,
  Search,
  Signpost,
} from 'lucide-react';
import {
  type ComponentType,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type CompoundTypeConfig,
  compoundTypes,
  type NodeTypeConfig,
  nodeTypes,
} from '@/config/nodeTypeCatalog';
import { useAddNodeAtCenter } from '@/hooks/useAddNodeAtCenter';
import { useAddNodeDialogs } from '@/hooks/useAddNodeDialogs';
import type { CompoundBlockKey } from '@/lib/block-factories';
import { StepIcon } from '@/components/nodes/StepIcon';
import type { NodeColorToken } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

// Re-exported so the handful of existing call sites that import the catalog
// from here (quick-add.ts, QuickAddMenu.tsx, FlowCanvas.tsx) don't need to
// change — the catalog itself lives in config/nodeTypeCatalog.ts, its own
// module, so ConditionNode.tsx/ActionNode.tsx can pull just the icon lookup
// out of it without importing this whole sidebar component.
export type { NodeTypeConfig, CompoundTypeConfig };
export { nodeTypes, compoundTypes };

interface NodePaletteProps {
  /** Opens the "Open Automation" browse/import dialog — see App.tsx, which owns the dialog itself. */
  onOpenAutomationImport: () => void;
  /** Opens the "Import YAML" dialog — see App.tsx, which owns the dialog itself. */
  onOpenImportYaml: () => void;
  /** Back to Home Assistant, when Circuitry runs as its panel. */
  onExit?: () => void;
  /** Folded to an icon rail (App.tsx remembers it). */
  rail?: boolean;
  onToggleRail?: () => void;
  /** The footer's status line: the remote connection, or its error. */
  status?: { text?: string; error?: string };
  version?: string;
}

const nodeConfig = (type: string) => nodeTypes.find((n) => n.type === type);
const compoundConfig = (key: CompoundBlockKey) => compoundTypes.find((c) => c.key === key);

/**
 * The left panel's own box (App.tsx). Unfolded, a column down the left edge;
 * folded, a dock: a frosted capsule floating over the canvas's left side,
 * its buttons growing as the pointer passes over them (.palette-dock,
 * index.css), centred on the canvas's height.
 */
export function paletteAsideClass(rail: boolean): string {
  return rail
    ? 'palette-dock absolute top-1/2 left-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[62px] -translate-y-1/2 flex-col rounded-[30px] border border-foreground/10 bg-card/70 shadow-[0_10px_30px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150'
    : 'flex h-full min-h-0 w-64 shrink-0 flex-col border-border border-r bg-card';
}

/** The Building blocks, in the side panel's groups. A duration (Delay) is one
 * of the Wait for… choices, so it has no row of its own. */
type BlockEntry =
  | { kind: 'compound'; key: CompoundBlockKey }
  | { kind: 'node'; type: 'set_variables' | 'start' | 'join' }
  | { kind: 'waitFor' };
const BLOCK_GROUPS: {
  group: 'branching' | 'repeat' | 'timing' | 'structure';
  entries: BlockEntry[];
}[] = [
  {
    group: 'branching',
    entries: [
      { kind: 'compound', key: 'if_else' },
      { kind: 'compound', key: 'choose' },
    ],
  },
  {
    group: 'repeat',
    entries: [
      { kind: 'compound', key: 'repeat_while' },
      { kind: 'compound', key: 'repeat_until' },
      { kind: 'compound', key: 'repeat_count' },
    ],
  },
  { group: 'timing', entries: [{ kind: 'waitFor' }, { kind: 'node', type: 'set_variables' }] },
  {
    group: 'structure',
    entries: [
      { kind: 'compound', key: 'parallel' },
      { kind: 'compound', key: 'sequence' },
      { kind: 'node', type: 'start' },
      { kind: 'node', type: 'join' },
    ],
  },
];

export function NodePalette({
  onOpenAutomationImport,
  onOpenImportYaml,
  onExit,
  rail = false,
  onToggleRail,
  status,
  version,
}: NodePaletteProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const { addNodeAtCenter, addCompoundAtCenter } = useAddNodeAtCenter();
  const {
    openWhen,
    openAnd,
    openThen,
    openThenForWait,
    openAndForNode,
    openThenForNode,
    openReplaceForNode,
    openSearch,
    dialogs,
  } = useAddNodeDialogs();
  const reset = useFlowStore((s) => s.reset);
  const openInNewTab = useFlowStore((s) => s.openInNewTab);

  // "Click an already-placed bubble to configure it" — see
  // useAddNodeDialogs.tsx's openAndForNode/openThenForNode doc comment and
  // flow-store.ts's nodeEditRequest doc comment for why this lives here:
  // ConditionNode.tsx/ActionNode.tsx (deep inside FlowCanvas, a sibling of
  // this component, not a descendant) can't reach useAddNodeDialogs' open
  // functions directly, so they just set this store field and this effect
  // notices and dispatches to the right dialog.
  const nodeEditRequest = useFlowStore((s) => s.nodeEditRequest);
  const clearNodeEditRequest = useFlowStore((s) => s.clearNodeEditRequest);
  useEffect(() => {
    if (!nodeEditRequest) return;
    const { kind, nodeId } = nodeEditRequest;
    clearNodeEditRequest();
    if (kind === 'replace') openReplaceForNode(nodeId);
    else if (kind === 'condition') openAndForNode(nodeId);
    else openThenForNode(nodeId);
  }, [nodeEditRequest, clearNodeEditRequest, openAndForNode, openThenForNode, openReplaceForNode]);

  const handleAddNode = useCallback(
    (config: NodeTypeConfig) => {
      // Trigger/Condition/Action open the Miller-column "Add" dialogs
      // (useAddNodeDialogs.tsx) instead of dropping an empty node. Wait gets the
      // same treatment: it used to drop a blank node directly, silently
      // skipping the "Wait for..." options entirely (reported bug) — now it
      // opens the Then dialog pre-jumped to the waitForOptions column. Drag-
      // and-drop from these same buttons is intentionally left as-is (still
      // drops an empty node with defaultData): a modal picker can't sensibly
      // attach to a drag gesture, so that path keeps the old behavior.
      if (config.type === 'trigger') return openWhen();
      if (config.type === 'condition') return openAnd();
      if (config.type === 'action') return openThen();
      if (config.type === 'wait') return openThenForWait();
      addNodeAtCenter(config.type, config.defaultData);
    },
    [addNodeAtCenter, openWhen, openAnd, openThen, openThenForWait]
  );

  const handleAddCompound = useCallback(
    (config: CompoundTypeConfig) => {
      // Every compound block — If/Else, Choose, Repeat While, Repeat Until,
      // Parallel, etc. — is added to the canvas immediately with blank
      // placeholder entry data, rather than pre-opening a miller before the
      // block even exists (reverted per user request; If/Else/Choose used
      // to open the AND dialog first). Clicking a placed entry condition/
      // action bubble afterward opens the respective miller to configure it
      // in place — see ConditionNode.tsx/ActionNode.tsx's click handling
      // and this component's nodeEditRequest effect above.
      addCompoundAtCenter(config.key);
    },
    [addCompoundAtCenter]
  );

  const onDragStart = useCallback((event: DragEvent<HTMLButtonElement>, config: NodeTypeConfig) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({
        type: config.type,
        defaultData: config.defaultData,
      })
    );
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragStartCompound = useCallback(
    (event: DragEvent<HTMLButtonElement>, config: CompoundTypeConfig) => {
      event.dataTransfer.setData(
        'application/reactflow-compound',
        JSON.stringify({ key: config.key })
      );
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  // The empty canvas's prompt asks for the trigger picker or Open.
  const paletteRequest = useFlowStore((state) => state.paletteRequest);
  // Each request once: one already there when the panel appeared, or already
  // handled, is skipped.
  const handledRequest = useRef(paletteRequest?.n ?? 0);
  useEffect(() => {
    if (!paletteRequest || paletteRequest.n === handledRequest.current) return;
    handledRequest.current = paletteRequest.n;
    if (paletteRequest.kind === 'when') openWhen();
    else onOpenAutomationImport();
  }, [paletteRequest, openWhen, onOpenAutomationImport]);

  const [query, setQuery] = useState('');

  /** One row: a small neon disc and its name; draggable onto the canvas. */
  const row = (props: {
    key: string;
    label: string;
    sub?: string;
    icon: LucideIcon | ComponentType<{ className?: string }>;
    tone: NodeColorToken;
    onClick: () => void;
    onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  }): ReactNode => {
    const button = (
      <button
        key={props.key}
        type="button"
        data-testid={`palette-${props.key}`}
        onClick={props.onClick}
        onDragStart={props.onDragStart}
        draggable={Boolean(props.onDragStart)}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg text-left',
          props.onDragStart && 'cursor-grab active:cursor-grabbing',
          // Docked: one size for every button, growing on hover (index.css).
          rail
            ? 'dock-item justify-center px-0'
            : props.sub
              ? 'gap-3 px-2 py-2 transition-colors hover:bg-muted'
              : 'gap-3 px-2 py-1.5 transition-colors hover:bg-muted'
        )}
      >
        <StepIcon
          tone={props.tone}
          icon={props.icon}
          size={rail ? 'lg' : props.sub ? 'xl' : 'md'}
        />
        {!rail && (
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate',
                props.sub ? 'font-semibold text-[15px]' : 'text-[15px]'
              )}
            >
              {props.label}
            </span>
            {props.sub && (
              <span className="block truncate text-[13px] text-muted-foreground">{props.sub}</span>
            )}
          </span>
        )}
        {!rail && props.onDragStart && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        )}
      </button>
    );
    if (!rail) return button;
    return (
      <Tooltip key={props.key}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} className="font-semibold">
          {props.sub ? `${props.label} · ${props.sub}` : props.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const blockRow = (entry: BlockEntry): ReactNode => {
    if (entry.kind === 'waitFor') {
      const wait = nodeConfig('wait');
      if (!wait) return null;
      return row({
        key: 'wait_for',
        label: t('nodes:blocks.wait_for.label'),
        icon: wait.icon,
        tone: wait.tone,
        onClick: openThenForWait,
        onDragStart: (e) => onDragStart(e, wait),
      });
    }
    if (entry.kind === 'node') {
      const config = nodeConfig(entry.type);
      if (!config) return null;
      return row({
        key: config.type,
        label: t(config.labelKey),
        icon: config.icon,
        tone: config.tone,
        onClick: () => handleAddNode(config),
        onDragStart: (e) => onDragStart(e, config),
      });
    }
    const config = compoundConfig(entry.key);
    if (!config) return null;
    return row({
      key: config.key,
      label: t(config.labelKey),
      icon: config.icon,
      tone: config.tone,
      onClick: () => handleAddCompound(config),
      onDragStart: (e) => onDragStartCompound(e, config),
    });
  };

  const addRows: {
    type: 'trigger' | 'condition' | 'action';
    kind: 'when' | 'and' | 'then';
    icon: LucideIcon;
    open: () => void;
  }[] = [
    { type: 'trigger', kind: 'when', icon: Radio, open: openWhen },
    { type: 'condition', kind: 'and', icon: Signpost, open: openAnd },
    { type: 'action', kind: 'then', icon: Play, open: openThen },
  ];

  const sectionHead = (text: string) =>
    rail ? (
      <div className="h-px w-7 shrink-0 bg-foreground/10" />
    ) : (
      <div className="px-2 pt-4 pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
        {text}
      </div>
    );

  const iconButton = (label: string, icon: ReactNode, onClick?: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {icon}
    </button>
  );

  const [helpOpen, setHelpOpen] = useState(false);

  const minimapOpen = useFlowStore((state) => state.minimapOpen);
  const toggleMinimap = useFlowStore((state) => state.toggleMinimap);
  // The canvas's overview map, shown or hidden (FlowCanvas.tsx).
  const overviewItem = (
    <DropdownMenuItem onClick={toggleMinimap}>
      {minimapOpen ? <EyeOff className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
      {minimapOpen ? t('buttons.hideMinimap') : t('buttons.showMinimap')}
    </DropdownMenuItem>
  );

  const automationItems = (
    <>
      <DropdownMenuItem onClick={reset}>
        <DiamondPlus className="mr-2 size-4" />
        {t('buttons.newAutomation')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openInNewTab()}>
        <PlusSquare className="mr-2 size-4" />
        {t('buttons.newAutomationInNewTab')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onOpenImportYaml}>
        <FileCode className="mr-2 h-4 w-4" />
        {t('buttons.importYaml')}
      </DropdownMenuItem>
    </>
  );

  const quickHelp = (
    <>
      <div className="mb-1.5 font-semibold">{t('labels.quickHelp')}</div>
      <ul className="space-y-1 text-muted-foreground text-xs">
        <li>{t('help.clickNodesToAdd')}</li>
        <li>{t('help.dragToConnect')}</li>
        <li>{t('help.deleteToRemove')}</li>
        <li>{t('help.backspaceDeleteKey')}</li>
      </ul>
    </>
  );

  const statusDot = (status?.text || status?.error) && (
    <span
      className={cn(
        'block h-2 w-2 shrink-0 rounded-full',
        status.error ? 'bg-destructive' : 'bg-action'
      )}
      title={status.error ?? status.text}
    />
  );

  // Docked, everything but the steps folds into one menu button at the
  // dock's foot (.dock-menu, index.css): expanding the panel, going back,
  // opening, searching, new automations and help. The connection dot sits
  // on its corner; the menu opens upwards beside it.
  const dockMenu = (
    <Popover open={helpOpen} onOpenChange={setHelpOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sidebar.more')}
              title={t('sidebar.more')}
              data-testid="dock-menu"
              className="dock-item dock-menu relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            >
              <Menu className="h-4 w-4" />
              {statusDot && <span className="absolute -top-0.5 -right-0.5">{statusDot}</span>}
            </button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent side="right" align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
          {onToggleRail && (
            <DropdownMenuItem onClick={onToggleRail}>
              <PanelLeftOpen className="mr-2 size-4" />
              {t('sidebar.expand')}
            </DropdownMenuItem>
          )}
          {onExit && (
            <DropdownMenuItem onClick={onExit}>
              <ChevronLeft className="mr-2 size-4" />
              {t('sidebar.backToHa')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenAutomationImport}>
            <FolderOpen className="mr-2 size-4" />
            {t('buttons.openAutomation')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openSearch('')}>
            <Search className="mr-2 size-4" />
            {t('sidebar.searchPlaceholder')}
          </DropdownMenuItem>
          {overviewItem}
          {automationItems}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
            <HelpCircle className="mr-2 size-4" />
            {t('labels.quickHelp')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent side="right" align="end" className="w-64 text-sm">
        {quickHelp}
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        // Docked: every button in one column, the same space between each
        // (the groups below are `contents`, so they add none of their own).
        rail && 'items-center gap-2 overflow-y-auto overflow-x-hidden py-3'
      )}
    >
      {dialogs}
      {!rail && (
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
          {onExit && iconButton(t('sidebar.backToHa'), <ChevronLeft className="h-4 w-4" />, onExit)}
          <button
            type="button"
            onClick={onOpenAutomationImport}
            title={t('buttons.openAutomation')}
            className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 font-semibold text-sm hover:border-foreground/30"
          >
            <FolderOpen className="h-4 w-4" />
            {t('sidebar.open')}
          </button>
          {/* The app's name is in the header above; More sits at the right. */}
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {iconButton(t('sidebar.more'), <MoreHorizontal className="h-4 w-4" />)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {automationItems}
              <DropdownMenuSeparator />
              {overviewItem}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {!rail && (
        <label className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-muted px-2.5 text-muted-foreground">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => {
              // The picker takes over the search at the first letter: its
              // own field opens with it and keeps the focus.
              const value = e.target.value;
              if (value.trim() === '') return setQuery(value);
              setQuery('');
              openSearch(value);
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            aria-label={t('sidebar.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-foreground text-sm outline-none"
          />
        </label>
      )}

      <div className={rail ? 'contents' : 'min-h-0 flex-1 overflow-y-auto px-2 pb-3'}>
        {/* Docked, the steps start the column: no divider above them. */}
        {!rail && sectionHead(t('sidebar.add'))}
        {addRows.map((a) => {
          const config = nodeConfig(a.type);
          return row({
            key: a.kind,
            // Home Assistant's own section names: When, And if, Then do.
            label: t(`nodes:picker.sectionNames.${a.kind}`),
            sub: t(`sidebar.subs.${a.kind}`),
            icon: a.icon,
            tone: config?.tone ?? a.type,
            onClick: a.open,
            onDragStart: config ? (e) => onDragStart(e, config) : undefined,
          });
        })}
        {sectionHead(t('nodes:picker.sections.blocks'))}
        {BLOCK_GROUPS.map(({ group, entries }) => (
          <div key={group} className={rail ? 'contents' : undefined}>
            {!rail && (
              <div className="px-2 pt-2.5 pb-0.5 text-[13px] text-muted-foreground">
                {t(`sidebar.groups.${group}`)}
              </div>
            )}
            {entries.map(blockRow)}
          </div>
        ))}
      </div>

      {/* Docked, the menu button closes the column, under a divider. */}
      {rail && sectionHead('')}
      {rail && dockMenu}

      {!rail && (
        <div className="flex items-center gap-1 border-t px-3 py-2 text-muted-foreground text-xs">
          {statusDot}
          <span className={cn('min-w-0 flex-1 truncate', status?.error && 'text-destructive')}>
            {status?.error ?? [status?.text, version && `v${version}`].filter(Boolean).join(' · ')}
          </span>
          {onToggleRail &&
            iconButton(t('sidebar.collapse'), <PanelLeftClose className="h-4 w-4" />, onToggleRail)}
          <Popover>
            <PopoverTrigger asChild>
              {iconButton(t('labels.quickHelp'), <HelpCircle className="h-4 w-4" />)}
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-64 text-sm">
              {quickHelp}
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
