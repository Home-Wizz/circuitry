import type { FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { untilExit } from '../analyzer/loops';
import { anchoredGraph, normalizeGraph } from '../analyzer/normalize';
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
 * - A condition runs its test and goes down its true or its false edges;
 *   one that can't be evaluated goes down its false edges, as HA's
 *   if/else does (#128).
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
 * - An until test that can't be evaluated leaves the loop (HA; bug #63),
 *   and so does a member of its list, through the list's exit: HA reads
 *   the list as one test (#128).
 * - A fan-out's branches beside the way the walk carries on -- to where
 *   the paths meet (an if's meeting point), to a loop's test at its end,
 *   or round a loop -- finish before it does: the meeting point, the test,
 *   or the loop's next pass waits for them, and goes on in its turn once
 *   they have (#267, decided with the maintainer: Home Assistant starts
 *   what follows only once a round's steps have finished). Only branches
 *   that end on their own count (not one that gets to a meeting point, a
 *   test or a way back round: those go on by their own rules), and only
 *   fan-outs since the paths diverged (after the node that dominates every
 *   way into the meeting point; inside the loop's body): a parallel around
 *   the whole if or loop is not waited for. A branch going round a loop
 *   still owes the Join its parallel meets at.
 * - `stop` ends the run; inside a parallel the other branches finish first
 *   and nothing after them runs.
 * The graph is normalized first (analyzer/normalize.ts: disabled steps,
 * loop anchors, path endings), as every strategy and gate reads it, but
 * tests meeting at one step are left as drawn: this reads the meeting
 * itself, each test on its own (#128: an OR of them is the strategies'
 * way to write it, and is checked against this reading).
 */
export function walkGraph(graph: FlowGraph, triggerIdx: number, hooks: GraphWalkHooks): void {
  const flow = normalizeGraph(graph, {
    meetings: false,
    copies: false,
    lines: false,
    stops: false,
  });
  // The loops, read with drawn meetings written out (#262): a path that
  // ends before where the branches meet goes on there, so a test whose
  // side ends that way doesn't leave the loop the meeting point is in
  // (editor fuzzer, seed 20261021, session 654: read on the lines alone,
  // such a test ended its loop on an error where the writers' if took
  // "no"). The steps are the same; only the guard question is asked here.
  const loopView = anchoredGraph(graph);
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

  /** Runs one node; returns where its token goes next ([] : the path ends). */
  const step = (id: string): Move[] => {
    hooks.tick?.();
    const node = nodes.get(id);
    if (!node) throw new Error(`graph walk: no node ${id}`);
    hooks.visit?.(node);
    if (node.type === 'condition') {
      const result = hooks.test(node);
      // A test that can't be evaluated ends the loop it guards (bug #63;
      // #283: read from the loops themselves, analyzer/loops.ts, so the
      // answer doesn't depend on which line a search met first), also a
      // member of its list; anywhere else an error reads as false, as
      // HA's if/else reads it (#128).
      if (result === null) {
        const exit = untilExit(loopView, id);
        // (The exit lines as this walk has them: the same lines, a drawn
        // one written out in the view aside.)
        if (exit !== null)
          return exit.map((e) => edges.find((x) => x.id === e.id) ?? e).flatMap(target);
      }
      const passed = result === true;
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
  // `fans`: the fan-outs this token's branch came out of (one id per time a
  // node fanned out; `fanFrom` names the node), for the rule that a
  // meeting point or a loop's next pass waits for the branches beside it.
  type Token = Move & {
    waiting: false | 'meet' | 'loop' | 'test';
    owes: string[];
    fans: string[];
    /** Held back for a branch beside it (#267): picked up again in its
     * turn, once that branch has finished. */
    beside?: boolean;
  };
  let tokens: Token[] = [];
  const fanFrom = new Map<string, string>();
  let fanCount = 0;
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
  /** Dominators over forward edges from the trigger that fired: every node
   * each node can't be reached without passing. */
  const dominators = new Map<string, Set<string>>();
  {
    const order = [...reachSet(start.id)];
    const all = new Set(order);
    for (const id of order) dominators.set(id, id === start.id ? new Set([id]) : new Set(all));
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of order) {
        if (id === start.id) continue;
        const preds = forwardIn(id)
          .map((e) => e.source)
          .filter((p) => all.has(p));
        const next = new Set<string>([id]);
        const first = preds.length > 0 ? dominators.get(preds[0])! : new Set<string>();
        for (const d of first) if (preds.every((p) => dominators.get(p)!.has(d))) next.add(d);
        if (next.size !== dominators.get(id)!.size) {
          dominators.set(id, next);
          changed = true;
        }
      }
    }
  }
  const dominates = (a: string, b: string) => dominators.get(b)?.has(a) ?? false;
  /** Where the ways into a meeting point split: the nearest node that
   * dominates each of them. */
  const divergence = (id: string): string | undefined => {
    const preds = forwardIn(id)
      .map((e) => e.source)
      .filter((p) => dominators.has(p));
    if (preds.length === 0) return undefined;
    const common = [...dominators.get(preds[0])!].filter((d) =>
      preds.every((p) => dominators.get(p)!.has(d))
    );
    // The nearest: the one the others all dominate.
    return common.reduce<string | undefined>(
      (best, d) =>
        best === undefined || dominators.get(d)!.size > dominators.get(best)!.size ? d : best,
      undefined
    );
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
          // An anchor normalize put before a loop's head or body (#272):
          // drawn, those lines went to the head, a plain meeting point, so
          // no branch counts for it the way it counts for a drawn Join.
          if ((nodes.get(id)?.data as Record<string, unknown> | undefined)?._anchor) continue;
          found[i].add(id);
          found[k].add(id);
        }
      }
    }
    return found.map((f) => [...f]);
  };
  const push = (moves: Move[], owes: string[], fans: string[] = [], from?: string) => {
    // A fan-out: each branch counts for the Joins it meets the others at.
    const joins = moves.length > 1 ? meetingJoins(moves.map((m) => m.at)) : moves.map(() => []);
    let branchFans = fans;
    if (moves.length > 1 && from !== undefined) {
      const fan = `fan${fanCount++}`;
      fanFrom.set(fan, from);
      branchFans = [...fans, fan];
    }
    for (let k = moves.length - 1; k >= 0; k--) {
      const m = moves[k];
      // A token past a Join (going on from somewhere after it) no longer
      // counts for it.
      const all = [...new Set([...owes, ...joins[k]])];
      tokens.push({
        ...m,
        waiting: false,
        owes: all.filter((j) => j !== m.at && !reaches(j, m.at)),
        fans: branchFans,
      });
    }
  };
  push(out(start.id).flatMap(target), [], [], start.id);
  let stopped = false;
  const advance = (at: string, owes: string[], fans: string[]) => {
    const left = owes.filter((j) => j !== at);
    try {
      const moves = step(at);
      if (moves.length > 0) {
        push(moves, left, fans, at);
        return;
      }
      // This branch ended: it has finished for every Join it counts for --
      // a stand-in arrival at each, owing none of the others (one at an
      // inner Join owing the outer one, and one there owing the inner,
      // waited for each other: a branch ending before a loop's entry
      // anchor where another Join meets it).
      for (const j of left) {
        if (!tokens.some((t) => t.at === j && t.waiting)) {
          tokens.push({ at: j, waiting: 'meet', owes: [], fans });
        }
      }
    } catch (e) {
      if (!hooks.isStop?.(e)) throw e;
      // The other branches finish; nothing after them runs.
      stopped = true;
    }
  };
  const live = (t: Token, except: string) => t.at !== except && t.waiting !== 'loop';
  /** Whether every way on from `id` ends without reaching a meeting point,
   * a loop's test or a way back round a loop (forward edges). */
  const endsAloneMemo = new Map<string, boolean>();
  const endsAlone = (id: string): boolean => {
    const known = endsAloneMemo.get(id);
    if (known !== undefined) return known;
    const result = ![...reachSet(id)].some(
      (n) =>
        forwardIn(n).length > 1 ||
        testHeads(n).length > 0 ||
        out(n).some((e) => backEdges.has(e.id))
    );
    endsAloneMemo.set(id, result);
    return result;
  };
  /** The heads a condition goes back to: it is that loop's test, at its end. */
  const testHeads = (id: string): string[] =>
    nodes.get(id)?.type === 'condition'
      ? out(id)
          .filter((e) => backEdges.has(e.id))
          .map((e) => e.target)
      : [];
  /** A loop's own test at its end (a do-while's, an until's): a condition
   * going back on its own -- no block of another kind (an until block's
   * own no side), not to a Repeat While head. Not a choose case or an if
   * going back to an enclosing while's head. */
  const isTestAtEnd = (id: string): boolean => {
    const node = nodes.get(id);
    if (node?.type !== 'condition') return false;
    return out(id).some((e) => {
      if (!backEdges.has(e.id)) return false;
      const own = blockKey(node);
      if (e.sourceHandle === 'false' && own === 'repeat_until') return true;
      return own === undefined && blockKey(nodes.get(e.target)) !== 'repeat_while';
    });
  };
  /** The nodes a loop's back edges leave from: its body's ends. */
  const loopEnds = (head: string) =>
    edges.filter((e) => e.target === head && backEdges.has(e.id)).map((e) => e.source);
  /** #267: a branch beside the way to `t` is still running -- one that came
   * out of a fan-out `t`'s own path came out of, since its paths diverged
   * (see the rules above). */
  const besideStillRunning = (t: Token): boolean => {
    const inScope = (fan: string) => {
      const from = fanFrom.get(fan);
      if (from === undefined) return false;
      if (t.waiting === 'loop') {
        const head = t.loop!;
        return (
          dominates(head, from) && loopEnds(head).some((end) => end === from || reaches(from, end))
        );
      }
      // A loop's test at its end (a do-while, an until): the round's
      // branches finish before it's asked, whichever way it then goes.
      if (t.waiting === 'test') {
        return testHeads(t.at).some(
          (head) => dominates(head, from) && (from === t.at || reaches(from, t.at))
        );
      }
      // Not the fan-out where the meeting point's own paths split (#99:
      // B and C meeting at E beside D -- E runs after B and C, alongside
      // D), only one after it.
      const split = divergence(t.at);
      return split !== undefined && from !== split && dominates(split, from);
    };
    const scoped = t.fans.filter(inScope);
    // A branch beside it still running: one that ends without getting to
    // a meeting point or a loop's test. One that does (another meeting
    // point the same branches meet at, #12; a line to where an outer if's
    // paths meet, #152; a step after the meeting point a branch runs into,
    // D4) goes on by those rules.
    return (
      scoped.length > 0 &&
      tokens.some(
        (o) =>
          o !== t &&
          !o.waiting &&
          o.at !== t.at &&
          // A loop's next pass waits for every branch of its pass still
          // on its way (one going to a step other lines lead to too, #267:
          // left behind each pass, it never ran while the loop went
          // round); a branch that is running always gets somewhere.
          (t.waiting === 'loop' || endsAlone(o.at)) &&
          o.fans.some((f) => scoped.includes(f))
      )
    );
  };
  const isReady = (t: Token): boolean => {
    if (besideStillRunning(t)) {
      t.beside = true;
      return false;
    }
    // A Join also waits for the branches that count for it but went
    // another way: they have to finish first.
    if (t.waiting !== 'loop') {
      // A branch going round a loop still owes it: its next pass is part
      // of it (#267: a step beside a do-while's test ended, and the Join
      // after the loop went on while the loop went round).
      return !tokens.some(
        (o) =>
          (live(o, t.at) && reaches(o.at, t.at)) ||
          (o !== t && o.at !== t.at && o.owes.includes(t.at))
      );
    }
    // The next pass waits until nothing is left in the body: no other token
    // at or on its way to any of the loop's ends, nor on a branch a step at
    // a body's end fans out to besides going back -- that branch is part of
    // this pass (bug #260: such tokens were left waiting forever, one more
    // each pass). A test's other edges are the loop's exit, not its body.
    const ends = loopEnds(t.loop!);
    const stepEnds = ends.filter((end) => nodes.get(end)?.type !== 'condition');
    return !tokens.some(
      (o) =>
        live(o, t.at) &&
        (ends.some((end) => o.at === end || reaches(o.at, end)) ||
          stepEnds.some((end) => reaches(end, o.at)))
    );
  };
  /** Runs `token`'s node, with every token waiting at it (they go on as
   * one). Starting a loop's next pass starts all of it: tokens that came
   * down the same loop's back edges to other nodes (a count loop's body
   * that opens with a parallel) become that pass's branches. */
  const release = (token: Token) => {
    const at = token.at;
    // After a `stop`, a loop's next pass is after it: it never starts (a
    // stop in a parallel in a loop body ran the loop on; bug #260).
    if (stopped && token.waiting === 'loop') {
      tokens = tokens.filter((t) => !(t.waiting === 'loop' && t.loop === token.loop));
      return;
    }
    if (token.waiting === 'loop') {
      for (const t of tokens) {
        if (t !== token && t.waiting === 'loop' && t.loop === token.loop && t.at !== at) {
          t.waiting = false;
          t.loop = undefined;
        }
      }
    }
    // #133: at a meeting point, with every token already there, waiting or
    // not yet looked at (a fan-out's branch that goes straight there
    // arrives before the others are marked): they go on as one. Not one
    // that came down a loop's back edge, which waits for that loop's next
    // pass.
    const meeting = forwardIn(at).length > 1;
    const merged = tokens.filter(
      (t) => t === token || (t.at === at && (t.waiting || (meeting && t.loop === undefined)))
    );
    tokens = tokens.filter((t) => !merged.includes(t));
    // Every branch it waited for has finished: none still counts for it.
    for (const t of tokens) t.owes = t.owes.filter((j) => j !== at);
    // A loop's next pass starts: the fan-outs of the pass before (inside
    // the loop) are behind it -- not carried round, one more each pass.
    const fans = [...new Set(merged.flatMap((t) => t.fans))];
    const head = token.waiting === 'loop' ? token.loop : undefined;
    advance(
      at,
      [...new Set(merged.flatMap((t) => t.owes))],
      head === undefined ? fans : fans.filter((f) => !dominates(head, fanFrom.get(f) ?? ''))
    );
  };
  while (tokens.length > 0) {
    let token: Token | undefined;
    let resumed: Token | undefined;
    for (let k = tokens.length - 1; k >= 0 && !token && !resumed; k--) {
      const t = tokens[k];
      if (!t.waiting) token = t;
      // One held back only for a branch beside it goes on in its turn once
      // that branch is done: depth first, as a YAML run (the steps beside,
      // then the round or what follows), not after every other branch.
      else if (t.beside && !stopped && isReady(t)) resumed = t;
    }
    if (resumed) {
      release(resumed);
      continue;
    }
    if (token) {
      if (token.loop !== undefined) token.waiting = 'loop';
      else if (forwardIn(token.at).length > 1) token.waiting = 'meet';
      else if (isTestAtEnd(token.at)) token.waiting = 'test';
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
