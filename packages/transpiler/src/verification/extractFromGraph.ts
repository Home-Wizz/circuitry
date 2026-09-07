import type { ConditionNode, FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { findBackEdges } from '../analyzer/topology';
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
}

interface LoopInfo {
  kind: 'while' | 'until' | 'count';
  testNodeId: string;
  bodyEntryIds: string[];
  exitTargetIds: string[];
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

function buildCtx(flow: FlowGraph): Ctx {
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
  const backEdgeIds = findBackEdges(stripped);
  const ctx: Ctx = { flow: stripped, nodesById, outgoing, incoming, backEdgeIds, loopsByEntry: new Map() };
  ctx.loopsByEntry = detectLoops(ctx);
  return ctx;
}

function forwardOutgoing(ctx: Ctx, nodeId: string): FlowEdge[] {
  return (ctx.outgoing.get(nodeId) ?? []).filter((e) => !ctx.backEdgeIds.has(e.id));
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
  for (const edge of ctx.flow.edges) {
    if (!ctx.backEdgeIds.has(edge.id)) continue;
    const source = ctx.nodesById.get(edge.source);
    const target = ctx.nodesById.get(edge.target);
    if (!source || !target) continue;

    if (target.type === 'condition' && source.type !== 'condition') {
      // while: entry = the test node itself.
      const trueEdges = forwardOutgoing(ctx, target.id).filter((e) => e.sourceHandle === 'true');
      const falseEdges = forwardOutgoing(ctx, target.id).filter((e) => e.sourceHandle === 'false');
      loops.set(target.id, {
        kind: 'while',
        testNodeId: target.id,
        bodyEntryIds: trueEdges.map((e) => e.target),
        exitTargetIds: falseEdges.map((e) => e.target),
      });
    } else if (source.type === 'condition' && edge.sourceHandle === 'false') {
      // until: entry = the first body node (the back-edge's own target).
      const trueEdges = forwardOutgoing(ctx, source.id).filter((e) => e.sourceHandle === 'true');
      loops.set(edge.target, {
        kind: 'until',
        testNodeId: source.id,
        bodyEntryIds: [edge.target],
        exitTargetIds: trueEdges.map((e) => e.target),
      });
    } else if (source.type === 'condition' && edge.sourceHandle === 'true') {
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

      const condPreds = (ctx.incoming.get(source.id) ?? []).filter((e) => !ctx.backEdgeIds.has(e.id));
      const incrementCandidate = condPreds.length === 1 ? ctx.nodesById.get(condPreds[0].source) : undefined;
      const incrementNodeId =
        varName && setsCounterVariable(incrementCandidate, varName) ? incrementCandidate!.id : undefined;

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

      loops.set(initNodeId ?? loopTargetId, {
        kind: 'count',
        testNodeId: source.id,
        bodyEntryIds,
        exitTargetIds: falseEdges.map((e) => e.target),
        count: extractCountValue(ctx, source.id),
        incrementNodeId,
      });
    }
  }
  return loops;
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
function findConvergenceSet(ctx: Ctx, starts: string[]): string[] {
  if (starts.length < 2) return [];
  const reachableSets = starts.map((start) => {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of forwardOutgoing(ctx, id)) queue.push(e.target);
    }
    return seen;
  });
  const common = [...reachableSets[0]].filter((id) => reachableSets.every((s) => s.has(id)));
  if (common.length === 0) return [];
  if (common.length === 1) return common;

  // Reduce to the minimal/undominated antichain: drop any common node
  // reachable (forward) from another common node -- it's downstream of a
  // sibling, not a sibling itself. Same idea as native.ts's own
  // findConvergenceSet, reimplemented locally here for the same reason
  // that function gives (avoiding a cross-file dependency).
  const reaches = (fromId: string, toId: string): boolean => {
    if (fromId === toId) return false;
    const seen = new Set<string>();
    const queue = [fromId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of forwardOutgoing(ctx, id)) {
        if (e.target === toId) return true;
        if (!seen.has(e.target)) queue.push(e.target);
      }
    }
    return false;
  };

  const minimal = common.filter((id) => !common.some((other) => other !== id && reaches(other, id)));
  if (minimal.length <= 1) return minimal;

  const withDistance = minimal.map((id) => ({
    id,
    maxDist: Math.max(...starts.map((s) => shortestDistance(ctx, s, id))),
  }));
  withDistance.sort((a, b) => a.maxDist - b.maxDist);
  return withDistance.map((d) => d.id);
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
  const body: BProgram = Array.isArray(repeat.sequence)
    ? repeat.sequence.flatMap((s) => normalizeYamlActionLeafForFallback(s as Record<string, unknown>))
    : [];
  if (repeat.while) {
    return { k: 'repeat', mode: 'while', test: parseConditionExpr(repeat.while), body };
  }
  if (repeat.until) {
    return { k: 'repeat', mode: 'until', test: parseConditionExpr(repeat.until), body };
  }
  return { k: 'repeat', mode: 'count', count: repeat.count !== undefined ? String(repeat.count) : '', body };
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
function normalizeYamlActionLeafForFallback(step: Record<string, unknown>): BProgram {
  return parseActionSequence([step]);
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
function stopHas(stop: string | Set<string> | null, id: string): boolean {
  if (stop === null) return false;
  return stop instanceof Set ? stop.has(id) : stop === id;
}

function buildContinuation(
  ctx: Ctx,
  targetIds: string[],
  stop: string | Set<string> | null,
  visited: Set<string>,
  suppressLoopId?: string,
  sequentialFallback = false,
): BProgram {
  const ids = targetIds.filter((id) => !stopHas(stop, id));
  if (ids.length === 0) return [];
  if (ids.length === 1) return walk(ctx, ids[0], stop, visited, suppressLoopId);

  const convergenceSet = findConvergenceSet(ctx, ids);

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
    const boundSet = new Set(convergenceSet);
    const branchPrograms = ids.map((id) => walk(ctx, id, boundSet, new Set(visited), suppressLoopId));
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
    if (allEmptyConditions && convergenceSet.length === 1) {
      const orExpr: BoolExpr = { op: 'or', args: branchConditions };
      const then = walk(ctx, convergenceSet[0], stop, new Set(visited));
      return [{ k: 'if', cond: orExpr, then, else: [] }];
    }

    const filtered = branchPrograms.filter((p) => p.length > 0);
    const parallelStep: BProgram = filtered.length > 0 ? [{ k: 'parallel', branches: filtered }] : [];
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
  const branchPrograms = ids.map((id) => walk(ctx, id, stop, new Set(visited), suppressLoopId));
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

  const loop = nodeId === suppressLoopId ? undefined : ctx.loopsByEntry.get(nodeId);
  if (loop) {
    if (loop.kind === 'while') {
      const cond = parseConditionFromNode(ctx.nodesById.get(loop.testNodeId) as ConditionNode);
      const body = buildContinuation(ctx, loop.bodyEntryIds, loop.testNodeId, new Set(), nodeId);
      const after = buildContinuation(ctx, loop.exitTargetIds, stop, visited);
      return [{ k: 'repeat', mode: 'while', test: cond, body }, ...after];
    }
    if (loop.kind === 'until') {
      const cond = parseConditionFromNode(ctx.nodesById.get(loop.testNodeId) as ConditionNode);
      const body = buildContinuation(ctx, loop.bodyEntryIds, loop.testNodeId, new Set(), nodeId);
      const after = buildContinuation(ctx, loop.exitTargetIds, stop, visited);
      return [{ k: 'repeat', mode: 'until', test: cond, body }, ...after];
    }
    // count: stop the body walk at the increment bookkeeping node (when
    // found) rather than the test node itself, so that node never gets
    // emitted as an extra action step -- it has no counterpart at all in
    // NativeStrategy's rendered `repeat: { count: N, sequence: [...] }`.
    const bodyStop = loop.incrementNodeId ?? loop.testNodeId;
    const body = buildContinuation(ctx, loop.bodyEntryIds, bodyStop, new Set(), nodeId);
    const after = buildContinuation(ctx, loop.exitTargetIds, stop, visited);
    return [{ k: 'repeat', mode: 'count', count: loop.count ?? '', body }, ...after];
  }

  const node = ctx.nodesById.get(nodeId);
  if (!node) return [];

  if (node.type === 'condition') {
    return buildConditionChain(ctx, nodeId, stop, visited);
  }

  const action = normalizeNodeAction(node);
  const outTargets = forwardOutgoing(ctx, nodeId).map((e) => e.target);
  const rest = buildContinuation(ctx, outTargets, stop, visited);
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
 */
function buildConditionChain(
  ctx: Ctx,
  startId: string,
  stop: string | Set<string> | null,
  visited: Set<string>
): BProgram {
  const conditions: BoolExpr[] = [];
  const elseTargets = forwardOutgoing(ctx, startId)
    .filter((e) => e.sourceHandle === 'false')
    .map((e) => e.target);

  let currentId = startId;
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
      nextNode?.type === 'condition' && !visited.has(trueTarget) && !ctx.loopsByEntry.has(trueTarget);

    if (canContinueChain) {
      const nextFalseEdges = forwardOutgoing(ctx, trueTarget).filter((e) => e.sourceHandle === 'false');
      const canChain =
        nextFalseEdges.length === 0 ||
        (nextFalseEdges.length === 1 && elseTargets.includes(nextFalseEdges[0].target));
      if (canChain) {
        visited.add(trueTarget);
        currentId = trueTarget;
        continue;
      }
    }

    thenTargets = [trueTarget];
    break;
  }

  const cond: BoolExpr = conditions.length === 1 ? conditions[0] : { op: 'and', args: conditions };
  const then = buildContinuation(ctx, thenTargets, stop, new Set(visited));
  const els = buildContinuation(ctx, elseTargets, stop, new Set(visited));
  return [{ k: 'if', cond, then, else: els }];
}

export function buildTrigger(node: FlowNode): Record<string, unknown> {
  const data = node.data as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (value === undefined || value === '') continue;
    if (value === null && key !== 'from' && key !== 'to') continue;
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
  return cleaned;
}

/**
 * Builds a canonical BProgram for the subtree reachable from `entryNodeId`,
 * stopping at `stopNodeId` (or running to the flow's natural end when
 * null) -- exposed for extractStateMachineFromGraph.ts, which needs the
 * exact same "what does this subtree of the graph mean" reading this file
 * already provides for NativeStrategy's verification (a fan-out branch's
 * content, up to wherever it reconverges).
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
export function extractGraphProgramBetween(
  flow: FlowGraph,
  entryNodeId: string,
  stopNodeId: string | Set<string> | null
): BProgram {
  const ctx = buildCtx(flow);
  return walk(ctx, entryNodeId, stopNodeId, new Set());
}

export function extractFromGraph(flow: FlowGraph): GraphExtraction {
  const ctx = buildCtx(flow);

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
  const program = buildContinuation(ctx, firstTargets, null, new Set(), undefined, effectiveEntries.length > 1);

  const startNode = ctx.flow.nodes.find((n) => n.type === 'start');
  const scriptFields =
    startNode?.type === 'start' ? (startNode.data as Record<string, unknown>).fields as Record<string, unknown> | undefined : undefined;

  return {
    triggers,
    program,
    scriptFields,
    isScriptMode,
    mode: flow.metadata?.mode ?? 'single',
    max: flow.metadata?.max,
    maxExceeded: flow.metadata?.max_exceeded,
    initialState: flow.metadata?.initial_state === false ? false : undefined,
    trace: flow.metadata?.trace,
    userVariables: flow.userVariables ?? {},
    triggerVariables: flow.userTriggerVariables,
  };
}
