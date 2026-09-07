import type { FlowEdge, FlowGraph } from '@circuitry/shared';
import graphlib from 'graphlib';

const { Graph, alg } = graphlib;

type GraphInstance = InstanceType<typeof Graph>;

/**
 * Find back-edges in the flow graph using DFS.
 * A back-edge is an edge that goes from a node to one of its ancestors
 * in the DFS tree, creating a cycle. Removing all back-edges makes the
 * graph acyclic.
 *
 * This is used to identify repeat/loop patterns structurally without
 * requiring any edge metadata.
 */
export function findBackEdges(flow: FlowGraph): Set<string> {
  // Ignore hint edges — they are visual-only and must not affect loop detection
  flow = {
    ...flow,
    edges: flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint'),
  };

  const backEdgeIds = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();

  // Build adjacency map
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    const existing = outgoing.get(edge.source) || [];
    existing.push(edge);
    outgoing.set(edge.source, existing);
  }

  // Find entry nodes (no incoming edges)
  const incomingTargets = new Set(flow.edges.map((e) => e.target));
  const entryNodes = flow.nodes.filter((n) => !incomingTargets.has(n.id)).map((n) => n.id);

  function dfs(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    inStack.add(nodeId);

    for (const edge of outgoing.get(nodeId) || []) {
      if (inStack.has(edge.target)) {
        backEdgeIds.add(edge.id);
      } else if (!visited.has(edge.target)) {
        dfs(edge.target);
      }
    }

    inStack.delete(nodeId);
  }

  for (const entry of entryNodes) {
    dfs(entry);
  }

  // Handle disconnected components
  for (const node of flow.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return backEdgeIds;
}

/**
 * Result of topology analysis
 */
export interface TopologyAnalysis {
  /**
   * True if the graph is a simple tree (can use native HA YAML)
   */
  isTree: boolean;
  /**
   * True if the graph contains cycles (requires state machine)
   */
  hasCycles: boolean;
  /**
   * True if there are multiple entry points (multiple triggers)
   */
  hasMultipleEntryPoints: boolean;
  /**
   * True if there are cross-links that skip levels or go backward
   */
  hasCrossLinks: boolean;
  /**
   * True if paths merge back together (diamond patterns)
   */
  hasConvergingPaths: boolean;
  /**
   * True if different triggers lead to different action paths
   * (e.g., trigger A → action 1, trigger B → action 2)
   * This requires state machine to route based on which trigger fired
   */
  hasDivergentTriggerPaths: boolean;
  /**
   * Node IDs that serve as entry points (triggers)
   */
  entryNodes: string[];
  /**
   * Node IDs that have no outgoing edges (terminal nodes)
   */
  exitNodes: string[];
  /**
   * Topologically sorted node IDs (if acyclic)
   */
  topologicalOrder: string[] | null;
  /**
   * Recommended transpilation strategy
   */
  recommendedStrategy: 'native' | 'state-machine';
}

/**
 * Analyze the topology of a flow graph
 * Determines whether the graph can be transpiled to native HA YAML
 * or requires the state machine approach
 */
export function analyzeTopology(flow: FlowGraph): TopologyAnalysis {
  // Strip hint edges (visual-only trigger-routing aids) before topology analysis
  flow = {
    ...flow,
    edges: flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint'),
  };

  const g = new Graph({ directed: true });

  // Structurally detect back-edges (loop edges) using DFS
  const backEdgeIds = findBackEdges(flow);

  // Build a node type lookup for classifying back-edges
  const nodeTypeMap = new Map(flow.nodes.map((n) => [n.id, n.type]));

  // Only exclude back-edges that form repeat patterns (involve a condition node).
  // True cycles (action→action loops) should still be detected as cycles.
  //
  // A *well-formed* repeat back-edge is the loop's one and only way back to
  // its condition — the single-action-body case block-factories.ts has
  // always scaffolded. Also track, per back-edge, which endpoint is the
  // condition node ("the loop condition") — used below to catch the case a
  // repeat's body is itself a branching structure (e.g. an If/Else picked
  // from the Blocks list as a repeat_while/until body), where more than one
  // path loops back to the same condition. NativeStrategy's repeat
  // generation only knows how to emit a single linear `sequence:`, so that
  // shape must fall back to state-machine instead of being silently
  // corrupted (see targetRoleCounts/sourceRoleCounts/loopConditionNodeIds below).
  const repeatBackEdgeIds = new Set<string>();
  const loopConditionNodeIds = new Set<string>();
  // Tally a condition endpoint's occurrences separately by ROLE (was it the
  // back-edge's target, or its source?) rather than one conflated count.
  // Needed because a single back-edge can have BOTH ends be conditions
  // (e.g. an inner repeat.while nested in an outer repeat.while's body: the
  // inner loop's own false-path terminal closing onto the OUTER condition
  // is one edge where the SOURCE is the inner loop's condition and the
  // TARGET is the outer loop's condition) -- conflating the two into one
  // per-node count made the inner condition's tally look like "2 back-edges
  // into itself" purely because it happened to be the SOURCE of an
  // unrelated edge counted for the OUTER condition's own convergence,
  // which isn't a branching-body signal for the inner loop at all (found
  // 2026-09-07 debugging the internal/external distinguishing check below
  // against a real loop-in-if/else-in-loop fixture).
  const targetRoleCounts = new Map<string, number>();
  const sourceRoleCounts = new Map<string, number>();
  for (const edge of flow.edges) {
    if (!backEdgeIds.has(edge.id)) continue;
    const sourceType = nodeTypeMap.get(edge.source);
    const targetType = nodeTypeMap.get(edge.target);
    // Repeat patterns always involve a condition node at one end — but both
    // ends can be conditions (e.g. a repeat_until's body placeholder gets
    // replaced by an If/Else, so the loop's own back-edge now runs
    // condition -> nested-condition). Track *every* condition-typed
    // endpoint, not just one — picking only source-or-target here previously
    // dropped whichever endpoint wasn't picked, silently missing the exact
    // node that goes on to receive the branching convergence.
    if (sourceType === 'condition' || targetType === 'condition') {
      repeatBackEdgeIds.add(edge.id);
      if (targetType === 'condition') {
        loopConditionNodeIds.add(edge.target);
        targetRoleCounts.set(edge.target, (targetRoleCounts.get(edge.target) ?? 0) + 1);
      }
      if (sourceType === 'condition') {
        loopConditionNodeIds.add(edge.source);
        sourceRoleCounts.set(edge.source, (sourceRoleCounts.get(edge.source) ?? 0) + 1);
      }
    }
  }
  // Filter out repeat back-edges for acyclic structural analysis. Moved
  // above hasBranchingRepeatBody's own computation (was originally right
  // after it) because the internal/external distinguishing check just
  // below needs a forward-only edge view to walk a loop's own body safely
  // without following back-edges into an infinite walk.
  const forwardEdges = flow.edges.filter((e) => !repeatBackEdgeIds.has(e.id));
  // Create a filtered flow view for analysis functions that operate on flow.edges
  const filteredFlow: FlowGraph = { ...flow, edges: forwardEdges };

  // More than one back-edge closing onto the same loop condition USED TO
  // unconditionally mean "the loop body branches in a way native can't
  // represent" -- but that blanket rule is wrong for the extremely common,
  // totally safe case of a repeat_while/until whose body's own trailing
  // statement is itself a branching construct (an if/else, a choose, a
  // parallel block) where EVERY branch simply completes and implicitly
  // continues the loop. Confirmed by direct evidence (maximal parser
  // stress test, round 3, 2026-09-07): a `repeat.while` whose body is a
  // single `parallel:` with 3 sibling branches, and a `repeat.while` whose
  // body is an `if/else` (one branch itself a nested loop) both regressed
  // from correctly tree-classified/native-renderable to state-machine (or
  // a thrown error under a forced strategy) the moment the parser was
  // fixed to correctly wire EVERY one of a branching body's terminal nodes
  // back to the loop condition (previously only one arbitrary terminal got
  // wired, silently dropping the others' own loop continuation -- a
  // real, separate bug now fixed in YamlParser.ts). Both shapes are
  // trivially representable by NativeStrategy's ordinary recursive nesting
  // (no special handling needed at all -- native.ts renders control flow
  // by walking nesting structure, not by needing one graph back-edge per
  // branch), so continuing to flag them here would be a straight quality
  // regression introduced BY the parser fix, not a genuine new danger.
  //
  // The genuine danger this check exists for (see
  // strategy-selection.test.ts's "Two separate loops to merge" fixture) is
  // different: an edge from something UNRELATED to this loop's own body --
  // e.g. a manually rewired edge from an entirely separate branch of the
  // graph -- landing on the loop's condition node. Distinguish the two by
  // checking whether every back-edge's "other" endpoint is a genuine
  // descendant of the condition's OWN true-handle body entry (i.e. reached
  // by walking forward-only edges starting from what the condition's own
  // 'true' edge(s) point at) -- as opposed to being reachable only via the
  // condition's FALSE/exit edge (which is what the dangerous rewired case
  // actually is: the stray edge's source is reachable from the condition
  // only via ITS OWN exit path, never via entering its body). This check
  // is intentionally narrow: it only relaxes the specific "condition is
  // the back-edge TARGET" shape (repeat.while, and while-like re-entry
  // points) actually proven safe here -- the "condition is the back-edge
  // SOURCE" shape (repeat.until's own false-handle back-edge into its body)
  // is left exactly as conservative as before, since it has a materially
  // different structure (the loop's body precedes rather than follows the
  // condition) and no concrete evidence yet requires touching it.
  const bodyEntryReachableCache = new Map<string, Set<string>>();
  function bodyEntryReachableSet(condId: string): Set<string> {
    const cached = bodyEntryReachableCache.get(condId);
    if (cached) return cached;
    const forwardOutgoing = new Map<string, FlowEdge[]>();
    for (const e of forwardEdges) {
      const list = forwardOutgoing.get(e.source) ?? [];
      list.push(e);
      forwardOutgoing.set(e.source, list);
    }
    const trueEntryEdges = (forwardOutgoing.get(condId) ?? []).filter(
      (e) => e.sourceHandle === 'true'
    );
    const reachable = new Set<string>();
    const stack = trueEntryEdges.map((e) => e.target);
    while (stack.length > 0) {
      const nodeId = stack.pop() as string;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      for (const e of forwardOutgoing.get(nodeId) ?? []) {
        if (!reachable.has(e.target)) stack.push(e.target);
      }
    }
    bodyEntryReachableCache.set(condId, reachable);
    return reachable;
  }
  const backEdgesByTarget = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    if (!repeatBackEdgeIds.has(edge.id)) continue;
    const list = backEdgesByTarget.get(edge.target) ?? [];
    list.push(edge);
    backEdgesByTarget.set(edge.target, list);
  }
  // A condition with 2+ back-edges where it's the SOURCE (the repeat.until
  // shape) stays exactly as conservative as before -- no evidence yet that
  // this shape is ever safe to relax, and it has a materially different
  // structure (loop body precedes the condition) from the while-style
  // target case below.
  const hasDangerousSourceRoleBranching = [...sourceRoleCounts.values()].some(
    (count) => count > 1
  );
  const hasDangerousTargetRoleBranching = [...targetRoleCounts.entries()].some(
    ([condId, count]) => {
      if (count <= 1) return false;
      const incomingBackEdges = backEdgesByTarget.get(condId) ?? [];
      if (incomingBackEdges.length !== count) return true;
      const reachable = bodyEntryReachableSet(condId);
      return !incomingBackEdges.every((e) => reachable.has(e.source));
    }
  );
  const hasBranchingRepeatBody = hasDangerousSourceRoleBranching || hasDangerousTargetRoleBranching;

  // A branching loop body can also surface as an *ordinary* convergence at
  // the loop condition itself (e.g. repeat_until: only one of the two
  // branch-to-condition edges gets structurally detected as a back-edge by
  // findBackEdges' DFS — the other survives into forwardEdges as a normal
  // edge and gets waved through by detectConvergingPaths' if/then/else
  // continuation-pattern exception, which has no way to know the
  // "continuation" it's looking at is actually a loop condition). Catch
  // that here: if a node anchoring a repeat loop receives more than one
  // edge in the forward view, the loop body branches, same conclusion as
  // hasBranchingRepeatBody above.
  const hasConvergenceAtLoopCondition = [...loopConditionNodeIds].some(
    (nodeId) => forwardEdges.filter((e) => e.target === nodeId).length > 1
  );

  // Build the graph (excluding back-edges)
  for (const node of flow.nodes) {
    g.setNode(node.id, node);
  }
  for (const edge of forwardEdges) {
    g.setEdge(edge.source, edge.target, edge);
  }

  // Detect cycles using graphlib's isAcyclic (back-edges excluded)
  const hasCycles = !alg.isAcyclic(g);

  // Find entry points (nodes with no incoming forward edges)
  const entryNodes = flow.nodes.filter((n) => g.predecessors(n.id)?.length === 0).map((n) => n.id);

  // Find exit points (nodes with no outgoing forward edges)
  const exitNodes = flow.nodes
    .filter((n) => {
      const forwardOutgoing = forwardEdges.filter((e) => e.source === n.id);
      return forwardOutgoing.length === 0;
    })
    .map((n) => n.id);

  // Get topological order if acyclic
  let topologicalOrder: string[] | null = null;
  if (!hasCycles) {
    try {
      topologicalOrder = alg.topsort(g);
    } catch {
      // Should not happen if isAcyclic is true
      topologicalOrder = null;
    }
  }

  // Check for cross-links (edges that skip levels) - use filtered flow
  const hasCrossLinks = detectCrossLinks(g, filteredFlow, topologicalOrder);

  // Check for converging paths (multiple edges pointing to same node) - use filtered flow
  const hasConvergingPaths = detectConvergingPaths(filteredFlow);

  // Check for divergent trigger paths (different triggers → different actions)
  const hasDivergentTriggerPaths = detectDivergentTriggerPaths(g, filteredFlow);

  // A tree structure has:
  // - No cycles
  // - Single entry point
  // - No cross-links
  // - No converging paths (except for condition branches that merge)
  // - No divergent trigger paths (all triggers lead to same actions)
  // - No branching repeat body (see hasBranchingRepeatBody/
  //   hasConvergenceAtLoopCondition above)
  const isTree =
    !hasCycles &&
    !hasCrossLinks &&
    !hasConvergingPaths &&
    !hasDivergentTriggerPaths &&
    !hasBranchingRepeatBody &&
    !hasConvergenceAtLoopCondition;

  // Determine recommended strategy
  const recommendedStrategy = isTree ? 'native' : 'state-machine';

  return {
    isTree,
    hasCycles,
    hasMultipleEntryPoints: entryNodes.length > 1,
    hasCrossLinks,
    hasConvergingPaths,
    hasDivergentTriggerPaths,
    entryNodes,
    exitNodes,
    topologicalOrder,
    recommendedStrategy,
  };
}

/**
 * Detect cross-links: edges that skip levels in the graph hierarchy
 * or create backward references (but not full cycles)
 *
 * Exception: parallel branches of different lengths that converge to a common
 * target are NOT cross-links - they're valid parallel patterns.
 */
function detectCrossLinks(
  g: GraphInstance,
  flow: FlowGraph,
  topologicalOrder: string[] | null
): boolean {
  if (!topologicalOrder || topologicalOrder.length === 0) {
    return false; // Can't detect cross-links in cyclic graphs
  }

  // Create a level map based on topological order
  const levelMap = new Map<string, number>();

  // BFS from entry nodes to assign levels
  const entryNodes = flow.nodes.filter((n) => g.predecessors(n.id)?.length === 0).map((n) => n.id);

  const queue: Array<{ nodeId: string; level: number }> = entryNodes.map((id) => ({
    nodeId: id,
    level: 0,
  }));

  while (queue.length > 0) {
    const { nodeId, level } = queue.shift()!;

    if (levelMap.has(nodeId)) {
      continue; // Already visited
    }

    levelMap.set(nodeId, level);

    const successors = g.successors(nodeId) || [];
    for (const succ of successors) {
      if (!levelMap.has(succ)) {
        queue.push({ nodeId: succ, level: level + 1 });
      }
    }
  }

  // Build map of nodes with multiple outgoing edges (potential parallel sources)
  const parallelSources = new Set<string>();
  const outgoingEdgeCount = new Map<string, number>();
  for (const edge of flow.edges) {
    const count = (outgoingEdgeCount.get(edge.source) || 0) + 1;
    outgoingEdgeCount.set(edge.source, count);
  }
  for (const [nodeId, count] of outgoingEdgeCount) {
    if (count > 1) {
      const node = flow.nodes.find((n) => n.id === nodeId);
      // Only non-condition nodes with multiple edges are parallel sources
      // (condition nodes have true/false branching)
      if (node?.type !== 'condition') {
        const nodeEdges = flow.edges.filter((e) => e.source === nodeId);
        const hasConditionLabels = nodeEdges.some(
          (e) => e.sourceHandle === 'true' || e.sourceHandle === 'false'
        );
        if (!hasConditionLabels) {
          parallelSources.add(nodeId);
        }
      }
    }
  }

  // Build map of nodes with multiple incoming edges (potential convergence points)
  const convergencePoints = new Set<string>();
  const incomingEdgeCount = new Map<string, number>();
  for (const edge of flow.edges) {
    const count = (incomingEdgeCount.get(edge.target) || 0) + 1;
    incomingEdgeCount.set(edge.target, count);
  }
  for (const [nodeId, count] of incomingEdgeCount) {
    if (count > 1) {
      convergencePoints.add(nodeId);
    }
  }

  // Check for edges that skip more than one level
  for (const edge of flow.edges) {
    const sourceLevel = levelMap.get(edge.source);
    const targetLevel = levelMap.get(edge.target);

    if (sourceLevel !== undefined && targetLevel !== undefined) {
      // Forward edge that skips a level
      if (targetLevel > sourceLevel + 1) {
        return true;
      }
      // Backward edge (not a full cycle, but goes to earlier level)
      if (targetLevel < sourceLevel) {
        // Check if this is a parallel branch convergence pattern:
        // The target is a convergence point AND there's a parallel source
        // somewhere upstream that created these parallel branches
        if (convergencePoints.has(edge.target) && parallelSources.size > 0) {
          // This might be a valid parallel pattern - check if the source
          // can trace back to a parallel source
          const canReachParallelSource = traceToParallelSourceBFS(
            flow,
            edge.source,
            parallelSources
          );
          if (canReachParallelSource) {
            // This is a parallel branch of different length converging - OK
            continue;
          }
        }
        // Same reasoning, condition-branch flavor (found via empirical
        // audit, 2026-09-06, Phase B item 3): an N-way choose/elif cascade
        // whose cases sit at different depths (near-universal once a case
        // is itself an AND-chain, or the cascade has 3+ levels, as in this
        // very edge -- a deeper case's action converging on the same
        // shared tail as a shallower case's) produces exactly this kind of
        // "backward" level-skip on the deeper branch's own edge into the
        // tail, even though detectConvergingPaths' own condition-branch
        // trace (checkParallelConvergence's traceToBranchCondition, which
        // climbs through single-incoming-edge condition ancestors --
        // see its doc comment) already accepts this exact convergence as
        // legitimate. Reuse that same acceptance test here, scoped to this
        // specific edge's target, rather than re-deriving the rule a
        // second, possibly divergent way.
        const incomingToTarget = flow.edges.filter((e) => e.target === edge.target);
        const uniqueIncomingSources = [...new Set(incomingToTarget.map((e) => e.source))];
        if (
          uniqueIncomingSources.length > 1 &&
          checkParallelConvergence(flow, uniqueIncomingSources, new Map(), edge.target)
        ) {
          continue;
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * Trace backwards from a node to see if it can reach any parallel source
 */
function traceToParallelSourceBFS(
  flow: FlowGraph,
  startNodeId: string,
  parallelSources: Set<string>
): boolean {
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    if (parallelSources.has(nodeId)) {
      return true;
    }

    // Find predecessors
    const predecessors = flow.edges.filter((e) => e.target === nodeId).map((e) => e.source);

    for (const pred of predecessors) {
      if (!visited.has(pred)) {
        queue.push(pred);
      }
    }
  }

  return false;
}

/**
 * Detect divergent trigger paths: different triggers lead to different action chains
 * In native HA, all triggers run the same action sequence, so if triggers have
 * different targets, we need the state machine to route based on which trigger fired.
 */
function detectDivergentTriggerPaths(g: GraphInstance, flow: FlowGraph): boolean {
  // Find all trigger nodes
  const triggerNodes = flow.nodes.filter((n) => n.type === 'trigger');

  // If 0 or 1 trigger, no divergence possible
  if (triggerNodes.length <= 1) {
    return false;
  }

  // Get the immediate targets of each trigger
  const triggerTargets = triggerNodes.map((trigger) => {
    const successors = g.successors(trigger.id) || [];
    return new Set(successors);
  });

  // When each trigger connects exclusively to condition nodes, the conditions
  // handle routing at runtime (e.g. `condition: trigger` checks). This pattern
  // is natively expressible in HA with sequential `if` blocks and is NOT
  // truly divergent from a transpilation standpoint.
  const allTriggerTargetsAreConditions = triggerNodes.every((trigger) => {
    const successors = g.successors(trigger.id) || [];
    return (
      successors.length > 0 &&
      successors.every((succ) => {
        const node = flow.nodes.find((n) => n.id === succ);
        return node?.type === 'condition';
      })
    );
  });
  if (allTriggerTargetsAreConditions) {
    return false;
  }

  // Check if all triggers have the same targets
  const firstTargets = triggerTargets[0];
  for (let i = 1; i < triggerTargets.length; i++) {
    const currentTargets = triggerTargets[i];

    // Check if sets are equal
    if (firstTargets.size !== currentTargets.size) {
      return true; // Different number of targets = divergent
    }

    for (const target of firstTargets) {
      if (!currentTargets.has(target)) {
        return true; // Different targets = divergent
      }
    }
  }

  return false;
}

/**
 * Detect converging paths: multiple edges pointing to the same node
 * This creates a DAG pattern that can't be represented as a simple tree
 *
 * Exception: parallel block convergence (multiple branches from a common source
 * that all converge to the same target) can be represented natively
 */
function detectConvergingPaths(flow: FlowGraph): boolean {
  const incomingCount = new Map<string, number>();

  for (const edge of flow.edges) {
    const count = incomingCount.get(edge.target) || 0;
    incomingCount.set(edge.target, count + 1);
  }

  // Build a map of outgoing edges for each node
  const outgoingEdges = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const existing = outgoingEdges.get(edge.source) || [];
    existing.push(edge.target);
    outgoingEdges.set(edge.source, existing);
  }

  for (const [nodeId, count] of incomingCount) {
    if (count > 1) {
      const incomingEdges = flow.edges.filter((e) => e.target === nodeId);
      const uniqueSources = new Set(incomingEdges.map((e) => e.source));

      if (uniqueSources.size > 1) {
        // It's a convergence. But is it from multiple triggers?
        const sourceNodes = [...uniqueSources].map((sourceId) =>
          flow.nodes.find((n) => n.id === sourceId)
        );
        const allSourcesAreTriggers = sourceNodes.every((n) => n?.type === 'trigger');

        if (allSourcesAreTriggers) {
          continue; // Multiple triggers converging - OK for native
        }

        // Check if this is a parallel block convergence pattern:
        // All converging sources must share a common predecessor that has
        // multiple outgoing edges (parallel branches)
        const isParallelConvergence = checkParallelConvergence(
          flow,
          [...uniqueSources],
          outgoingEdges,
          nodeId
        );

        if (!isParallelConvergence) {
          return true; // It's a true convergence that requires state-machine
        }
      }
    }
  }

  return false;
}

/**
 * Check if the converging sources form a parallel block pattern
 * A parallel block pattern is when:
 * 1. All converging branches originate from the same source node
 * 2. That source node is NOT a condition node (which would be branching, not parallel)
 * 3. The outgoing edges from that source are NOT labeled with sourceHandle (true/false)
 * 4. The incoming edges to the convergence point are NOT all from condition true paths
 *
 * This handles parallel blocks like: source → [A, B, C] → target
 * But NOT condition branching: condition → (true)A / (false)B → target
 */
function checkParallelConvergence(
  flow: FlowGraph,
  convergingSources: string[],
  outgoingEdges: Map<string, string[]>,
  convergenceTargetId: string
): boolean {
  // Reject outright if any converging source can reach ANOTHER converging
  // source via ordinary forward edges (found 2026-09-06, empirical audit --
  // see choose-ifelse-external-connection-audit.test.ts). A genuine
  // sibling-branch convergence -- if/then/else arms, an elif cascade's
  // individual cases, a `parallel:` block's own branches -- never has this
  // shape: each source is the tail of its own disjoint branch subtree, so
  // none is reachable from any other. When one IS reachable from another,
  // the "second" source isn't an independent sibling at all -- it's really
  // downstream of the "first" one, via a structurally redundant/shortcut
  // edge (e.g. a trigger wired directly onto a choose-chain's Case 2 IN
  // ADDITION to Case 1's own real chain edge, where Case 2 was already
  // reachable through Case 1's normal false-path fallthrough). Treating
  // that as two legitimate parallel siblings -- as traceToBranchCondition's
  // generalized climb below otherwise would once both traced back to the
  // same distant shared ancestor -- silently changes the automation's
  // actual behavior: native.ts would render Case 1 as an unconditional
  // `parallel:` sibling instead of the ordinary elif fallthrough it
  // actually is, so Case 2 gets (wrongly) evaluated and applied even when
  // Case 1 already matched.
  const reachableFrom = (startId: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const target of outgoingEdges.get(cur) ?? []) {
        if (!seen.has(target)) {
          seen.add(target);
          stack.push(target);
        }
      }
    }
    return seen;
  };
  for (const a of convergingSources) {
    const reach = reachableFrom(a);
    const aNode = flow.nodes.find((n) => n.id === a);
    for (const b of convergingSources) {
      if (a === b || !reach.has(b)) continue;
      // `a` reaches `b` via ordinary forward edges. That's expected and
      // FINE when `a` is a condition: its own true/false edges are
      // mutually exclusive, so "a's false edge feeds the convergence
      // target directly" (a IS a converging source) and "a's true edge
      // leads, several steps later, into b" (the OTHER converging source)
      // can never both execute in the same run -- this is nothing more
      // than the ordinary shape of an if/then with no else. Only reject
      // when `a` is NOT a condition: a non-condition node normally has
      // exactly one outgoing edge in this graph model, so having two here
      // (one leading directly to the convergence target, one leading,
      // several steps later, to the OTHER source `b`) can only mean an
      // unconditional multi-edge fan-out (a trigger with more than one
      // direct-drawn edge; a malformed non-`parallel:`-typed action) --
      // and per this codebase's own established convention for that shape
      // (state-machine.ts's buildTriggerRouting "collapses" a trigger's
      // extra edge into a target already reachable from another of its
      // targets, treating it as redundant rather than a second concurrent
      // path), BOTH edges are never independently, unconditionally live at
      // once the way a genuine `parallel:` block's branches are.
      if (aNode?.type !== 'condition') {
        return false;
      }
    }
  }

  // Check: if all converging sources are conditions and all incoming edges
  // to the convergence point have the same sourceHandle (all 'true' OR all 'false'),
  // this is an OR condition pattern that CAN be handled by native strategy.
  const incomingEdgesToTarget = flow.edges.filter((e) => e.target === convergenceTargetId);
  const allSourcesAreConditions = convergingSources.every((sourceId) => {
    const node = flow.nodes.find((n) => n.id === sourceId);
    return node?.type === 'condition';
  });
  const allIncomingFromTruePath = incomingEdgesToTarget.every((e) => e.sourceHandle === 'true');
  const allIncomingFromFalsePath = incomingEdgesToTarget.every((e) => e.sourceHandle === 'false');

  if (allSourcesAreConditions && (allIncomingFromTruePath || allIncomingFromFalsePath)) {
    // This is an OR condition pattern (multiple conditions' true/false paths converging)
    // This CAN be represented as native "condition: or" in Home Assistant YAML
    return true;
  }

  // Find predecessors of each converging source
  const predecessorsOf = (nodeId: string): string[] => {
    return flow.edges.filter((e) => e.target === nodeId).map((e) => e.source);
  };

  // Trace back each converging source's own chain of single-parented
  // ancestors, and check whether all of them share a common ancestor
  // somewhere along the way -- the outermost condition (or, at shallower
  // nesting, an inner condition, or a `parallel:` fan-out point) whose
  // branching structure explains why every one of these sources exists at
  // all. This is a nearest-common-ancestor search, not a "climb each
  // source all the way to its own root and hope they land on the exact
  // same final node" walk (an earlier version of this function worked
  // that way and had two opposite failure modes: stopping the climb too
  // early -- at the first self-parented condition -- missed sibling
  // branches nested at DIFFERENT depths beneath the SAME outer if/else;
  // climbing indefinitely instead overshot PAST the true, nearby shared
  // ancestor and wandered into unrelated, already-otherwise-resolved
  // convergences further up the graph, such as two triggers merging into
  // a shared entry node, wrongly failing the whole check on an unrelated
  // technicality found found 2026-09-06 auditing Phase B item 3's
  // coverage-gap candidates).
  //
  // Each source's chain is built by climbing through single-incoming-edge
  // predecessors ONE HOP AT A TIME, regardless of node type (condition,
  // action, delay, a loop's own set_variables init node, ...), stopping
  // (inclusively) the moment a node has 0 incoming edges (a true entry
  // root) or 2+ (an independent convergence point this trace can't climb
  // through -- that node is separately validated on its own terms by
  // detectConvergingPaths' own per-node loop, so this trace doesn't need
  // to vouch for it, but it also can't safely see PAST it). Climbing
  // through a node is safe by construction: it only ever happens when
  // that node has EXACTLY one incoming edge in the WHOLE graph, so there
  // is no other path into it from some unrelated branch this trace could
  // be wrongly conflating.
  const buildAncestorChain = (nodeId: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      const incomingEdges = flow.edges.filter((e) => e.target === current);
      if (incomingEdges.length !== 1) break; // 0 (true root) or 2+ (unresolved) -- chain ends here, inclusive
      current = incomingEdges[0].source;
    }
    return chain;
  };

  // Check if all converging sources' ancestor chains share a common node --
  // the NEAREST one, i.e. the first node (in climb order) that appears in
  // every source's chain. This is an if/then/else continuation pattern:
  // condition → (true) branch → convergence
  //          → (false) branch → convergence
  // -- or, equally, an N-way choose/elif cascade, or several `parallel:`
  // branches fanning out directly from a single condition's true edge --
  // natively representable in HA YAML either way (actions after the
  // if/then/else/choose/parallel block).
  const sourceChains = convergingSources.map((sourceId) => buildAncestorChain(sourceId));
  const sharedAncestorFound = sourceChains[0].some((candidate) =>
    sourceChains.every((chain) => chain.includes(candidate))
  );
  if (sharedAncestorFound) {
    // All branches originate from the same nearest shared ancestor --
    // whether that's a single if/then/else, an N-way choose/elif cascade,
    // or an inner if fully nested inside an outer branch -- this is a
    // valid continuation, natively representable in HA YAML.
    return true;
  }

  // Check if edges from a node are parallel (not condition branching)
  const isParallelSource = (nodeId: string): boolean => {
    const node = flow.nodes.find((n) => n.id === nodeId);
    // Condition nodes use true/false branching, not parallel
    if (node?.type === 'condition') {
      return false;
    }

    // Check if any outgoing edges have sourceHandle (condition labels)
    const nodeOutgoingEdges = flow.edges.filter((e) => e.source === nodeId);
    const hasConditionLabels = nodeOutgoingEdges.some(
      (e) => e.sourceHandle === 'true' || e.sourceHandle === 'false'
    );
    if (hasConditionLabels) {
      return false;
    }

    // Must have multiple outgoing edges for parallel
    return nodeOutgoingEdges.length > 1;
  };

  // Trace back each converging source to find the "parallel source" - the node
  // where parallel branches diverge
  const traceToParallelSource = (nodeId: string, visited: Set<string>): string | null => {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);

    const preds = predecessorsOf(nodeId);
    if (preds.length === 0) return null;
    if (preds.length > 1) return null; // Node has multiple predecessors, not a simple chain

    const pred = preds[0];

    // If predecessor is a parallel source (not condition branching), found it
    if (isParallelSource(pred)) {
      return pred;
    }

    // Otherwise, trace further back
    return traceToParallelSource(pred, visited);
  };

  // Find parallel source for each converging branch
  const parallelSources = new Set<string>();

  for (const sourceId of convergingSources) {
    // First check if this source's immediate predecessor is a parallel source
    const preds = predecessorsOf(sourceId);
    if (preds.length === 1) {
      const pred = preds[0];
      if (isParallelSource(pred)) {
        parallelSources.add(pred);
        continue;
      }
    }

    // Trace back to find parallel source
    const parallelSource = traceToParallelSource(sourceId, new Set());
    if (parallelSource) {
      parallelSources.add(parallelSource);
    } else {
      // No parallel source found for this branch - it's not a parallel pattern
      return false;
    }
  }

  // All converging branches must share the same parallel source
  return parallelSources.size === 1;
}

/**
 * Get the depth of each node from entry points
 */
export function getNodeDepths(flow: FlowGraph): Map<string, number> {
  const g = new Graph({ directed: true });

  for (const node of flow.nodes) {
    g.setNode(node.id, node);
  }
  for (const edge of flow.edges) {
    g.setEdge(edge.source, edge.target);
  }

  const depths = new Map<string, number>();
  const entryNodes = flow.nodes.filter((n) => g.predecessors(n.id)?.length === 0).map((n) => n.id);

  const queue: Array<{ nodeId: string; depth: number }> = entryNodes.map((id) => ({
    nodeId: id,
    depth: 0,
  }));

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    if (depths.has(nodeId) && depths.get(nodeId)! <= depth) {
      continue;
    }

    depths.set(nodeId, depth);

    const successors = g.successors(nodeId) || [];
    for (const succ of successors) {
      queue.push({ nodeId: succ, depth: depth + 1 });
    }
  }

  return depths;
}
