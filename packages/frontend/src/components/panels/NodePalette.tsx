import { ChevronDown, DiamondPlus, FileCode, FolderOpenDotIcon, PlusSquare } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  type CompoundTypeConfig,
  compoundGroupOrder,
  compoundTypes,
  type NodeTypeConfig,
  nodeTypes,
} from '@/config/nodeTypeCatalog';
import { useAddNodeAtCenter } from '@/hooks/useAddNodeAtCenter';
import { useAddNodeDialogs } from '@/hooks/useAddNodeDialogs';
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
}

export function NodePalette({ onOpenAutomationImport, onOpenImportYaml }: NodePaletteProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const { addNodeAtCenter, addCompoundAtCenter } = useAddNodeAtCenter();
  const { openWhen, openAnd, openThen, openThenForWait, openAndForNode, openThenForNode, dialogs } =
    useAddNodeDialogs();
  const reset = useFlowStore((s) => s.reset);
  const openInNewTab = useFlowStore((s) => s.openInNewTab);
  // Purely local to this dropdown's own open/closed chevron state — nothing
  // else in the app needs to know or control it (unlike automationImportOpen/
  // importYamlOpen, which gate the actual dialogs mounted up in App.tsx).
  const [importDropdownOpen, setImportDropdownOpen] = useState(false);

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
    if (kind === 'condition') openAndForNode(nodeId);
    else openThenForNode(nodeId);
  }, [nodeEditRequest, clearNodeEditRequest, openAndForNode, openThenForNode]);

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

  return (
    <div className="space-y-2 p-4">
      {/* Open Automation — moved here from the top-right header per explicit
          user request, replacing the "+Add" node-menu toolbar (CanvasAddMenu)
          that used to live in this exact spot. Nodes are still added via the
          Trigger/Condition/Action/... buttons below (and the compound-block
          buttons further down) — CanvasAddMenu was always a *second*,
          redundant way to reach the same When/And/Then dialogs (see its own
          doc comment), so nothing is lost by dropping it here. */}
      <div className="flex">
        <Button onClick={onOpenAutomationImport} className="flex-1 rounded-r-none">
          <FolderOpenDotIcon className="mr-2 h-4 w-4" />
          {t('buttons.openAutomation')}
        </Button>
        <DropdownMenu open={importDropdownOpen} onOpenChange={setImportDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="default" className="rounded-l-none border-l px-2">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {dialogs}
      <Separator className="my-3" />

      <h3 className="mb-3 font-semibold text-muted-foreground text-sm">{t('labels.addNode')}</h3>
      <div className="space-y-2">
        {nodeTypes.map((config) => (
          <Button
            key={config.type}
            variant="outline"
            onClick={() => handleAddNode(config)}
            onDragStart={(e) => onDragStart(e, config)}
            draggable
            className={cn(
              'h-auto w-full justify-start gap-3 py-3',
              'cursor-grab transition-colors active:cursor-grabbing',
              config.color
            )}
          >
            {/* A neutral translucent chip, not config.badgeColor (bg-{token}
                text-{token}-foreground) — now that the button itself is a
                solid token color (see node-colors.ts's `palette`, updated
                per user request to drop the washed-out bg-{token}/10 look),
                the badge would be invisible against a same-colored button.
                This overlay still frames the icon without fighting the
                button's own solid fill. */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/15">
              <config.icon className="h-4 w-4" />
            </span>
            <span className="font-medium text-sm">{t(config.labelKey)}</span>
          </Button>
        ))}
      </div>

      <Separator className="my-3" />

      <h3 className="mb-3 font-semibold text-muted-foreground text-sm">
        {t('nodes:compoundBlocks.sectionLabel')}
      </h3>
      <div className="space-y-3">
        {compoundGroupOrder.map((group) => {
          const items = compoundTypes.filter((c) => c.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="space-y-2">
              <h4 className="px-1 font-medium text-muted-foreground/70 text-xs uppercase tracking-wide">
                {t(`nodes:compoundBlocks.groups.${group}`)}
              </h4>
              {items.map((config) => (
                <Button
                  key={config.key}
                  variant="outline"
                  onClick={() => handleAddCompound(config)}
                  onDragStart={(e) => onDragStartCompound(e, config)}
                  draggable
                  className={cn(
                    'h-auto w-full justify-start gap-3 py-3',
                    'cursor-grab transition-colors active:cursor-grabbing',
                    config.color
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/15">
                    <config.icon className="h-4 w-4" />
                  </span>
                  <span className="font-medium text-sm">{t(config.labelKey)}</span>
                </Button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
