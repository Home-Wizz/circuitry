import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { classifyLoopBackEdge } from '../strategies/native';
import { listHeads } from './list-members';
import { linesFromEnds } from './meeting-lines';
import { MAX_COPIED_STEPS } from './path-endings';
import { findBackEdges } from './topology';

/**
 * #265, written (decided with the maintainer, 2026-10-12): a do-while whose
 * test's yes side goes back round AND on to steps beside it -- "chime; door
 * still open? yes: notify, and chime again". Drawn, the steps beside run
 * each time the test sends the loop round, and the next round waits for
 * them (Home Assistant starts a round only once the last one's steps have
 * finished). No `repeat` holds steps that run between rounds only when the
 * test passed, so the graph is rewritten into one that does: the first
 * round as drawn, then a while on the test whose body is the steps beside
 * and a copy of the round --
 *
 *   A -> C;  C yes -> A (back), C yes -> X        becomes
 *   A -> C;  C yes -> X -> A' -> C (back)
 *
 * written `A; repeat while C: [X, A]`. The test is asked once per round,
 * as drawn; one that can't be evaluated ends the loop either way (HA's
 * `until: [not C]` and `while: [C]` both stop). Several steps beside meet
 * at a Join before the copy; a path in them that ends goes on to the copy
 * (it ends only its branch), a `stop` stays a stop (when every way through
 * them stops, the loop never goes round: only the line back goes).
 *
 * Left as drawn (and refused, analyzer/loop-side-lines.ts) when it can't
 * be written this way: an until's no side (its test's error ends the loop
 * where the rewritten test's would run it), a round of more than
 * MAX_COPIED_STEPS steps, a round with a way back out of it (to its own
 * head, or to an enclosing loop's), a round whose way to the test ends in
 * a condition, or steps beside that lead anywhere but their own ends. Not
 * for the graph walk, which reads the drawing itself and so checks this
 * rewrite.
 */
export function writeOutLoopRounds(flow: FlowGraph): FlowGraph {
  let current = flow;
  for (let pass = 0; pass <= flow.edges.length; pass++) {
    const next = writeOutOne(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

function writeOutOne(flow: FlowGraph): FlowGraph | null {
  const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const forwardOf = (id: string) => lines.filter((e) => e.source === id && !backEdges.has(e.id));
  const reach = (starts: string[], avoid = new Set<string>()): Set<string> => {
    const seen = new Set<string>();
    const queue = starts.filter((id) => !avoid.has(id));
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of forwardOf(id)) if (!avoid.has(e.target)) queue.push(e.target);
    }
    return seen;
  };
  for (const back of lines) {
    if (!backEdges.has(back.id)) continue;
    const test = nodes.get(back.source);
    const head = nodes.get(back.target);
    if (!test || !head) continue;
    if (classifyLoopBackEdge(test, head, back.sourceHandle) !== 'do-while') continue;
    const sides = forwardOf(test.id)
      .filter((e) => e.sourceHandle === 'true')
      .map((e) => e.target);
    if (sides.length === 0) continue;
    const rewritten = rewrite(flow, lines, backEdges, nodes, reach, back, test, head, sides);
    if (rewritten !== null) return rewritten;
  }
  return null;
}

function rewrite(
  flow: FlowGraph,
  lines: FlowEdge[],
  backEdges: Set<string>,
  nodes: Map<string, FlowNode>,
  reach: (starts: string[], avoid?: Set<string>) => Set<string>,
  back: FlowEdge,
  test: FlowNode,
  head: FlowNode,
  sides: string[]
): FlowGraph | null {
  // The round: what the head leads to before the test -- its way to the
  // test and the branches off it that end there (a step beside a meeting
  // point inside it, #267) -- but not what comes after the loop.
  const fromHead = reach([head.id], new Set([test.id]));
  const exits = lines
    .filter((e) => e.source === test.id && e.sourceHandle === 'false' && !backEdges.has(e.id))
    .map((e) => e.target);
  const afterLoop = reach(exits);
  const round = new Set([...fromHead].filter((id) => !afterLoop.has(id)));
  if (![...round].some((id) => lines.some((e) => e.source === id && e.target === test.id))) {
    return null;
  }
  if (round.size === 0 || round.size > MAX_COPIED_STEPS) return null;
  // A loop inside it is copied with it; nothing in it goes back anywhere
  // else (to this loop's head: two loops on it, #134; out of the round: an
  // enclosing loop's head). Its way to the test leaves steps.
  if (
    lines.some(
      (e) =>
        backEdges.has(e.id) &&
        e !== back &&
        round.has(e.source) &&
        (!round.has(e.target) || e.target === head.id)
    )
  ) {
    return null;
  }
  const intoTest = lines.filter((e) => e.target === test.id && round.has(e.source));
  if (intoTest.some((e) => nodes.get(e.source)?.type === 'condition')) return null;
  // The steps beside: their own, leading nowhere but their ends.
  const beside = reach(sides);
  if ([...beside].some((id) => id === test.id || round.has(id) || id === head.id)) return null;
  for (const e of lines) {
    if (beside.has(e.source) && !beside.has(e.target)) return null;
    // A way in from elsewhere -- the test's own "no" side among them: then
    // the steps are the loop's exit too, and the copy of the round after
    // them would go round where the drawing ends (editor fuzzer, seed
    // 20261024, session 400: saved, the loop never ended).
    if (
      beside.has(e.target) &&
      !beside.has(e.source) &&
      (e.source !== test.id || e.sourceHandle !== 'true')
    )
      return null;
  }

  const taken = new Set(flow.nodes.map((n) => n.id));
  const fresh = (base: string) => {
    let id = `${base}__round`;
    for (let k = 2; taken.has(id); k++) id = `${base}__round${k}`;
    taken.add(id);
    return id;
  };
  const copyOf = new Map([...round].map((id) => [id, fresh(id)]));
  const copies: FlowNode[] = flow.nodes
    .filter((n) => round.has(n.id))
    .map(
      (n) =>
        ({
          ...n,
          id: copyOf.get(n.id)!,
          position: { x: n.position.x + 40, y: n.position.y + 120 },
          data: structuredClone(n.data),
        }) as FlowNode
    );
  const edgeIds = new Set(flow.edges.map((e) => e.id));
  const freshEdge = (base: string) => {
    let id = `${base}__round`;
    for (let k = 2; edgeIds.has(id); k++) id = `${base}__round${k}`;
    edgeIds.add(id);
    return id;
  };
  // The copy's own lines, and its lines out of the round (to the test,
  // and any way out of the loop a step in it has).
  const copiedEdges: FlowEdge[] = flow.edges
    .filter((e) => round.has(e.source))
    .map((e) => ({
      ...e,
      id: freshEdge(e.id),
      source: copyOf.get(e.source)!,
      target: copyOf.get(e.target) ?? e.target,
    }));
  const headCopy = copyOf.get(head.id)!;
  // Into the copy: from where the steps beside end (one of them), or
  // through a Join they all finish at (several).
  const added: FlowNode[] = [];
  let besideEnds: FlowEdge[] | null;
  // A condition first among the steps beside isn't a member of the test's
  // list (it is entered through a Join below): its "no" ends its branch.
  const members = new Map([...listHeads(flow)].filter(([, listHead]) => listHead !== test.id));
  if (sides.length === 1) {
    besideEnds = linesFromEnds(beside, headCopy, 'round', nodes, lines, members);
  } else {
    const joinId = fresh(`${test.id}_beside`);
    added.push({
      id: joinId,
      type: 'join',
      position: { x: test.position.x + 320, y: test.position.y + 120 },
      data: { mode: 'all' },
    } as FlowNode);
    const toJoin = linesFromEnds(beside, joinId, 'round', nodes, lines, members);
    besideEnds =
      toJoin === null
        ? null
        : [
            ...toJoin,
            {
              id: freshEdge(`${joinId}_to_${headCopy}`),
              source: joinId,
              target: headCopy,
            } as FlowEdge,
          ];
  }
  if (besideEnds === null) return null;
  // Every way through the steps beside stops: the loop never goes round
  // (the next round waits for them), so the line back just goes.
  if (besideEnds.length === 0) return { ...flow, edges: flow.edges.filter((e) => e !== back) };
  // The steps beside are entered through a pass-through Join, as a loop
  // entry anchor is: with the line back gone, a condition first among them
  // would otherwise read as a member of the test's list (`while: [C, D]`).
  const entryId = fresh(`${test.id}_beside_entry`);
  added.push({
    id: entryId,
    type: 'join',
    position: { x: test.position.x + 160, y: test.position.y + 60 },
    data: { mode: 'all' },
  } as FlowNode);
  // One line from the test to it, in place of all the test's lines to them.
  const sideSet = new Set(sides);
  const toSide = (e: FlowEdge) =>
    e.source === test.id && e.sourceHandle === 'true' && sideSet.has(e.target);
  const entered = [
    ...flow.edges.filter((e) => e !== back && !toSide(e)),
    {
      id: freshEdge(`${test.id}_to_${entryId}`),
      source: test.id,
      target: entryId,
      sourceHandle: 'true',
    } as FlowEdge,
  ];
  const fromEntry = sides.map(
    (side) =>
      ({ id: freshEdge(`${entryId}_to_${side}`), source: entryId, target: side }) as FlowEdge
  );
  return {
    ...flow,
    nodes: [...flow.nodes, ...copies, ...added],
    edges: [...entered, ...fromEntry, ...copiedEdges, ...besideEnds],
  };
}
