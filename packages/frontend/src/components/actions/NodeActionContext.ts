import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/store/flow-store';

/**
 * Context provided to action handlers
 */
export interface NodeActionContext {
  selectedNodes: Node<FlowNodeData>[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  clipboard: string | null;
  pasteCount: number;
  addNode: (node: Node<FlowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  /** Re-runs per-node validation (duplicate `data.id`, missing required fields, ...) across the whole graph — called after Paste/Duplicate, whose cloned nodes carry over their source's `data.id` unchanged and would otherwise show as valid until some unrelated edit happens to re-trigger validation. */
  validateAllNodes: () => void;
  setClipboard: (data: string | null) => void;
  setPasteCount: (count: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}
