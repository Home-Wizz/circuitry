import type { FlowEdge, FlowGraph, FlowMetadata, FlowNode, FlowWorkspace } from '@circuitry/shared';
import { generateUUID } from '@/lib/utils';

export interface MergeAutomationSource {
  graph: FlowGraph;
  automationId: string;
  entityId: string;
  alias: string;
  importedAt?: string;
}

interface GraphBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function calculateBounds(nodes: FlowNode[]): GraphBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x);
    maxY = Math.max(maxY, node.position.y);
  }

  return {
    minX,
    minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function sanitizeSourcePrefix(input: string, index: number): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const base = normalized || `source_${index + 1}`;
  return `${base}_${index + 1}`;
}

function mergeUserVariables(
  sources: Array<{ prefix: string; variables?: Record<string, unknown> }>
): Record<string, unknown> | undefined {
  const mergedVariables: Record<string, unknown> = {};

  for (const source of sources) {
    if (!source.variables) {
      continue;
    }

    for (const [key, value] of Object.entries(source.variables)) {
      if (!(key in mergedVariables)) {
        mergedVariables[key] = value;
        continue;
      }

      if (JSON.stringify(mergedVariables[key]) === JSON.stringify(value)) {
        continue;
      }

      mergedVariables[`${source.prefix}__${key}`] = value;
    }
  }

  return Object.keys(mergedVariables).length > 0 ? mergedVariables : undefined;
}

export function mergeAutomationGraphs(sources: MergeAutomationSource[]): FlowGraph {
  if (sources.length < 2) {
    throw new Error('At least two automations are required for merge.');
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(sources.length)));
  const boundsPerSource = sources.map((source) => calculateBounds(source.graph.nodes));
  const maxWidth = Math.max(...boundsPerSource.map((bounds) => bounds.width), 0);
  const maxHeight = Math.max(...boundsPerSource.map((bounds) => bounds.height), 0);
  const cellWidth = maxWidth + 260;
  const cellHeight = maxHeight + 220;

  const mergedNodes: FlowNode[] = [];
  const mergedEdges: FlowEdge[] = [];
  const workspaceSources: FlowWorkspace['sources'] = [];
  const prefixedVariableSources: Array<{ prefix: string; variables?: Record<string, unknown> }> =
    [];

  sources.forEach((source, index) => {
    const prefix = sanitizeSourcePrefix(
      source.alias || source.automationId || source.entityId,
      index
    );
    const bounds = boundsPerSource[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = col * cellWidth;
    const offsetY = row * cellHeight;

    const nodeIdMap = new Map<string, string>();
    // Tracks how many times each ORIGINAL node id has been seen within this
    // one source so far. A source graph with two nodes sharing the same id
    // is already malformed (e.g. a decompiled/imported automation that
    // never passed through the frontend's own duplicate-id validation --
    // findDuplicateIdErrors in flow-store.ts), and an edge referencing that
    // id is inherently ambiguous about which of the two it meant -- merge
    // can't resolve that ambiguity for the caller. What merge CAN and must
    // guarantee on its own, though, is that it never introduces a NEW bug
    // on top of that: found via the automation-merge fuzzer (round 2,
    // 2026-09-06), the old code always emitted `${prefix}__${node.id}` with
    // no disambiguation, so a source with duplicate node ids produced two
    // DISTINCT merged nodes sharing the exact same merged id -- silent
    // node-id collisions in the OUTPUT graph (React Flow node lookups,
    // property-panel selection, and the transpiler's own node map all key
    // strictly by id) that never existed in the input, one layer worse than
    // the source's own ambiguity. Every node still after the first
    // occurrence of a given original id gets a `__dupN` suffix so merged
    // ids stay unique; the first occurrence keeps the exact prior format
    // (`${prefix}__${node.id}`, no suffix) so this is a no-op for every
    // well-formed source, which is the overwhelming common case.
    const originalIdOccurrences = new Map<string, number>();

    for (const node of source.graph.nodes) {
      const occurrence = originalIdOccurrences.get(node.id) ?? 0;
      originalIdOccurrences.set(node.id, occurrence + 1);
      const nextNodeId =
        occurrence === 0 ? `${prefix}__${node.id}` : `${prefix}__${node.id}__dup${occurrence}`;
      // Map lookups (used by edges below) always resolve an original id to
      // the LAST-seen node carrying it -- an arbitrary but deterministic
      // choice for an already-ambiguous input, consistent with the map's
      // prior single-slot-per-key behavior.
      nodeIdMap.set(node.id, nextNodeId);
      mergedNodes.push({
        ...node,
        id: nextNodeId,
        position: {
          x: node.position.x - bounds.minX + offsetX,
          y: node.position.y - bounds.minY + offsetY,
        },
      });
    }

    for (const edge of source.graph.edges) {
      const sourceId = nodeIdMap.get(edge.source);
      const targetId = nodeIdMap.get(edge.target);
      if (!sourceId || !targetId) {
        continue;
      }

      mergedEdges.push({
        ...edge,
        id: `${prefix}__${edge.id}`,
        source: sourceId,
        target: targetId,
      });
    }

    workspaceSources.push({
      automation_id: source.automationId,
      entity_id: source.entityId,
      alias: source.alias,
      node_prefix: prefix,
      imported_at: source.importedAt ?? new Date().toISOString(),
    });

    prefixedVariableSources.push({
      prefix,
      variables: source.graph.userVariables,
    });
  });

  const baseMetadata: FlowMetadata = {
    mode: 'single',
    initial_state: true,
    ...(sources[0]?.graph.metadata || {}),
  };

  return {
    id: generateUUID(),
    name: 'Merged Automation',
    description: `Merged from ${sources.length} automations`,
    nodes: mergedNodes,
    edges: mergedEdges,
    metadata: baseMetadata,
    version: 1,
    workspace: {
      mode: 'merged',
      sources: workspaceSources,
    },
    userVariables: mergeUserVariables(prefixedVariableSources),
  };
}
