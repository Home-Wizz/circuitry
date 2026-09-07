import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '@/store/flow-store';
import { useUndoRedo } from './useUndoRedo';
import type { NodeActionContext } from '@/components/actions';

/**
 * Builds the `NodeActionContext` every Copy/Cut/Paste/Delete-style action
 * (components/actions/*) needs to run — nodes/edges/clipboard state plus the
 * store mutators and undo/redo. Shared by NodeToolbar.tsx (the persistent
 * floating toolbar) and CanvasContextMenu.tsx (the right-click menu) so both
 * surfaces drive the exact same action implementations rather than each
 * assembling their own copy of this object, per CLAUDE.md's DRY rule.
 */
export function useNodeActionContext(): NodeActionContext {
  const {
    nodes,
    edges,
    clipboard,
    pasteCount,
    addNode,
    removeNode,
    updateNodeData,
    setNodes,
    setEdges,
    validateAllNodes,
    setClipboard,
    setPasteCount,
  } = useFlowStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      clipboard: s.clipboard,
      pasteCount: s.pasteCount,
      addNode: s.addNode,
      removeNode: s.removeNode,
      updateNodeData: s.updateNodeData,
      setNodes: s.setNodes,
      setEdges: s.setEdges,
      validateAllNodes: s.validateAllNodes,
      setClipboard: s.setClipboard,
      setPasteCount: s.setPasteCount,
    }))
  );
  const { undo, redo, canUndo, canRedo } = useUndoRedo();

  return useMemo(
    () => ({
      selectedNodes: nodes.filter((n) => n.selected),
      nodes,
      edges,
      clipboard,
      pasteCount,
      addNode,
      removeNode,
      updateNodeData,
      setNodes,
      setEdges,
      validateAllNodes,
      setClipboard,
      setPasteCount,
      undo,
      redo,
      canUndo,
      canRedo,
    }),
    [
      nodes,
      edges,
      clipboard,
      pasteCount,
      addNode,
      removeNode,
      updateNodeData,
      setNodes,
      setEdges,
      validateAllNodes,
      setClipboard,
      setPasteCount,
      undo,
      redo,
      canUndo,
      canRedo,
    ]
  );
}
