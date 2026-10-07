import type { Edge } from '@xyflow/react';
import {
  Clipboard,
  Copy,
  CopyPlus,
  Pencil,
  Play,
  Replace,
  Scissors,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getCopyAction,
  getCutAction,
  getDeleteAction,
  getDuplicateAction,
  getPasteAction,
  getRunAction,
} from '@/components/actions';
import { NameDialog } from '@/components/ui/name-dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { NodeActionContext } from '@/components/actions';
import { useNodeActionContext } from '@/hooks/useNodeActionContext';
import { connectedFlow, replacePicker } from '@/lib/canvasEdits';
import { showSuccessToast } from '@/lib/haToast';
import { getLoopStructure } from '@/lib/loop-structure';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

/**
 * What was right-clicked, in viewport (client) coordinates — same
 * coordinate space `MouseEvent.clientX/clientY` uses, so no flow-position
 * conversion is needed to place the menu.
 */
export type ContextMenuTarget =
  | { kind: 'node'; screenX: number; screenY: number; nodeId: string }
  | { kind: 'edge'; screenX: number; screenY: number; edge: Edge }
  | { kind: 'pane'; screenX: number; screenY: number }
  /** The nodes a right-drag box selected (FlowCanvas.tsx). */
  | { kind: 'selection'; screenX: number; screenY: number };

/** The steps that take a name of their own (HA's `alias`). */
const RENAMEABLE: ReadonlySet<string> = new Set([
  'trigger',
  'condition',
  'action',
  'delay',
  'wait',
  'set_variables',
]);

interface CanvasContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
}

interface MenuItem {
  key: string;
  label: string;
  icon: typeof Copy;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Right-click menu for the canvas — Copy/Cut/Paste/Delete on a node or a
 * connecting line, plus a bare Paste on empty canvas. Nodes reuse the exact
 * same actions the persistent floating toolbar (NodeToolbar.tsx) runs, via
 * useNodeActionContext.ts, so both surfaces stay in lockstep.
 *
 * Lines get their own logic here rather than reusing NodeAction: a regular
 * connecting line's Copy/Cut/Delete operate on just that line, but a Repeat
 * While/Until loop-back line's operate on the *entire loop structure* (its
 * condition node, every node in its body, and every edge among them) — per
 * explicit user request ("delete should work but we are deleting the entire
 * loop structure not just the line or the nodes themselves"). See
 * lib/loop-structure.ts.
 *
 * Built on the same Popover + PopoverAnchor combo QuickAddMenu.tsx uses
 * (zero-size, `position: fixed` anchor div at the click point, no real
 * trigger element) rather than a hand-rolled `position: fixed` div with
 * manual outside-click/Escape/portal handling. That manual version rendered
 * and positioned itself correctly but its Copy/Cut/Paste/Delete clicks
 * didn't register — Radix's Popover already solves portaling, dismiss-on-
 * outside-click/Escape, and focus handling correctly inside Circuitry's
 * shadow-root/HA-panel embedding (every other floating surface in the app
 * uses it), so reusing it outright removes the custom event-handling code
 * that was the likely source of the bug rather than trying to debug it
 * further blind.
 */
export function CanvasContextMenu({ target, onClose }: CanvasContextMenuProps) {
  const { t } = useTranslation(['common']);
  const nodeActionContext = useNodeActionContext();
  const {
    nodes,
    edges,
    canDeleteEdge,
    removeEdge,
    removeNodes,
    setClipboard,
    setPasteCount,
    onNodesChange,
    requestNodeEdit,
  } = useFlowStore();

  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  // The step being renamed (its alias), asked in a dialog after the menu closes.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renaming = nodes.find((n) => n.id === renamingId);

  const items: MenuItem[] = [];

  if (target?.kind === 'node') {
    // Built from `target.nodeId` directly rather than trusting
    // `nodeActionContext.selectedNodes` as-is: FlowCanvas.tsx's
    // onNodeContextMenu selects the right-clicked node via the store's
    // setNodes *before* opening this menu, but that's a separate render
    // from this one, and relying on it staying in sync was fragile (it's
    // what caused right-click Delete to silently no-op — the target node
    // wasn't reliably marked `.selected` yet by the time these actions were
    // built). Looking the node up by id and only falling back to the wider
    // selection when it's *already* part of one is correct regardless of
    // that timing.
    const targetNode = nodes.find((n) => n.id === target.nodeId);
    const actingNodes = targetNode
      ? targetNode.selected
        ? nodes.filter((n) => n.selected)
        : [targetNode]
      : [];
    const scopedContext = { ...nodeActionContext, selectedNodes: actingNodes };

    const runAction = getRunAction(t);
    const replaceable =
      actingNodes.length === 1 && targetNode && replacePicker(targetNode.type) !== null;
    if (targetNode && replaceable) {
      items.push({
        key: 'replace',
        label: t('contextMenu.replace'),
        icon: Replace,
        onSelect: () => requestNodeEdit('replace', targetNode.id),
      });
    }
    if (targetNode && actingNodes.length === 1 && RENAMEABLE.has(targetNode.type ?? '')) {
      items.push({
        key: 'rename',
        label: t('contextMenu.rename'),
        icon: Pencil,
        onSelect: () => setRenamingId(targetNode.id),
      });
    }
    items.push({
      key: 'run',
      label: t('toolbar.runAction'),
      icon: Play,
      disabled: !runAction.isEnabled?.(scopedContext),
      onSelect: () => runAction.execute(scopedContext),
    });
    items.push(...clipboardItems(scopedContext));
    items.push(pasteItem());
    items.push({
      key: 'select-flow',
      label: t('contextMenu.selectFlow'),
      icon: Workflow,
      disabled: actingNodes.length === 0,
      onSelect: () => selectFlowOf(actingNodes.map((n) => n.id)),
    });
    items.push(deleteItem(scopedContext));
  } else if (target?.kind === 'edge') {
    const edge = target.edge;
    const isLoop = edge.type === 'loop-back';
    const isDeletable = isLoop || canDeleteEdge(edge.id);

    items.push(
      {
        key: 'copy',
        label: t('toolbar.copy'),
        icon: Copy,
        disabled: !isDeletable,
        onSelect: () => copyEdge(edge, isLoop),
      },
      {
        key: 'cut',
        label: t('toolbar.cut'),
        icon: Scissors,
        disabled: !isDeletable,
        onSelect: () => cutEdge(edge, isLoop),
      }
    );
    items.push(pasteItem());
    items.push({
      key: 'delete',
      label: t(isLoop ? 'toolbar.deleteLoop' : 'toolbar.deleteEdge'),
      icon: Trash2,
      destructive: true,
      disabled: !isDeletable,
      onSelect: () => deleteEdge(edge, isLoop),
    });
  } else if (target?.kind === 'selection') {
    const selectionContext = {
      ...nodeActionContext,
      selectedNodes: nodes.filter((n) => n.selected),
    };
    items.push(...clipboardItems(selectionContext), deleteItem(selectionContext));
  } else if (target) {
    items.push(pasteItem());
  }

  /** Duplicate, Copy and Cut, on the nodes `context` names. */
  function clipboardItems(context: NodeActionContext): MenuItem[] {
    const duplicateAction = getDuplicateAction(t);
    const copyAction = getCopyAction(t);
    const cutAction = getCutAction(t);
    return [
      {
        key: 'duplicate',
        label: t('toolbar.duplicate'),
        icon: CopyPlus,
        disabled: !duplicateAction.isEnabled?.(context),
        onSelect: () => duplicateAction.execute(context),
      },
      {
        key: 'copy',
        label: t('toolbar.copy'),
        icon: Copy,
        disabled: !copyAction.isEnabled?.(context),
        onSelect: () => copyAction.execute(context),
      },
      {
        key: 'cut',
        label: t('toolbar.cut'),
        icon: Scissors,
        disabled: !cutAction.isEnabled?.(context),
        onSelect: () => cutAction.execute(context),
      },
    ];
  }

  function deleteItem(context: NodeActionContext): MenuItem {
    const deleteAction = getDeleteAction(t);
    return {
      key: 'delete',
      label: t('toolbar.deleteNode'),
      icon: Trash2,
      destructive: true,
      disabled: !deleteAction.isEnabled?.(context),
      onSelect: () => deleteAction.execute(context),
    };
  }

  /** Selects every step linked to these, the flows they belong to. A
   * selection change only: not an edit, so not unsaved work. (FlowCanvas's
   * onSelectionChange keeps selectedNodeId in step.) */
  function selectFlowOf(nodeIds: string[]) {
    const flow = new Set<string>();
    for (const id of nodeIds) for (const member of connectedFlow(id, edges)) flow.add(member);
    onNodesChange(nodes.map((n) => ({ type: 'select', id: n.id, selected: flow.has(n.id) })));
  }

  function pasteItem(): MenuItem {
    const pasteAction = getPasteAction(t);
    return {
      key: 'paste',
      label: t('toolbar.paste'),
      icon: Clipboard,
      disabled: !pasteAction.isEnabled?.(nodeActionContext),
      onSelect: () => pasteAction.execute(nodeActionContext),
    };
  }

  function buildEdgeClipboardPayload(edge: Edge) {
    if (edge.type === 'loop-back') {
      const { nodeIds, edgeIds } = getLoopStructure(edge, edges);
      return {
        nodes: nodes.filter((n) => nodeIds.has(n.id)),
        edges: edges.filter((e) => edgeIds.has(e.id)),
        isLoop: true,
      };
    }
    return { nodes: [], edges: [edge], isLoop: false };
  }

  function copyEdge(edge: Edge, isLoop: boolean) {
    const payload = buildEdgeClipboardPayload(edge);
    setClipboard(JSON.stringify({ nodes: payload.nodes, edges: payload.edges }));
    setPasteCount(0);
    showSuccessToast(t(isLoop ? 'contextMenu.loopCopied' : 'contextMenu.connectionCopied'));
  }

  function cutEdge(edge: Edge, isLoop: boolean) {
    const payload = buildEdgeClipboardPayload(edge);
    setClipboard(JSON.stringify({ nodes: payload.nodes, edges: payload.edges }));
    setPasteCount(0);
    if (isLoop) {
      removeNodes(payload.nodes.map((n) => n.id));
    } else {
      removeEdge(edge.id);
    }
    showSuccessToast(t(isLoop ? 'contextMenu.loopCut' : 'contextMenu.connectionCut'));
  }

  function deleteEdge(edge: Edge, isLoop: boolean) {
    if (isLoop) {
      const { nodeIds } = getLoopStructure(edge, edges);
      removeNodes([...nodeIds]);
      showSuccessToast(t('contextMenu.loopDeleted'));
    } else {
      if (!canDeleteEdge(edge.id)) return;
      removeEdge(edge.id);
    }
  }

  return (
    <>
      <Popover
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        {target && (
          <>
            <PopoverAnchor asChild>
              <div
                style={{
                  position: 'fixed',
                  left: target.screenX,
                  top: target.screenY,
                  width: 0,
                  height: 0,
                }}
              />
            </PopoverAnchor>
            <PopoverContent
              className="w-auto min-w-40 p-1"
              align="start"
              sideOffset={4}
              onContextMenu={(event) => event.preventDefault()}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    item.onSelect();
                    onClose();
                  }}
                  className={cn(
                    'flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors',
                    'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
                    item.destructive && 'text-destructive hover:text-destructive'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              ))}
            </PopoverContent>
          </>
        )}
      </Popover>
      <NameDialog
        open={renaming !== undefined}
        onOpenChange={(open) => {
          if (!open) setRenamingId(null);
        }}
        title={t('contextMenu.renameTitle')}
        description={t('contextMenu.renameDescription')}
        label={t('contextMenu.renameLabel')}
        placeholder={t('placeholders.optionalDisplayName')}
        initialName={typeof renaming?.data.alias === 'string' ? renaming.data.alias : ''}
        allowEmpty
        onSave={(name) => {
          if (renaming) updateNodeData(renaming.id, { alias: name || undefined });
          setRenamingId(null);
        }}
      />
    </>
  );
}
