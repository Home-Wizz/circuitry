import type { ConditionNode, FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import { isStartNode } from '@circuitry/shared';
import { findBackEdges } from '../analyzer/topology';
import type { BProgram, BStep } from './behaviorProgram';
import { type BoolExpr, parseConditionExpr } from './boolean';
import { buildTrigger, extractGraphProgramBetween, normalizeNodeAction } from './extractFromGraph';

/**
 * Independently derives, straight from the FlowGraph, the same per-node
 * "state transition table" StateMachineStrategy's choose-block dispatcher
 * is supposed to encode (see state-machine.ts's own class doc comment --
 * the "Virtual CPU" pattern: `current_node` as program counter, one
 * choose-case per node, `variables: { current_node: X }` as the only way
 * control ever moves from one state to the next). Built the same way
 * extractFromGraph.ts reads the graph for NativeStrategy verification:
 * straight from the graph's own edges and node data, per HA's documented
 * execution grammar, never by calling into StateMachineStrategy's own
 * construction code (generateNodeBlock, buildFanOutContinuation,
 * buildFanOutFromTargets, findLoopBackConvergence,
 * filterIndependentFanOutTargets, generateParallelEntryBlocks) -- so a bug
 * in that code shows up as a genuine divergence between this file and the
 * rendered YAML, rather than being invisible to both sides of the same
 * comparison.
 *
 * Unlike NativeStrategy, which needs a tree-shaped subgraph to render at
 * all (topology.ts's `isTree` gate), the state machine's dispatcher has no
 * such requirement: a cycle, a cross-link, or two independent upstream
 * nodes converging on the same downstream node are all just "two states
 * (or a back-edge) whose transition happens to name the same next-state
 * id" -- completely ordinary for a state machine and needing NO special
 * handling here (confirmed via strategy-selection.test.ts's own converging
 * -while-loops fixture: two unrelated conditions' true-paths rewired onto
 * the same downstream loop-condition node is exactly this shape, and
 * resolves to two perfectly ordinary single-edge transitions sharing a
 * target, nothing more).
 *
 * The ONLY real topology question this file's own convergence-finding
 * logic has to answer -- mirroring buildFanOutFromTargets /
 * findLoopBackConvergence / filterIndependentFanOutTargets, the RULE, not
 * the code, same precedent as extractFromGraph.ts's own detectLoops /
 * findConvergence being independent from native.ts's detectRepeatPatterns
 * / findConvergencePoint -- is: when a single node (or a condition's one
 * branch, or a trigger with multiple direct targets) genuinely fans out
 * into 2+ concurrent targets (a real `parallel:` block), where do those
 * branches reconverge afterward, if anywhere?
 */

export type Transition =
  | { kind: 'single'; target: string }
  | { kind: 'fanout'; targets: string[]; convergence: string; program: BProgram };

export interface LeafState {
  kind: 'leaf';
  /** The node's own action content, or null for a join/passthrough node
   * (a transparent convergence marker with no content of its own) --
   * mirrors normalizeNodeAction's own null cases. */
  ownStep: BStep | null;
  transition: Transition;
}

export interface ConditionState {
  kind: 'condition';
  cond: BoolExpr;
  trueTransition: Transition;
  falseTransition: Transition;
}

export type StateSpec = LeafState | ConditionState;

export interface ParallelEntrySpec {
  targets: string[];
  convergence: string;
  program: BProgram;
}

export type EntrySpec =
  | { kind: 'single'; target: string }
  | { kind: 'byTriggerIdx'; targets: Map<number, string> };

export interface StateMachineGraphExtraction {
  /** True when the graph has no trigger (or start node) with any outgoing
   * edge at all -- state-machine.ts's generate() takes an entirely
   * different, dispatcher-free early-return path in this case (an empty
   * `actions: []` / `sequence: []`, no `current_node`/`repeat`/`choose` at
   * all), so none of `states`/`parallelEntries`/`entry` apply. `triggers`
   * still applies even when isEmpty -- state-machine.ts's own early-return
   * path (triggerRouting.size === 0) still emits the real `triggers:` list
   * with an empty `actions: []`, so a corrupted/dropped trigger in that
   * shape is a real bug this must still catch (found via the adversarial
   * verification-gate mutation fuzzer, 2026-09-07 -- this whole `triggers`
   * field was previously entirely absent from state-machine verification,
   * a genuine soundness gap: removing or corrupting a trigger from the
   * candidate YAML was silently accepted as equivalent). Reuses
   * extractFromGraph.ts's own `buildTrigger` (same reasoning as reusing
   * `extractGraphProgramBetween`/`normalizeNodeAction` from that file: it's
   * the independent, strategy-agnostic "what does this trigger node mean"
   * reader, not NativeStrategy's own construction code). */
  isEmpty: boolean;
  triggers: Record<string, unknown>[];
  states: Map<string, StateSpec>;
  parallelEntries: Map<string, ParallelEntrySpec>;
  entry: EntrySpec;
}

interface Ctx {
  flow: FlowGraph;
  outgoing: Map<string, FlowEdge[]>;
  backEdgeIds: Set<string>;
}

function buildCtx(flow: FlowGraph): Ctx {
  const stripped: FlowGraph = {
    ...flow,
    edges: flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint'),
  };
  const outgoing = new Map<string, FlowEdge[]>();
  for (const e of stripped.edges) {
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e);
  }
  const backEdgeIds = findBackEdges(stripped);
  return { flow: stripped, outgoing, backEdgeIds };
}

function outgoingEdges(ctx: Ctx, nodeId: string): FlowEdge[] {
  return ctx.outgoing.get(nodeId) ?? [];
}

function forwardOutgoing(ctx: Ctx, nodeId: string): FlowEdge[] {
  return outgoingEdges(ctx, nodeId).filter((e) => !ctx.backEdgeIds.has(e.id));
}

/**
 * Same BFS-reachable-sets + minimum-max-distance convergence search as
 * extractFromGraph.ts's own private findConvergence/shortestDistance -- a
 * fresh, independent implementation of the same topological RULE (not a
 * call into that file, or into native.ts's findConvergencePoint), matching
 * this codebase's established "duplicate the rule, not the code"
 * precedent.
 */
/**
 * Generalizes the old single-node findConvergence to the case where 2+
 * branches share 2+ SIBLING downstream nodes rather than one dominating
 * node (bug #12, found via the randomized fuzzer, 2026-09-06 -- mirrors
 * extractFromGraph.ts's own identical fix and native.ts's
 * findConvergenceSet exactly). Returns [] (no shared node), a
 * single-element array (classic case, semantically identical to the old
 * findConvergence), or a 2+ element array for a genuine sibling set,
 * ordered nearest-first.
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

/**
 * Mirrors state-machine.ts's private findLoopBackConvergence RULE: every
 * branch's ways out (dead ends, and back-edges leaving the branch's own
 * forward-reachable subgraph) must be back-edges to one and the same node.
 * A fan-out whose branches loop back rather than reaching an ordinary
 * downstream node still has a well-defined shared continuation -- the
 * loop head they all return to.
 */
function findLoopBackConvergence(ctx: Ctx, targetIds: string[]): string | null {
  // Bug #25 (2026-09-26): each branch's exits are its dead ends and the
  // back-edges leaving its whole forward-reachable subgraph (not just the
  // target node's own edges -- a multi-step branch at the end of a loop
  // body used to fall through to END). Every exit must be a back-edge to
  // the same one node.
  let loopTarget: string | null = null;
  for (const id of targetIds) {
    const reachable = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const e of forwardOutgoing(ctx, nodeId)) queue.push(e.target);
    }
    for (const nodeId of reachable) {
      for (const e of outgoingEdges(ctx, nodeId)) {
        if (!ctx.backEdgeIds.has(e.id) || reachable.has(e.target)) continue;
        if (loopTarget !== null && loopTarget !== e.target) return null;
        loopTarget = e.target;
      }
    }
  }
  return loopTarget;
}

/**
 * Mirrors state-machine.ts's private filterIndependentFanOutTargets RULE
 * exactly: drops any target that some OTHER target in the same list can
 * reach (forward, excluding back-edges) without being reachable back -- a
 * one-way "shortcut" edge the graph format sometimes wires alongside a
 * branch's own natural continuation (e.g. a condition's true-path also
 * wired directly to the after-if-block continuation) isn't an independent
 * fan-out sibling, it's structural bookkeeping already covered by the
 * other branch's own continuation.
 */
function filterIndependentTargets(ctx: Ctx, targetIds: string[]): string[] {
  if (targetIds.length <= 1) return targetIds;
  const reaches = (fromId: string, toId: string): boolean => {
    const visited = new Set<string>();
    const queue = [fromId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === toId) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of forwardOutgoing(ctx, id)) queue.push(e.target);
    }
    return false;
  };
  return targetIds.filter(
    (id) => !targetIds.some((otherId) => otherId !== id && reaches(otherId, id) && !reaches(id, otherId))
  );
}

/**
 * Resolves a raw outgoing-edge target list into a Transition.
 *
 * `midFlow: true` mirrors buildFanOutFromTargets (used for every ordinary
 * node's fan-out AND each side of a condition's own branch): independent-
 * target filtering, ordinary forward convergence, then a loop-back
 * convergence fallback.
 *
 * `midFlow: false` mirrors generateParallelEntryBlocks' own, deliberately
 * simpler resolution for a TRIGGER's direct multiple targets: no
 * independent-target filtering, no loop-back fallback -- just a direct
 * convergence search, read directly from source (that function calls
 * `findConvergencePointForBranches` alone, nothing else).
 */
function resolveTransition(ctx: Ctx, rawTargetIds: string[], midFlow: boolean): Transition {
  const targetIds = midFlow ? filterIndependentTargets(ctx, rawTargetIds) : rawTargetIds;
  if (targetIds.length === 0) return { kind: 'single', target: 'END' };
  if (targetIds.length === 1) return { kind: 'single', target: targetIds[0] };

  let convergenceSet = findConvergenceSet(ctx, targetIds);
  if (convergenceSet.length === 0 && midFlow) {
    const loopBack = findLoopBackConvergence(ctx, targetIds);
    if (loopBack) convergenceSet = [loopBack];
  }
  const boundSet = convergenceSet.length > 0 ? new Set(convergenceSet) : null;
  const branchPrograms = targetIds.map((id) => extractGraphProgramBetween(ctx.flow, id, boundSet));
  const program: BProgram = [{ k: 'parallel', branches: branchPrograms }];

  if (convergenceSet.length <= 1) {
    return {
      kind: 'fanout',
      targets: targetIds,
      convergence: convergenceSet[0] ?? 'END',
      program,
    };
  }

  // 2+ sibling convergence nodes (bug #12): the exposed `convergence`
  // field must stay a single scalar (state-machine.ts's current_node is
  // always a scalar dispatch value), so recurse on the sibling set itself
  // -- same midFlow semantics -- and splice its own program in as more
  // sequential BSteps, bubbling up its resolved scalar convergence.
  // Mirrors state-machine.ts's own buildFanOutFromTargets recursive-splice
  // fix exactly.
  const inner = resolveTransition(ctx, convergenceSet, midFlow);
  const innerProgram = inner.kind === 'fanout' ? inner.program : [];
  const innerConvergence = inner.kind === 'fanout' ? inner.convergence : inner.target;
  return {
    kind: 'fanout',
    targets: targetIds,
    convergence: innerConvergence,
    program: [...program, ...innerProgram],
  };
}

function buildLeafState(ctx: Ctx, node: FlowNode): LeafState {
  // Phase 5 (2026-09-26): a disabled node's own step is skipped by HA, so
  // it contributes nothing (extractFromYaml.ts drops `enabled: false`
  // steps the same way).
  const ownStep =
    (node.data as Record<string, unknown> | undefined)?.enabled === false
      ? null
      : normalizeNodeAction(node);
  const targets = outgoingEdges(ctx, node.id).map((e) => e.target);
  const transition = resolveTransition(ctx, targets, true);
  return { kind: 'leaf', ownStep, transition };
}

/**
 * Bug #23 (2026-09-26): a count loop's test condition (`{{
 * _repeat_counter_X < N }}`) loops back via its true edge to the loop's
 * INIT node (`X = 0`) -- YamlParser's convention for "run the body again",
 * the way extractFromGraph.ts and NativeStrategy read it. Taken literally
 * it re-runs `X = 0` every iteration and never finishes, so for that edge
 * the real next states are the init node's own successors.
 */
function countLoopRepeatTargets(ctx: Ctx, node: ConditionNode, targetId: string): string[] | null {
  const data = node.data as Record<string, unknown>;
  if (data.condition !== 'template' || typeof data.value_template !== 'string') return null;
  const counter = data.value_template.match(/(_repeat_counter_[A-Za-z0-9_]+)\s*<\s*\d+/)?.[1];
  if (!counter) return null;
  const target = ctx.flow.nodes.find((n) => n.id === targetId);
  if (target?.type !== 'set_variables') return null;
  const vars = (target.data as Record<string, unknown>).variables as
    | Record<string, unknown>
    | undefined;
  if (!vars || Object.keys(vars).length !== 1 || vars[counter] !== 0) return null;
  return outgoingEdges(ctx, targetId).map((e) => e.target);
}

/**
 * Bug #27 (2026-09-26): a condition with no false edge that is the 2nd+
 * member of a multi-condition list (`if: [A, B]` and friends are wired A
 * -true-> B with only A's false edge) or a canvas AND-chain shares the
 * list head's false targets; NativeStrategy and extractFromGraph.ts have
 * always read it that way. Member test: its only incoming edge is the
 * single true edge of a condition, it carries no `_blockKey` (a nested
 * construct head's missing false edge means "nothing happens" -- bug #21),
 * and the parent's false targets don't lead back to it (then it's where the
 * parent's branches meet again -- bug #26). Otherwise [] (END).
 */
function andMemberFalseTargets(ctx: Ctx, conditionId: string, seen: Set<string>): string[] {
  if (seen.has(conditionId)) return [];
  seen.add(conditionId);
  const node = ctx.flow.nodes.find((n) => n.id === conditionId);
  if (node?.type !== 'condition') return [];
  const own = outgoingEdges(ctx, conditionId).filter((e) => e.sourceHandle === 'false');
  if (own.length > 0) return own.map((e) => e.target);
  if (typeof (node.data as Record<string, unknown>)._blockKey === 'string') return [];
  const incoming = ctx.flow.edges.filter(
    (e) => e.target === conditionId && !ctx.backEdgeIds.has(e.id)
  );
  if (incoming.length !== 1 || incoming[0].sourceHandle !== 'true') return [];
  const parent = ctx.flow.nodes.find((n) => n.id === incoming[0].source);
  if (parent?.type !== 'condition') return [];
  if (outgoingEdges(ctx, parent.id).filter((e) => e.sourceHandle === 'true').length !== 1)
    return [];
  const parentElse = andMemberFalseTargets(ctx, parent.id, seen);
  const reaches = (from: string): boolean => {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === conditionId) return true;
      // Never through the parent (an else looping back to an enclosing
      // loop's head reaches the member only around the loop).
      if (visited.has(id) || id === parent.id) continue;
      visited.add(id);
      for (const e of forwardOutgoing(ctx, id)) queue.push(e.target);
    }
    return false;
  };
  return parentElse.some(reaches) ? [] : parentElse;
}

function buildConditionState(ctx: Ctx, node: ConditionNode): ConditionState {
  const cond = parseConditionExpr(node.data as Record<string, unknown>);
  const trueTargets = outgoingEdges(ctx, node.id)
    .filter((e) => e.sourceHandle === 'true')
    .flatMap((e) => countLoopRepeatTargets(ctx, node, e.target) ?? [e.target]);
  const ownFalse = outgoingEdges(ctx, node.id)
    .filter((e) => e.sourceHandle === 'false')
    .map((e) => e.target);
  const falseTargets =
    ownFalse.length > 0 ? ownFalse : andMemberFalseTargets(ctx, node.id, new Set());
  return {
    kind: 'condition',
    cond,
    trueTransition: resolveTransition(ctx, trueTargets, true),
    falseTransition: resolveTransition(ctx, falseTargets, true),
  };
}

export function extractStateMachineFromGraph(flow: FlowGraph): StateMachineGraphExtraction {
  const ctx = buildCtx(flow);

  // Build trigger-like entries: real trigger nodes, or (script mode, no
  // triggers at all) a single synthetic entry at index 0 rooted at the
  // `start` node -- mirrors buildTriggerRouting's own fallback exactly.
  const triggerNodes = ctx.flow.nodes.filter((n) => n.type === 'trigger');
  const triggers = triggerNodes.map(buildTrigger);
  const entryCandidates: Array<{ index: number; targets: string[] }> = [];
  if (triggerNodes.length > 0) {
    triggerNodes.forEach((t, i) => {
      const targets = outgoingEdges(ctx, t.id).map((e) => e.target);
      if (targets.length > 0) entryCandidates.push({ index: i, targets });
    });
  } else {
    const startNode = ctx.flow.nodes.find(isStartNode);
    if (startNode) {
      const targets = outgoingEdges(ctx, startNode.id).map((e) => e.target);
      if (targets.length > 0) entryCandidates.push({ index: 0, targets });
    }
  }

  if (entryCandidates.length === 0) {
    return {
      isEmpty: true,
      triggers,
      states: new Map(),
      parallelEntries: new Map(),
      entry: { kind: 'single', target: 'END' },
    };
  }

  const parallelEntries = new Map<string, ParallelEntrySpec>();
  const effectiveEntries = new Map<number, string>();
  for (const { index, targets: rawTargets } of entryCandidates) {
    // Mirrors buildTriggerRouting's own fix (Phase B item 6 audit,
    // 2026-09-06): a trigger's raw outgoing targets can include a
    // one-way "shortcut" target that's already reachable from another
    // target in the same list (e.g. a trigger wired directly onto a
    // Choose block's Case 2, which Case 1's own chain edge already
    // reaches) -- that's not a genuine independent fan-out sibling, so
    // it must be filtered out here exactly the same way
    // filterIndependentFanOutTargets now filters it in
    // buildTriggerRouting before generateParallelEntryBlocks ever sees
    // it. Both sides MUST agree on this filtering, or a trigger with a
    // dominated target looks like a real 2-target parallel entry on the
    // graph side while the candidate YAML (correctly) emits a single
    // fixed entry with no synthetic __parallel_trigger_N state at all.
    const targets = filterIndependentTargets(ctx, rawTargets);
    if (targets.length === 1) {
      effectiveEntries.set(index, targets[0]);
      continue;
    }
    const parallelId = `__parallel_trigger_${index}`;
    effectiveEntries.set(index, parallelId);
    const transition = resolveTransition(ctx, targets, false);
    // targets.length > 1 here always resolves to 'fanout' (resolveTransition
    // only returns 'single' for 0 or 1 targets), but branch defensively
    // rather than assume.
    if (transition.kind === 'fanout') {
      parallelEntries.set(parallelId, {
        targets: transition.targets,
        convergence: transition.convergence,
        program: transition.program,
      });
    } else {
      parallelEntries.set(parallelId, { targets, convergence: transition.target, program: [] });
    }
  }

  const uniqueTargets = new Set(effectiveEntries.values());
  const entry: EntrySpec =
    uniqueTargets.size === 1
      ? { kind: 'single', target: [...uniqueTargets][0] }
      : { kind: 'byTriggerIdx', targets: effectiveEntries };

  // Build one dispatch state per non-trigger, non-start node -- mirrors
  // state-machine.ts's own `nodeBlocks` filter exactly.
  const states = new Map<string, StateSpec>();
  for (const node of ctx.flow.nodes) {
    if (node.type === 'trigger' || node.type === 'start') continue;
    states.set(node.id, node.type === 'condition' ? buildConditionState(ctx, node as ConditionNode) : buildLeafState(ctx, node));
  }

  return { isEmpty: false, triggers, states, parallelEntries, entry };
}
