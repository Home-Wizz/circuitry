import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { listHeads } from './list-members';
import { findBackEdges } from './topology';

/**
 * Bug #111 (2026-09-27; the Join node is the switch). Branches of one
 * fan-out that can each end before the step X they meet at:
 * - lines that just meet at X: X runs once if at least one path reaches it;
 * - a Join before X: X runs once every branch has finished, got there or
 *   not (the Join's own help text).
 * The two differ only when every branch can end before X.
 *
 * HA writes the first as an OR when each branch is only a test on the way
 * to X (a condition whose "yes" or "no" edge goes straight to X and whose
 * other side ends): `gateConditionMeetings` puts conditions in their place
 * -- an `or` of the "yes" sides' tests whose "yes" edge goes to X, and an
 * `and` of the "no" sides' tests whose "no" edge goes to X (one that can't
 * be evaluated gets there, as HA's if/else sends it; `not` would raise the
 * error, #128) -- and the strategies and gates read those like any other
 * condition. The same meeting where a branch does something before its
 * test can't be written in HA (a variable set in a parallel branch doesn't
 * reach the step after it), so `unwritableMeeting` finds it and
 * FlowTranspiler refuses the graph, pointing at the Join. A Join is left
 * alone: every strategy writes it as the parallel it is, followed by X.
 */
export function gateConditionMeetings(flow: FlowGraph): FlowGraph {
  let current = flow;
  for (let pass = 0; pass <= flow.edges.length; pass++) {
    const next = gateOne(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

type Ctx = {
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
  backEdges: Set<string>;
  /** Forward edges out of / into each node. */
  out: Map<string, FlowEdge[]>;
  into: Map<string, FlowEdge[]>;
};

function contextOf(flow: FlowGraph): Ctx {
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const out = new Map<string, FlowEdge[]>();
  const into = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (backEdges.has(e.id)) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    into.set(e.target, [...(into.get(e.target) ?? []), e]);
  }
  return { nodes: new Map(flow.nodes.map((n) => [n.id, n])), edges, backEdges, out, into };
}

const forwardOut = (ctx: Ctx, id: string) => ctx.out.get(id) ?? [];
const forwardIn = (ctx: Ctx, id: string) => ctx.into.get(id) ?? [];

/** The groups of forward edges out of a node that start branches together:
 * all of a step's edges, or one handle's edges of a condition. */
function fanOuts(ctx: Ctx, id: string): FlowEdge[][] {
  const out = forwardOut(ctx, id);
  const node = ctx.nodes.get(id);
  const groups =
    node?.type === 'condition'
      ? [
          out.filter((e) => e.sourceHandle === 'true'),
          out.filter((e) => e.sourceHandle === 'false'),
        ]
      : [out];
  return groups.filter((g) => g.length > 1);
}

/** What a branch that is only a test needs to get to the step it meets
 * at: its condition, and the side (its "yes" or "no" edge) that goes there. */
type Arrival = { test: Record<string, unknown>; side: 'true' | 'false' };

/** A branch that is only a test on the way to `meet`: a condition with one
 * way in, no loop edges, whose only edge goes straight to `meet` (its other
 * side ends there). Returns what it needs to get there, or null. */
function arrivalTest(ctx: Ctx, id: string, meet: string): Arrival | null {
  const node = ctx.nodes.get(id);
  if (node?.type !== 'condition') return null;
  if (forwardIn(ctx, id).length !== 1) return null;
  const out = ctx.edges.filter((e) => e.source === id);
  if (out.length !== 1 || out[0].target !== meet || ctx.backEdges.has(out[0].id)) return null;
  const test = Object.fromEntries(
    Object.entries(node.data as Record<string, unknown>).filter(([k]) => !k.startsWith('_'))
  );
  return { test, side: out[0].sourceHandle === 'false' ? 'false' : 'true' };
}

/** One condition from several: `kind` of them, or the one itself. */
const grouped = (kind: 'and' | 'or', tests: Record<string, unknown>[]): Record<string, unknown> =>
  tests.length === 1 ? tests[0] : { condition: kind, conditions: tests };

function gateOne(flow: FlowGraph): FlowGraph | null {
  const ctx = contextOf(flow);
  for (const source of flow.nodes) {
    for (const group of fanOuts(ctx, source.id)) {
      // Branches that are only tests, by the step they go to.
      const byMeet = new Map<string, ({ edge: FlowEdge } & Arrival)[]>();
      for (const edge of group) {
        const only = ctx.edges.filter((e) => e.source === edge.target);
        if (only.length !== 1) continue;
        const meet = only[0].target;
        const arrival = arrivalTest(ctx, edge.target, meet);
        if (!arrival) continue;
        byMeet.set(meet, [...(byMeet.get(meet) ?? []), { edge, ...arrival }]);
      }
      for (const [meet, branches] of byMeet) {
        if (branches.length < 2 || ctx.nodes.get(meet)?.type === 'join') continue;
        // Another way into X that always gets there makes X run anyway:
        // the tests then gate nothing, and the fan-out is left as drawn.
        if (forwardIn(ctx, meet).length !== branches.length) continue;
        const tests = new Set(branches.map((b) => b.edge.target));
        const first = ctx.nodes.get(branches[0].edge.target)!;
        const existing = new Set(flow.nodes.map((n) => n.id));
        const freshId = (base: string) => {
          let id = base;
          for (let i = 2; existing.has(id); i++) id = `${base}_${i}`;
          existing.add(id);
          return id;
        };
        const edgeIds = new Set(flow.edges.map((e) => e.id));
        const edge = (source: string, target: string, sourceHandle: 'true' | 'false') => {
          const id = uniqueId(`${source}__${sourceHandle}__${target}`, edgeIds);
          edgeIds.add(id);
          return { id, source, target, sourceHandle };
        };
        const gateNode = (id: string, data: Record<string, unknown>): FlowNode => ({
          id,
          type: 'condition',
          position: first.position,
          data,
        });
        // A "yes" side gets there when its test passes: an OR of those,
        // whose "yes" edge goes to X. A "no" side gets there when its test
        // fails or can't be evaluated, which `not` doesn't say (it raises
        // the error, #128): an AND of those, whose "no" edge goes to X --
        // HA's if/else sends an error there too. Both kinds: the OR first,
        // its "no" edge on to the AND.
        const yes = branches.filter((b) => b.side === 'true').map((b) => b.test);
        const no = branches.filter((b) => b.side === 'false').map((b) => b.test);
        const base = `${source.id}__meets__${meet}`;
        const gates: FlowNode[] = [];
        const gateEdges: ReturnType<typeof edge>[] = [];
        if (yes.length > 0) {
          gates.push(gateNode(freshId(base), grouped('or', yes)));
          gateEdges.push(edge(gates[0].id, meet, 'true'));
        }
        if (no.length > 0) {
          const id = freshId(yes.length > 0 ? `${base}__no` : base);
          if (gates.length > 0) gateEdges.push(edge(gates[0].id, id, 'false'));
          gates.push(gateNode(id, grouped('and', no)));
          gateEdges.push(edge(id, meet, 'false'));
        }
        const into = branches[0].edge;
        return {
          ...flow,
          nodes: [...flow.nodes.filter((n) => !tests.has(n.id)), ...gates],
          edges: [
            ...flow.edges.filter((e) => !tests.has(e.source) && !tests.has(e.target)),
            { ...into, id: uniqueId(`${into.id}__gate`, edgeIds), target: gates[0].id },
            ...gateEdges,
          ],
        };
      }
    }
  }
  return null;
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  return id;
}

/**
 * #111: a meeting HA can't write. Branches of one fan-out that meet at a
 * step X (not a Join) -- where all of them meet, or where a group of them
 * does before the rest (#99) -- each able to go on without X running for
 * it (`canMiss`). gateConditionMeetings has already made the ones HA can
 * write one OR. Returns X's id, or null.
 */
export function unwritableMeeting(flow: FlowGraph): string | null {
  const ctx = contextOf(flow);
  const members = listHeads(flow);
  /** Everything `from` reaches going forward, not past `bound`. */
  const memo = new Map<string, Set<string>>();
  const reach = (from: string, bound: Set<string>): Set<string> => {
    const key = `${from}\u0000${[...bound].sort().join('\u0000')}`;
    const known = memo.get(key);
    if (known) return known;
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (bound.has(id)) continue;
      for (const e of forwardOut(ctx, id)) queue.push(e.target);
    }
    memo.set(key, seen);
    return seen;
  };
  /** Whether the branch starting at `from` can go on without `meet` ever
   * running for it (#111, #113): some choice at its conditions leads every
   * one of its paths away from `meet` -- to an end (a missing side, a step
   * with nothing after it; not a `stop`, which ends everything anyway), or
   * on past it without passing through it (a "no" side going around it).
   * A fan-out misses only when every one of its branches does (#107: a
   * shortcut edge past `meet` next to one into it still gets there). A
   * loop's back edge adds nothing: whether its exit misses decides. */
  const canMiss = (from: string, meet: string): boolean => {
    const missMemo = new Map<string, boolean>();
    const inProgress = new Set<string>();
    const misses = (id: string): boolean => {
      if (id === meet) return false;
      const known = missMemo.get(id);
      if (known !== undefined) return known;
      if (inProgress.has(id)) return false;
      inProgress.add(id);
      const result = missesAt(id);
      inProgress.delete(id);
      missMemo.set(id, result);
      return result;
    };
    const all = (targets: string[]) => targets.every((t) => misses(t));
    const missesAt = (id: string): boolean => {
      const node = ctx.nodes.get(id);
      const data = (node?.data as Record<string, unknown> | undefined) ?? {};
      if (node?.type === 'action' && 'stop' in data) return false;
      // Back edges too: a loop's last step goes back, it doesn't end.
      const out = ctx.edges.filter((e) => e.source === id);
      if (node?.type !== 'condition') return all(out.map((e) => e.target));
      const side = (handle: 'true' | 'false'): boolean => {
        const targets = out.filter((e) => e.sourceHandle === handle).map((e) => e.target);
        if (targets.length > 0) return all(targets);
        // A list member's missing side is its list's else (2.2).
        const head = members.get(id);
        if (handle === 'false' && head !== undefined) {
          // Back edges too: an until list's else is its next round.
          const listElse = ctx.edges
            .filter((e) => e.source === head && e.sourceHandle === 'false')
            .map((e) => e.target);
          return listElse.length === 0 || all(listElse);
        }
        return true;
      };
      return side('true') || side('false');
    };
    return misses(from);
  };
  /** Where all of `starts` first meet: one node reached from each, not
   * past another such node. */
  const firstMeeting = (starts: string[], bound: Set<string>): string[] => {
    const sets = starts.map((s) => reach(s, bound));
    const common = [...sets[0]].filter((id) => sets.every((r) => r.has(id)));
    return common.filter(
      (id) => !common.some((other) => other !== id && reach(other, bound).has(id))
    );
  };
  const check = (starts: string[], bound: Set<string>): string | null => {
    if (starts.length < 2) return null;
    const meets = firstMeeting(starts, bound);
    // Where they first meet (several places, when a "no" side of each goes
    // on to a second one, #113).
    for (const meet of meets) {
      if (ctx.nodes.get(meet)?.type !== 'join' && starts.every((t) => canMiss(t, meet))) {
        return meet;
      }
    }
    // Groups of them meeting before that (or with no meeting of all): the
    // same question for each group, bounded by where all of them meet.
    const inner = new Set([...bound, ...meets]);
    const reachOf = new Map(starts.map((t) => [t, reach(t, inner)]));
    const groups: string[][] = [];
    for (const t of starts) {
      const joined = groups.filter((g) =>
        g.some((o) => [...reachOf.get(o)!].some((id) => !inner.has(id) && reachOf.get(t)!.has(id)))
      );
      for (const g of joined) groups.splice(groups.indexOf(g), 1);
      groups.push([...joined.flat(), t]);
    }
    for (const g of groups) {
      if (g.length < 2 || g.length === starts.length) continue;
      const found = check(g, inner);
      if (found) return found;
    }
    return null;
  };
  for (const source of flow.nodes) {
    for (const group of fanOuts(ctx, source.id)) {
      const found = check(
        group.map((e) => e.target),
        new Set()
      );
      if (found) return found;
    }
  }
  return null;
}
