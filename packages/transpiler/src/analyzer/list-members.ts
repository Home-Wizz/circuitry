import type { FlowEdge, FlowGraph } from '@circuitry/shared';
import { findBackEdges } from './topology';

/**
 * The list convention, for whoever needs to know which conditions are
 * chained into a list: the canvas (it shows them) and
 * analyzer/condition-meetings.ts. A plain condition (no `_blockKey`) is a
 * member of the list of the condition before it when its one way in is
 * that condition's only "yes" edge (#110; so the list's else never leads
 * to it -- where the branches meet is not a member, #26) and its own "no"
 * edges (if any) go exactly where the list's else does (#51). The
 * strategies and gates each read the same rule themselves; the
 * convention table (convention-list-members.test.ts) holds them all to
 * it, this reading included.
 *
 * Returns member id -> the id of its list's first condition.
 */
export function listHeads(flow: FlowGraph): Map<string, string> {
  const backEdges = findBackEdges(flow);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const out = new Map<string, FlowEdge[]>();
  const into = new Map<string, FlowEdge[]>();
  for (const e of flow.edges) {
    if (e.type === 'hint' || e.type === 'choose-hint' || backEdges.has(e.id)) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    into.set(e.target, [...(into.get(e.target) ?? []), e]);
  }
  const targets = (id: string, handle: string) =>
    (out.get(id) ?? []).filter((e) => e.sourceHandle === handle).map((e) => e.target);
  const sameIds = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));
  /** Where the list up to `id` goes when it fails: the nearest "no" edges
   * up the chain. `seen` guards against a cycle of "yes" edges. */
  const elseOf = (id: string, seen: Set<string>): string[] => {
    const own = targets(id, 'false');
    if (own.length > 0) return own;
    const parent = parentOf(id, seen);
    return parent ? elseOf(parent, seen) : [];
  };
  /** The condition whose list `id` is chained into, or null. */
  const parentOf = (id: string, seen: Set<string>): string | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    const node = nodes.get(id);
    if (node?.type !== 'condition') return null;
    if (typeof (node.data as Record<string, unknown>)._blockKey === 'string') return null;
    const ways = into.get(id) ?? [];
    if (ways.length !== 1 || ways[0].sourceHandle !== 'true') return null;
    const parent = ways[0].source;
    if (nodes.get(parent)?.type !== 'condition' || targets(parent, 'true').length !== 1) {
      return null;
    }
    const listElse = elseOf(parent, new Set(seen));
    const own = targets(id, 'false');
    if (own.length > 0 && !sameIds(own, listElse)) return null;
    return parent;
  };
  const heads = new Map<string, string>();
  for (const node of flow.nodes) {
    let head = parentOf(node.id, new Set());
    if (head === null) continue;
    const climbed = new Set([node.id]);
    for (let up = parentOf(head, new Set(climbed)); up !== null && !climbed.has(up); ) {
      climbed.add(head);
      head = up;
      up = parentOf(head, new Set(climbed));
    }
    heads.set(node.id, head);
  }
  return heads;
}
