import {
  type ConditionNode,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  TRIGGER_KEYS_KEEPING_NULL,
} from '@circuitry/shared';
import {
  goesRoundEarlyInAWhile,
  hasCycleWithin,
  loopStructure,
  twoWaysOutOfALoop,
  untilExit,
} from '../analyzer/loops';
import { findBackEdges } from '../analyzer/topology';
import { undominated } from '../utils/undominated';
import type { BProgram, BStep } from './behaviorProgram';
import { normalizeActionData } from './behaviorProgram';
import { type BoolExpr, parseConditionExpr } from './boolean';
import { graphActionToCompiled, isFallbackRepeatNodeData } from './compiledAction';
import { parseActionSequence } from './extractFromYaml';

/**
 * Extracts a canonical BProgram directly from the graph the user actually
 * drew on the canvas -- independent of NativeStrategy's own shape-matching
 * code (choose-chain detection, OR-pattern detection, leading-condition
 * promotion, ...). It answers a different, more basic question than
 * NativeStrategy does: not "what's a nice-looking native YAML shape for
 * this graph" but "what does this graph structurally MEAN, if you just
 * follow its edges." The two questions have the same answer for a correct
 * NativeStrategy conversion, but this file never assumes that -- it's
 * built from the graph's own edges and HA's documented execution grammar
 * only, so a bug in NativeStrategy's shape-matching produces a genuine
 * divergence here rather than being invisible to both sides at once (the
 * "shared blind spot" risk that ruled out reusing NativeStrategy's own
 * transform logic to build the comparison baseline -- see project memory's
 * Phase B notes, "the maintainer chose option (b)").
 *
 * `parseConditionExpr` (boolean.ts) is the one piece of logic this file
 * deliberately DOES share with extractFromYaml.ts. That's not the same
 * kind of sharing: it isn't a NativeStrategy shaping heuristic, it's a
 * direct, mechanical encoding of HA's own documented and/or/not semantics
 * (verified against home-assistant/core's actual condition.py, not
 * assumed), applied identically to two DIFFERENT raw inputs (a canvas
 * node's `data`, and a parsed YAML condition object). A bug in it would
 * show up as a genuine divergence between the two sides (each is
 * interpreting different source material through the same lens), not as a
 * shape-specific blind spot that only manifests when NativeStrategy takes
 * a particular shortcut.
 */

interface Ctx {
  flow: FlowGraph;
  nodesById: Map<string, FlowNode>;
  outgoing: Map<string, FlowEdge[]>;
  incoming: Map<string, FlowEdge[]>;
  backEdgeIds: Set<string>;
  loopsByEntry: Map<string, LoopInfo>;
  /** #284: entries two loops share (#28), when reading only some branches
   * of a fan-out: an error once a walk reaches one (a branch machine,
   * read as states, never does). */
  sharedEntries: Map<string, SharedLoopEntryError>;
  /** #284, the same for a line back no loop owns (#114), by the step it
   * leaves from. */
  unownedEdges: Map<string, { error: Error; targets: string[]; loop?: Set<string> }>;
  /** Set only by findTreeContinuedPathEnds: where to record them. */
  pathEnds?: PathEnd[];
  /** One entry per parallel (fan-out) the walk is inside, innermost last:
   * whether the path ends after it -- nothing its branches lead to runs
   * after it (pathEndsAfter). */
  parallels: boolean[];
  /** Where the walk carries on after what it's inside, innermost last: an
   * if whose branches meet, or a loop (its next round), each with how many
   * parallels it's inside (see recordPathEnd, decision D5). */
  carryOns: CarryOn[];
  /** Set only by scanPathEnds: path ends no stop can be added at. */
  rewrites?: PathEndRewrites;
}

/** How many parallels it's inside, and for an if, its tail copy. */
interface CarryOn {
  parallels: number;
  copy?: TailCopy;
}

/**
 * Decision D5: an if inside a parallel branch whose branches meet, with a
 * path in it that ends where the tree reading carries on to that meeting
 * point, while something runs after the parallel (so no `stop` can be added
 * there, #150). Written by copying what follows the meeting point, up to
 * where the if's branches would have gone on anyway (`outerStop`), into
 * its else side: then the ending path has nothing after it to carry on to.
 */
export interface TailCopy {
  /** The if's conditions (an AND chain shares one else). */
  chain: string[];
  thenTargets: string[];
  elseTargets: string[];
  meetings: string[];
  outerStop: string[];
}

/** What scanPathEnds finds besides the ends that get a stop. */
export interface PathEndRewrites {
  /** Each with the first path end that needs it. */
  copies: (TailCopy & { end: PathEnd })[];
  /** Ends no copy writes: inside a loop in a parallel branch (it would go
   * round again), while something runs after the parallel. */
  unwritable: PathEnd[];
}

/**
 * A place where a path of the graph just ends -- an action with no
 * outgoing edge, or a condition with no false (or no true) edge -- at a
 * point where this file's tree reading would carry on with something
 * after it (the step where the enclosing if's branches meet again, or the
 * enclosing loop's next round). See findTreeContinuedPathEnds.
 */
export interface PathEnd {
  nodeId: string;
  /** For a condition: the handle with no edge. */
  handle?: 'true' | 'false';
}

interface LoopInfo {
  kind: 'while' | 'until' | 'count';
  testNodeId: string;
  /**
   * For 'while'/'until': the loop's whole condition list, head first (see
   * loopConditionChain). The loop tests all of them, AND'd.
   */
  testNodeIds?: string[];
  bodyEntryIds: string[];
  exitTargetIds: string[];
  /** The loop's test is the negation of its condition: an until that
   * repeats while the test HOLDS (a do-while, bug #259), or a while whose
   * body is its head's "no" side (bug #263). */
  negated?: boolean;
  /** For 'until': steps the test's round side also goes on to (#265: as
   * drawn they run each round beside going round; HA's `repeat` can only
   * go round, so a walk reaching the loop refuses). */
  beside?: string[];
  /** #293: a do-while's test on the way round (not its own) that ends on one
   * side: no repeat says the round stops there. */
  endsOnTheWay?: string;
  /** For 'count' only -- see extractCountValue's doc comment. */
  count?: string;
  /** For 'count' only -- see counterVarNameFromCondition's doc comment. The
   * counter-increment set_variables node, when present: the body walk must
   * stop here instead of at testNodeId so this bookkeeping node never shows
   * up as an extra action step. */
  incrementNodeId?: string;
}

export interface GraphExtraction {
  /** Normalized trigger objects (same shape/stripping as NativeStrategy's own buildTrigger, applied independently here). */
  triggers: Record<string, unknown>[];
  /** The action program reachable from the trigger(s)/start node, per HA's "all triggers share one action sequence" rule. */
  program: BProgram;
  /** Script-mode `fields:`, when the flow has a `start` node with fields. */
  scriptFields?: Record<string, unknown>;
  isScriptMode: boolean;
  mode: string;
  max?: unknown;
  maxExceeded?: unknown;
  initialState?: unknown;
  trace?: unknown;
  userVariables: Record<string, unknown>;
  triggerVariables?: Record<string, unknown>;
}

function buildCtx(
  flow: FlowGraph,
  entries: string[] = [],
  /** Report two loops sharing an entry when a walk reaches it, not at once
   * (#284). */
  lazyConflicts = false
): Ctx {
  const stripped: FlowGraph = {
    ...flow,
    edges: flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint'),
  };
  const nodesById = new Map(stripped.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, FlowEdge[]>();
  const incoming = new Map<string, FlowEdge[]>();
  for (const e of stripped.edges) {
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e);
    (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e);
  }
  const backEdgeIds = findBackEdges(stripped, entries);
  const ctx: Ctx = {
    flow: stripped,
    nodesById,
    outgoing,
    incoming,
    backEdgeIds,
    loopsByEntry: new Map(),
    sharedEntries: new Map(),
    unownedEdges: new Map(),
    parallels: [],
    carryOns: [],
  };
  ctx.loopsByEntry = detectLoops(ctx);
  if (!lazyConflicts) {
    const shared = ctx.sharedEntries.values().next();
    if (!shared.done) throw shared.value;
    const unowned = ctx.unownedEdges.values().next();
    if (!unowned.done) throw unowned.value.error;
  }
  return ctx;
}

function forwardOutgoing(ctx: Ctx, nodeId: string): FlowEdge[] {
  return (ctx.outgoing.get(nodeId) ?? []).filter((e) => !ctx.backEdgeIds.has(e.id));
}

/** Two different loops whose back edges go to the same step (#28): which
 * one is inside the other can't be told. Typed so FlowTranspiler can give
 * the user the reason (#134). */
export class SharedLoopEntryError extends Error {
  constructor(
    readonly entryId: string,
    readonly loops: [LoopInfo, LoopInfo]
  ) {
    super(
      `two loops share entry node "${entryId}" (${loops[0].kind} tested at "${loops[0].testNodeId}", ` +
        `${loops[1].kind} tested at "${loops[1].testNodeId}"); cannot tell which one encloses the other`
    );
    this.name = 'SharedLoopEntryError';
  }
}

/**
 * Classifies every structural back-edge into a while/until/count loop,
 * keyed by the node id where a forward walk must intercept it (the test
 * node itself for 'while' -- the loop's natural forward entry point is the
 * test; the first body node for 'until'/'count' -- the loop's natural
 * forward entry point is the body, and the test is only reached once the
 * body finishes). This mirrors the classification rule documented on
 * RepeatPattern/native.ts's detectRepeatPatterns (a fact about how the
 * canvas encodes loops, not a NativeStrategy shaping choice), but is its
 * own from-scratch implementation -- native.ts's version is private, and
 * duplicating the *rule* (not the code) independently means a bug in
 * either implementation is far more likely to produce a real, catchable
 * divergence than to reproduce itself identically on both sides.
 */
function detectLoops(ctx: Ctx): Map<string, LoopInfo> {
  const loops = new Map<string, LoopInfo>();
  // Bug #28 (2026-09-26): two different loops can claim the same entry
  // node -- an until whose body opens with another loop, drawn without the
  // Join anchor YamlParser/FlowTranspiler put there. A plain Map.set let
  // the later one silently replace the earlier (and native.ts's table did
  // the same, so the gate agreed with a wrong compile). Refuse instead:
  // the same loop may be recorded more than once (a while head with
  // several body exits), a different one may not.
  const setLoop = (entryId: string, info: LoopInfo): void => {
    const existing = loops.get(entryId);
    // A hand-wired until list can give a member its own false back-edge
    // (the same loop-back as the head's): that is the same loop, recorded
    // from the member. Keep whichever record has the longer list (the
    // head's).
    // Bug #294: the same kind both ways round -- a do-while is recorded as
    // a negated until, so an until on a list's "no" side and a do-while on
    // its member's "yes" side, back to the same step, looked like one loop
    // recorded twice, and the other side's round was lost.
    if (
      existing &&
      existing.kind === info.kind &&
      Boolean(existing.negated) === Boolean(info.negated) &&
      existing.testNodeId !== info.testNodeId &&
      ((existing.testNodeIds ?? []).includes(info.testNodeId) ||
        (info.testNodeIds ?? []).includes(existing.testNodeId))
    ) {
      if ((info.testNodeIds?.length ?? 1) > (existing.testNodeIds?.length ?? 1)) {
        loops.set(entryId, info);
      }
      return;
    }
    // Bug #264: the same test looping back on both sides (a do-while's
    // yes and an until's no, to the same step) is no loop its test can
    // end; read as one of them, the other side was lost.
    if (
      existing &&
      (existing.kind !== info.kind ||
        existing.testNodeId !== info.testNodeId ||
        Boolean(existing.negated) !== Boolean(info.negated))
    ) {
      if (!ctx.sharedEntries.has(entryId)) {
        ctx.sharedEntries.set(entryId, new SharedLoopEntryError(entryId, [existing, info]));
      }
      return;
    }
    loops.set(entryId, info);
  };
  // Kept, not thrown here: buildCtx reports it (or a walk reaching it).
  const unowned = (sourceId: string, targetId: string): void => {
    const found = ctx.unownedEdges.get(sourceId);
    if (found) {
      found.targets.push(targetId);
      return;
    }
    ctx.unownedEdges.set(sourceId, {
      error: new Error(
        `the edge from "${sourceId}" back to "${targetId}" belongs to no loop; cannot tell what it repeats`
      ),
      targets: [targetId],
    });
  };
  for (const edge of ctx.flow.edges) {
    if (!ctx.backEdgeIds.has(edge.id)) continue;
    const source = ctx.nodesById.get(edge.source);
    const target = ctx.nodesById.get(edge.target);
    if (!source || !target) continue;

    // Bug #22 (2026-09-26): a condition's back-edge is its own until loop
    // only when the condition is a `repeat_until` head (false handle); its
    // own count loop only when it carries no `_blockKey` at all (count
    // tests never do). Any other `_blockKey` head -- an if/else, a choose
    // case, an inner while or until finishing -- or any condition looping
    // back onto a `repeat_while` head is the LAST statement of an enclosing
    // while's body exiting back to that while's head. Handle-only
    // classification (the rule native.ts shared) turned `while A: [while B:
    // [...]]` into "until B".
    const sourceBlockKey = (source.data as Record<string, unknown> | undefined)?._blockKey;
    const targetBlockKey = (target.data as Record<string, unknown> | undefined)?._blockKey;
    const isOwnUntilEdge =
      source.type === 'condition' &&
      edge.sourceHandle === 'false' &&
      sourceBlockKey === 'repeat_until';
    const isBodyExitIntoEnclosingLoop =
      !isOwnUntilEdge &&
      source.type === 'condition' &&
      (typeof sourceBlockKey === 'string' || targetBlockKey === 'repeat_while');
    // Bug #114 (2026-09-27): such an edge going back to a step, not to a
    // loop's head, belongs to no loop this reading knows. It used to be
    // skipped, reading the side it leaves from as empty -- native did the
    // same, so the gate agreed with a compile that dropped the loop.
    if (isBodyExitIntoEnclosingLoop && target.type !== 'condition') {
      unowned(source.id, target.id);
      continue;
    }

    if (
      target.type === 'condition' &&
      (source.type !== 'condition' || isBodyExitIntoEnclosingLoop)
    ) {
      // while: entry = the test node itself. Bug #263: a step that loops
      // back from the test's "no" side -- the body is the no side, the
      // exit the yes side: `while: [not C]`. Read as a while on the yes
      // side, its body came out empty (native wrote it so, and this
      // agreed). Bug #292: the test may be a list (`and`); its "yes" side
      // is the last member's -- a member's own "no" line is the list's
      // "no", so reaching the step through it from the head's "yes" side
      // is no round on the yes side.
      const testNodeIds = loopConditionChain(ctx, target.id, 'while');
      const lastTestId = testNodeIds[testNodeIds.length - 1];
      const trueEdges = forwardOutgoing(ctx, lastTestId).filter((e) => e.sourceHandle === 'true');
      const falseEdges = forwardOutgoing(ctx, target.id).filter((e) => e.sourceHandle === 'false');
      // Bug #294: a way out that comes back round the loop (an if/else
      // meeting at a Join that goes back to the test): no side leaves, so
      // no repeat says it. Read as a while, what follows it was the steps
      // already read, nothing, and the loop ended where the canvas goes on.
      if (
        forwardReach(
          ctx,
          falseEdges.map((e) => e.target)
        ).has(source.id)
      ) {
        unowned(source.id, target.id);
        continue;
      }
      const yesSide = trueEdges.map((e) => e.target);
      // Whether the round is on the yes side: its own lines count even when
      // they are lines back (a "yes" line straight back round).
      const yesLines = (ctx.outgoing.get(lastTestId) ?? [])
        .filter((e) => e.sourceHandle === 'true')
        .map((e) => e.target);
      if (source.type !== 'condition' && !forwardReach(ctx, yesLines).has(source.id)) {
        setLoop(target.id, {
          kind: 'while',
          testNodeId: target.id,
          testNodeIds,
          bodyEntryIds: falseEdges.map((e) => e.target),
          exitTargetIds: yesSide,
          negated: true,
        });
        continue;
      }
      setLoop(target.id, {
        kind: 'while',
        testNodeId: target.id,
        testNodeIds,
        bodyEntryIds: trueEdges.map((e) => e.target),
        exitTargetIds: falseEdges.map((e) => e.target),
      });
    } else if (
      source.type === 'condition' &&
      edge.sourceHandle === 'false' &&
      !isBodyExitIntoEnclosingLoop
    ) {
      // until: entry = the first body node (the back-edge's own target).
      const testNodeIds = loopConditionChain(ctx, source.id, 'until');
      const lastTestId = testNodeIds[testNodeIds.length - 1];
      const trueEdges = forwardOutgoing(ctx, lastTestId).filter((e) => e.sourceHandle === 'true');
      setLoop(edge.target, {
        kind: 'until',
        testNodeId: source.id,
        testNodeIds,
        bodyEntryIds: [edge.target],
        exitTargetIds: trueEdges.map((e) => e.target),
        beside: forwardOutgoing(ctx, source.id)
          .filter((e) => e.sourceHandle === 'false')
          .map((e) => e.target),
      });
    } else if (
      source.type === 'condition' &&
      edge.sourceHandle === 'true' &&
      !isBodyExitIntoEnclosingLoop &&
      !counterVarNameFromCondition(source)
    ) {
      // do-while (bug #259): a condition that is not the parser's counter
      // test, its true edge looping back to the body's first node. The
      // body runs, then the test, and while it holds the body runs again:
      // `repeat: until: [not C]`, which is how NativeStrategy writes it.
      // Read as a count loop (below) its body walk stopped at once and the
      // count was empty.
      const falseEdges = forwardOutgoing(ctx, source.id).filter((e) => e.sourceHandle === 'false');
      // Bug #293: a test on the way round with a side that just ends (in a
      // fan-out's branch): the round stops there, which `repeat: until`
      // can't say. Read as an `if` with nothing in it, the loop went round
      // on its last test alone, and native wrote it so.
      const onTheWay = new Set<string>();
      const way = [edge.target];
      while (way.length > 0) {
        const id = way.pop()!;
        if (id === source.id || onTheWay.has(id)) continue;
        onTheWay.add(id);
        for (const e of forwardOutgoing(ctx, id)) way.push(e.target);
      }
      // Only tests the loop's test is reached from (one beside it ending is
      // a branch of its own, #267).
      const reachesTest = (id: string) => forwardReach(ctx, [id]).has(source.id);
      const endsOnTheWay = [...onTheWay].find((id) => {
        if (ctx.nodesById.get(id)?.type !== 'condition' || !reachesTest(id)) return false;
        const sides = new Set((ctx.outgoing.get(id) ?? []).map((e) => e.sourceHandle));
        return !sides.has('true') || !sides.has('false');
      });
      setLoop(edge.target, {
        kind: 'until',
        testNodeId: source.id,
        bodyEntryIds: [edge.target],
        exitTargetIds: falseEdges.map((e) => e.target),
        negated: true,
        ...(endsOnTheWay !== undefined ? { endsOnTheWay } : {}),
        beside: forwardOutgoing(ctx, source.id)
          .filter((e) => e.sourceHandle === 'true')
          .map((e) => e.target),
      });
    } else if (
      source.type === 'condition' &&
      edge.sourceHandle === 'true' &&
      !isBodyExitIntoEnclosingLoop
    ) {
      // count: YamlParser.ts's repeat.count decompile branch (read directly
      // from source this session) always wires
      // set_vars(counter=0) -> body... -> set_vars(counter+1) -> condition(counter<N),
      // with a true-handle back-edge from the condition to the first body
      // node. Both set_variables nodes are pure bookkeeping NativeStrategy
      // discards entirely when it renders `repeat: { count: N, sequence:
      // [...] }`, so they must be identified and excluded here too -- via
      // the counter variable's own naming convention (see
      // counterVarNameFromCondition), not merely "whichever node happens to
      // sit next to the condition/body-entry" -- so a genuine user-authored
      // set_variables node in that position is never mistaken for loop
      // bookkeeping.
      const loopTargetId = edge.target;
      const falseEdges = forwardOutgoing(ctx, source.id).filter((e) => e.sourceHandle === 'false');
      const varName = counterVarNameFromCondition(ctx.nodesById.get(source.id));

      const condPreds = (ctx.incoming.get(source.id) ?? []).filter(
        (e) => !ctx.backEdgeIds.has(e.id)
      );
      const incrementCandidate =
        condPreds.length === 1 ? ctx.nodesById.get(condPreds[0].source) : undefined;
      const incrementNodeId =
        varName && setsCounterVariable(incrementCandidate, varName)
          ? incrementCandidate!.id
          : undefined;

      // The back-edge's target IS the loop's init `set_variables` node
      // directly whenever a body exists (fixed 2026-09-06 in YamlParser.ts
      // -- it used to target `bodyResult.nodes[0]`, the first node CREATED
      // while parsing the body, only the same node as the init node's own
      // entry when the body's first step is a single action; a `parallel:`
      // first step made that just one arbitrary sibling with no edge back
      // to the others -- see native.ts's identical, independently-
      // implemented fix + comment for the full history). Recognize it the
      // same authoritative way as the increment node above (via the
      // counter variable's own name), guarding against the empty-body case
      // where loopTargetId IS the increment node itself (also a legitimate
      // match for setsCounterVariable, but not an init node). When it is
      // the init node, seed the body walk from ITS forward children --
      // reaching EVERY branch of a `parallel:` first step, not just one
      // sibling -- rather than from the init node itself, so its one-time
      // `variables: {counter: 0}` step is never mistaken for loop-body
      // content and compared as if NativeStrategy were supposed to render
      // it inside `repeat.sequence`.
      const hasBody = incrementNodeId === undefined || loopTargetId !== incrementNodeId;
      const initIsLoopTarget =
        hasBody && !!varName && setsCounterVariable(ctx.nodesById.get(loopTargetId), varName);
      const initNodeId = initIsLoopTarget ? loopTargetId : undefined;
      const bodyEntryIds = initIsLoopTarget
        ? forwardOutgoing(ctx, loopTargetId).map((e) => e.target)
        : [loopTargetId];

      setLoop(initNodeId ?? loopTargetId, {
        kind: 'count',
        testNodeId: source.id,
        bodyEntryIds,
        exitTargetIds: falseEdges.map((e) => e.target),
        count: extractCountValue(ctx, source.id),
        incrementNodeId,
      });
    } else {
      // #114: nor may any other loop-back edge (a step going back to a
      // step) be skipped.
      unowned(source.id, target.id);
    }
  }
  // Seed 20261018 session 421: one test ending two loops -- the end of a
  // do-while on its "yes" side and the head of a loop on its "no" side.
  // HA gives a loop's test to one `repeat:`; read as nested repeats, one
  // of the loops was written once. No structure holds it (the state
  // machine follows the lines). Each loop is kept by the step a walk
  // meets it at, so a walk that never gets there is unaffected.
  // #303: a member of one loop's test list too (an until's list whose
  // last member is another loop's test): written, the outer loop checked
  // it again after the inner one had.
  const entryOfTest = new Map<string, string>();
  for (const [entryId, loop] of loops) {
    for (const test of new Set([loop.testNodeId, ...(loop.testNodeIds ?? [])])) {
      const other = entryOfTest.get(test);
      if (other === undefined) {
        entryOfTest.set(test, entryId);
        continue;
      }
      if (other === entryId) continue;
      for (const id of [other, entryId]) {
        if (ctx.unownedEdges.has(id)) continue;
        ctx.unownedEdges.set(id, {
          error: new Error(
            `"${test}" is the test of two loops (going back to "${other}" and to "${entryId}"); no repeat holds both`
          ),
          // Reached by a walk, always a problem.
          targets: [id],
        });
      }
    }
  }
  // #302: two loops that overlap, neither inside the other: one's test a
  // step of the other's round (from its start to the lines back into it)
  // while its own start is outside that round. Read as nested repeats, the
  // first written used the shared step up and the other's line back was
  // lost; native wrote the same and this agreed.
  // A loop's round: the steps its start reaches going on that reach one of
  // the lines back into it -- what its start reaches, met with what reaches
  // those lines' sources (each one search, forward lines only). It used to
  // ask both of every step, a search each, for every loop: on a long
  // automation each save took more than twice as long (the 150-step save,
  // #224's test, went from under 3 s to about 7 under load).
  const forwardInto = new Map<string, string[]>();
  for (const n of ctx.flow.nodes)
    for (const e of forwardOutgoing(ctx, n.id))
      forwardInto.set(e.target, [...(forwardInto.get(e.target) ?? []), n.id]);
  const spread = (from: string[], next: (id: string) => string[]): Set<string> => {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...next(id));
    }
    return seen;
  };
  const roundOf = (entryId: string): Set<string> => {
    const ends = ctx.flow.edges
      .filter((e) => ctx.backEdgeIds.has(e.id) && e.target === entryId)
      .map((e) => e.source);
    const fromStart = spread([entryId], (id) => forwardOutgoing(ctx, id).map((e) => e.target));
    const toEnds = spread(ends, (id) => forwardInto.get(id) ?? []);
    return new Set([entryId, ...[...fromStart].filter((id) => toEnds.has(id))]);
  };
  for (const [outerEntry] of loops) {
    const round = roundOf(outerEntry);
    for (const [innerEntry, inner] of loops) {
      if (innerEntry === outerEntry) continue;
      const tests = inner.testNodeIds ?? [inner.testNodeId];
      const shared = tests.find((t) => round.has(t));
      if (shared === undefined || round.has(innerEntry)) continue;
      for (const id of [outerEntry, innerEntry]) {
        if (ctx.unownedEdges.has(id)) continue;
        ctx.unownedEdges.set(id, {
          error: new Error(
            `the loops going back to "${innerEntry}" and to "${outerEntry}" overlap ("${shared}" is in both, neither inside the other); no repeat holds them`
          ),
          targets: [id],
        });
      }
    }
  }
  // #315: a loop entered at more than one step (an irreducible region):
  // repeats nest, each entered at its start, so none holds it. Native
  // wrote one copy per way in, one of them without a step, and this read
  // it the same way.
  for (const loop of loopStructure(ctx.flow).loops) {
    if (!loop.irreducible) continue;
    const heads = [...loop.heads].sort();
    for (const id of heads) {
      if (ctx.unownedEdges.has(id)) continue;
      ctx.unownedEdges.set(id, {
        error: new Error(
          `the loop going round ${heads.map((h) => `"${h}"`).join(' and ')} is entered at more than one step; no repeat holds it`
        ),
        targets: [id],
        // #337: only a walk that goes round it: a branch whose end cuts
        // the loop (the branches meet in it) reads no loop there.
        loop: loop.nodes,
      });
    }
  }
  // #317: a path in a while's body going back to the test before the step
  // its condition's branches meet at: a body is one list, so no repeat
  // holds it (native wrote the meeting step after the if, for that path
  // too, and this read it the same way).
  const early = goesRoundEarlyInAWhile(ctx.flow);
  if (early !== null && !ctx.unownedEdges.has(early.head)) {
    ctx.unownedEdges.set(early.head, {
      error: new Error(
        `a path from "${early.at}" goes back round to "${early.head}" before "${early.meeting}", where its branches meet; no repeat holds it`
      ),
      targets: [early.head],
    });
  }
  // #318: a loop two of its tests lead out of, to a common step: one of
  // those ways out is a break, which no repeat holds (native wrote the
  // first test as an if in a loop on the second, and this read it the
  // same way).
  const twoOut = twoWaysOutOfALoop(ctx.flow);
  if (twoOut !== null && !ctx.unownedEdges.has(twoOut.head)) {
    ctx.unownedEdges.set(twoOut.head, {
      error: new Error(
        `"${twoOut.first}" and "${twoOut.second}" both lead out of the loop at "${twoOut.head}" and on to the same step; no repeat holds two ways out`
      ),
      targets: [twoOut.head],
    });
  }
  return loops;
}

/**
 * Item 4 (2026-09-26): a loop's condition LIST. `while: [A, B]` and
 * `until: [A, B]` are parsed as A -true-> B, with B (and any further
 * member) carrying no `_blockKey` and sharing the head's false edge (the
 * multi-condition list convention).
 * The loop tests them all, AND'd; the body (while) or the exit (until)
 * hangs off the LAST member's true edge. This extractor used to take the
 * head alone and read the rest of the list as an if inside the body
 * (while) or after the loop (until), so every multi-condition while/until
 * failed native verification and fell back to the state machine -- and
 * one inside a parallel branch was refused outright, because the
 * state-machine gate reads parallel branches through this file too.
 *
 * Same fold rule as native.ts's detectRepeatPatterns (implemented
 * independently): the next node is folded in when it is a condition
 * reached by the current member's one forward true edge, is not already
 * in the list, carries no `_blockKey` (that would be the head of another
 * construct -- bug #13), and has no false edge of its own -- or, for a
 * while, one that goes where the head's does; for an until, one that
 * loops back where the head's does.
 */
/** Bug #110: a list member has exactly one way in (the member before
 * it); where other paths also arrive is a statement of its own. Back edges
 * don't count. Native's hasOneWayIn states the same rule. */
function hasOneWayIn(ctx: Ctx, nodeId: string): boolean {
  return (ctx.incoming.get(nodeId) ?? []).filter((e) => !ctx.backEdgeIds.has(e.id)).length === 1;
}

function loopConditionChain(ctx: Ctx, headId: string, kind: 'while' | 'until'): string[] {
  const chain = [headId];
  const headExits = forwardOutgoing(ctx, headId)
    .filter((e) => e.sourceHandle === 'false')
    .map((e) => e.target);
  const headLoopBack = (ctx.outgoing.get(headId) ?? [])
    .filter((e) => e.sourceHandle === 'false' && ctx.backEdgeIds.has(e.id))
    .map((e) => e.target);
  let currentId = headId;
  while (true) {
    const trueEdges = forwardOutgoing(ctx, currentId).filter((e) => e.sourceHandle === 'true');
    if (trueEdges.length !== 1) break;
    const next = ctx.nodesById.get(trueEdges[0].target);
    if (next?.type !== 'condition' || chain.includes(next.id)) break;
    if (typeof (next.data as Record<string, unknown> | undefined)?._blockKey === 'string') break;
    if (!hasOneWayIn(ctx, next.id)) break;
    // Back-edges count here. A while member's false edge that loops back
    // (to the head, or anywhere) means "keep looping" -- the opposite of a
    // list member, whose false leaves the loop -- so `while W: [if C ...]`
    // with C's false edge back to W is NOT `while: [W, C]`. An until
    // member's false edge may loop back only to where the head's does
    // (that IS the member's inherited else).
    const nextFalse = (ctx.outgoing.get(next.id) ?? []).filter((e) => e.sourceHandle === 'false');
    const nextForwardFalse = nextFalse.filter((e) => !ctx.backEdgeIds.has(e.id));
    const nextBackFalse = nextFalse.filter((e) => ctx.backEdgeIds.has(e.id));
    let foldable: boolean;
    if (kind === 'while') {
      // Its false edges go exactly where the head's do: one exit, or all
      // of them when a parallel follows the loop (it used to
      // take one exit only, so such a list never folded).
      const exitKey = (targets: string[]) => [...new Set(targets)].sort().join('\u0000');
      foldable =
        nextFalse.length === 0 ||
        (headExits.length > 0 &&
          nextBackFalse.length === 0 &&
          exitKey(nextForwardFalse.map((e) => e.target)) === exitKey(headExits));
    } else {
      foldable =
        nextForwardFalse.length === 0 &&
        nextBackFalse.every((e) => headLoopBack.includes(e.target));
    }
    if (!foldable) break;
    chain.push(next.id);
    currentId = next.id;
  }
  return chain;
}

/** A while/until loop's whole test: its condition list, AND'd exactly the
 * way a YAML `while:`/`until:` list is (extractFromYaml.ts reads that list
 * with the same parseConditionExpr). */
function loopTest(ctx: Ctx, loop: LoopInfo): BoolExpr {
  const ids = loop.testNodeIds ?? [loop.testNodeId];
  const test =
    ids.length === 1
      ? parseConditionFromNode(ctx.nodesById.get(ids[0]) as ConditionNode)
      : parseConditionExpr(ids.map((id) => ctx.nodesById.get(id)?.data ?? {}));
  return loop.negated ? { op: 'not', arg: test } : test;
}

/**
 * A count-loop's test condition is a template counter check
 * (`{{ _repeat_counter_xxx < N }}`) that NativeStrategy discards entirely
 * in favor of a clean `repeat: { count: N, sequence: [...] }` -- the
 * counter mechanics (an init set_variables node and an increment
 * set_variables node, both structurally invisible in the rendered YAML)
 * only exist to make the loop editable/re-enterable on the canvas. Since
 * the rendered side never has the template or the counter steps to compare
 * against, the only way to check "same iteration count" is to extract N
 * from the same template convention here too. This is the one place this
 * file necessarily depends on a Circuitry-authoring convention rather than
 * pure HA grammar -- unavoidable, since count-loop iteration count has no
 * other representation on the canvas side at all.
 */
function extractCountValue(ctx: Ctx, conditionNodeId: string): string | undefined {
  const node = ctx.nodesById.get(conditionNodeId);
  if (node?.type !== 'condition') return undefined;
  const data = node.data as Record<string, unknown>;
  if (data.condition !== 'template') return undefined;
  const tmpl = data.value_template;
  if (typeof tmpl !== 'string') return undefined;
  const match = tmpl.match(/<\s*(\d+)\s*\}\}/);
  return match ? match[1] : undefined;
}

/**
 * Extracts the counter variable's own name directly from a count-loop
 * condition node's template (`{{ _repeat_counter_xxx < N }}` ->
 * `_repeat_counter_xxx`) -- the authoritative source for "which
 * set_variables nodes are this loop's bookkeeping", since it comes from the
 * condition itself rather than from graph wiring assumptions.
 */
function counterVarNameFromCondition(node: FlowNode | undefined): string | undefined {
  if (node?.type !== 'condition') return undefined;
  const data = node.data as Record<string, unknown>;
  if (data.condition !== 'template') return undefined;
  const tmpl = data.value_template;
  if (typeof tmpl !== 'string') return undefined;
  const match = tmpl.match(/(_repeat_counter_[A-Za-z0-9_]+)\s*<\s*\d+/);
  return match ? match[1] : undefined;
}

/** True iff `node` is a `set_variables` node whose ENTIRE `variables`
 * payload is exactly `{ [varName]: <anything> }` -- matching
 * YamlParser.ts's init/increment node shape precisely enough that a
 * genuine user-authored set_variables node (which would virtually never
 * consist of nothing but a single `_repeat_counter_...`-named variable) is
 * never mistaken for loop bookkeeping. */
function setsCounterVariable(node: FlowNode | undefined, varName: string): boolean {
  if (node?.type !== 'set_variables' || !varName) return false;
  const vars = (node.data as Record<string, unknown>).variables;
  if (!vars || typeof vars !== 'object') return false;
  const keys = Object.keys(vars as Record<string, unknown>);
  return keys.length === 1 && keys[0] === varName;
}

/**
 * Generalizes the old single-node findConvergence to the case where 2+
 * branches share 2+ SIBLING downstream nodes rather than one dominating
 * node (bug #12, found via the randomized fuzzer, 2026-09-06 -- see
 * native.ts's findConvergenceSet, which this mirrors exactly). Returns []
 * (no shared node), a single-element array (classic case, semantically
 * identical to the old findConvergence), or a 2+ element array for a
 * genuine sibling set, ordered nearest-first.
 */
function findConvergenceSet(
  ctx: Ctx,
  startsOrGroups: (string | string[])[],
  stop: string | Set<string> | null = null,
  /** An if's branches (one runs), not a fan-out's (all run): a meeting a
   * run gets around doesn't count (#266). */
  exclusive = false
): string[] {
  // A group of starts is one branch (bug #50, 2026-09-26 -- an if's else
  // that is itself a parallel); see native.ts's findConvergenceSet.
  const groups = startsOrGroups
    .map((s) => (Array.isArray(s) ? s : [s]))
    .filter((g) => g.length > 0);
  if (groups.length < 2) return [];
  // `stop` (#99): a stop node can itself be where the branches meet, but
  // nothing past it is (it belongs to whoever set the stop).
  const reachableSets = groups.map((group) => {
    const seen = new Set<string>();
    const queue = [...group];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (stopHas(stop, id)) continue;
      for (const e of forwardOutgoing(ctx, id)) queue.push(e.target);
    }
    return seen;
  });
  let common = [...reachableSets[0]].filter((id) => reachableSets.every((s) => s.has(id)));

  // Reduce to the minimal/undominated antichain: drop any common node
  // reachable (forward) from another common node -- it's downstream of a
  // sibling, not a sibling itself. Bug #266: one that some path from the
  // branches gets around, to what follows it, isn't where they meet; they
  // meet further on. Same rule as native.ts's findConvergenceSet, written
  // independently.
  let minimal: string[] = [];
  while (common.length > 0) {
    minimal = undominated(
      common,
      (id) => forwardOutgoing(ctx, id).map((e) => e.target),
      (id) => stopHas(stop, id)
    );
    if (!exclusive || !runGetsAround(ctx, groups, new Set(minimal), stop)) break;
    const around = new Set(minimal);
    common = common.filter((id) => !around.has(id));
    minimal = [];
  }
  if (minimal.length <= 1) return minimal;
  // #321: an if's branches meet at a set of steps only where no run goes
  // to one of them and not the others (a fan-out to all of them). Where one
  // run goes to a step and another to a path that ends, they don't meet at
  // all: each branch runs its own way on.
  if (exclusive && !noRunSplitsTheMeeting(ctx, groups, minimal, stop)) return [];

  const withDistance = minimal.map((id) => ({
    id,
    maxDist: Math.max(
      ...groups.map((group) => Math.min(...group.map((s) => shortestDistance(ctx, s, id))))
    ),
  }));
  withDistance.sort((a, b) => a.maxDist - b.maxDist);
  return withDistance.map((d) => d.id);
}

/** Bug #266: whether a run from one of `groups` (the branches of an if: one
 * runs) can reach something `meeting` leads to without running `meeting`
 * itself -- a condition takes one side, a step runs every line out of it,
 * so a line past the meeting point beside one to it (D4) still runs it.
 * Same rule as native.ts's someWayGetsPast, written independently. */
function runGetsAround(
  ctx: Ctx,
  groups: string[][],
  meeting: Set<string>,
  stop: string | Set<string> | null
): boolean {
  const after = new Set<string>();
  const stack = [...meeting].flatMap((id) => forwardOutgoing(ctx, id).map((e) => e.target));
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (after.has(id) || meeting.has(id)) continue;
    after.add(id);
    if (stopHas(stop, id)) continue;
    for (const e of forwardOutgoing(ctx, id)) stack.push(e.target);
  }
  type Run = { runsIt: boolean; around: boolean };
  const seen = new Map<string, Run>();
  const together = (ids: string[]): Run => {
    const runs = ids.map(runFrom);
    const runsIt = runs.some((r) => r.runsIt);
    return { runsIt, around: !runsIt && runs.some((r) => r.around) };
  };
  const runFrom = (id: string): Run => {
    const known = seen.get(id);
    if (known) return known;
    seen.set(id, { runsIt: false, around: false });
    let run: Run;
    if (meeting.has(id)) run = { runsIt: true, around: false };
    else if (after.has(id)) run = { runsIt: false, around: true };
    // #323: a run that reaches where the walk stops (an outer meeting)
    // without the meeting point goes on past it there too.
    else if (stopHas(stop, id)) run = { runsIt: false, around: true };
    else if (ctx.nodesById.get(id)?.type === 'condition') {
      const yes = together(
        forwardOutgoing(ctx, id)
          .filter((e) => e.sourceHandle === 'true')
          .map((e) => e.target)
      );
      const no = together(
        forwardOutgoing(ctx, id)
          .filter((e) => e.sourceHandle === 'false')
          .map((e) => e.target)
      );
      run = { runsIt: yes.runsIt && no.runsIt, around: yes.around || no.around };
    } else run = together(forwardOutgoing(ctx, id).map((e) => e.target));
    seen.set(id, run);
    return run;
  };
  return groups.some((group) => together(group).around);
}

/** #321: whether `members` can be where `groups` (an if's branches) meet:
 * no run reaches one of them without the others -- a condition's run takes
 * either side, a step's runs every line out of it (a fan-out). A run that
 * ends first, at none of them (a `stop` in a branch), doesn't count. */
function noRunSplitsTheMeeting(
  ctx: Ctx,
  groups: string[][],
  members: string[],
  stop: string | Set<string> | null
): boolean {
  const memberSet = new Set(members);
  return members.every((target) => {
    type Reach = 'hit' | 'miss' | 'none';
    const seen = new Map<string, Reach>();
    const ofLines = (ids: string[]): Reach => {
      const each = ids.map(reach);
      return each.includes('hit') ? 'hit' : each.includes('miss') ? 'miss' : 'none';
    };
    const reach = (id: string): Reach => {
      const known = seen.get(id);
      if (known !== undefined) return known;
      seen.set(id, 'none');
      let result: Reach;
      if (id === target) result = 'hit';
      else if (memberSet.has(id)) result = 'miss';
      else if (stopHas(stop, id)) result = 'none';
      else if (ctx.nodesById.get(id)?.type === 'condition') {
        const side = (h: 'true' | 'false') =>
          ofLines(
            forwardOutgoing(ctx, id)
              .filter((e) => e.sourceHandle === h)
              .map((e) => e.target)
          );
        const sides = [side('true'), side('false')];
        result = sides.includes('miss') ? 'miss' : sides.includes('hit') ? 'hit' : 'none';
      } else result = ofLines(forwardOutgoing(ctx, id).map((e) => e.target));
      seen.set(id, result);
      return result;
    };
    return groups.every((group) => ofLines(group) !== 'miss');
  });
}

/** An enabled `stop` step with nothing after it and one way in: a stop of
 * one branch's own (a stop other paths also reach is a meeting point). */
function isStopOnly(ctx: Ctx, id: string): boolean {
  const node = ctx.nodesById.get(id);
  const data = node?.data as Record<string, unknown> | undefined;
  return (
    node?.type === 'action' &&
    data !== undefined &&
    'stop' in data &&
    data.enabled !== false &&
    (ctx.outgoing.get(id) ?? []).length === 0 &&
    (ctx.incoming.get(id) ?? []).filter((e) => !ctx.backEdgeIds.has(e.id)).length === 1
  );
}

function shortestDistance(ctx: Ctx, start: string, target: string): number {
  if (start === target) return 0;
  const seen = new Set<string>([start]);
  const queue: Array<[string, number]> = [[start, 0]];
  while (queue.length > 0) {
    const [id, dist] = queue.shift()!;
    for (const e of forwardOutgoing(ctx, id)) {
      if (e.target === target) return dist + 1;
      if (!seen.has(e.target)) {
        seen.add(e.target);
        queue.push([e.target, dist + 1]);
      }
    }
  }
  return Number.POSITIVE_INFINITY;
}

function parseConditionFromNode(node: ConditionNode): BoolExpr {
  return parseConditionExpr(node.data as Record<string, unknown>);
}

/** A repeat step built from an action node's own opaque `data.repeat`
 * fallback payload (see compiledAction.ts's isFallbackRepeatNodeData) --
 * the loop's condition/body were never decomposed into real graph nodes,
 * so its whole behavior lives inside this one node's data instead of
 * being reachable via back-edges the way detectLoops finds. Uses the same
 * BStep 'repeat' shape a decomposed loop produces so both compare
 * identically against a `repeat:` step on the YAML side. */
function fallbackRepeatStep(data: Record<string, unknown>): BStep {
  const repeat = data.repeat as Record<string, unknown>;
  // The body as one list, not step by step: a condition step gates the
  // rest of the body (bug #85: read on its own it gated nothing, and a loop
  // kept whole with one in its body was refused).
  const body: BProgram = Array.isArray(repeat.sequence)
    ? normalizeYamlActionsForFallback(repeat.sequence)
    : [];
  if (repeat.while) {
    return { k: 'repeat', mode: 'while', test: parseConditionExpr(repeat.while), body };
  }
  if (repeat.until) {
    return { k: 'repeat', mode: 'until', test: parseConditionExpr(repeat.until), body };
  }
  return {
    k: 'repeat',
    mode: 'count',
    count: repeat.count !== undefined ? String(repeat.count) : '',
    body,
  };
}

/**
 * A fallback repeat node's own `sequence` is raw, already-compiled YAML
 * action-step JSON (it round-tripped in verbatim from the original YAML,
 * per YamlParser's fallback path) -- not a graph node at all, so it can't
 * go through the normal node-walking recursion. It's parsed the exact same
 * way extractFromYaml.ts parses any other step list -- extractFromYaml.ts
 * has no reason to depend back on this file, so importing its sequence
 * parser here directly (rather than via a registration indirection) is
 * safe: no import cycle.
 */
function normalizeYamlActionsForFallback(steps: unknown[]): BProgram {
  return parseActionSequence(steps);
}

export function normalizeNodeAction(node: FlowNode): BStep | null {
  switch (node.type) {
    case 'trigger':
    case 'start':
    case 'join':
    case 'sequence_start':
    case 'sequence_end':
      // Transparent: contribute no step of their own. sequence_start/end
      // grouping is purely a naming/UI aid -- HA's `sequence:` building
      // block runs its contents in the exact same order as if they were
      // inlined, so it carries no distinct behavior to preserve here.
      return null;
    case 'condition':
      // Handled by the caller (walk) -- conditions produce an 'if' step,
      // never a plain action step.
      return null;
    case 'action':
      if (isFallbackRepeatNodeData(node.data as Record<string, unknown>)) {
        return fallbackRepeatStep(node.data as Record<string, unknown>);
      }
      return { k: 'action', call: normalizeActionData(graphActionToCompiled(node)) };
    default:
      return { k: 'action', call: normalizeActionData(graphActionToCompiled(node)) };
  }
}

/** Walks forward from one or more target ids, applying the parallel/OR-gate
 * fold described in this file's own design notes (project memory, Phase B)
 * when they all reconverge. */
/** Runs `walkBody` (a loop's body) as a place the walk carries on from
 * (the loop's next round). */
function insideLoop<T>(ctx: Ctx, walkBody: () => T): T {
  ctx.carryOns.push({ parallels: ctx.parallels.length });
  try {
    return walkBody();
  } finally {
    ctx.carryOns.pop();
  }
}

/**
 * Decision D4: where branches that meet at `meetings` stop -- there, and at
 * anything after it. A branch that runs on into a step after the meeting
 * point (through a step that isn't part of it) leaves that step to run
 * once, after the meeting point. The tree reading used to walk it into the
 * branch too, so it read that step twice, as native wrote it.
 */
function meetingBound(ctx: Ctx, meetings: string[]): string[] {
  return [...forwardReach(ctx, meetings)];
}

/** The stop nodes, as a list. */
function stopIds(stop: string | Set<string> | null): string[] {
  return stop === null ? [] : stop instanceof Set ? [...stop] : [stop];
}

function stopHas(stop: string | Set<string> | null, id: string): boolean {
  if (stop === null) return false;
  return stop instanceof Set ? stop.has(id) : stop === id;
}

/** #319: a while's or until's way out with no line is a path end (decision
 * D1: the run stops there), not the end of the loop and on to whatever the
 * tree reading carries on with (an outer loop's next round) -- unless the
 * loop is a branch (inside a parallel, or a step in it also leads out),
 * where a path that ends ends only its branch. The way out is
 * a while's head's "no" side (its "yes" when negated), an until's last
 * test's "yes" side (its "no" when negated). */
function recordLoopExitEnd(ctx: Ctx, loop: LoopInfo, stop: string | Set<string> | null): void {
  if (loop.exitTargetIds.length > 0) return;
  // Inside a parallel branch a path that ends ends only its branch; a stop
  // there would end the others too.
  if (ctx.parallels.length > 0) return;
  const tests = loop.testNodeIds ?? [loop.testNodeId];
  const at = loop.kind === 'until' ? tests[tests.length - 1] : tests[0];
  // The same where a step in the loop also leads out of it (a line round an
  // outer loop beside this one): the loop is a branch of that fan-out.
  const { loops, innermost } = loopStructure(ctx.flow);
  const index = innermost.get(at);
  if (index === undefined) return;
  const inLoop = loops[index].nodes;
  const stepLeads = [...inLoop].some(
    (id) =>
      ctx.nodesById.get(id)?.type !== 'condition' &&
      (ctx.outgoing.get(id) ?? []).some((e) => !inLoop.has(e.target))
  );
  if (stepLeads) return;
  const exitIsYes = (loop.kind === 'until') !== (loop.negated === true);
  const handle = exitIsYes ? 'true' : 'false';
  if ((ctx.outgoing.get(at) ?? []).some((e) => e.sourceHandle === handle)) return;
  recordPathEnd(ctx, stop, at, handle);
}

/** Records a path end when findTreeContinuedPathEnds is collecting them:
 * only where something would run after it in the tree reading (`stop` is
 * set: an enclosing if's meeting point or loop test), and not inside a
 * parallel branch (there a path that ends just ends its branch, in every
 * strategy) -- unless the path ends after that parallel and every one
 * around it: then a `stop` there ends nothing that would run, as HA raises
 * it once the other branches have finished (#150). */
function recordPathEnd(
  ctx: Ctx,
  stop: string | Set<string> | null,
  nodeId: string,
  handle?: 'true' | 'false'
): void {
  if (!ctx.pathEnds || stop === null) return;
  if (ctx.pathEnds.some((p) => p.nodeId === nodeId && p.handle === handle)) return;
  // A node that also comes AFTER the meeting point (reachable from it) is a
  // shared tail the tree reading merely copies into this branch -- the
  // automation's last step, say. Not a place where a path ends early.
  // Only for an if's meeting point: a loop's test (or a count loop's
  // increment) reaches its whole body, and is among the stops of an if
  // inside it whose branches meet (#154: a path ending in such an if went
  // on to the meeting point and round the loop again).
  const loopStops = new Set(
    [
      ...ctx.loopsByEntry.values(),
      ...[...ctx.sharedEntries.values()].flatMap((shared) => shared.loops),
    ].flatMap((loop) => [loop.testNodeId, ...(loop.incrementNodeId ? [loop.incrementNodeId] : [])])
  );
  const meetings = stopIds(stop).filter((id) => !loopStops.has(id));
  if (forwardReach(ctx, meetings).has(nodeId)) return;
  // The innermost parallel something runs after (1 for the outermost; 0
  // when there's none): a path that ends inside it ends only its branch.
  const goesOn = ctx.parallels.lastIndexOf(false) + 1;
  if (goesOn > 0) {
    // Decision D5: a stop can't be used. Where the tree reading carries on
    // to something inside that branch -- an if's meeting point, or a loop's
    // next round -- the path must end there instead: the if's tail is
    // copied; a loop can't be. Carrying on to where the branch itself ends
    // is right as it is.
    const frame = ctx.carryOns.at(-1);
    if (ctx.rewrites && frame && frame.parallels >= goesOn) {
      const copy = frame.copy;
      if (!copy) ctx.rewrites.unwritable.push(handle ? { nodeId, handle } : { nodeId });
      else if (!ctx.rewrites.copies.some((c) => c.chain[0] === copy.chain[0])) {
        ctx.rewrites.copies.push({ ...copy, end: handle ? { nodeId, handle } : { nodeId } });
      }
    }
    return;
  }
  ctx.pathEnds.push(handle ? { nodeId, handle } : { nodeId });
}

/**
 * Walks each branch of a fan-out up to `stop`, counting it as inside a
 * parallel. Bug #99 (2026-09-27): branches that meet again before `stop`
 * when not all of them do (B and C lead to E, D doesn't) are one branch --
 * a fan-out of their own, E once after both -- not one walk per branch,
 * which read E into B's branch and into C's (native.ts wrote it that way
 * too, so the gate passed it). A meeting no nesting of parallels can
 * write is refused. Same rule as native.ts's buildParallelBranches,
 * written independently.
 */
function walkBranches(
  ctx: Ctx,
  ids: string[],
  stop: string | Set<string> | null,
  visited: Set<string>,
  suppressLoopId?: string,
  /** Groups the caller reads itself (#284): left empty, unwalked. */
  skip?: (group: string[]) => boolean
): BProgram[] {
  const groups = meetingGroups(ctx, ids, stop);
  // A fan-out from a step that also goes back round its loop (a body's
  // last step): the loop's next round runs after the parallel, so a path
  // that ends in a branch ends only that branch (bug #260: a `stop` there
  // ended the whole run after one round). Not a fan-out that nothing
  // leaves round the loop from (#154: there the automation stops).
  // On the same side: a test whose "yes" goes back round and whose "no"
  // fans out runs one or the other, so nothing goes round after that
  // parallel (#328: its ends were read as only ending their branches, no
  // stop was written, and the tree reading carried on to an outer meeting).
  const goesRoundToo = ctx.flow.nodes.some((n) => {
    const out = ctx.outgoing.get(n.id) ?? [];
    const fan = ids.map((id) => out.find((e) => e.target === id && !ctx.backEdgeIds.has(e.id)));
    if (fan.some((e) => e === undefined)) return false;
    const side = fan[0]?.sourceHandle;
    return (
      fan.every((e) => e?.sourceHandle === side) &&
      out.some((e) => ctx.backEdgeIds.has(e.id) && e.sourceHandle === side)
    );
  });
  ctx.parallels.push(!goesRoundToo && pathEndsAfter(ctx, ids, stop));
  try {
    return groups.map((group) => {
      if (skip?.(group)) return [];
      if (group.length === 1) return walk(ctx, group[0], stop, new Set(visited), suppressLoopId);
      if (group.length === ids.length) {
        throw new Error(
          `branches ${ids.join(', ')} meet again in a way no parallel can be written for`
        );
      }
      return buildContinuation(ctx, group, stop, new Set(visited), suppressLoopId);
    });
  } finally {
    ctx.parallels.pop();
  }
}

/**
 * #150: whether nothing a fan-out's branches lead to runs after it -- no
 * edge leaves what they reach before `stop` (to the stop or past it, or
 * back to a loop's test). The tree reading carries on at `stop` after the
 * parallel; as drawn, the automation ends there.
 */
function pathEndsAfter(ctx: Ctx, ids: string[], stop: string | Set<string> | null): boolean {
  const reached = forwardReach(ctx, ids);
  const afterStop = afterStopOf(ctx, ids, stop);
  const region = new Set([...reached].filter((id) => !afterStop.has(id)));
  return [...region].every((id) => (ctx.outgoing.get(id) ?? []).every((e) => region.has(e.target)));
}

/**
 * #99: fan-out targets grouped by whether their branches meet before
 * `stop` -- share a node, forward edges only, neither the stop nor past
 * it -- linking everything that meets anything in a group. Each group
 * keeps the place of its first target.
 */
function meetingGroups(ctx: Ctx, ids: string[], stop: string | Set<string> | null): string[][] {
  // What comes after the stop runs once after it, whichever branch has a
  // (shortcut) edge to it: not a meeting of the branches.
  const afterStop = afterStopOf(ctx, ids, stop);
  const reach = ids.map((start) => {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id) || afterStop.has(id)) continue;
      seen.add(id);
      for (const e of forwardOutgoing(ctx, id)) queue.push(e.target);
    }
    return seen;
  });
  const groups: { members: number[]; nodes: Set<string> }[] = [];
  ids.forEach((_, i) => {
    const meeting = groups.filter((g) => [...reach[i]].some((id) => g.nodes.has(id)));
    const merged = {
      members: [...meeting.flatMap((g) => g.members), i].sort((a, b) => a - b),
      nodes: new Set([...meeting.flatMap((g) => [...g.nodes]), ...reach[i]]),
    };
    for (const g of meeting) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  });
  groups.sort((a, b) => a.members[0] - b.members[0]);
  return groups.map((g) => g.members.map((i) => ids[i]));
}

/** The stop the branches from `ids` lead to and everything after it (forward
 * edges). Only a stop they lead to counts: a loop's test they go back to
 * comes before them. */
function afterStopOf(ctx: Ctx, ids: string[], stop: string | Set<string> | null): Set<string> {
  const reached = forwardReach(ctx, ids);
  return forwardReach(
    ctx,
    stopIds(stop).filter((id) => reached.has(id))
  );
}

/** Every node reachable from `starts` by forward edges, `starts` included. */
function forwardReach(ctx: Ctx, starts: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of forwardOutgoing(ctx, id)) queue.push(e.target);
  }
  return seen;
}

/** Whether a line back round leaves the steps reached from `starts`
 * before `bound` (#346). */
function goesRoundBefore(ctx: Ctx, starts: string[], bound: Set<string>): boolean {
  const region = new Set<string>();
  const queue = starts.filter((id) => !bound.has(id));
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (region.has(id)) continue;
    region.add(id);
    for (const e of forwardOutgoing(ctx, id)) if (!bound.has(e.target)) queue.push(e.target);
  }
  return [...region].some((id) =>
    (ctx.outgoing.get(id) ?? []).some(
      (e) => ctx.backEdgeIds.has(e.id) && !region.has(e.target) && !bound.has(e.target)
    )
  );
}

/** Whether an enabled `stop` step is reached from `starts` before `until`. */
function stopsBefore(ctx: Ctx, starts: string[], until: string): boolean {
  const seen = new Set<string>();
  const queue = starts.filter((id) => id !== until);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const data = ctx.nodesById.get(id)?.data as Record<string, unknown> | undefined;
    if (data !== undefined && 'stop' in data && data.enabled !== false) return true;
    for (const e of forwardOutgoing(ctx, id)) if (e.target !== until) queue.push(e.target);
  }
  return false;
}

/** Bug #267: runs `walkOn` as branches beside the way the walk carries on,
 * when `beside` holds: a path ending in them ends only its branch (the
 * meeting point, the loop's test or its next round waits for them). */
function asBranches(ctx: Ctx, beside: boolean, walkOn: () => BProgram): BProgram {
  if (!beside) return walkOn();
  ctx.parallels.push(false);
  try {
    return walkOn();
  } finally {
    ctx.parallels.pop();
  }
}

/** Bug #267: whether `id` (on its `handle` side, for a condition) also goes
 * back round a loop: its other lines there lead to steps beside the way
 * round (the forward edges the walk follows leave that line out). */
function alsoGoesRound(ctx: Ctx, id: string, handle?: 'true' | 'false'): boolean {
  return (ctx.outgoing.get(id) ?? []).some(
    (e) => ctx.backEdgeIds.has(e.id) && (handle === undefined || e.sourceHandle === handle)
  );
}

function buildContinuation(
  ctx: Ctx,
  targetIds: string[],
  stop: string | Set<string> | null,
  visited: Set<string>,
  suppressLoopId?: string,
  sequentialFallback = false
): BProgram {
  // A target that a stop target leads to (#99: a shortcut edge past the
  // stop) runs once, after the stop, not also here.
  const afterStop = forwardReach(
    ctx,
    targetIds.filter((id) => stopHas(stop, id))
  );
  const ids = targetIds.filter((id) => !stopHas(stop, id) && !afterStop.has(id));
  if (ids.length === 0) return [];
  // Bug #267: a fan-out with a line to where the walk carries on (the
  // enclosing if's meeting point, a loop's test) beside the rest: the rest
  // run alongside that path, as branches of their own, and what comes
  // after waits for them. A path ending in one ends only its branch -- D1
  // made it end the run, so the meeting point never ran (an if) or the
  // loop ran once.
  if (ids.length < targetIds.length) {
    return asBranches(ctx, true, () =>
      ids.length === 1
        ? walk(ctx, ids[0], stop, visited, suppressLoopId)
        : buildContinuation(ctx, ids, stop, visited, suppressLoopId, sequentialFallback)
    );
  }
  if (ids.length === 1) return walk(ctx, ids[0], stop, visited, suppressLoopId);

  const convergenceSet = findConvergenceSet(ctx, ids, stop);

  // Classify each branch as a BARE condition test (its walked program is
  // exactly one `if` step, itself with BOTH then and else empty -- i.e.
  // nothing happens on that branch before hitting the shared convergence
  // point, on either outcome) or not. When every branch is a bare
  // condition test this way, the fan-out is a disjunction gating the
  // shared continuation, not a real concurrent parallel -- see this file's
  // doc comment. A branch's own walked program ALWAYS contains at least
  // one step for a condition-rooted branch (buildConditionChain emits the
  // `if` step for the condition itself even when both its outcomes are
  // empty) -- checking branchPrograms[i].length === 0 here can never be
  // true and always missed this case (a real bug, caught by
  // nested-conditions.test.ts's OR-convergence suite once the verification
  // gate was wired into FlowTranspiler and started flagging the resulting
  // false mismatches). Reusing the branch's own already-chain-folded `cond`
  // (rather than re-reading just the single node's condition data) also
  // makes this correct for a branch that is itself a multi-condition
  // AND-chain ending in an empty then/else, not just a single bare node.
  if (convergenceSet.length > 0) {
    // With the enclosing stop (#152): a branch's edge to where the
    // enclosing branches meet goes there, not into the branch. And what
    // comes after the meeting point (decision D4).
    const boundSet = new Set([...meetingBound(ctx, convergenceSet), ...stopIds(stop)]);
    const branchPrograms = walkBranches(ctx, ids, boundSet, visited, suppressLoopId);
    const branchConditions: BoolExpr[] = [];
    const allEmptyConditions = ids.every((id, i) => {
      const node = ctx.nodesById.get(id);
      const program = branchPrograms[i];
      const bareStep = program.length === 1 ? program[0] : null;
      const isBareCondition =
        node?.type === 'condition' &&
        bareStep !== null &&
        bareStep.k === 'if' &&
        bareStep.then.length === 0 &&
        bareStep.else.length === 0;
      if (isBareCondition) branchConditions.push((bareStep as Extract<BStep, { k: 'if' }>).cond);
      return isBareCondition;
    });

    // The OR-gate fold only applies with a single dominating convergence
    // node -- with 2+ sibling convergence nodes there is no single "then"
    // that could represent both continuations at once, so this falls
    // through to the general parallel-step handling below (bug #12 fix,
    // 2026-09-06).
    // #111: a Join goes on once every branch has finished, whether its test
    // passed or not -- never an OR of them.
    const atJoin = ctx.nodesById.get(convergenceSet[0])?.type === 'join';
    // #132: each branch's test is the way its branch gets there only when
    // nothing gets there through a "no" edge: a test whose "no" edge goes
    // there too always arrives, and the step runs whatever the tests say.
    const reachedOnlyByYes = (ctx.incoming.get(convergenceSet[0]) ?? [])
      .filter((e) => !ctx.backEdgeIds.has(e.id))
      .every((e) => e.sourceHandle === 'true');
    if (allEmptyConditions && convergenceSet.length === 1 && !atJoin && reachedOnlyByYes) {
      const orExpr: BoolExpr = { op: 'or', args: branchConditions };
      const then = walk(ctx, convergenceSet[0], stop, new Set(visited));
      return [{ k: 'if', cond: orExpr, then, else: [] }];
    }

    const filtered = branchPrograms.filter((p) => p.length > 0);
    const parallelStep: BProgram =
      filtered.length > 0 ? [{ k: 'parallel', branches: filtered }] : [];
    const continuation =
      convergenceSet.length === 1
        ? walk(ctx, convergenceSet[0], stop, new Set(visited))
        : buildContinuation(ctx, convergenceSet, stop, new Set(visited), suppressLoopId);
    return [...parallelStep, ...continuation];
  }

  // No shared convergence.
  if (sequentialFallback) {
    // This is the top-level fan-out from MULTIPLE trigger (or start) nodes,
    // each leading to its own fully disjoint downstream subtree -- e.g. two
    // independent trigger -> `condition: trigger` -> action chains in one
    // automation, each firing only for its own trigger. HA has no concept
    // of "parallel triggers": every trigger shares the SAME single
    // `actions:` sequence, run top-to-bottom on every execution regardless
    // of which trigger actually fired (a `condition: trigger, id: X` check
    // is what makes an unrelated branch a no-op that run). Treating
    // multiple disjoint trigger-rooted subtrees as a real `parallel:` block
    // was a real bug -- caught by if-then-else.test.ts's "independent flows
    // when condition: trigger id is an array" case once the verification
    // gate was wired into FlowTranspiler -- so these run SEQUENTIALLY, one
    // after another, never concurrently. This is scoped to the top-level
    // multi-entry call only (see extractFromGraph); an ordinary mid-flow
    // fan-out from a single node with no shared convergence is still a
    // genuine concurrent parallel, handled by the branch below.
    return ids.flatMap((id) => walk(ctx, id, stop, new Set(visited), suppressLoopId));
  }

  // Genuine fan-out from a single node with no shared convergence -- a real
  // concurrent parallel block with no continuation after it.
  const branchPrograms = walkBranches(ctx, ids, stop, visited, suppressLoopId);
  const filtered = branchPrograms.filter((p) => p.length > 0);
  return filtered.length > 0 ? [{ k: 'parallel', branches: filtered }] : [];
}

/**
 * `suppressLoopId`, when equal to `nodeId`, skips the loopsByEntry lookup
 * for this one call only. This matters for 'until'/'count' loops:
 * detectLoops keys those by the back-edge's own target -- which is also
 * that same loop's bodyEntryIds[0] -- so the very first call made while
 * building the loop's OWN body would otherwise land back on the identical
 * map entry and re-expand the same loop forever (a real infinite-recursion
 * bug, caught by canonicalization-behavioral-check.test.ts's until/count
 * cases -- "Maximum call stack size exceeded" -- not a theoretical one).
 * The suppression is scoped to exactly one call: once this entry node's own
 * action/condition content has been processed, every recursive call moves
 * on to a different nodeId (undefined suppressLoopId), so a loop nested
 * immediately inside another loop's body is still detected correctly.
 */
function walk(
  ctx: Ctx,
  nodeId: string,
  stop: string | Set<string> | null,
  visited: Set<string>,
  suppressLoopId?: string
): BProgram {
  if (stopHas(stop, nodeId)) return [];
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const shared = nodeId === suppressLoopId ? undefined : ctx.sharedEntries.get(nodeId);
  if (shared) throw shared;
  // A line back no loop owns, unless it leads out of what this walk reads
  // (to where its branch ends): that isn't this walk's loop (#284).
  const unownedLine = ctx.unownedEdges.get(nodeId);
  if (
    unownedLine?.targets.some((t) => !stopHas(stop, t)) &&
    (unownedLine.loop === undefined ||
      hasCycleWithin(ctx.flow, new Set([...unownedLine.loop].filter((id) => !stopHas(stop, id)))))
  )
    throw unownedLine.error;
  const loop = nodeId === suppressLoopId ? undefined : ctx.loopsByEntry.get(nodeId);
  if (loop) {
    if (loop.kind === 'while') {
      const cond = loopTest(ctx, loop);
      const body = insideLoop(ctx, () =>
        buildContinuation(ctx, loop.bodyEntryIds, loop.testNodeId, new Set(), nodeId)
      );
      recordLoopExitEnd(ctx, loop, stop);
      const after = buildContinuation(ctx, loop.exitTargetIds, stop, visited);
      return [{ k: 'repeat', mode: 'while', test: cond, body }, ...after];
    }
    if (loop.kind === 'until') {
      // #265: the test's round side also going on to steps -- drawn, they
      // run each round beside going round; a `repeat` only goes round (the
      // tree left them out, and this reading agreed; the state machine
      // writes them).
      if (loop.beside && loop.beside.length > 0)
        throw new Error(
          `the test "${loop.testNodeId}" goes back round its loop and also on to "${loop.beside[0]}", which no repeat says`
        );
      if (loop.endsOnTheWay !== undefined)
        throw new Error(
          `the test "${loop.endsOnTheWay}" on the way round the loop tested at "${loop.testNodeId}" ends on one side, which no repeat says`
        );
      const cond = loopTest(ctx, loop);
      const body = insideLoop(ctx, () =>
        buildContinuation(ctx, loop.bodyEntryIds, loop.testNodeId, new Set(), nodeId)
      );
      recordLoopExitEnd(ctx, loop, stop);
      const after = buildContinuation(ctx, loop.exitTargetIds, stop, visited);
      return [{ k: 'repeat', mode: 'until', test: cond, body }, ...after];
    }
    // count: stop the body walk at the increment bookkeeping node (when
    // found) rather than the test node itself, so that node never gets
    // emitted as an extra action step -- it has no counterpart at all in
    // NativeStrategy's rendered `repeat: { count: N, sequence: [...] }`.
    const bodyStop = loop.incrementNodeId ?? loop.testNodeId;
    const body = insideLoop(ctx, () =>
      buildContinuation(ctx, loop.bodyEntryIds, bodyStop, new Set(), nodeId)
    );
    const after = buildContinuation(ctx, loop.exitTargetIds, stop, visited);
    return [{ k: 'repeat', mode: 'count', count: loop.count ?? '', body }, ...after];
  }

  const node = ctx.nodesById.get(nodeId);
  if (!node) return [];

  if (node.type === 'condition') {
    return buildConditionChain(ctx, nodeId, stop, visited);
  }

  // Phase 5 (2026-09-26): a disabled step is skipped by HA -- no step at
  // all, the same as extractFromYaml.ts does for `enabled: false`.
  const action =
    (node.data as Record<string, unknown> | undefined)?.enabled === false
      ? null
      : normalizeNodeAction(node);
  const outTargets = forwardOutgoing(ctx, nodeId).map((e) => e.target);
  const data = node.data as Record<string, unknown>;
  const isStopStep = 'stop' in data && data.enabled !== false;
  if ((ctx.outgoing.get(nodeId) ?? []).length === 0 && !isStopStep)
    recordPathEnd(ctx, stop, nodeId);
  const rest = asBranches(ctx, alsoGoesRound(ctx, nodeId), () =>
    buildContinuation(ctx, outTargets, stop, visited)
  );
  return action ? [action, ...rest] : rest;
}

/**
 * Walks a chain of AND'd condition nodes into ONE `if` step, matching
 * native.ts's own "Condition Chain Logic" fold rule EXACTLY (read directly
 * from source this session, `buildSequenceFromNode`'s `canChain` check) --
 * not because that's a NativeStrategy shaping preference, but because it is
 * the objective definition of what an untouched false-handle on the canvas
 * MEANS. Home Assistant's own `if:` always has a well-defined false path;
 * the canvas format does not require wiring one, so "this condition node
 * has no false edge at all" is not "and if it's false, nothing happens" --
 * it is "this condition shares its nearest chain-ancestor's false target."
 * A condition node can be folded into the current chain when EITHER it has
 * no false edge of its own, OR its one false edge points at the exact same
 * target(s) as the chain's first condition's false edge -- exactly
 * native.ts's `canChain` predicate. Without this, a node with no false edge
 * extracts as `else: []` (a dead end) instead of "same as the chain's
 * shared else," producing a genuine false mismatch against NativeStrategy's
 * real (and correct) `if: [cond1, cond2, ...]` rendering -- caught by
 * 14-washingmachine.yaml and others in the real-fixture diagnostic suite.
 *
 * Exception (bug #21, 2026-09-26): the rule above is the encoding of a
 * multi-condition LIST, whose members never carry a `_blockKey`. A node
 * that does carry one is the head of a separate nested if/choose, and its
 * missing false edge really does mean "nothing happens" -- see the check
 * below.
 */
function buildConditionChain(
  ctx: Ctx,
  startId: string,
  stop: string | Set<string> | null,
  visited: Set<string>
): BProgram {
  // A condition that guards its loop ends the loop when it can't be
  // checked (analyzer/loops.ts, #283); an `if` takes its "no" side then,
  // which stays in the loop. Read as an if, it agreed with a tree that
  // went round where the canvas stops (editor fuzzer, seed 20261022,
  // session 832): no if can say it.
  if (untilExit(ctx.flow, startId) !== null)
    throw new Error(
      `the condition "${startId}" ends its loop when it can't be checked, which an if inside the loop can't say`
    );
  const conditions: BoolExpr[] = [];
  const elseTargets = forwardOutgoing(ctx, startId)
    .filter((e) => e.sourceHandle === 'false')
    .map((e) => e.target);

  let currentId = startId;
  const chain = [startId];
  let thenTargets: string[] = [];

  while (true) {
    const node = ctx.nodesById.get(currentId);
    if (!node || node.type !== 'condition') break;
    conditions.push(parseConditionFromNode(node as ConditionNode));

    const trueEdges = forwardOutgoing(ctx, currentId).filter((e) => e.sourceHandle === 'true');
    if (trueEdges.length === 0) {
      thenTargets = [];
      break;
    }
    if (trueEdges.length > 1) {
      thenTargets = trueEdges.map((e) => e.target);
      break;
    }

    const trueTarget = trueEdges[0].target;
    const nextNode = ctx.nodesById.get(trueTarget);
    const canContinueChain =
      nextNode?.type === 'condition' &&
      !visited.has(trueTarget) &&
      !ctx.loopsByEntry.has(trueTarget) &&
      !ctx.sharedEntries.has(trueTarget) &&
      !ctx.unownedEdges.has(trueTarget) &&
      hasOneWayIn(ctx, trueTarget);

    if (canContinueChain) {
      const nextFalseEdges = forwardOutgoing(ctx, trueTarget).filter(
        (e) => e.sourceHandle === 'false'
      );
      // Bug #21 (2026-09-26): the head of a separate nested if/choose (it
      // carries a `_blockKey`; a multi-condition list member never does)
      // with no false edge means "nothing happens" on false, not "share the
      // chain's else". It joins the chain only when its false targets are
      // exactly the chain's else targets.
      const isConstructHead =
        typeof (nextNode.data as Record<string, unknown> | undefined)?._blockKey === 'string';
      const nextFalseTargets = new Set(nextFalseEdges.map((e) => e.target));
      // Bug #26 (2026-09-26): a condition the chain's else path also leads
      // to is where then and else meet again (the next statement), never
      // an AND'd member.
      const reachedFromElse = elseTargets.some(
        (t) => t === trueTarget || shortestDistance(ctx, t, trueTarget) !== Number.POSITIVE_INFINITY
      );
      const canChain = reachedFromElse
        ? false
        : isConstructHead
          ? nextFalseTargets.size === new Set(elseTargets).size &&
            [...nextFalseTargets].every((id) => elseTargets.includes(id))
          : nextFalseEdges.length === 0 ||
            // Exactly the chain's else targets (several when a parallel
            // follows -- bug #51; native.ts's canFoldIntoAndChain).
            (nextFalseTargets.size === new Set(elseTargets).size &&
              [...nextFalseTargets].every((id) => elseTargets.includes(id)));
      if (canChain) {
        visited.add(trueTarget);
        currentId = trueTarget;
        chain.push(trueTarget);
        continue;
      }
    }

    thenTargets = [trueTarget];
    break;
  }

  const cond: BoolExpr = conditions.length === 1 ? conditions[0] : { op: 'and', args: conditions };
  const hasEdge = (id: string, handle: 'true' | 'false'): boolean =>
    (ctx.outgoing.get(id) ?? []).some((e) => e.sourceHandle === handle);
  if (!hasEdge(startId, 'false')) recordPathEnd(ctx, stop, startId, 'false');
  if (thenTargets.length === 0 && !hasEdge(currentId, 'true')) {
    recordPathEnd(ctx, stop, currentId, 'true');
  }

  // Do the then- and else-paths reconverge on a shared node BEFORE the
  // outer `stop` boundary (e.g. two branches of a nested if/else that both
  // feed into one shared trailing action, loop, or further condition)?
  // thenTargets and elseTargets are walked via two entirely SEPARATE
  // buildContinuation calls below, so neither call has any way to see the
  // other's reachable set -- each one only knows about the outer `stop`,
  // not about this inner join. Found via the parallel-entry fuzzer,
  // 2026-09-25: a nested if/else inside one branch of a trigger's own
  // multi-target parallel fan-out, where both outcomes fed into the same
  // trailing `repeat: while`, got that repeat duplicated into both the
  // `then` and `else` arrays instead of hoisted out once after the if --
  // behaviorally harmless in isolation (either way the repeat still runs
  // exactly once), but a different TREE SHAPE than what native.ts's own
  // generator already correctly produces (repeat emitted once, as a
  // sibling step after the if), so `programsEquivalent` reported a false
  // mismatch ("no way to match up the N parallel branch(es)") even though
  // the generated YAML was correct. This is the same class of fix
  // buildContinuation's own fan-out handling already applies to sibling
  // branches (findConvergenceSet + hoist-once) -- reapplied here because a
  // single condition's then/else is a second, distinct fan-out shape this
  // file didn't previously check for convergence between.
  //
  // Item 4 (2026-09-26): only when there IS an else path. With none, the
  // "convergence" found was the then-branch's own fan-out meeting again
  // (`if c then [parallel: [A, B], parallel: [C, D]]`), and the second
  // parallel was hoisted out of the if, as if it ran when c was false.
  const innerConvergence =
    thenTargets.length > 0 && elseTargets.length > 0
      ? findConvergenceSet(
          ctx,
          // Decision D1: a branch that is just a `stop` step never reaches
          // the meeting point but ends the automation; it doesn't keep the
          // other branches from meeting (native.ts's withoutStopOnly).
          [thenTargets, elseTargets].map((g) => g.filter((id) => !isStopOnly(ctx, id))),
          // #323: bounded by where this walk stops (native's bounded walk
          // does the same), so a run going on to an outer meeting without
          // the inner one counts as getting past it.
          stop,
          true
        ).filter((id) => !stopHas(stop, id))
      : [];
  const innerStop: string | Set<string> | null =
    innerConvergence.length > 0
      ? new Set([...stopIds(stop), ...meetingBound(ctx, innerConvergence)])
      : stop;

  // #342: a side's line to where the walk carries on runs there, after
  // this if and what follows it -- unless that ends the automation first
  // (a `stop` before getting there): then it runs beside, which no reading
  // after it gives.
  for (const left of [...thenTargets, ...elseTargets].filter((id) => stopHas(stop, id))) {
    if (stopsBefore(ctx, innerConvergence, left))
      throw new Error(`"${left}" runs beside a branch that ends the automation before it`);
  }
  // #346: the meeting point runs after the if; a side going back round
  // its loop before getting there doesn't run it, which that reading says.
  if (innerConvergence.length > 0) {
    const meet = new Set(innerConvergence);
    for (const side of [thenTargets, elseTargets]) {
      if (side.length > 0 && goesRoundBefore(ctx, side, meet))
        throw new Error(
          `a side goes back round its loop before "${innerConvergence[0]}", where the sides meet`
        );
    }
  }
  if (innerConvergence.length > 0) {
    ctx.carryOns.push({
      parallels: ctx.parallels.length,
      copy: {
        chain,
        thenTargets,
        elseTargets,
        meetings: innerConvergence,
        outerStop: stopIds(stop),
      },
    });
  }
  let then: BProgram;
  let els: BProgram;
  try {
    then = asBranches(ctx, alsoGoesRound(ctx, currentId, 'true'), () =>
      buildContinuation(ctx, thenTargets, innerStop, new Set(visited))
    );
    els = asBranches(ctx, alsoGoesRound(ctx, startId, 'false'), () =>
      buildContinuation(ctx, elseTargets, innerStop, new Set(visited))
    );
  } finally {
    if (innerConvergence.length > 0) ctx.carryOns.pop();
  }
  const ifStep: BStep = { k: 'if', cond, then, else: els };

  if (innerConvergence.length === 0) {
    return [ifStep];
  }
  const continuation =
    innerConvergence.length === 1
      ? walk(ctx, innerConvergence[0], stop, new Set(visited))
      : buildContinuation(ctx, innerConvergence, stop, new Set(visited));
  return [ifStep, ...continuation];
}

export function buildTrigger(node: FlowNode): Record<string, unknown> {
  const data = node.data as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (value === undefined) continue; // "" kept (bug #72)
    if (value === null && !TRIGGER_KEYS_KEEPING_NULL.has(key)) continue;
    cleaned[key] = value;
  }
  // Fold event context_user_id the same way BaseStrategy.foldEventContextUserId
  // does -- a documented HA wire-shape fact (event trigger's "Limit to
  // events triggered by" nests under context.user_id), not a NativeStrategy
  // shaping choice, so both extractors apply it identically.
  if (typeof cleaned.context_user_id === 'string' && cleaned.context_user_id) {
    const { context_user_id, ...rest } = cleaned;
    return { ...rest, context: { user_id: context_user_id } };
  }
  // A blank editing field (no user): not an HA key, never written (the
  // strategies' fold drops it too). Kept apart now that "" isn't dropped
  // wholesale (bug #72).
  delete cleaned.context_user_id;
  return cleaned;
}

/**
 * The branches of a fan-out from `targetIds` as canonical BPrograms, each
 * read up to `stop` (or to the flow's natural end when null), branches
 * that meet before it read as one (#99, walkBranches) -- exposed for
 * extractStateMachineFromGraph.ts, which needs the exact same "what does
 * this part of the graph mean" reading this file already provides for
 * NativeStrategy's verification (a fan-out's branches, up to wherever they
 * reconverge).
 *
 * Reusing this file for a second strategy's verification is NOT the same
 * "shared blind spot" risk this file's own doc comment warns against (that
 * risk is specifically about a strategy's verification baseline being
 * built out of that SAME strategy's own construction code). This file is
 * itself the independent, strategy-agnostic "what the graph means" oracle
 * -- built from the graph's own edges and HA's documented execution
 * grammar, never from NativeStrategy's or StateMachineStrategy's shaping
 * choices -- and already hardened against the full native-strategy fixture
 * suite. StateMachineStrategy verification needs that identical graph
 * truth for the identical sub-question, so reusing it here avoids
 * introducing a second, independently-buggy graph-topology reader where
 * none is needed -- state-machine-specific shaping decisions (does a node
 * get a real `parallel:` fan-out, where do its branches reconverge, the
 * loop-back fallback, ...) are still re-derived fresh and independently in
 * that file, exactly like this file re-derives native.ts's own
 * choose-chain/loop/convergence rules instead of calling into it.
 */
export function extractGraphParallelBranches(
  flow: FlowGraph,
  targetIds: string[],
  stop: Set<string> | null,
  /** Where the run these branches belong to starts: loops are read from
   * where that run joins them (#282). */
  entries: string[] = []
): BProgram[] {
  return extractGraphParallelBranchGroups(flow, targetIds, stop, entries).map((g) => g.program);
}

/** extractGraphParallelBranches, with the targets each branch starts at
 * (#99's groups: branches that meet before `stop` are one). */
export function extractGraphParallelBranchGroups(
  flow: FlowGraph,
  targetIds: string[],
  stop: Set<string> | null,
  entries: string[] = [],
  /** Groups the caller reads itself (#284's branch machines): their
   * programs are left empty. */
  skip?: (group: string[]) => boolean
): { targets: string[]; program: BProgram }[] {
  const ctx = buildCtx(flow, entries, true);
  const groups = meetingGroups(ctx, targetIds, stop);
  const programs = walkBranches(ctx, targetIds, stop, new Set(), undefined, skip);
  return groups.map((targets, i) => ({ targets, program: programs[i] }));
}

export function extractFromGraph(flow: FlowGraph): GraphExtraction {
  return extractFromCtx(buildCtx(flow));
}

/**
 * Decision D1 (2026-09-26): where a path that just ends is read differently
 * by this file's tree reading (it carries on after the enclosing
 * construct) and by the literal flowchart reading the state machine uses
 * (the automation stops there). Circuitry's rule is the literal one;
 * analyzer/path-endings.ts makes each of these an explicit stop before any
 * strategy runs, so both readings agree. [] when the graph can't be read
 * at all (the gate reports that separately).
 */
export function findTreeContinuedPathEnds(flow: FlowGraph): PathEnd[] {
  return scanPathEnds(flow).ends;
}

/** findTreeContinuedPathEnds, with the ends inside a parallel that no stop
 * can be added at (decision D5). Nothing when the graph can't be read. */
export function scanPathEnds(flow: FlowGraph): { ends: PathEnd[] } & PathEndRewrites {
  try {
    const ctx = buildCtx(flow);
    ctx.pathEnds = [];
    ctx.rewrites = { copies: [], unwritable: [] };
    extractFromCtx(ctx);
    return { ends: ctx.pathEnds, ...ctx.rewrites };
  } catch {
    return { ends: [], copies: [], unwritable: [] };
  }
}

/** findConvergenceSet for a whole graph: where the paths from `starts`
 * first meet again (forward edges only). [] when the graph can't be read. */
export function graphConvergenceSet(flow: FlowGraph, starts: (string | string[])[]): string[] {
  try {
    return findConvergenceSet(buildCtx(flow), starts);
  } catch {
    return [];
  }
}

function extractFromCtx(ctx: Ctx): GraphExtraction {
  const flow = ctx.flow;

  const triggerNodes = ctx.flow.nodes.filter((n) => n.type === 'trigger');
  const triggers = triggerNodes.map(buildTrigger);
  const isScriptMode = triggerNodes.length === 0;

  const entryNodeIds = ctx.flow.nodes
    .filter((n) => n.type === 'trigger' || n.type === 'start')
    .map((n) => n.id);
  // No trigger/start nodes at all and no edges into anything -- treat every
  // node with no incoming edge as an entry, matching BaseStrategy.findEntryNodes.
  const effectiveEntries =
    entryNodeIds.length > 0
      ? entryNodeIds
      : ctx.flow.nodes.filter((n) => (ctx.incoming.get(n.id) ?? []).length === 0).map((n) => n.id);

  const firstTargets = [
    ...new Set(effectiveEntries.flatMap((id) => forwardOutgoing(ctx, id).map((e) => e.target))),
  ];

  // sequentialFallback: true whenever there is more than one top-level
  // entry point (multiple triggers, or -- defensively -- multiple start
  // nodes). See buildContinuation's own comment on this parameter: HA runs
  // one shared `actions:` sequence regardless of which trigger fired, so
  // disjoint per-trigger subtrees with no shared convergence must be
  // extracted as sequential steps, never as a `parallel` BStep. When
  // `firstTargets` dedups down to a single shared node (e.g. several
  // triggers that all lead to the same first action), buildContinuation's
  // own `ids.length === 1` shortcut bypasses this flag entirely, so passing
  // it unconditionally whenever there are multiple entries is harmless.
  // Bug #29 (2026-09-26, found by the Phase 4 red run): the sequential
  // reading is for entries that lead to DIFFERENT places. When every
  // trigger has exactly the same targets (the ordinary case of two
  // triggers wired to one fan-out -- what YamlParser builds for a
  // top-level `parallel:` in a multi-trigger automation), whichever
  // trigger fires, all of those targets start together: a parallel, as
  // with a single trigger. Reading it as sequential made every correct
  // native compile of that shape fail the gate (a needless fallback) and
  // let a compile that serialized the parallel pass.
  const targetSetKey = (id: string): string =>
    [...new Set(forwardOutgoing(ctx, id).map((e) => e.target))].sort().join('\u0000');
  const entriesShareOneFanOut =
    effectiveEntries.length > 1 &&
    effectiveEntries.every((id) => targetSetKey(id) === targetSetKey(effectiveEntries[0]));
  // Bug #30 (2026-09-26, found by the same red run): when the triggers DO
  // lead to different places, one shared action list can only mean the
  // same thing if every route starts with its own `condition: trigger`
  // guard -- then running the routes one after another, each checking
  // which trigger fired, is what the graph says. With plain conditions (or
  // anything else) at the start of the routes, the graph says "trigger 1
  // runs route 1 only"; a sequential (or OR-folded) reading runs route 2
  // on trigger 1 as well, and let a native compile doing exactly that
  // pass. No single native program expresses per-trigger routes without
  // guards, so refuse; the state machine routes on trigger.idx instead.
  const divergentEntries = effectiveEntries.length > 1 && !entriesShareOneFanOut;
  if (divergentEntries) {
    const allGuardedByTrigger = firstTargets.every((id) => {
      const node = ctx.nodesById.get(id);
      return (
        node?.type === 'condition' &&
        (node.data as Record<string, unknown> | undefined)?.condition === 'trigger'
      );
    });
    if (!allGuardedByTrigger) {
      throw new Error(
        'the triggers lead to different places without `condition: trigger` guards; ' +
          'one shared action list cannot express per-trigger routes'
      );
    }
  }
  const program = buildContinuation(
    ctx,
    firstTargets,
    null,
    new Set(),
    undefined,
    divergentEntries
  );

  return {
    triggers,
    program,
    isScriptMode,
    ...extractGraphSettings(flow),
  };
}

/** The automation-level settings -- everything except triggers and the
 * action program -- that the output must carry through unchanged. */
export type FlowSettings = Pick<
  GraphExtraction,
  | 'scriptFields'
  | 'mode'
  | 'max'
  | 'maxExceeded'
  | 'initialState'
  | 'trace'
  | 'userVariables'
  | 'triggerVariables'
>;

/** Reads FlowSettings straight from the graph. Used by extractFromGraph
 * (native verification) and directly by verifyStateMachineOutput, which
 * doesn't otherwise need the full behavior-program extraction. */
export function extractGraphSettings(flow: FlowGraph): FlowSettings {
  const startNode = flow.nodes.find((n) => n.type === 'start');
  const scriptFields =
    startNode?.type === 'start'
      ? ((startNode.data as Record<string, unknown>).fields as Record<string, unknown> | undefined)
      : undefined;
  return {
    scriptFields,
    mode: flow.metadata?.mode ?? 'single',
    max: flow.metadata?.max,
    maxExceeded: flow.metadata?.max_exceeded,
    // As written: true and unset differ in HA (bug #196).
    initialState:
      typeof flow.metadata?.initial_state === 'boolean' ? flow.metadata.initial_state : undefined,
    trace: flow.metadata?.trace,
    userVariables: flow.userVariables ?? {},
    triggerVariables: flow.userTriggerVariables,
  };
}
