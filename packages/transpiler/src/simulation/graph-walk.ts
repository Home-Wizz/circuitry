import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { normalizeGraph } from '../analyzer/normalize';
import { findBackEdges } from '../analyzer/topology';

/** A token's next node; `loop`: it came down a back edge into that node
 * (the loop's head, or a count loop's init). */
type Move = { at: string; loop?: string };

/** What running a node means, for whoever walks the graph. */
export interface GraphWalkHooks {
  /** Before each node runs (a step limit throws from here). */
  tick?: () => void;
  /** Each node as it runs, in order. */
  visit?: (node: FlowNode) => void;
  /** Each edge a token goes down, as it does. */
  follow?: (edge: FlowEdge) => void;
  /** A condition's outcome; null when it can't be evaluated (an until
   * test then ends its loop, anything else reads it as false). */
  test: (node: FlowNode) => boolean | null;
  /** A step (action, delay, wait, variables) runs. */
  run?: (node: FlowNode) => void;
  /** Whether an error `run` threw is a `stop`: the other branches of a
   * parallel finish, and nothing after them runs. */
  isStop?: (error: unknown) => boolean;
}

/**
 * Run a graph itself. Native, the state
 * machine and both gates all RECOGNIZE shapes in the graph (a loop, a
 * Choose, a list, a meeting point) before they know what it does, and when
 * a recognizer and its gate twin misread a shape the same way, they agree
 * on the wrong output. This recognizes nothing: it puts a token on the
 * trigger that fired and moves it along the edges, node by node, the way a
 * person traces the canvas with a finger -- and is the executable
 * definition of what a graph means. The test suite's graph interpreter
 * (`__tests__/graph-interpreter.ts`) runs it with sm-interpreter.ts's leaf
 * semantics (service calls, conditions, variables, errors) and compares
 * its trace with running the compiled YAML; the canvas's trace simulator
 * runs it with the conditions the user picks, to show what the saved
 * automation does. None of the strategies or gates use it: it stays an
 * independent reading, which is why it states the conventions itself
 * rather than calling the analyzer's readers (list members included).
 *
 * The rules, each an independent reading of a convention (invariants
 * section 2):
 * - A step runs, then its token goes down every edge out of it; several
 *   edges are a parallel, one token per edge.
 * - A condition runs its test and goes down its true or its false edges.
 *   With no edge on that side, a list member (no `_blockKey`, one way in,
 *   the true edge of a condition with one true edge, not reached from that
 *   condition's else) takes its list head's else (2.2); otherwise the
 *   token's path ends (D1: the automation stops, or only that branch
 *   inside a parallel).
 * - A node with several ways in (forward edges) is where paths meet: a
 *   token there waits until no other live token can still reach it, then
 *   the waiting tokens go on as one (2.12: what follows runs once) -- if
 *   any got there. A Join where a fan-out's branches meet goes on once
 *   they have all finished, got there or not (#111).
 * - A count loop's test going back to its init node goes to what follows
 *   the init (the counter isn't reset; 2.4).
 * - An until test that can't be evaluated leaves the loop (HA; bug #63).
 * - `stop` ends the run; inside a parallel the other branches finish first
 *   and nothing after them runs.
 * The graph is normalized first (analyzer/normalize.ts: disabled steps,
 * loop anchors, path endings), as every strategy and gate reads it.
 */
export function walkGraph(graph: FlowGraph, triggerIdx: number, hooks: GraphWalkHooks): void {
  const flow = normalizeGraph(graph);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
  const backEdges = findBackEdges(flow);
  const out = (id: string) => edges.filter((e) => e.source === id);
  const forwardIn = (id: string) => edges.filter((e) => e.target === id && !backEdges.has(e.id));
  const blockKey = (n: FlowNode | undefined) =>
    (n?.data as Record<string, unknown> | undefined)?._blockKey;

  const triggers = flow.nodes.filter((n) => n.type === 'trigger');
  const start = triggers[triggerIdx] ?? flow.nodes.find((n) => n.type === 'start');
  if (!start) return;

  /** Whether `from` reaches `to` going forward (not through `avoid`). */
  const reaches = (from: string, to: string, avoid?: string): boolean => {
    const seen = new Set<string>(avoid === undefined ? [] : [avoid]);
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of out(id)) if (!backEdges.has(e.id)) queue.push(e.target);
    }
    return false;
  };

  /** A condition with no edge on the side it took: a list member's
   * inherited else (2.2), or null (the path ends). */
  const inheritedElse = (id: string, seen = new Set<string>()): string[] | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    const node = nodes.get(id);
    if (node?.type !== 'condition' || typeof blockKey(node) === 'string') return null;
    const ways = forwardIn(id);
    if (ways.length !== 1 || ways[0].sourceHandle !== 'true') return null;
    const parent = nodes.get(ways[0].source);
    if (parent?.type !== 'condition') return null;
    if (out(parent.id).filter((e) => e.sourceHandle === 'true').length !== 1) return null;
    const own = out(parent.id).filter((e) => e.sourceHandle === 'false');
    const parentElse = own.length > 0 ? own.map((e) => e.target) : inheritedElse(parent.id, seen);
    if (parentElse === null) return null;
    // Reached from the parent's else too: where its branches meet (#26).
    // Not through the parent: an else going back to an enclosing loop's
    // head reaches it only around the loop.
    if (parentElse.some((t) => t === id || reaches(t, id, parent.id))) return null;
    return parentElse;
  };

  /** Where a token goes down `edge`: `loop` is set for a back edge (the
   * node it goes back to). A count loop's test going back to its init
   * node goes to what follows the init (the counter isn't reset; 2.4,
   * #23). */
  const target = (edge: FlowEdge): Move[] => {
    hooks.follow?.(edge);
    const to = nodes.get(edge.target);
    const from = nodes.get(edge.source);
    const loop = backEdges.has(edge.id) ? edge.target : undefined;
    const vars = (to?.data as Record<string, unknown> | undefined)?.variables as
      | Record<string, unknown>
      | undefined;
    const counter = vars && Object.keys(vars).length === 1 ? Object.keys(vars)[0] : null;
    const isCountReentry =
      loop !== undefined &&
      from?.type === 'condition' &&
      to?.type === 'set_variables' &&
      counter !== null &&
      counter.startsWith('_repeat_counter_') &&
      vars?.[counter] === 0;
    return isCountReentry
      ? out(edge.target).map((e) => ({ at: e.target, loop }))
      : [{ at: edge.target, loop }];
  };

  const isUntilTest = (node: FlowNode): boolean =>
    blockKey(node) === 'repeat_until' ||
    (typeof blockKey(node) !== 'string' &&
      out(node.id).some((e) => e.sourceHandle === 'false' && backEdges.has(e.id)));

  /** Runs one node; returns where its token goes next ([] : the path ends). */
  const step = (id: string): Move[] => {
    hooks.tick?.();
    const node = nodes.get(id);
    if (!node) throw new Error(`graph walk: no node ${id}`);
    hooks.visit?.(node);
    if (node.type === 'condition') {
      const result = hooks.test(node);
      // An until test that can't be evaluated ends the loop (bug #63);
      // anywhere else an error reads as false.
      const passed = result === true || (result === null && isUntilTest(node));
      const side = out(id).filter((e) => e.sourceHandle === (passed ? 'true' : 'false'));
      if (side.length > 0) return side.flatMap(target);
      if (passed) return [];
      return (inheritedElse(id) ?? []).map((at) => ({ at }));
    }
    if (['action', 'delay', 'wait', 'set_variables'].includes(node.type)) {
      hooks.run?.(node);
    } else if (
      !['trigger', 'start', 'join', 'sequence_start', 'sequence_end'].includes(node.type)
    ) {
      throw new Error(`graph walk: node type ${node.type} not supported`);
    }
    return out(id).flatMap(target);
  };

  // Tokens: each at the node it runs next. One at a meeting point waits for
  // the other paths that can still get there ('meet'); one that came down
  // a loop's back edge waits for the rest of the loop's body to finish
  // ('loop': HA starts the next pass only then) and doesn't count as able
  // to reach anything in the meantime. Run depth first, the first branch of
  // a parallel to its end before the next (as sm-interpreter.ts runs a YAML
  // parallel), so both read their conditions in the same order.
  // `owes`: the Joins this token's branch counts for (#111). A Join where
  // branches of a fan-out meet goes on once every one of them has finished,
  // whether it got there or ended on the way (its help: "waits for every
  // incoming branch to finish"); a branch that ends leaves a stand-in
  // arrival there. Anywhere else a path that ends just ends: a plain
  // meeting point runs only if some path reached it.
  type Token = Move & { waiting: false | 'meet' | 'loop'; owes: string[] };
  let tokens: Token[] = [];
  /** Everything `from` reaches going forward. */
  const reachSet = (from: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of out(id)) if (!backEdges.has(e.id)) queue.push(e.target);
    }
    return seen;
  };
  /** For each of a fan-out's branches, the Joins where it first meets
   * another of them: the nodes both reach that neither reaches only through
   * another. */
  const meetingJoins = (starts: string[]): string[][] => {
    const sets = starts.map(reachSet);
    const found = starts.map(() => new Set<string>());
    for (let i = 0; i < starts.length; i++) {
      for (let k = i + 1; k < starts.length; k++) {
        const common = [...sets[i]].filter((id) => sets[k].has(id));
        const first = common.filter(
          (id) => !common.some((other) => other !== id && reaches(other, id))
        );
        for (const id of first) {
          if (nodes.get(id)?.type !== 'join' || forwardIn(id).length < 2) continue;
          found[i].add(id);
          found[k].add(id);
        }
      }
    }
    return found.map((f) => [...f]);
  };
  const push = (moves: Move[], owes: string[]) => {
    // A fan-out: each branch counts for the Joins it meets the others at.
    const joins = moves.length > 1 ? meetingJoins(moves.map((m) => m.at)) : moves.map(() => []);
    for (let k = moves.length - 1; k >= 0; k--) {
      const m = moves[k];
      // A token past a Join (going on from somewhere after it) no longer
      // counts for it.
      const all = [...new Set([...owes, ...joins[k]])];
      tokens.push({
        ...m,
        waiting: false,
        owes: all.filter((j) => j !== m.at && !reaches(j, m.at)),
      });
    }
  };
  push(out(start.id).flatMap(target), []);
  let stopped = false;
  const advance = (at: string, owes: string[]) => {
    const left = owes.filter((j) => j !== at);
    try {
      const moves = step(at);
      if (moves.length > 0) {
        push(moves, left);
        return;
      }
      // This branch ended: it has finished for every Join it counts for.
      for (const j of left) {
        if (!tokens.some((t) => t.at === j && t.waiting)) {
          tokens.push({ at: j, waiting: 'meet', owes: left.filter((o) => o !== j) });
        }
      }
    } catch (e) {
      if (!hooks.isStop?.(e)) throw e;
      // The other branches finish; nothing after them runs.
      stopped = true;
    }
  };
  const live = (t: Token, except: string) => t.at !== except && t.waiting !== 'loop';
  /** The nodes a loop's back edges leave from: its body's ends. */
  const loopEnds = (head: string) =>
    edges.filter((e) => e.target === head && backEdges.has(e.id)).map((e) => e.source);
  const isReady = (t: Token): boolean => {
    // A Join also waits for the branches that count for it but went
    // another way: they have to finish first.
    if (t.waiting !== 'loop') {
      return !tokens.some((o) => live(o, t.at) && (reaches(o.at, t.at) || o.owes.includes(t.at)));
    }
    // The next pass waits until nothing is left in the body: no other token
    // at or on its way to any of the loop's ends.
    const ends = loopEnds(t.loop!);
    return !tokens.some(
      (o) => live(o, t.at) && ends.some((end) => o.at === end || reaches(o.at, end))
    );
  };
  /** Runs `token`'s node, with every token waiting at it (they go on as
   * one). Starting a loop's next pass starts all of it: tokens that came
   * down the same loop's back edges to other nodes (a count loop's body
   * that opens with a parallel) become that pass's branches. */
  const release = (token: Token) => {
    const at = token.at;
    if (token.waiting === 'loop') {
      for (const t of tokens) {
        if (t !== token && t.waiting === 'loop' && t.loop === token.loop && t.at !== at) {
          t.waiting = false;
          t.loop = undefined;
        }
      }
    }
    const merged = tokens.filter((t) => t === token || (t.at === at && t.waiting));
    tokens = tokens.filter((t) => !merged.includes(t));
    // Every branch it waited for has finished: none still counts for it.
    for (const t of tokens) t.owes = t.owes.filter((j) => j !== at);
    advance(at, [...new Set(merged.flatMap((t) => t.owes))]);
  };
  while (tokens.length > 0) {
    let token: Token | undefined;
    for (let k = tokens.length - 1; k >= 0 && !token; k--) {
      if (!tokens[k].waiting) token = tokens[k];
    }
    if (token) {
      if (token.loop !== undefined) token.waiting = 'loop';
      else if (forwardIn(token.at).length > 1) token.waiting = 'meet';
      // Nothing to wait for (an if's two sides meeting, a loop's only
      // path back): go on at once, as a YAML run does.
      if (!token.waiting || isReady(token)) release(token);
      continue;
    }
    if (stopped) break;
    // Every token waits: release a node whose paths have all arrived
    // (or never will); the tokens there go on as one.
    const ready = tokens.find(isReady);
    if (!ready) throw new Error('graph walk: branches wait on each other');
    release(ready);
  }
}
