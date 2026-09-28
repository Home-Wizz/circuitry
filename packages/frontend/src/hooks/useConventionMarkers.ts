import { type ConventionMarkers, conventionMarkers } from '@circuitry/transpiler';
import { useFlowStore } from '@/store/flow-store';

/**
 * What the transpiler reads from the graph's shape, for the
 * nodes to show (`ConventionMarkers.tsx`). Worked out once per change to
 * the graph's nodes or edges, not per node or per drag frame: positions
 * don't change the reading, so the key is the edges and each node's id,
 * type and data.
 */
let cached: {
  edges: unknown;
  nodesRef: unknown;
  nodes: unknown[];
  value: ConventionMarkers;
} | null = null;

const EMPTY: ConventionMarkers = { listMembers: {}, pathEnds: [] };

function markersFor(state: ReturnType<typeof useFlowStore.getState>): ConventionMarkers {
  const { nodes, edges, toFlowGraph } = state;
  // Every node asks on every store change: the same arrays answer at once.
  if (cached && cached.edges === edges && cached.nodesRef === nodes) return cached.value;
  const nodeKey = nodes.flatMap((n) => [n.id, n.type, n.data]);
  if (
    cached &&
    cached.edges === edges &&
    cached.nodes.length === nodeKey.length &&
    cached.nodes.every((v, i) => v === nodeKey[i])
  ) {
    cached.nodesRef = nodes;
    return cached.value;
  }
  let value = EMPTY;
  try {
    value = conventionMarkers(toFlowGraph());
  } catch {
    // A graph half-way through an edit: nothing to show until it reads.
  }
  cached = { edges, nodesRef: nodes, nodes: nodeKey, value };
  return value;
}

export interface NodeConventionMarkers {
  /** A list member: the id of its list's first condition. */
  listHead?: string;
  /** The handles where a path ends and stops the automation: 'true' /
   * 'false' for a condition, 'out' for a step. */
  stopsAt: ('true' | 'false' | 'out')[];
}

export function useConventionMarkers(nodeId: string): NodeConventionMarkers {
  // One string per node, so a node re-renders only when its own markers
  // change (a drag re-reads the cache, it doesn't re-render every node).
  const key = useFlowStore((s) => {
    const markers = markersFor(s);
    const stops = markers.pathEnds.filter((p) => p.nodeId === nodeId).map((p) => p.handle ?? 'out');
    return `${markers.listMembers[nodeId] ?? ''}\u0000${stops.join(',')}`;
  });
  const [listHead, stops] = key.split('\u0000');
  return {
    listHead: listHead || undefined,
    stopsAt: stops
      .split(',')
      .filter((h): h is 'true' | 'false' | 'out' => h === 'true' || h === 'false' || h === 'out'),
  };
}
