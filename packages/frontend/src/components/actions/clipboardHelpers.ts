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

const isTriggeredBy = (node: Node<FlowNodeData>) =>
  node.type === 'condition' && node.data.condition === 'trigger';

/** An id not taken yet: the id itself, else with _2, _3, ... */
function freshId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  let n = 2;
  while (taken.has(`${id}_${n}`)) n++;
  return `${id}_${n}`;
}

/** A condition's data with the "Triggered by" ids it names (its own and its
 * sub-conditions') renamed. */
function renameTriggerRefs(
  data: Record<string, unknown>,
  renamed: ReadonlyMap<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (data.condition === 'trigger') {
    const rename = (id: unknown) => (typeof id === 'string' ? (renamed.get(id) ?? id) : id);
    out.id = Array.isArray(data.id) ? data.id.map(rename) : rename(data.id);
  }
  if (Array.isArray(data.conditions)) {
    out.conditions = data.conditions.map((sub) =>
      sub && typeof sub === 'object' && !Array.isArray(sub)
        ? renameTriggerRefs(sub as Record<string, unknown>, renamed)
        : sub
    );
  }
  return out;
}

/**
 * The copies' data (#164): a copied step's `id:` is kept unless the canvas
 * already has it, in which case the copy gets a fresh one (an id must be
 * unique in an automation), and a copied "Triggered by" condition follows a
 * copied trigger that was renamed, so a duplicated flow tests its own
 * trigger rather than the original's. A "Triggered by" naming a trigger
 * that wasn't copied keeps it.
 */
export function cloneStepData(
  sourceNodes: Node<FlowNodeData>[],
  canvasNodes: Node<FlowNodeData>[]
): Map<string, FlowNodeData> {
  const taken = new Set<string>();
  for (const node of canvasNodes) {
    const id = node.data.id;
    if (!isTriggeredBy(node) && typeof id === 'string' && id.trim() !== '') taken.add(id);
  }
  const ownIds = new Map<string, string>();
  const renamedTriggers = new Map<string, string>();
  for (const node of sourceNodes) {
    const id = node.data.id;
    if (isTriggeredBy(node) || typeof id !== 'string' || id.trim() === '') continue;
    const fresh = freshId(id, taken);
    taken.add(fresh);
    ownIds.set(node.id, fresh);
    if (fresh !== id && node.type === 'trigger') renamedTriggers.set(id, fresh);
  }
  const out = new Map<string, FlowNodeData>();
  for (const node of sourceNodes) {
    const data = renameTriggerRefs(node.data as Record<string, unknown>, renamedTriggers);
    const own = ownIds.get(node.id);
    if (own !== undefined) data.id = own;
    out.set(node.id, data as FlowNodeData);
  }
  return out;
}

/** The space left between the originals and their duplicates. */
const BESIDE_GAP = 80;
/** A node's width before React Flow has measured it. */
const DEFAULT_NODE_WIDTH = 240;

/** The offset that places copies of `nodes` just right of them, clear of
 * the whole selection. */
export function besideOffset(nodes: readonly Node<FlowNodeData>[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH;
    left = Math.min(left, node.position.x);
    right = Math.max(right, node.position.x + width);
  }
  return { x: right - left + BESIDE_GAP, y: 0 };
}

/**
 * Clones a set of nodes and their connecting edges into the canvas.
 * Deselects existing nodes and selects the new clones. Placed `offset` from
 * the originals; by default a progressive offset based on the paste count.
 */
export function cloneNodesIntoCanvas(
  sourceNodes: Node<FlowNodeData>[],
  sourceEdges: Edge[],
  context: NodeActionContext,
  placement?: { x: number; y: number }
): void {
  const currentPasteCount = (context.pasteCount || 0) + 1;
  if (!placement) context.setPasteCount(currentPasteCount);
  const offset = placement ?? { x: 50 * currentPasteCount, y: 50 * currentPasteCount };
  const clonedData = cloneStepData(sourceNodes, context.nodes);

  const nodeIdMap = new Map<string, string>();

  const deselectedNodes = context.nodes.map((n) => ({ ...n, selected: false }));

  const newNodes = sourceNodes.map((n) => {
    const newId = generateNodeId(n.type ?? 'node');
    nodeIdMap.set(n.id, newId);
    return {
      ...n,
      selected: true,
      id: newId,
      data: clonedData.get(n.id) ?? n.data,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
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

  // Validated at once, as addNode/addCompound are: a copy can still carry
  // issues of its own (an empty required field), and the whole graph's
  // checks see the new nodes.
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
    const candidate = {
      ...edge,
      id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    if (isDuplicate(candidate, [...context.edges, ...newEdges])) continue;
    newEdges.push(candidate);
  }
  if (newEdges.length > 0) {
    context.setEdges([...context.edges, ...newEdges]);
  }
}
