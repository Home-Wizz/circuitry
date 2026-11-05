import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { listHeads } from './list-members';
import { enclosingHeads, hasCycleWithin, loopStructure, onlyWayRound } from './loops';

/**
 * Every drawn line counts (decision, 2026-10-10; bug #262). A step's (or a
 * condition side's) lines to T and to O, where O's path also leads on to
 * T: T is where the two paths meet, and runs once, after O's path has
 * finished -- whichever way it went. The strategies and gates used to drop
 * the line to T as a redundant shortcut, so T ran only when O's path got
 * there (a condition on it said no: T never ran).
 *
 * Written out here, before anything reads the graph: every way O's path can
 * end without reaching T -- a step with nothing after it, a condition side
 * with no line (not a list member, which takes its list's else) -- now
 * leads to T, and the direct line goes. Where O's path always reached T
 * this changes nothing but the line (the shortcut reading and this one
 * agree). Left as drawn when O's path goes anywhere else (somewhere T isn't
 * after), is also taken from somewhere else (another trigger joined to
 * the same first step: the new lines would apply to it too), loops, or
 * holds a Choose without a default; a step that `stop`s gets no line
 * (nothing after it runs).
 *
 * The graph walk (simulation/graph-walk.ts) doesn't use this: it reads the
 * meeting itself, so it checks this rewrite.
 */
export function writeOutMeetingLines(flow: FlowGraph): FlowGraph {
  let current = flow;
  for (let pass = 0; pass <= flow.edges.length; pass++) {
    const next = writeOutOne(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

/** Whether `to` can be reached from `from` without passing through
 * `avoid`: the fan-out's own step and the heads of the loops it is in
 * (#283: not along the "forward" lines of a depth-first walk, whose choice
 * of back edges depends on the order lines were drawn in). A path that
 * comes back through one of them is the loop going round, the next round,
 * not one target's path leading on to another in this one. */
function reachesAvoiding(edges: FlowEdge[], from: string, to: string, avoid: Set<string>): boolean {
  const seen = new Set<string>([...avoid].filter((id) => id !== to));
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  return false;
}

/** Whether `a` and `b` are both ways into one loop (a loop with several
 * ways in, #283's irreducible region): one reaching the other is no more
 * going round than the other way, so it doesn't make them one path. */
function enteredTogether(flow: FlowGraph, a: string, b: string): boolean {
  return loopStructure(flow).loops.some((loop) => loop.heads.has(a) && loop.heads.has(b));
}

function writeOutOne(flow: FlowGraph): FlowGraph | null {
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const members = listHeads(flow);

  for (const source of flow.nodes) {
    const avoid = new Set([source.id, ...enclosingHeads(flow, source.id)]);
    const reaches = (from: string, to: string) => reachesAvoiding(edges, from, to, avoid);
    const out = edges.filter((e) => e.source === source.id);
    const handles = source.type === 'condition' ? ['true', 'false'] : [null];
    for (const handle of handles) {
      const side = handle === null ? out : out.filter((e) => (e.sourceHandle ?? null) === handle);
      const targets = [...new Set(side.map((e) => e.target))];
      if (targets.length < 2) continue;
      for (const meeting of targets) {
        // A line back round a loop the step is in: the next round, never
        // a meeting in this one. (Not to a head of a loop with several ways
        // in: that line is a forward one in some run.)
        if (avoid.has(meeting) && onlyWayRound(flow, source.id, meeting)) continue;
        const others = targets.filter(
          (o) =>
            o !== meeting &&
            reaches(o, meeting) &&
            (!reaches(meeting, o) || enteredTogether(flow, o, meeting))
        );
        if (others.length === 0) continue;
        const added = endsLeadingTo(
          flow,
          source.id,
          handle,
          meeting,
          others,
          nodes,
          edges,
          members
        );
        if (added === null) continue;
        const direct = new Set(side.filter((e) => e.target === meeting).map((e) => e.id));
        const redirected = new Map(added.redirect ?? []);
        return {
          ...flow,
          nodes: [...flow.nodes, ...(added.nodes ?? [])],
          edges: [
            ...flow.edges
              .filter((e) => !direct.has(e.id))
              .map((e) =>
                redirected.has(e.id) ? { ...e, target: redirected.get(e.id) as string } : e
              ),
            ...added.lines,
          ],
        };
      }
    }
  }
  return null;
}

/** The lines to add so that every way the paths from `starts` can end
 * leads to `meeting`, or null when that isn't how the drawing reads (see
 * writeOutMeetingLines). */
function endsLeadingTo(
  flow: FlowGraph,
  from: string,
  fromHandle: string | null,
  meeting: string,
  starts: string[],
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[],
  members: Map<string, string>
): { lines: FlowEdge[]; nodes?: FlowNode[]; redirect?: [string, string][] } | null {
  const region = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === meeting || region.has(id)) continue;
    region.add(id);
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  // The path loops before the meeting point: left as drawn.
  if (hasCycleWithin(flow, region)) return null;
  // Every way out of the region goes to the meeting point (or ends), and
  // every way in comes from the fan-out: a path another trigger or step
  // also takes would get the new lines too, where that path has no meeting.
  // Steps a run that gets to the fan-out can also take: a way in from one
  // of them may be another branch of the same run going into the path
  // (#99: a branch beside the fan-out's own), which a copy would run
  // twice; that stays as drawn. Copied only for a way in no such run
  // takes (another trigger's own path) or the fan-out's other side.
  const sameRun = stepsOfRunsReaching(from, nodes, edges);
  let sharedPath = false;
  for (const e of edges) {
    if (region.has(e.source) && !region.has(e.target) && e.target !== meeting) return null;
    // From the fan-out's own side only (bug #266: the other side of the
    // same condition going into the region got the new lines too).
    const fromFanOut = e.source === from && (e.sourceHandle ?? null) === fromHandle;
    if (region.has(e.target) && !region.has(e.source) && !fromFanOut) {
      if (e.source !== from && sameRun.has(e.source)) return null;
      sharedPath = true;
    }
  }
  if (!sharedPath) {
    const lines = linesFromEnds(region, meeting, 'meets', nodes, edges, members);
    return lines === null ? null : { lines };
  }
  return meetingOnACopy(from, fromHandle, meeting, region, nodes, edges, members);
}

/** Every step reachable from a trigger that reaches `step`. */
function stepsOfRunsReaching(
  step: string,
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[]
): Set<string> {
  const forward = (starts: string[]) => {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.source === id) queue.push(e.target);
    }
    return seen;
  };
  const triggers = [...nodes.values()]
    .filter((n) => n.type === 'trigger' && forward([n.id]).has(step))
    .map((n) => n.id);
  return forward(triggers);
}

/**
 * #262's leftover (decided 2026-10-31: copy the shared path): the path
 * from the fan-out to the meeting point is also taken from elsewhere
 * (another trigger, the other side of the same condition). Home
 * Assistant's YAML can't share steps between two paths, so this fan-out's
 * run gets a copy of the path of its own, whose ends lead to the meeting
 * point as written out above; the path as drawn stays for the others, who
 * meet nothing there. The same steps run in the same order either way.
 */
function meetingOnACopy(
  from: string,
  fromHandle: string | null,
  meeting: string,
  region: Set<string>,
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[],
  members: Map<string, string>
): { lines: FlowEdge[]; nodes: FlowNode[]; redirect: [string, string][] } | null {
  const suffix = `__for_${from}${fromHandle ? `_${fromHandle}` : ''}`;
  const copyOf = (id: string) => (region.has(id) ? `${id}${suffix}` : id);
  if ([...region].some((id) => nodes.has(copyOf(id)))) return null;
  const copies: FlowNode[] = [];
  for (const id of region) {
    const node = nodes.get(id);
    if (!node) return null;
    copies.push({ ...node, id: copyOf(id), data: { ...node.data } } as FlowNode);
  }
  const copiedLines: FlowEdge[] = edges
    .filter((e) => region.has(e.source))
    .map((e) => ({
      ...e,
      id: `${e.id}${suffix}`,
      source: copyOf(e.source),
      target: copyOf(e.target),
    }));
  const copyRegion = new Set([...region].map(copyOf));
  const allNodes = new Map([...nodes, ...copies.map((n) => [n.id, n] as [string, FlowNode])]);
  // A list member keeps its list's "no" on the copy (its head copied too).
  const copyMembers = new Map(members);
  for (const [member, head] of members)
    if (region.has(member)) copyMembers.set(copyOf(member), copyOf(head));
  const ends = linesFromEnds(
    copyRegion,
    meeting,
    'meets',
    allNodes,
    [...edges, ...copiedLines],
    copyMembers
  );
  if (ends === null) return null;
  const redirect: [string, string][] = edges
    .filter(
      (e) => e.source === from && (e.sourceHandle ?? null) === fromHandle && region.has(e.target)
    )
    .map((e) => [e.id, copyOf(e.target)]);
  return { lines: [...copiedLines, ...ends], nodes: copies, redirect };
}

/**
 * The lines that make every way the paths in `region` can end lead to
 * `to`: a step with nothing after it, a condition side with no line (not a
 * list member's "no", which takes its list's else); a step that `stop`s
 * gets none. Null when that can't be said (a Choose with no default: its
 * "no case matched" goes on by its own rule). Each line's id is
 * `<from>__<tag>__<to>`. Shared with loop-rounds.ts (#267).
 */
export function linesFromEnds(
  region: Set<string>,
  to: string,
  tag: string,
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[],
  members: Map<string, string>
): FlowEdge[] | null {
  const added: FlowEdge[] = [];
  const line = (from: string, handle: 'true' | 'false' | null) =>
    added.push({
      id: `${from}__${tag}__${to}${handle ? `_${handle}` : ''}`,
      source: from,
      target: to,
      ...(handle ? { sourceHandle: handle } : {}),
    } as FlowEdge);
  for (const id of region) {
    const node = nodes.get(id);
    if (!node) return null;
    const own = edges.filter((e) => e.source === id);
    const data = node.data as Record<string, unknown>;
    if (node.type === 'condition') {
      const yes = own.some((e) => e.sourceHandle === 'true');
      const no = own.some((e) => e.sourceHandle === 'false');
      if (!no && data._blockKey === 'choose') return null;
      if (!yes) line(id, 'true');
      if (!no && !members.has(id)) line(id, 'false');
    } else if (own.length === 0 && data.stop === undefined) {
      line(id, null);
    }
  }
  return added;
}

/**
 * #262, what writeOutMeetingLines leaves as drawn: a line to a step that
 * another line's path also leads to, where that path doesn't always get
 * there and can't be written out (it is also taken from elsewhere, leaves
 * for somewhere else, or loops). As drawn the step runs either way; read
 * the old way it runs only when the path gets there -- which reading is
 * meant can't be told from the drawing, so it isn't saved (decided with
 * the maintainer, 2026-10-11). Run on a graph writeOutMeetingLines has
 * already written out. Returns `[from, meeting, through]` for each.
 */
export function unwrittenMeetings(flow: FlowGraph): [string, string, string][] {
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const forwardOut = (id: string) => edges.filter((e) => e.source === id);
  const members = listHeads(flow);
  let roundHeadsNow = new Set<string>();
  /** Whether every way on from `id` gets to `meeting` (a `stop` ends the
   * run in either reading; a list member takes its list's else; a Choose
   * case with no "no" falls through to where its cases meet). */
  const always = (id: string, meeting: string, memo: Map<string, boolean>): boolean => {
    if (id === meeting) return true;
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, true);
    const node = nodes.get(id);
    const data = (node?.data ?? {}) as Record<string, unknown>;
    const out = forwardOut(id);
    let result: boolean;
    if (!node) result = false;
    // Going round the loop instead of getting there (#283).
    else if (roundHeadsNow.has(id)) result = false;
    else if (node.type === 'condition') {
      const side = (h: string) => out.filter((e) => e.sourceHandle === h);
      const noSideOk = side('false').length > 0 || members.has(id) || data._blockKey === 'choose';
      result =
        side('true').length > 0 && noSideOk && out.every((e) => always(e.target, meeting, memo));
    } else if (out.length === 0) {
      result = data.stop !== undefined || edges.some((e) => e.source === id);
    } else result = out.every((e) => always(e.target, meeting, memo));
    memo.set(id, result);
    return result;
  };
  const found: [string, string, string][] = [];
  for (const source of flow.nodes) {
    const avoid = new Set([source.id, ...enclosingHeads(flow, source.id)]);
    const reaches = (from: string, to: string) => reachesAvoiding(edges, from, to, avoid);
    const out = forwardOut(source.id);
    const roundHeads = avoid;
    const handles = source.type === 'condition' ? ['true', 'false'] : [null];
    for (const handle of handles) {
      const side = handle === null ? out : out.filter((e) => (e.sourceHandle ?? null) === handle);
      const targets = [...new Set(side.map((e) => e.target))];
      for (const meeting of targets) {
        if (avoid.has(meeting) && onlyWayRound(flow, source.id, meeting)) continue;
        for (const other of targets) {
          if (other === meeting || !reaches(other, meeting)) continue;
          if (reaches(meeting, other) && !enteredTogether(flow, other, meeting)) continue;
          roundHeadsNow = roundHeads;
          if (!always(other, meeting, new Map())) found.push([source.id, meeting, other]);
        }
      }
    }
  }
  return found;
}
