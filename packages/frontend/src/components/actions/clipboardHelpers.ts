import type { Edge, Node } from '@xyflow/react';
import { generateNodeId } from '@/lib/utils';
import type { FlowNodeData } from '@/store/flow-store';
import type { NodeActionContext } from './NodeActionContext';

/**
 * Copies the selected nodes and their connecting edges to the clipboard.
 * Resets the paste count so the next paste starts at offset 1.
 */
export function copyNodesToClipboard(context: NodeActionContext): void {
  const selectedNodeIds = context.selectedNodes.map((n) => n.id);
  const selectedEdges = context.edges.filter(
    (edge) => selectedNodeIds.includes(edge.source) && selectedNodeIds.includes(edge.target)
  );
  context.setClipboard(JSON.stringify({ nodes: context.selectedNodes, edges: selectedEdges }));
  context.setPasteCount(0);
}

/**
 * Clones a set of nodes and their connecting edges into the canvas.
 * Deselects existing nodes and selects the new clones.
 * Uses a progressive offset based on the paste count.
 */
export function cloneNodesIntoCanvas(
  sourceNodes: Node<FlowNodeData>[],
  sourceEdges: Edge[],
  context: NodeActionContext
): void {
  const currentPasteCount = (context.pasteCount || 0) + 1;
  context.setPasteCount(currentPasteCount);
  const offset = 50 * currentPasteCount;

  const nodeIdMap = new Map<string, string>();

  const deselectedNodes = context.nodes.map((n) => ({ ...n, selected: false }));

  const newNodes = sourceNodes.map((n) => {
    const newId = generateNodeId(n.type ?? 'node');
    nodeIdMap.set(n.id, newId);
    return {
      ...n,
      selected: true,
      id: newId,
      position: { x: n.position.x + offset, y: n.position.y + offset },
    };
  });

  context.setNodes([...deselectedNodes, ...newNodes]);

  if (sourceEdges.length > 0) {
    const newEdges = sourceEdges.map((edge) => ({
      ...edge,
      id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: nodeIdMap.get(edge.source) ?? edge.source,
      target: nodeIdMap.get(edge.target) ?? edge.target,
    }));
    context.setEdges([...context.edges, ...newEdges]);
  }

  // Each clone's `data` (including a real HA step `data.id`, if the source
  // node had one set) is carried over verbatim — only the node's own graph
  // id is regenerated above. A duplicate `data.id` wouldn't otherwise be
  // flagged until some unrelated edit happened to re-trigger validation
  // (unlike addNode/addCompound, which always validate immediately).
  context.validateAllNodes();
}

/**
 * Re-adds a connecting line copied on its own (right-click a line -> Copy,
 * with no nodes involved — see CanvasContextMenu.tsx) rather than pasting
 * new nodes. Reconnects each clipboard edge between its *original*
 * source/target ids: unlike node paste, there's nothing to offset or remap,
 * since the line's endpoints already exist on the canvas. Silently skips an
 * edge if either endpoint no longer exists, or if an identical connection
 * (same source/target/handles/type) is already present, so repeatedly
 * pasting a copied line into the same spot isn't a visible no-op that still
 * clutters the graph with literal duplicates.
 */
export function pasteEdgesOnly(sourceEdges: Edge[], context: NodeActionContext): void {
  const nodeIds = new Set(context.nodes.map((n) => n.id));
  const isDuplicate = (candidate: Edge, existing: Edge[]) =>
    existing.some(
      (e) =>
        e.source === candidate.source &&
        e.target === candidate.target &&
        e.sourceHandle === candidate.sourceHandle &&
        e.targetHandle === candidate.targetHandle &&
        e.type === candidate.type
    );

  const newEdges: Edge[] = [];
  for (const edge of sourceEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const candidate = { ...edge, id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
    if (isDuplicate(candidate, [...context.edges, ...newEdges])) continue;
    newEdges.push(candidate);
  }
  if (newEdges.length > 0) {
    context.setEdges([...context.edges, ...newEdges]);
  }
}
