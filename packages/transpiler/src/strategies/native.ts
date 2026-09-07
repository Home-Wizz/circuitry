import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowGraph,
  FlowNode,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@circuitry/shared';
import { isDeviceAction, isStartNode } from '@circuitry/shared';
import type { TopologyAnalysis } from '../analyzer/topology';
import { findBackEdges } from '../analyzer/topology';
import { BaseStrategy, type HAYamlOutput } from './base';

/**
 * `target`/`options` only belong on purpose-specific dotted conditions
 * (e.g. `climate.is_cooling` — `options` holds inline threshold state like
 * `options.threshold`, `target` holds the entity/device/area it applies
 * to). Legacy flat condition types (state, time, sun, zone, ...) never have
 * either in HA's own schema, and HA's config validator rejects them
 * outright as "extra keys not allowed" the moment they show up — regardless
 * of how they got there.
 *
 * A defensive strip here, independent of the frontend fix that stops these
 * fields from being *written* onto the wrong condition type in the first
 * place (see packages/frontend/src/config/conditionFields.ts's
 * getAllConditionFieldNames), means a condition that's already carrying a
 * stale `target`/`options` — from an already-saved automation, or a
 * live-but-unsaved canvas session — transpiles cleanly the moment this
 * ships, without the user having to reconfigure it again just to clear the
 * leftover field. Reported directly: reconfiguring an If/Else condition
 * from a purpose-specific type (with a threshold) to the legacy "Time" type
 * left `options` behind, and saving failed with "extra keys not allowed @
 * ...['options']".
 *
 * Every `sun.*` condition (`sun.is_up`, `sun.is_down`, `sun.is_night`, ...)
 * is the one dotted-condition family that's an exception to "dotted means
 * target/options belong" above: HA's own docs are explicit that these take
 * "no options" at all, and the sun is a global singleton with nothing to
 * target — matches NativeConditionFields.tsx's `isSunSingleton` branch,
 * which suppresses the target/behavior/for fields in the UI for exactly
 * this reason. But nodes still round-trip an `options: {}` (or a stray
 * `target`) onto sun.* conditions from elsewhere (a default filled in at
 * node-creation time, or after switching a condition's type on an existing
 * node), and — same as the flat-condition case above — HA's config
 * validator rejects the *key* outright as "extra keys not allowed" even
 * when its value is an empty object; it's the field's mere presence that's
 * invalid, not what's in it. Reported directly: "none of my automations
 * made with Circuitry that involve is-it-night or sunset/sunrise
 * conditions work" — every one of them was carrying a `sun.is_up`/
 * `sun.is_night` condition with a leftover `options: {}` that HA's
 * schema rejected on save/load.
 */
export function stripDottedOnlyConditionFields(
  condition: unknown,
  rest: Record<string, unknown>
): Record<string, unknown> {
  if (typeof condition === 'string' && condition.startsWith('sun.')) {
    const { target, options, ...cleaned } = rest;
    return cleaned;
  }
  if (typeof condition === 'string' && condition.includes('.')) return rest;
  const { target, options, ...cleaned } = rest;
  return cleaned;
}

/**
 * Describes a detected repeat pattern in the flow graph
 */
interface RepeatPattern {
  type: 'while' | 'until' | 'count';
  /** The node ID that serves as the entry point to this repeat pattern */
  entryNodeId: string;
  /** Condition node IDs in the repeat (for while/until) */
  conditionNodeIds: string[];
  /** Body node IDs (the sequence inside the loop) */
  bodyNodeIds: string[];
  /**
   * Body entry node(s) -- where buildRepeatBlock actually starts building
   * the loop's `sequence:` from. Almost always a single id equal to
   * bodyNodeIds[0], but can be 2+ when the loop body's very first
   * statement is itself a `parallel:` block, fanning out directly from
   * whatever precedes the body (the loop's init node for 'count', or
   * whatever came before the repeat action for 'until') rather than from a
   * single concrete action node -- the identical shape collectBodyNodes
   * (used by 'while', which needed no separate field since it re-derives
   * this on demand in buildRepeatBlock) already handles. Missing this for
   * 'count'/'until' used to mean bodyNodeIds[0] alone -- one arbitrary
   * sibling of that fan-out -- got passed to buildFanOut as the sole entry,
   * silently building and keeping only that one branch and dropping the
   * rest every time the loop body opened with `parallel:` (found via
   * empirical audit, 2026-09-06).
   */
  bodyEntryNodeIds: string[];
  /** The source node of the back-edge */
  backEdgeSourceId: string;
  /** For count: the init set_vars node ID */
  initNodeId?: string;
  /** For count: the increment set_vars node ID */
  incrementNodeId?: string;
  /** For count: the count value */
  count?: number | string;
  /** The node ID where flow continues after the loop */
  exitNodeId: string | null;
}

/**
 * Describes a detected "Grouping actions" (`sequence:`) pattern — a matched
 * SequenceStartNode → ... body ... → SequenceEndNode run structurally, the
 * same way RepeatPattern above is detected from graph shape rather than an
 * explicit id reference between the two marker nodes.
 */
interface SequencePattern {
  /** The sequence_start node's own ID — also the map key / entry point */
  entryNodeId: string;
  /** The matching sequence_end node's ID */
  endNodeId: string;
  /**
   * Body entry node(s) -- sequence_start's own outgoing targets. Almost
   * always a single id, but can be 2+ when the group's very first
   * statement is itself a `parallel:` block, fanning out directly from
   * sequence_start rather than from a regular action node (the same shape
   * bug #4 fixed for repeat-loop bodies, found again here as bug #10:
   * detectSequencePatterns originally took only the first such edge via
   * `.find()`, silently discarding every other branch of the group's own
   * opening fan-out).
   */
  bodyEntryNodeIds: string[];
  /** All node IDs strictly between start and end */
  bodyNodeIds: string[];
  /** Where flow continues after the group (sequence_end's own outgoing target) */
  exitNodeId: string | null;
  alias?: string;
}

/**
 * Native strategy for simple tree-shaped automations
 * Generates standard nested Home Assistant YAML with choose blocks
 */
export class NativeStrategy extends BaseStrategy {
  readonly name = 'native';
  readonly description = 'Generates nested HA YAML for simple tree-shaped automations';

  canHandle(analysis: TopologyAnalysis): boolean {
    return analysis.isTree;
  }

  /** Repeat patterns detected in the current flow */
  private repeatPatterns: Map<string, RepeatPattern> = new Map();
  /** Set of all node IDs that are internal to a repeat pattern */
  private repeatInternalNodeIds: Set<string> = new Set();
  /** Sequence (Grouping actions) patterns detected in the current flow, keyed by sequence_start node ID */
  private sequencePatterns: Map<string, SequencePattern> = new Map();
  /** Set of all node IDs internal to a sequence pattern (start + body + end) */
  private sequenceInternalNodeIds: Set<string> = new Set();
  /** Set of back-edge IDs detected via DFS */
  private backEdgeIds: Set<string> = new Set();
  /**
   * Node IDs in the exact order they're materialized into YAML by this
   * generate() call — i.e. the order buildCondition()/buildNodeAction()
   * are first invoked for each node. This is later reused (via
   * HAYamlOutput.nodeOrder) as the write-order for `_circuitry_metadata.nodes`
   * in FlowTranspiler.ts's generateCircuitryMetadata, so that it exactly matches
   * the order YamlParser.ts's parseAutomationStructure will re-encounter
   * the same nodes when walking this same generated YAML back on reload.
   * Fixes saved node positions getting reassigned to the wrong nodes on
   * reopen — see recordNodeOrder()'s doc comment for the full mechanism.
   */
  private nodeVisitOrder: string[] = [];

  /**
   * Records a node's first materialization into output YAML, in call order.
   * Called from the few choke points every condition/action/delay/wait/
   * set_variables/join node necessarily passes through (buildCondition,
   * buildNodeAction) — deliberately NOT from every individual builder, so
   * this doesn't need to track this file's many recursive branch points
   * individually. Idempotent: a node revisited from a second call site
   * (e.g. a condition reached via both buildConditionChoose and this file's
   * own inline condition-chain logic) keeps its first recorded position.
   * Trigger and start-marker nodes never reach either choke point (they're
   * structural entry points, handled separately) and purely-transparent
   * nodes (paired sequence markers, a count-repeat's init/increment nodes)
   * also never reach one — FlowTranspiler.ts's generateCafeMetadata knows
   * to append any node ID missing from this list at the end, in its
   * original flow.nodes order, as a safe fallback.
   */
  private recordNodeOrder(nodeId: string): void {
    if (!this.nodeVisitOrder.includes(nodeId)) {
      this.nodeVisitOrder.push(nodeId);
    }
  }

  /**
   * Shared setup every entry point into this strategy's tree-walker needs
   * before buildSequenceFromNode/buildNodeAction/buildCondition can run:
   * resets the visit-order tracker, strips visual-only hint edges, and
   * pre-detects back-edges/repeat patterns/sequence-marker pairs from the
   * (possibly hint-stripped) flow. Factored out of generate() so
   * buildActionsFromEntryPoint (see its own doc comment) can reuse the exact
   * same detection instead of duplicating it — CLAUDE.md's DRY rule.
   * Returns the hint-stripped flow, since callers need to pass that same
   * flow into buildSequenceFromNode/getOutgoingEdges afterward.
   */
  private prepareForTraversal(flow: FlowGraph): FlowGraph {
    this.nodeVisitOrder = [];

    // Strip hint edges (visual-only trigger-routing aids) before any processing
    flow = {
      ...flow,
      edges: flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint'),
    };

    // Structurally detect back-edges using DFS
    this.backEdgeIds = findBackEdges(flow);

    // Pre-detect repeat patterns from structural back-edges
    this.repeatPatterns = this.detectRepeatPatterns(flow);
    this.repeatInternalNodeIds = new Set();
    for (const pattern of this.repeatPatterns.values()) {
      for (const id of pattern.bodyNodeIds) this.repeatInternalNodeIds.add(id);
      for (const id of pattern.conditionNodeIds) this.repeatInternalNodeIds.add(id);
      if (pattern.initNodeId) this.repeatInternalNodeIds.add(pattern.initNodeId);
      if (pattern.incrementNodeId) this.repeatInternalNodeIds.add(pattern.incrementNodeId);
    }

    // Pre-detect sequence_start/sequence_end marker pairs
    this.sequencePatterns = this.detectSequencePatterns(flow);
    this.sequenceInternalNodeIds = new Set();
    for (const pattern of this.sequencePatterns.values()) {
      this.sequenceInternalNodeIds.add(pattern.entryNodeId);
      this.sequenceInternalNodeIds.add(pattern.endNodeId);
      for (const id of pattern.bodyNodeIds) this.sequenceInternalNodeIds.add(id);
    }

    return flow;
  }

  /**
   * Builds a self-contained native HA action sequence starting from an
   * arbitrary node, for callers that aren't transpiling a whole automation
   * through generate() — currently only StateMachineStrategy's
   * generateParallelEntryBlocks (see its doc comment), which needs to inline
   * one branch of a `parallel:` block for a trigger with multiple direct
   * targets. Reuses this class's own tree-walker (buildSequenceFromNode)
   * rather than StateMachineStrategy hand-rolling a second, separate way to
   * turn a condition/delay/wait/action chain into YAML — CLAUDE.md's DRY
   * rule again. Every non-cyclic subtree (the only kind a parallel branch
   * can legally be — a back-edge looping out of one branch into shared
   * state isn't representable in HA's `parallel:` regardless) transpiles
   * exactly like it would if it were the sole path out of a trigger.
   */
  buildActionsFromEntryPoint(flow: FlowGraph, entryNodeId: string): unknown[] {
    const preparedFlow = this.prepareForTraversal(flow);
    return this.buildSequenceFromNode(preparedFlow, entryNodeId, new Set());
  }

  /**
   * Finds the shared convergence node (if any) that every one of the given
   * branch-start node ids eventually reaches, using this class's own
   * back-edge-aware BFS reachability search (findConvergencePoint) --
   * exposed for StateMachineStrategy's generateParallelEntryBlocks (see its
   * doc comment), which needs to know whether a trigger's fanned-out
   * targets reconverge on a shared continuation before deciding whether to
   * route the state machine's current_node there afterward, or straight to
   * 'END' (found via empirical audit, 2026-09-06 -- generateParallelEntryBlocks
   * previously always jumped to 'END' after the parallel block, silently
   * dropping any action that came after the branches reconverged).
   */
  findConvergencePointForBranches(flow: FlowGraph, branchStartIds: string[]): string | null {
    const preparedFlow = this.prepareForTraversal(flow);
    return this.findConvergencePoint(preparedFlow, branchStartIds);
  }

  /**
   * Set-aware counterpart to findConvergencePointForBranches: exposed for
   * StateMachineStrategy's buildFanOutFromTargets/generateParallelEntryBlocks,
   * which need to know the FULL set of shared convergence node(s) -- not
   * just one arbitrary member of it -- when 2+ branches share 2+ sibling
   * downstream nodes rather than a single dominating one (bug #12, found
   * via the randomized fuzzer, 2026-09-06). See findConvergenceSet's own
   * doc comment for the full explanation.
   */
  findConvergenceSetForBranches(flow: FlowGraph, branchStartIds: string[]): string[] {
    const preparedFlow = this.prepareForTraversal(flow);
    return this.findConvergenceSet(preparedFlow, branchStartIds);
  }

  /**
   * Builds a self-contained native HA action sequence starting from an
   * arbitrary node but stopping BEFORE a given boundary node, instead of
   * running to the natural end of the subtree like buildActionsFromEntryPoint
   * does. Exposed for StateMachineStrategy's generateParallelEntryBlocks: once
   * findConvergencePointForBranches has located a shared continuation node,
   * each parallel branch must be built only up to that point -- the
   * continuation itself belongs to the state machine's normal per-node
   * dispatch (already generated for every node via generateNodeBlock), not
   * duplicated inline inside one branch of the `parallel:` block.
   *
   * stopNodeId may be a single node id (the classic case) or a Set of node
   * ids (bug #12 fix, 2026-09-06): when 2+ branches share 2+ sibling
   * convergence nodes, StateMachineStrategy needs to bound a branch's walk
   * at ANY member of that sibling set, not just one of them.
   */
  buildActionsUntilNode(
    flow: FlowGraph,
    entryNodeId: string,
    stopNodeId: string | Set<string>
  ): unknown[] {
    const preparedFlow = this.prepareForTraversal(flow);
    return this.buildSequenceUntilNode(preparedFlow, entryNodeId, stopNodeId, new Set());
  }

  generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput {
    const warnings: string[] = [];
    flow = this.prepareForTraversal(flow);

    // Record trigger nodes' order FIRST, before any action/condition node is
    // visited. Trigger nodes never reach recordNodeOrder's own call sites
    // (buildNodeAction/buildCondition -- they're extracted separately, right
    // below, via extractTriggers) so without this they always end up
    // appended AFTER every action in `_circuitry_metadata.nodes` (via
    // generateCircuitryMetadata's fallback loop), regardless of the
    // trigger's real position. Since YamlParser.ts's getNextNodeId() pulls
    // ids from that list in strict positional order and parses triggers
    // first, this silently swapped the trigger's saved node id with the
    // first action's on every save -> reload round trip. Found via the
    // pre-existing (since v1.0.0) metadata-persistence test failures
    // surfaced during the decompile audit, 2026-09-06 -- a real, if
    // narrow, node-identity-corruption bug, not introduced this session.
    for (const node of flow.nodes) {
      if (node.type === 'trigger') {
        this.recordNodeOrder(node.id);
      }
    }

    // Extract triggers from the flow
    const triggers = this.extractTriggers(flow);

    // Build action sequence starting from first node after triggers
    const entryNodes = analysis.entryNodes;
    const firstActions = entryNodes.flatMap((entryId) => {
      const outgoing = this.getOutgoingEdges(flow, entryId);
      return outgoing.map((e) => e.target);
    });

    // Remove duplicates
    const uniqueFirstActions = [...new Set(firstActions)];

    // Check if leading conditions can be promoted to root conditions block.
    // Conditions directly after triggers with no else/false paths can be placed
    // in the root "conditions:" block so HA properly tracks "Last triggered at".
    let rootConditions: unknown[] | null = null;
    let actionsStartNodeIds: string[] = [];
    let promotedVisited: Set<string> | null = null;

    if (uniqueFirstActions.length === 1) {
      const promoted = this.extractLeadingConditions(flow, uniqueFirstActions[0]);
      if (promoted.conditions.length > 0) {
        rootConditions = promoted.conditions;
        actionsStartNodeIds = promoted.nextNodeIds;
        promotedVisited = promoted.visitedIds;
      }
    }

    // Build the action sequence
    let actions: unknown[];
    if (rootConditions) {
      // Leading conditions promoted to root - build actions from continuation point(s)
      // If there are multiple starting points (fan-out), build sequences from all of them
      if (actionsStartNodeIds.length > 0) {
        // buildFanOut, not a plain .flatMap -- found via empirical audit, 2026-09-06, as bug #12: a genuine multi-target then/else fan-out (an ordinary `parallel:` block as an if/then's or a choose case's own content) was being flattened via .flatMap into a plain sequential list instead of wrapped in `{ parallel: [...] }` -- silently turning concurrent branches into sequential ones, a real behavior change for any branch containing a delay/wait (same class of bug as #4/#9/#11, just on the DEFAULT/native if-then-else and choose-case builders instead of a loop/sequence-group body or StateMachineStrategy).
        actions = this.buildFanOut(flow, actionsStartNodeIds, new Set(promotedVisited!));
      } else {
        actions = [];
      }
    } else if (uniqueFirstActions.length === 1) {
      actions = this.buildSequenceFromNode(flow, uniqueFirstActions[0], new Set());
    } else if (uniqueFirstActions.length > 1) {
      // Check if this is an OR pattern: all first actions are conditions
      // whose true/false paths converge to the same target
      const orPattern = this.detectOrPattern(flow, uniqueFirstActions);

      if (orPattern) {
        // Build OR condition block
        const orConditions = orPattern.conditions.map((c) => this.buildCondition(c));
        const visited = new Set(orPattern.conditions.map((c) => c.id));

        const thenSequence = this.buildSequenceFromNode(flow, orPattern.convergenceNode, visited);

        actions = [
          {
            if: [{ condition: 'or', conditions: orConditions }],
            then: thenSequence,
            else: orPattern.isFromFalsePaths ? [] : [], // OR conditions from true paths have empty else
          },
        ];
      } else {
        // Check if all first-action nodes are `condition: trigger` nodes.
        // In that case, each branch is an exclusive trigger-id route and should
        // be emitted as sequential `if:` blocks, not a parallel block.
        const allAreTriggerConditions = uniqueFirstActions.every((nodeId) => {
          const node = flow.nodes.find((n) => n.id === nodeId);
          return (
            node?.type === 'condition' &&
            (node.data as Record<string, unknown>)?.condition === 'trigger'
          );
        });

        if (allAreTriggerConditions) {
          // Emit each as a sequential if block
          actions = uniqueFirstActions.flatMap((nodeId) =>
            this.buildSequenceFromNode(flow, nodeId, new Set())
          );
        } else {
          // Multiple paths from triggers - use parallel. Found via
          // empirical audit, 2026-09-06 (Phase B item 3 stress test): this
          // used to build each branch independently and unbounded via
          // buildSequenceFromNode, exactly like buildFanOut's own
          // now-fixed bug #12 predecessor -- so two trigger-fan-out
          // branches that both eventually converge on the same downstream
          // node (e.g. trigger -> [A, B] -> shared C) each walked all the
          // way through C independently, duplicating C's actions into
          // BOTH parallel branches (and any state/template `data` object
          // reused between them via a YAML anchor, since js-yaml
          // auto-anchors the now-identical duplicated object) instead of
          // running it once after the parallel block, same as any other
          // service action or condition would if listed after a
          // `parallel:` in native HA YAML. buildFanOut already solves
          // exactly this (findConvergencePoint + buildSequenceUntilNode +
          // a single shared continuation) -- reuse it here instead of
          // re-deriving the same unbounded logic a second, divergent way.
          actions = this.buildFanOut(flow, uniqueFirstActions, new Set());
        }
      }
    } else {
      actions = [];
      warnings.push('No actions found after trigger nodes');
    }

    // No trigger nodes: this is a script-mode flow (a callable sub-flow via
    // its own "Start block") rather than an automation. Emit `script:`, not
    // `automation:` with an empty triggers list — an automation with no
    // triggers can never fire. entryNodes/firstActions above already treat a
    // `start` node exactly like a `trigger` node (metadata-only, no incoming
    // edges, its own action is never emitted), so the action sequence built
    // above is already correct for this branch; only the wrapper shape and
    // `fields:` extraction differ.
    if (triggers.length === 0) {
      const script: Record<string, unknown> = {
        alias: flow.name,
        description: flow.description || '',
        sequence: actions,
        mode: flow.metadata?.mode ?? 'single',
      };

      if (flow.userVariables && Object.keys(flow.userVariables).length > 0) {
        script.variables = flow.userVariables;
      }
      if (flow.metadata?.max) {
        script.max = flow.metadata.max;
      }
      if (flow.metadata?.max_exceeded) {
        script.max_exceeded = flow.metadata.max_exceeded;
      }

      // Script `fields:` (typed input parameters) come from an explicit
      // `start` node, if the flow has one.
      const startNode = flow.nodes.find(isStartNode);
      const fields = startNode?.data.fields;
      if (fields && Object.keys(fields).length > 0) {
        script.fields = fields;
      }

      return {
        script,
        warnings,
        strategy: this.name,
        nodeOrder: this.nodeVisitOrder,
      };
    }

    const automation: Record<string, unknown> = {
      alias: flow.name,
      description: flow.description || '',
      triggers: triggers,
    };

    if (rootConditions && rootConditions.length > 0) {
      automation.conditions = rootConditions;
    }

    automation.actions = actions;
    automation.mode = flow.metadata?.mode ?? 'single';

    // Preserve top-level variables from original YAML (round-trip)
    if (flow.userVariables && Object.keys(flow.userVariables).length > 0) {
      automation.variables = flow.userVariables;
    }

    // Add optional metadata
    if (flow.metadata?.max) {
      automation.max = flow.metadata.max;
    }
    if (flow.metadata?.max_exceeded) {
      automation.max_exceeded = flow.metadata.max_exceeded;
    }
    if (flow.metadata?.initial_state === false) {
      automation.initial_state = false;
    }
    if (flow.metadata?.trace) {
      automation.trace = flow.metadata.trace;
    }
    if (flow.userTriggerVariables && Object.keys(flow.userTriggerVariables).length > 0) {
      automation.trigger_variables = flow.userTriggerVariables;
    }

    return {
      automation,
      warnings,
      strategy: this.name,
      nodeOrder: this.nodeVisitOrder,
    };
  }

  /**
   * Detect repeat patterns by structurally analyzing back-edges in the graph.
   * Classification rules:
   * - Back-edge target is a condition, source is NOT a condition → while
   * - Back-edge source is a condition with sourceHandle='false' → until
   * - Back-edge source is a condition with sourceHandle='true' → count
   */
  private detectRepeatPatterns(flow: FlowGraph): Map<string, RepeatPattern> {
    const patterns = new Map<string, RepeatPattern>();

    for (const edge of flow.edges) {
      if (!this.backEdgeIds.has(edge.id)) continue;

      const sourceNode = this.getNode(flow, edge.source);
      const targetNode = this.getNode(flow, edge.target);
      if (!sourceNode || !targetNode) continue;

      if (targetNode.type === 'condition' && sourceNode.type !== 'condition') {
        // ── while pattern ──
        // Back-edge: last body node → first condition node
        const firstCondId = edge.target;
        const backEdgeSourceId = edge.source;

        // Exit: first condition's false path. Resolved up front (not just
        // after the chain below) so the chain-collection loop can tell a
        // genuine AND'd while-condition apart from a nested if/else that
        // merely happens to sit right after the while-header in the graph.
        const falseEdge = flow.edges.find(
          (e) =>
            e.source === firstCondId && e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
        );
        const chainExitTarget = falseEdge?.target ?? null;

        // Collect condition chain: follow true edges from condition to
        // condition. Only fold the next condition into the while-header
        // AND-chain if it isn't a branch point of its own: either it has no
        // false edge (the shape YamlParser always produces for a genuine
        // multi-condition `while: [cond1, cond2, ...]`), or its false edge
        // converges back to the same overall loop-exit as the chain's head
        // condition (a hand-wired equivalent). Otherwise this is a nested
        // if/else living in the loop BODY, not another AND'd while-condition
        // — folding it in here would silently merge its condition into
        // `while:` and orphan its own false-branch actions entirely (found
        // via empirical audit, 2026-09-06: a while-loop whose first body
        // statement was an if/else lost the if's else-branch and had its
        // condition wrongly AND'd onto the loop's own while-condition).
        const conditionNodeIds: string[] = [];
        let currentId = firstCondId;
        while (currentId) {
          const node = this.getNode(flow, currentId);
          if (node?.type !== 'condition') break;
          conditionNodeIds.push(currentId);
          const trueEdge = flow.edges.find(
            (e) =>
              e.source === currentId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
          );
          if (!trueEdge) break;
          const nextNode = this.getNode(flow, trueEdge.target);
          if (nextNode?.type !== 'condition' || conditionNodeIds.indexOf(trueEdge.target) !== -1) {
            break;
          }
          const nextFalseEdges = flow.edges.filter(
            (e) =>
              e.source === nextNode.id && e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
          );
          const canFold =
            (nextFalseEdges.length === 0 ||
              (chainExitTarget !== null &&
                nextFalseEdges.length === 1 &&
                nextFalseEdges[0].target === chainExitTarget)) &&
            // Second, more decisive guard added 2026-09-06 (Bug #13, Phase B
            // item 3 -- see the identical guard's own doc comment in the
            // until-pattern branch below for the full explanation): a node
            // reached via this chain's own "keep chaining" true edge that
            // carries a `_blockKey` is unambiguously the HEAD of some OTHER
            // construct (another if, choose, or repeat), never a genuine
            // AND'd continuation of THIS while-header -- only a construct's
            // very first/`i === 0` condition ever gets one, and a real
            // chain member never does.
            !(nextNode.data as Record<string, unknown> | undefined)?._blockKey;
          if (!canFold) break;
          currentId = trueEdge.target;
        }

        // Body nodes: everything between last condition's true target and back-edge source
        const lastCondId = conditionNodeIds[conditionNodeIds.length - 1];
        const bodyNodeIds = this.collectBodyNodes(
          flow,
          lastCondId,
          'true',
          new Set(conditionNodeIds),
          backEdgeSourceId
        );
        const bodyEntryNodeIds = flow.edges
          .filter(
            (e) =>
              e.source === lastCondId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
          )
          .map((e) => e.target);

        patterns.set(firstCondId, {
          type: 'while',
          entryNodeId: firstCondId,
          conditionNodeIds,
          bodyNodeIds,
          bodyEntryNodeIds,
          backEdgeSourceId,
          exitNodeId: falseEdge?.target ?? null,
        });
      } else if (sourceNode.type === 'condition' && edge.sourceHandle === 'false') {
        // ── until pattern ──
        // Back-edge: condition →(false)→ first body node
        const firstBodyId = edge.target;
        const firstCondId = edge.source;

        // Collect condition chain the same way as the while-pattern above,
        // with the same false-edge guard PLUS a second, more decisive
        // guard added 2026-09-06 (Bug #13, Phase B item 3): a genuine
        // AND'd chain member is NEVER the head of some other construct.
        // YamlParser.ts stamps a `_blockKey` (`repeat_until`, `repeat_while`,
        // `if_else`, `choose`) on the very FIRST condition of every
        // AND-exploded condition list it creates -- an until-chain's own
        // 2nd+ conditions, an if's 2nd+ AND'd conditions, etc. never get
        // one (only that construct's own head/i===0 condition does). This
        // is a graph-identity signal, not a structural inference: a node
        // reached via this chain's own "keep chaining" true edge that
        // CARRIES a `_blockKey` is, unambiguously, the head of some OTHER
        // construct entirely -- most commonly an ordinary else-less `if:`
        // block that happens to be the very next statement after the
        // until-loop, previously silently absorbed into this until's own
        // condition list because an else-less if has no false edge of its
        // own either, making it graph-indistinguishable from a genuine
        // AND'd until-condition under the false-edge check alone (found
        // via the randomized fuzzer's coverage-gap audit, e.g. Fuzz-21/51:
        // a `repeat.until` immediately followed by an else-less `if`,
        // whose then-branch action was getting folded into the loop body
        // as if it ran unconditionally on every iteration, while the until
        // itself wrongly required the if's own condition to ALSO be true
        // before the loop could ever exit).
        const conditionNodeIds: string[] = [];
        let condId: string | null = firstCondId;
        while (condId) {
          const node = this.getNode(flow, condId);
          if (node?.type !== 'condition') break;
          conditionNodeIds.push(condId);
          const trueEdge = flow.edges.find(
            (e) => e.source === condId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
          );
          if (!trueEdge) break;
          const nextNode = this.getNode(flow, trueEdge.target);
          if (nextNode?.type !== 'condition' || conditionNodeIds.indexOf(trueEdge.target) !== -1) {
            break;
          }
          const nextFalseEdges = flow.edges.filter(
            (e) =>
              e.source === nextNode.id && e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
          );
          if (nextFalseEdges.length !== 0) break;
          const nextBlockKey = (nextNode.data as Record<string, unknown> | undefined)?._blockKey;
          if (nextBlockKey) break;
          condId = trueEdge.target;
        }

        // Body entry: firstBodyId is the back-edge's literal target, which
        // YamlParser.ts currently derives as `bodyResult.nodes[0]` -- the
        // first node CREATED while parsing the body. That's only the same
        // node as the body's true entry when the body's first statement is
        // a single action; when it's itself a `parallel:` block, firstBodyId
        // is just ONE arbitrary sibling with no edge of its own to the
        // others, and this pattern's body reconstruction is known-incomplete
        // for that shape (tracked the same way as Bug #13 -- see this file's
        // detectRepeatPatterns doc/the fuzzer's isKnownParallelConvergenceGap
        // comment). Unlike 'count' (which got a dedicated init
        // `set_variables` node to redirect the back-edge to instead, fixed
        // 2026-09-06 in YamlParser.ts), 'until' has no such anchor -- the
        // body is parsed directly from whatever preceded the repeat action,
        // so there is no extra node to point at, and expanding firstBodyId
        // into its full sibling set here (attempted and reverted the same
        // day) corrupts a DIFFERENT, unrelated class of automation: this
        // exact detectRepeatPatterns is also reused as state-machine.ts's
        // nativeSubBuilder for rendering a plain `repeat:` block embedded
        // inside one of ITS OWN generated states, entirely outside
        // topology.ts's isTree gate -- there, the loop's siblings are ALSO
        // independently reachable as ordinary branches of whatever
        // outer fan-out precedes the loop, so expanding bodyEntryNodeIds
        // here made them render TWICE (once inside the loop body, once as
        // sibling top-level actions), turning several previously-successful
        // state-machine transpiles into hard, unrecoverable failures (found
        // via the randomized fuzzer, 2026-09-06, e.g. Fuzz-83: three
        // ordinary top-level `repeat.until` blocks, no `repeat.count`
        // anywhere, newly broken by that attempt). Left as the pre-existing
        // single-node behavior; a real fix needs either a parser-side
        // anchor node (as 'count' now has) or teaching the caller which
        // siblings a loop already claims before it walks them itself.
        const bodyEntryNodeIds = [firstBodyId];

        // Body nodes: traverse forward from firstBodyId until we hit the condition
        const bodyNodeIds = this.collectNodesUntil(flow, firstBodyId, new Set(conditionNodeIds));

        // Exit: last condition's true path
        const lastCondId = conditionNodeIds[conditionNodeIds.length - 1];
        const trueEdge = flow.edges.find(
          (e) => e.source === lastCondId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
        );

        patterns.set(firstBodyId, {
          type: 'until',
          entryNodeId: firstBodyId,
          conditionNodeIds,
          bodyNodeIds,
          bodyEntryNodeIds,
          backEdgeSourceId: firstCondId,
          exitNodeId: trueEdge?.target ?? null,
        });
      } else if (sourceNode.type === 'condition' && edge.sourceHandle === 'true') {
        // ── count pattern ──
        // Back-edge: condition →(true)→ the loop's init `set_variables` node
        // (fixed 2026-09-06 -- see YamlParser.ts's repeat.count wiring
        // comment; it used to target `bodyResult.nodes[0]`, the first node
        // CREATED while parsing the body, which is only the same node as
        // the init node's actual entry when the body's first step is a
        // single action. When the body's first step is itself a
        // `parallel:` block, that was just ONE arbitrary sibling with no
        // edge back to the others -- looping onto it re-ran only that one
        // sibling every iteration after the first, silently dropping the
        // rest). backEdgeTargetId now names what the edge always points
        // to; whether that's a genuine init node with body children of its
        // own, or (an empty-body loop) directly the increment node, is
        // resolved below via hasBody.
        const backEdgeTargetId = edge.target;
        const condId = edge.source;

        const conditionNodeIds = [condId];

        // Find the increment node: it's a set_variables predecessor of the condition
        const condPredEdges = flow.edges.filter(
          (e) => e.target === condId && !this.backEdgeIds.has(e.id)
        );
        const incrementNodeId = condPredEdges.length > 0 ? condPredEdges[0].source : undefined;

        // An empty-body `repeat.count` has the back-edge target itself
        // equal to the increment node (see YamlParser.ts: `loopTargetId =
        // bodyResult.nodes.length > 0 ? counterId : incrId`) -- there is no
        // separate init node's worth of body children to seed a walk from
        // in that case.
        const hasBody = incrementNodeId === undefined || backEdgeTargetId !== incrementNodeId;

        const stopSet = new Set<string>([condId]);
        if (incrementNodeId) stopSet.add(incrementNodeId);

        // Body nodes: seed the walk from the init node's OWN forward
        // children (reaching EVERY branch when the body's first step is a
        // `parallel:` block, not just one sibling of it -- the identical
        // fix collectBodyNodes already applies for the while-pattern
        // above), never from the init node itself, so its one-time
        // `variables: {counter: 0}` step is never mistaken for loop-body
        // content and re-emitted inside `repeat.sequence` on every
        // iteration.
        const bodySeedIds = hasBody
          ? flow.edges
              .filter((e) => e.source === backEdgeTargetId && !this.backEdgeIds.has(e.id))
              .map((e) => e.target)
          : [backEdgeTargetId];
        const bodyNodeIds = this.collectNodesUntil(flow, bodySeedIds, stopSet);

        // Init node: when the loop has a body, the back-edge target IS the
        // init node directly; for an empty-body loop, recover it the old
        // way (the increment node's own set_variables predecessor).
        const initNodeId = hasBody
          ? backEdgeTargetId
          : flow.edges
              .filter((e) => e.target === backEdgeTargetId && !this.backEdgeIds.has(e.id))
              .map((e) => e.source)
              .find((id) => this.getNode(flow, id)?.type === 'set_variables');

        // Extract count from the condition's value_template
        const condNode = this.getNode(flow, condId);
        let countValue: number | string | undefined;
        if (condNode?.type === 'condition' && condNode.data.condition === 'template') {
          const tmpl = condNode.data.value_template;
          if (typeof tmpl === 'string') {
            // Extract N from "{{ _repeat_counter_xxx < N }}"
            const match = tmpl.match(/<\s*(\d+)\s*\}\}/);
            if (match) {
              countValue = Number.parseInt(match[1], 10);
            }
          }
        }

        // Exit: condition's false path
        const falseEdge = flow.edges.find(
          (e) => e.source === condId && e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
        );

        // Entry is the init node if it exists, otherwise the back-edge target
        const entryNodeId = initNodeId ?? backEdgeTargetId;

        patterns.set(entryNodeId, {
          type: 'count',
          entryNodeId,
          conditionNodeIds,
          bodyNodeIds,
          bodyEntryNodeIds: hasBody ? bodySeedIds : [],
          backEdgeSourceId: condId,
          initNodeId,
          incrementNodeId,
          count: countValue,
          exitNodeId: falseEdge?.target ?? null,
        });
      }
    }

    return patterns;
  }

  /**
   * Collect body node IDs starting from a condition's specified handle path
   * until reaching the backEdgeSource (inclusive)
   */
  private collectBodyNodes(
    flow: FlowGraph,
    condNodeId: string,
    handle: 'true' | 'false',
    excludeIds: Set<string>,
    backEdgeSourceId: string
  ): string[] {
    // Seed the walk from EVERY matching-handle edge, not just the first —
    // condNodeId can have more than one, when the loop body's very first
    // statement is itself a `parallel:` block fanning out directly from
    // the loop's own condition node. A single `.find()` here used to seed
    // the walk with only one of those fan-out targets, so `bodyNodeIds`
    // silently never contained the other branch(es) at all -- not a
    // build-order bug like the ones fixed elsewhere in this file, but a
    // detection bug: the missing branch's nodes were never even collected
    // as part of the pattern to begin with. Found via empirical audit,
    // 2026-09-06 (a while-loop whose body opened with a `parallel:` block
    // silently dropped one of its two branches).
    const startEdges = flow.edges.filter(
      (e) => e.source === condNodeId && e.sourceHandle === handle && !this.backEdgeIds.has(e.id)
    );
    if (startEdges.length === 0) return [];

    const bodyIds: string[] = [];
    const queue = startEdges.map((e) => e.target);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id) || excludeIds.has(id)) continue;
      visited.add(id);
      bodyIds.push(id);

      if (id === backEdgeSourceId) continue; // Don't traverse beyond back-edge source

      const outgoing = flow.edges.filter((e) => e.source === id && !this.backEdgeIds.has(e.id));
      for (const e of outgoing) {
        if (!visited.has(e.target) && !excludeIds.has(e.target)) {
          queue.push(e.target);
        }
      }
    }

    return bodyIds;
  }

  /**
   * Collect node IDs by traversing forward until hitting any node in stopIds
   */
  private collectNodesUntil(
    flow: FlowGraph,
    startId: string | string[],
    stopIds: Set<string>
  ): string[] {
    const bodyIds: string[] = [];
    const queue = Array.isArray(startId) ? [...startId] : [startId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id) || stopIds.has(id)) continue;
      visited.add(id);
      bodyIds.push(id);

      const outgoing = flow.edges.filter((e) => e.source === id && !this.backEdgeIds.has(e.id));
      for (const e of outgoing) {
        if (!visited.has(e.target) && !stopIds.has(e.target)) {
          queue.push(e.target);
        }
      }
    }

    return bodyIds;
  }

  /**
   * Detect sequence_start/sequence_end marker pairs by structurally walking
   * forward from each sequence_start's body until the nearest sequence_end
   * is reached. Best-effort pairing, same limitation as repeat/choose
   * detection has for deeply nested structures: a sequence_start always
   * matches the *nearest* sequence_end reachable from it, so nested
   * Sequence-inside-Sequence groups aren't disambiguated beyond that.
   * An unpaired sequence_start (no reachable sequence_end) is left out of
   * the map entirely and falls back to being a transparent no-op node (see
   * buildNodeAction's 'sequence_start'/'sequence_end' cases).
   */
  private detectSequencePatterns(flow: FlowGraph): Map<string, SequencePattern> {
    const patterns = new Map<string, SequencePattern>();

    for (const node of flow.nodes) {
      if (node.type !== 'sequence_start') continue;

      // .filter(), not .find(): a sequence group's very first statement can
      // itself be a `parallel:` block, fanning out directly from
      // sequence_start into 2+ body entry points -- bug #10, found via
      // empirical audit 2026-09-06 (a nested `parallel:` inside a `sequence:`
      // group, itself inside an outer `parallel:` branch). Taking only the
      // first such edge silently dropped every other branch of the group's
      // own opening fan-out from ever being considered part of the body at
      // all -- not just under-built, structurally invisible to bodyNodeIds
      // and to the walk in buildSequenceBlock alike.
      const startEdges = flow.edges.filter(
        (e) => e.source === node.id && !this.backEdgeIds.has(e.id)
      );
      const bodyEntryNodeIds = startEdges.map((e) => e.target);
      if (bodyEntryNodeIds.length === 0) continue;

      let endNodeId: string | null = null;
      const queue = [...bodyEntryNodeIds];
      const seen = new Set<string>();
      while (queue.length > 0 && !endNodeId) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const candidate = this.getNode(flow, id);
        if (candidate?.type === 'sequence_end') {
          endNodeId = id;
          break;
        }
        const outgoing = flow.edges.filter((e) => e.source === id && !this.backEdgeIds.has(e.id));
        for (const e of outgoing) {
          if (!seen.has(e.target)) queue.push(e.target);
        }
      }
      if (!endNodeId) continue; // Unpaired start — leave as a transparent node

      const bodyNodeIds = this.collectNodesUntil(flow, bodyEntryNodeIds, new Set([endNodeId]));
      const exitEdge = flow.edges.find(
        (e) => e.source === endNodeId && !this.backEdgeIds.has(e.id)
      );

      patterns.set(node.id, {
        entryNodeId: node.id,
        endNodeId,
        bodyEntryNodeIds,
        bodyNodeIds,
        exitNodeId: exitEdge?.target ?? null,
        alias: 'alias' in node.data && typeof node.data.alias === 'string' ? node.data.alias : undefined,
      });
    }

    return patterns;
  }

  /**
   * Build a `{ sequence: [...], alias? }` YAML block from a detected
   * sequence pattern, walking the body with buildSequenceUntilNode so
   * anything nested inside (conditions, nested parallel, ...) is handled
   * exactly like every other bounded body-walk in this file.
   */
  private buildSequenceBlock(
    flow: FlowGraph,
    pattern: SequencePattern,
    visited: Set<string>
  ): Record<string, unknown> {
    const body =
      pattern.bodyEntryNodeIds.length > 0
        ? this.buildFanOutUntilNode(flow, pattern.bodyEntryNodeIds, pattern.endNodeId, visited)
        : [];
    return {
      ...(pattern.alias ? { alias: pattern.alias } : {}),
      sequence: body,
    };
  }

  /**
   * Bounded counterpart to buildFanOut: builds a `{ parallel: [...] }` step
   * from 2+ target node ids, same as buildFanOut, but stops each branch at
   * an explicit stopNodeId instead of auto-detecting a convergence point
   * and continuing past it. Needed for a sequence ("Grouping actions")
   * group whose own opening statement is a `parallel:` block (bug #10) --
   * unlike a repeat loop's body (which buildFanOut already handles via its
   * own back-edge-exclusion boundary), a sequence group's body has a real
   * forward stop point (its sequence_end marker), so the branches must not
   * be walked past it the way buildFanOut's unbounded continuation would.
   */
  private buildFanOutUntilNode(
    flow: FlowGraph,
    targetIds: string[],
    stopNodeId: string | Set<string>,
    visited: Set<string>
  ): unknown[] {
    if (targetIds.length === 0) return [];
    if (targetIds.length === 1) {
      return this.buildSequenceUntilNode(flow, targetIds[0], stopNodeId, new Set(visited));
    }

    const stopSet = stopNodeId instanceof Set ? stopNodeId : new Set([stopNodeId]);

    // Bound each branch at the NEAREST shared convergence node(s), not
    // directly at the group's own end (stopNodeId) -- otherwise a node the
    // branches converge on partway through (e.g. `parallel: [A, B]` then a
    // shared C, all inside one `sequence:` group) gets walked into BOTH
    // branches independently and duplicated, instead of appearing once
    // after the parallel block the way the source YAML actually specifies.
    // Found via empirical audit, 2026-09-06, as a follow-up to bug #10
    // itself: the first fix (bounding branches directly at stopNodeId)
    // correctly stopped the fan-out from being dropped, but silently
    // duplicated the branches' shared tail instead.
    //
    // findConvergenceSet (not findConvergencePoint) -- bug #12, found via
    // the randomized fuzzer, 2026-09-06: when the branches share 2+
    // SIBLING downstream nodes (neither reachable from the other), there
    // is no single dominating convergence node to pick. When that happens
    // this function recurses into itself on the sibling set instead of
    // arbitrarily treating one of them as "the" continuation -- each
    // sibling becomes its own further fan-out/convergence step, correctly
    // handling arbitrary nesting depth.
    const convergenceSet = this.findConvergenceSet(flow, targetIds);
    const convergencePoints = convergenceSet.length > 0 ? convergenceSet : [...stopSet];
    const boundSet = new Set(convergencePoints);
    const parallelActions = targetIds.map((id) =>
      this.buildSequenceUntilNode(flow, id, boundSet, new Set(visited))
    );
    const filteredBranches = parallelActions.filter((a) => a.length > 0);

    const sequence: unknown[] = [];
    if (filteredBranches.length > 0) {
      // Flatten single-action branches to avoid double-nesting (- - service:),
      // same convention as buildFanOut/buildSequenceUntilNode's own nested
      // fan-out case.
      const flattenedBranches = filteredBranches.map((branch) =>
        branch.length === 1 ? branch[0] : branch
      );
      sequence.push({ parallel: flattenedBranches });
    }
    const stillPending = convergencePoints.filter((id) => !stopSet.has(id));
    if (stillPending.length > 0) {
      sequence.push(...this.buildFanOutUntilNode(flow, stillPending, stopNodeId, new Set(visited)));
    }
    return sequence;
  }

  /**
   * Build a repeat: YAML block from a detected repeat pattern
   */
  private buildRepeatBlock(
    flow: FlowGraph,
    pattern: RepeatPattern,
    visited: Set<string>
  ): Record<string, unknown> | null {
    // This pattern's entry is being expanded right now -- remove it from
    // the lookup map immediately so nothing re-detects it as a fresh
    // repeat-pattern entry point. This matters for 'until' patterns (and
    // 'count' patterns with no init node), where entryNodeId IS the body's
    // own first node (bodyNodeIds[0]): buildSequenceFromNode is called on
    // that same node id below to build the body, and its own top-of-function
    // repeatPatterns lookup would otherwise find this exact pattern again
    // and call back into buildRepeatBlock -- infinite recursion (caught
    // empirically, 2026-09-06, as a "Maximum call stack size exceeded" on
    // the simplest possible repeat.until roundtrip). Each entry node maps
    // to exactly one pattern for the lifetime of a single transpile pass,
    // so once its own build has started there is no legitimate later call
    // that still needs to find it in this map.
    this.repeatPatterns.delete(pattern.entryNodeId);

    // Mark the pattern's own header nodes (conditions/init/increment/entry)
    // as visited now -- but deliberately NOT the body nodes yet. The body
    // is built below via buildSequenceFromNode, the same general-purpose
    // recursive walker used everywhere else in this file for nested
    // conditions/loops/groups/convergence, and it bails out immediately
    // (returns []) for any node already in `visited` -- that's how it
    // avoids infinite loops elsewhere. Pre-marking every body node visited
    // here, before that walk ran, used to defeat it entirely: a repeat
    // body whose first statement was an if/else got an empty then/else
    // from what was then a bespoke, more limited body-builder (see git
    // history for the old buildBodySubsequence-based version), while the
    // branch's own actions still leaked out as flattened, unconditional
    // top-level steps from the old flat bodyNodeIds loop -- silently
    // corrupting the automation's behavior. Found via empirical audit,
    // 2026-09-06 (a while-loop whose body opened with an if/else).
    // entryNodeId is deliberately NOT marked visited here yet. For
    // 'while' patterns it's the header condition (already covered by the
    // conditionNodeIds loop above), but for 'until' patterns -- and for
    // 'count' patterns with no init node -- entryNodeId IS the body's own
    // first node (bodyNodeIds[0]). Marking it visited before the
    // buildSequenceFromNode call below would make that call bail out
    // immediately on its own target node, producing an empty body. It's
    // added afterward instead, alongside the rest of bodyNodeIds.
    for (const id of pattern.conditionNodeIds) visited.add(id);
    if (pattern.initNodeId) visited.add(pattern.initNodeId);
    if (pattern.incrementNodeId) visited.add(pattern.incrementNodeId);

    // Build the body sequence by walking from the body's actual entry
    // point(s) with buildFanOut -- the same fan-out-aware builder used for
    // every other bounded body in this file. The loop's own back-edge is
    // already excluded wherever this walker filters `outgoing` edges by
    // `!this.backEdgeIds.has(e.id)`, so it naturally stops once it reaches
    // the last body node (whose only remaining edge is the back-edge)
    // without needing an explicit bound.
    //
    // The body's true entry point(s) -- there can be more than one when
    // the loop body's very first statement is itself a `parallel:` block,
    // fanning out directly from whatever precedes the body rather than
    // from a single concrete action node. All three pattern types now
    // carry this pre-computed on bodyEntryNodeIds (see detectRepeatPatterns
    // above for how each derives it): 'while' from the header condition's
    // own true edge(s), 'until' by tracing firstBodyId back to a genuine
    // parallel fan-out predecessor when one exists, 'count' from the init
    // node's own forward children. Any fan-out further inside the body is
    // a normal descendant that buildFanOut/buildSequenceFromNode already
    // discover as they recurse forward. Using only bodyNodeIds[0] here
    // used to mean a loop body opening with `parallel:` silently built
    // only one of its branches and dropped the rest entirely -- found via
    // empirical audit, 2026-09-06.
    const bodyEntryIds: string[] = pattern.bodyEntryNodeIds;
    const bodySequence: unknown[] = this.buildFanOut(flow, bodyEntryIds, visited);

    // Defensive backstop: make sure every node this pattern claims as body
    // content (plus entryNodeId, see above) ends up marked visited, in
    // case the walk above didn't naturally reach one of them (shouldn't
    // normally happen -- bodyNodeIds is derived by traversing the same
    // graph -- but this keeps the outer traversal from ever re-emitting a
    // stray body node as a top-level step after the repeat block returns).
    for (const id of pattern.bodyNodeIds) visited.add(id);
    visited.add(pattern.entryNodeId);

    // Get alias from the first condition (while) or from the init node (count)
    let alias: string | undefined;

    if (pattern.type === 'while') {
      // Build while conditions
      const whileConditions = pattern.conditionNodeIds.map((id) => {
        const node = this.getNode(flow, id) as ConditionNode;
        if (!alias && node?.data?.alias) alias = node.data.alias;
        return this.buildCondition(node);
      });

      const result: Record<string, unknown> = {
        repeat: {
          while: whileConditions,
          sequence: bodySequence,
        },
      };
      if (alias) result.alias = alias;
      return result;
    }

    if (pattern.type === 'until') {
      const untilConditions = pattern.conditionNodeIds.map((id) => {
        const node = this.getNode(flow, id) as ConditionNode;
        return this.buildCondition(node);
      });

      const result: Record<string, unknown> = {
        repeat: {
          until: untilConditions,
          sequence: bodySequence,
        },
      };
      if (alias) result.alias = alias;
      return result;
    }

    if (pattern.type === 'count') {
      if (pattern.initNodeId) {
        const initNode = this.getNode(flow, pattern.initNodeId);
        if (initNode?.data && 'alias' in initNode.data) {
          alias = initNode.data.alias as string | undefined;
        }
      }

      const result: Record<string, unknown> = {
        repeat: {
          count: pattern.count,
          sequence: bodySequence,
        },
      };
      if (alias) result.alias = alias;
      return result;
    }

    return null;
  }

  /**
   * Extract trigger configurations from trigger nodes
   */
  private extractTriggers(flow: FlowGraph): unknown[] {
    return flow.nodes
      .filter((n): n is TriggerNode => n.type === 'trigger')
      .map((node) => this.buildTrigger(node));
  }

  /**
   * Detect if multiple first actions form an OR pattern
   * (all are conditions whose true OR false paths converge to the same node)
   */
  private detectOrPattern(
    flow: FlowGraph,
    firstActionIds: string[]
  ): { conditions: ConditionNode[]; convergenceNode: string; isFromFalsePaths: boolean } | null {
    // All first actions must be condition nodes
    const conditions = firstActionIds.map((id) => this.getNode(flow, id));
    if (!conditions.every((n): n is ConditionNode => n?.type === 'condition')) {
      return null;
    }

    // Collect true and false targets for each condition
    const trueTargets = new Set<string>();
    const falseTargets = new Set<string>();
    let conditionsWithTruePath = 0;
    let conditionsWithFalsePath = 0;

    for (const cond of conditions) {
      const trueEdge = flow.edges.find((e) => e.source === cond.id && e.sourceHandle === 'true');
      const falseEdge = flow.edges.find((e) => e.source === cond.id && e.sourceHandle === 'false');
      if (trueEdge) {
        trueTargets.add(trueEdge.target);
        conditionsWithTruePath++;
      }
      if (falseEdge) {
        falseTargets.add(falseEdge.target);
        conditionsWithFalsePath++;
      }
    }

    // OR via true paths: all conditions have the same true target
    // AND either no false paths exist OR all false paths also converge (no information loss)
    if (trueTargets.size === 1 && conditionsWithTruePath === firstActionIds.length) {
      // Reject if false paths diverge — that would silently drop else-branch actions
      if (conditionsWithFalsePath > 0 && falseTargets.size > 1) {
        return null;
      }
      const convergenceNode = [...trueTargets][0];
      return {
        conditions: conditions as ConditionNode[],
        convergenceNode,
        isFromFalsePaths: false,
      };
    }

    // OR via false paths: all conditions have the same false target
    // AND either no true paths exist OR all true paths also converge
    if (falseTargets.size === 1 && conditionsWithFalsePath === firstActionIds.length) {
      // Reject if true paths diverge — that would silently drop then-branch actions
      if (conditionsWithTruePath > 0 && trueTargets.size > 1) {
        return null;
      }
      const convergenceNode = [...falseTargets][0];
      return {
        conditions: conditions as ConditionNode[],
        convergenceNode,
        isFromFalsePaths: true,
      };
    }

    return null;
  }

  /**
   * Extract leading condition nodes that can be promoted to the root conditions block.
   * Only conditions with no false/else path are promotable, forming a straight chain
   * from triggers to actions via true paths only (or false paths only for inverted conditions).
   * Fan-out is allowed when only one handle type is used - the condition is promoted and
   * all fan-out targets become action starting points.
   */
  private extractLeadingConditions(
    flow: FlowGraph,
    startNodeId: string
  ): { conditions: unknown[]; nextNodeIds: string[]; visitedIds: Set<string> } {
    const conditions: unknown[] = [];
    const visitedIds = new Set<string>();
    let currentId: string | null = startNodeId;

    while (currentId) {
      const node = this.getNode(flow, currentId);
      if (!node || node.type !== 'condition') break;

      // Don't promote conditions that are part of a repeat pattern
      if (this.repeatPatterns.has(currentId) || this.repeatInternalNodeIds.has(currentId)) break;

      const allOutgoing = this.getOutgoingEdges(flow, currentId);
      const outgoing = allOutgoing.filter((e) => !this.backEdgeIds.has(e.id));
      const truePaths = outgoing.filter((edge) => edge.sourceHandle === 'true');
      const falsePaths = outgoing.filter((edge) => edge.sourceHandle === 'false');

      // Can only promote if the condition uses only ONE handle type (no branching to different outcomes)
      // If both handles are used, it's a full if/then/else and cannot be promoted
      if (truePaths.length > 0 && falsePaths.length > 0) break;
      // Must have at least one path
      if (truePaths.length === 0 && falsePaths.length === 0) break;

      // Build the condition object with alias preserved
      const condition = this.buildCondition(node as ConditionNode);
      if ((node as ConditionNode).data.alias) {
        condition.alias = (node as ConditionNode).data.alias;
      }

      if (falsePaths.length > 0) {
        // Connected via false handle only → inverted condition, wrap in "not"
        conditions.push({
          condition: 'not',
          conditions: [condition],
        });
        visitedIds.add(currentId);

        // If there's fan-out (multiple false paths), stop extraction and return all targets
        if (falsePaths.length > 1) {
          return { conditions, nextNodeIds: falsePaths.map((e) => e.target), visitedIds };
        }
        currentId = falsePaths[0].target;
      } else {
        // Connected via true handle only → promote as-is
        conditions.push(condition);
        visitedIds.add(currentId);

        // If there's fan-out (multiple true paths), stop extraction and return all targets
        if (truePaths.length > 1) {
          return { conditions, nextNodeIds: truePaths.map((e) => e.target), visitedIds };
        }
        currentId = truePaths[0].target;
      }
    }

    return { conditions, nextNodeIds: currentId ? [currentId] : [], visitedIds };
  }

  /**
   * Build a single trigger configuration
   */
  private buildTrigger(node: TriggerNode): Record<string, unknown> {
    // Trigger nodes aren't currently tagged with any internal Circuitry field by
    // block-factories.ts, but stripping here too costs nothing and closes
    // the gap automatically if that ever changes (see stripInternalFields's
    // doc comment in base.ts).
    const trigger: Record<string, unknown> = this.stripInternalFields(node.data);

    // Clean up undefined/empty values (but keep explicit from/to: null — see cleanTriggerFields)
    return this.cleanTriggerFields(this.foldEventContextUserId(trigger));
  }

  /**
   * Find condition nodes whose specified handle (true/false) points to a given target node
   * Returns the condition sources if there are multiple (OR pattern), empty array otherwise
   */
  private findOrConditionSources(
    flow: FlowGraph,
    targetNodeId: string,
    handleType: 'true' | 'false',
    visited: Set<string>
  ): ConditionNode[] {
    const sources = flow.edges
      .filter(
        (e) =>
          e.target === targetNodeId && e.sourceHandle === handleType && !this.backEdgeIds.has(e.id)
      )
      .map((e) => this.getNode(flow, e.source))
      .filter((n): n is ConditionNode => n?.type === 'condition' && !visited.has(n.id));

    if (sources.length <= 1) return [];

    // Only treat as OR if the opposite handle (else/then) of each source
    // either has no edge, or all opposite edges converge to the same target.
    // This prevents silent data loss when conditions have diverging else/then branches.
    const oppositeHandle = handleType === 'true' ? 'false' : 'true';
    const oppositeTargets = new Set<string>();
    let sourcesWithOpposite = 0;
    for (const src of sources) {
      const edge = flow.edges.find(
        (e) =>
          e.source === src.id && e.sourceHandle === oppositeHandle && !this.backEdgeIds.has(e.id)
      );
      if (edge) {
        oppositeTargets.add(edge.target);
        sourcesWithOpposite++;
      }
    }
    // If opposite paths diverge → not a clean OR pattern, skip detection
    if (sourcesWithOpposite > 0 && oppositeTargets.size > 1) {
      return [];
    }

    return sources;
  }

  /**
   * Recursively build action sequence from a node
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive graph traversal is inherently complex
  private buildSequenceFromNode(flow: FlowGraph, nodeId: string, visited: Set<string>): unknown[] {
    if (visited.has(nodeId)) {
      return []; // Avoid infinite loops
    }

    const node = this.getNode(flow, nodeId);
    if (!node) {
      return [];
    }

    const sequence: unknown[] = [];

    // Check if this node is an OR convergence point (multiple conditions' true/false paths converge here)
    const orTrueSources = this.findOrConditionSources(flow, nodeId, 'true', visited);
    const orFalseSources = this.findOrConditionSources(flow, nodeId, 'false', visited);

    if (orTrueSources.length > 1) {
      // Multiple conditions' TRUE paths converge here - build OR block
      const orConditions = orTrueSources.map((c) => this.buildCondition(c));
      // Mark these conditions as visited
      for (const c of orTrueSources) {
        visited.add(c.id);
      }

      // Now add the current node to visited and build the then sequence.
      //
      // The condition branch below used to recurse with a brand-new EMPTY
      // Set() ("process this condition node fresh") instead of `visited`,
      // specifically so nodeId itself wouldn't be seen as already-visited
      // (which would make the top-of-function bail-out skip building its
      // own if/then/else entirely). But an empty set ALSO threw away the
      // fact that `orTrueSources` were just marked visited -- and since
      // findOrConditionSources is a pure structural lookup over `flow`
      // filtered only by `visited`, a fresh empty set makes it rediscover
      // the EXACT SAME orTrueSources.length > 1 convergence on THIS SAME
      // nodeId every time, which re-enters this exact branch again, ad
      // infinitum -- a genuine, deterministic infinite recursion (stack
      // overflow), not just a missed edge case. Found via a randomized
      // stress-test fuzzer, 2026-09-06 (Phase B item 3, round 3): a
      // condition node that is itself the target of 2+ sibling
      // conditions' converging true-edges triggers it unconditionally,
      // every time, regardless of graph size. topology.ts's isTree
      // classifier happens to reject shapes like this today (so the real
      // transpile()/forceStrategy pipeline can't reach it via canHandle()
      // gating), but that's incidental protection for a crash-class bug,
      // not a guarantee -- a future classifier generalization could
      // silently reopen it. Fixed by cloning `visited` (so the
      // now-marked orTrueSources ids stay excluded, preventing
      // re-detection) and removing only `nodeId` itself from that clone
      // (so nodeId's own branch-processing still runs instead of hitting
      // the top-of-function already-visited bail-out).
      visited.add(nodeId);
      const nodeSelfVisited = new Set(visited);
      nodeSelfVisited.delete(nodeId);
      const thenSequence =
        node.type === 'condition'
          ? this.buildSequenceFromNode(flow, nodeId, nodeSelfVisited)
          : this.buildSequenceFromNode(flow, nodeId, new Set(visited));

      // For OR conditions, prepend the current node's action to the then sequence if it's not a condition
      let finalThenSequence: unknown[];
      if (node.type !== 'condition') {
        const currentAction = this.buildNodeAction(node);
        finalThenSequence = currentAction ? [currentAction, ...thenSequence] : thenSequence;
      } else {
        finalThenSequence = thenSequence;
      }

      sequence.push({
        if: [{ condition: 'or', conditions: orConditions }],
        then: finalThenSequence,
        else: [], // OR conditions don't have a shared else path
      });
      return sequence;
    }

    if (orFalseSources.length > 1) {
      // Multiple conditions' FALSE paths converge here - build OR block (negated logic)
      // When false paths converge, it means "if NOT cond1 AND NOT cond2" which is equivalent to "if NOT (cond1 OR cond2)"
      const orConditions = orFalseSources.map((c) => this.buildCondition(c));
      // Mark these conditions as visited
      for (const c of orFalseSources) {
        visited.add(c.id);
      }

      // Now add the current node to visited and build the then sequence.
      // Same infinite-recursion fix as the orTrueSources branch above --
      // see its doc comment for the full explanation. A fresh empty Set()
      // here would let this exact orFalseSources.length > 1 convergence
      // on THIS SAME nodeId rediscover itself forever.
      visited.add(nodeId);
      const nodeSelfVisitedFalse = new Set(visited);
      nodeSelfVisitedFalse.delete(nodeId);
      const thenSequence =
        node.type === 'condition'
          ? this.buildSequenceFromNode(flow, nodeId, nodeSelfVisitedFalse)
          : this.buildSequenceFromNode(flow, nodeId, new Set(visited));

      // For OR conditions, prepend the current node's action to the then sequence if it's not a condition
      let finalThenSequence: unknown[];
      if (node.type !== 'condition') {
        const currentAction = this.buildNodeAction(node);
        finalThenSequence = currentAction ? [currentAction, ...thenSequence] : thenSequence;
      } else {
        finalThenSequence = thenSequence;
      }

      // Since false paths converge, we negate by swapping then/else
      // "if any condition is false, do this" = "if NOT(all conditions true), do this"
      sequence.push({
        if: [{ condition: 'or', conditions: orConditions }],
        then: [], // When OR is true, we don't execute (this is the "else" in normal terms)
        else: finalThenSequence, // When OR is false (all conditions false), execute
      });
      return sequence;
    }

    // Check if this node is the entry point of a repeat pattern
    const repeatPattern = this.repeatPatterns.get(nodeId);
    if (repeatPattern) {
      const repeatBlock = this.buildRepeatBlock(flow, repeatPattern, visited);
      if (repeatBlock) {
        sequence.push(repeatBlock);
        // Continue from the exit node
        if (repeatPattern.exitNodeId) {
          const afterRepeat = this.buildSequenceFromNode(
            flow,
            repeatPattern.exitNodeId,
            new Set(visited)
          );
          sequence.push(...afterRepeat);
        }
        return sequence;
      }
    }

    // Check if this node is the entry point of a sequence (Grouping actions) pattern
    const sequencePattern = this.sequencePatterns.get(nodeId);
    if (sequencePattern) {
      visited.add(nodeId);
      sequence.push(this.buildSequenceBlock(flow, sequencePattern, visited));
      visited.add(sequencePattern.endNodeId);
      if (sequencePattern.exitNodeId) {
        const afterSequence = this.buildSequenceFromNode(
          flow,
          sequencePattern.exitNodeId,
          new Set(visited)
        );
        sequence.push(...afterSequence);
      }
      return sequence;
    }

    // Normal processing - add to visited now
    visited.add(nodeId);

    // Get outgoing edges (excluding repeat back-edges)
    const outgoing = this.getOutgoingEdges(flow, nodeId).filter((e) => !this.backEdgeIds.has(e.id));

    if (node.type === 'condition') {
      // Detect choose chain: condition's FALSE path leads to another unvisited condition node
      const falsePathEdges = this.getOutgoingEdges(flow, node.id).filter(
        (e) => e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
      );
      const firstFalseTarget =
        falsePathEdges.length === 1 ? this.getNode(flow, falsePathEdges[0].target) : null;

      // Bug fix, verified 2026-09-06 via the new behavioral-equivalence gate
      // (Phase B task #10) against 03-multiple-conditions.yaml: a
      // mutually-exclusive elif/choose chain requires that the false-path's
      // condition node is reachable ONLY when this node's own condition is
      // false. If that same node is ALSO reachable by walking forward from
      // this node's TRUE path, the false-path condition isn't an
      // alternative case at all -- it's an independent, sequential
      // condition that runs regardless of this one's outcome (e.g. two
      // separate single-case `choose:` blocks back to back in the source
      // YAML). Treating that as a choose chain made findConvergencePoint
      // pick the second condition's own gated action as the "shared
      // post-branch code" and hoist it out unconditionally, silently
      // dropping the second condition entirely. Falling through to the
      // plain Condition Chain Logic below instead handles this correctly:
      // it renders the second condition as its own separate if/then/else
      // once buildSequenceFromNode reaches it via the convergence
      // continuation, rather than as a choose case.
      const truePathEdges = this.getOutgoingEdges(flow, node.id).filter(
        (e) => e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
      );
      const falseTargetReachableViaTruePath =
        firstFalseTarget !== null &&
        truePathEdges.some(
          (e) => this.getShortestDistance(flow, e.target, firstFalseTarget!.id) !== Number.POSITIVE_INFINITY
        );

      const isChooseChain =
        firstFalseTarget?.type === 'condition' &&
        !visited.has(firstFalseTarget.id) &&
        !this.repeatPatterns.has(firstFalseTarget.id) &&
        !this.repeatInternalNodeIds.has(firstFalseTarget.id) &&
        !this.sequencePatterns.has(firstFalseTarget.id) &&
        !falseTargetReachableViaTruePath;

      if (isChooseChain) {
        // ===== Choose Block Logic =====
        // Build choose: [{conditions, sequence}, ...] from condition chain via FALSE paths
        type BranchInfo = { conditions: unknown[]; thenNodeIds: string[] };
        const branchInfos: BranchInfo[] = [];
        let currentChoiceNode: FlowNode | null = node;
        let defaultStartId: string | null = null;

        while (currentChoiceNode?.type === 'condition') {
          visited.add(currentChoiceNode.id);
          const choiceFirstNodeId = currentChoiceNode.id;

          // Collect AND-chain within this choice (conditions on TRUE path with no own false path)
          const branchConditions: unknown[] = [];
          let innerNode: FlowNode = currentChoiceNode;
          let thenNodeIds: string[] = [];

          while (innerNode?.type === 'condition') {
            branchConditions.push(this.buildCondition(innerNode as ConditionNode));

            const truePaths = this.getOutgoingEdges(flow, innerNode.id).filter(
              (e) => e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
            );

            if (truePaths.length === 0) break;
            if (truePaths.length > 1) {
              thenNodeIds = truePaths.map((e) => e.target);
              break;
            }

            const trueTarget = this.getNode(flow, truePaths[0].target);

            if (
              trueTarget?.type === 'condition' &&
              !visited.has(trueTarget.id) &&
              !this.repeatPatterns.has(trueTarget.id) &&
              !this.repeatInternalNodeIds.has(trueTarget.id)
            ) {
              const innerFalse = this.getOutgoingEdges(flow, trueTarget.id).filter(
                (e) => e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
              );
              if (innerFalse.length === 0) {
                // No false path — AND-condition within this choice
                visited.add(trueTarget.id);
                innerNode = trueTarget;
              } else {
                thenNodeIds = [truePaths[0].target];
                break;
              }
            } else {
              thenNodeIds = [truePaths[0].target];
              break;
            }
          }

          branchInfos.push({ conditions: branchConditions, thenNodeIds });

          const choiceFalse = this.getOutgoingEdges(flow, choiceFirstNodeId).filter(
            (e) => e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
          );

          if (choiceFalse.length === 0) {
            currentChoiceNode = null;
            break;
          }

          const nextFalseNode = this.getNode(flow, choiceFalse[0].target);

          if (nextFalseNode?.type === 'condition' && !visited.has(nextFalseNode.id)) {
            currentChoiceNode = nextFalseNode;
          } else {
            defaultStartId = choiceFalse[0].target;
            currentChoiceNode = null;
          }
        }

        // Find convergence point(s) across all branches + optional default.
        // findConvergenceSet (not findConvergencePoint) -- bug #12, found via
        // the randomized fuzzer, 2026-09-06: confirmed via empirical audit to
        // occur here too, not just in the "outer" buildFanOut/buildFanOutUntilNode
        // call sites fixed first -- when 2+ choose-cases (+ optional default)
        // share 2+ SIBLING downstream nodes (e.g. they all continue into the
        // SAME two-branch `parallel:` block), there is no single dominating
        // convergence node, and findConvergencePoint's old single-node contract
        // silently corrupted this shape exactly the same way it did for a plain
        // fan-out (see findConvergenceSet's own doc comment).
        const allBranchStarts = [
          ...branchInfos.flatMap((b) => b.thenNodeIds),
          ...(defaultStartId ? [defaultStartId] : []),
        ];
        const convergenceSet =
          allBranchStarts.length >= 2 ? this.findConvergenceSet(flow, allBranchStarts) : [];
        const convergenceBoundSet = convergenceSet.length > 0 ? new Set(convergenceSet) : null;

        // Build choose options
        const chooseOptions: Record<string, unknown>[] = [];
        for (const branch of branchInfos) {
          // buildFanOut(UntilNode), not a plain .flatMap -- found via empirical audit, 2026-09-06, as bug #12: a genuine multi-target then/else fan-out (an ordinary `parallel:` block as an if/then's or a choose case's own content) was being flattened via .flatMap into a plain sequential list instead of wrapped in `{ parallel: [...] }` -- silently turning concurrent branches into sequential ones, a real behavior change for any branch containing a delay/wait (same class of bug as #4/#9/#11, just on the DEFAULT/native if-then-else and choose-case builders instead of a loop/sequence-group body or StateMachineStrategy).
          const branchSeq =
            branch.thenNodeIds.length > 0
              ? convergenceBoundSet
                ? this.buildFanOutUntilNode(flow, branch.thenNodeIds, convergenceBoundSet, new Set(visited))
                : this.buildFanOut(flow, branch.thenNodeIds, new Set(visited))
              : [];
          chooseOptions.push({ conditions: branch.conditions, sequence: branchSeq });
        }

        const chooseAction: Record<string, unknown> = { choose: chooseOptions };

        if (defaultStartId) {
          const defSeq = convergenceBoundSet
            ? this.buildSequenceUntilNode(flow, defaultStartId, convergenceBoundSet, new Set(visited))
            : this.buildSequenceFromNode(flow, defaultStartId, new Set(visited));
          if (defSeq.length > 0) {
            chooseAction.default = defSeq;
          }
        }

        sequence.push(chooseAction);

        if (convergenceSet.length === 1) {
          sequence.push(...this.buildSequenceFromNode(flow, convergenceSet[0], new Set(visited)));
        } else if (convergenceSet.length > 1) {
          sequence.push(...this.buildFanOut(flow, convergenceSet, new Set(visited)));
        }
      } else {
        // ===== Condition Chain Logic (AND-chain → if/then/else) =====

        const conditions: unknown[] = [];
        let currentNode: FlowNode = node;
        let thenNodeIds: string[] = [];
        let elseNodeIds: string[] = [];

        const originalElsePaths = this.getOutgoingEdges(flow, node.id).filter(
          (edge) => edge.sourceHandle === 'false' && !this.backEdgeIds.has(edge.id)
        );
        elseNodeIds = originalElsePaths.map((edge) => edge.target);

        while (currentNode?.type === 'condition') {
          conditions.push(this.buildCondition(currentNode as ConditionNode));

          const truePaths = this.getOutgoingEdges(flow, currentNode.id).filter(
            (edge) => edge.sourceHandle === 'true' && !this.backEdgeIds.has(edge.id)
          );

          if (truePaths.length === 0) {
            break;
          }

          if (truePaths.length > 1) {
            thenNodeIds = truePaths.map((edge) => edge.target);
            break;
          }

          const truePath = truePaths[0];
          const nextNode = this.getNode(flow, truePath.target);

          if (
            nextNode?.type === 'condition' &&
            !visited.has(nextNode.id) &&
            !this.repeatPatterns.has(nextNode.id) &&
            !this.repeatInternalNodeIds.has(nextNode.id)
          ) {
            const nextFalsePaths = this.getOutgoingEdges(flow, nextNode.id).filter(
              (edge) => edge.sourceHandle === 'false' && !this.backEdgeIds.has(edge.id)
            );

            const canChain =
              nextFalsePaths.length === 0 ||
              (nextFalsePaths.length === 1 && elseNodeIds.includes(nextFalsePaths[0].target));

            if (canChain) {
              currentNode = nextNode;
              visited.add(currentNode.id);
            } else {
              thenNodeIds = [truePath.target];
              break;
            }
          } else {
            thenNodeIds = [truePath.target];
            break;
          }
        }

        const ifAction: Record<string, unknown> = {
          alias: node.data.alias,
          if: conditions,
          then: [],
          else: [],
        };

        const allBranchStarts = [...thenNodeIds, ...elseNodeIds];
        // findConvergenceSet (not findConvergencePoint) -- bug #12, found via
        // the randomized fuzzer, 2026-09-06: confirmed via empirical audit to
        // occur here too (an if/then and if/else branch that both continue
        // into the SAME two-branch `parallel:` block have no single dominating
        // convergence node -- see findConvergenceSet's own doc comment).
        const convergenceSet =
          thenNodeIds.length > 0 && elseNodeIds.length > 0
            ? this.findConvergenceSet(flow, allBranchStarts)
            : [];
        const convergenceBoundSet = convergenceSet.length > 0 ? new Set(convergenceSet) : null;

        // buildFanOut(UntilNode), not a plain .flatMap, for both then/else --
        // found via empirical audit, 2026-09-06, as bug #12: a genuine multi-target then/else fan-out (an ordinary `parallel:` block as an if/then's or a choose case's own content) was being flattened via .flatMap into a plain sequential list instead of wrapped in `{ parallel: [...] }` -- silently turning concurrent branches into sequential ones, a real behavior change for any branch containing a delay/wait (same class of bug as #4/#9/#11, just on the DEFAULT/native if-then-else and choose-case builders instead of a loop/sequence-group body or StateMachineStrategy).
        if (convergenceBoundSet) {
          if (thenNodeIds.length > 0) {
            ifAction.then = this.buildFanOutUntilNode(flow, thenNodeIds, convergenceBoundSet, new Set(visited));
          }
          if (elseNodeIds.length > 0) {
            ifAction.else = this.buildFanOutUntilNode(flow, elseNodeIds, convergenceBoundSet, new Set(visited));
          }
          sequence.push(ifAction);
          if (convergenceSet.length === 1) {
            sequence.push(...this.buildSequenceFromNode(flow, convergenceSet[0], new Set(visited)));
          } else {
            sequence.push(...this.buildFanOut(flow, convergenceSet, new Set(visited)));
          }
        } else {
          if (thenNodeIds.length > 0) {
            ifAction.then = this.buildFanOut(flow, thenNodeIds, new Set(visited));
          }
          if (elseNodeIds.length > 0) {
            ifAction.else = this.buildFanOut(flow, elseNodeIds, new Set(visited));
          }
          sequence.push(ifAction);
        }
      }
    } else {
      // ===== Default Logic for Non-Condition Nodes =====
      const action = this.buildNodeAction(node);
      if (action) {
        sequence.push(action);
      }

      if (outgoing.length >= 1) {
        sequence.push(...this.buildFanOut(flow, outgoing.map((e) => e.target), visited));
      }
    }

    return sequence;
  }

  /**
   * Build a `{ parallel: [...] }` step (plus whatever follows once the
   * branches reconverge, if they do) from a set of fan-out target node
   * ids. A single target is just delegated straight to
   * buildSequenceFromNode -- no parallel wrapper -- so this is safe to use
   * as the general "continue from these N children" step for any node,
   * fanned-out or not.
   *
   * Shared by buildSequenceFromNode's own multi-outgoing-edge handling
   * above and by buildRepeatBlock's loop-body builder, so a `parallel:`
   * block that's the very first thing inside a repeat body (fanning out
   * directly from the loop's own condition node rather than from a
   * regular action node) is built exactly the same way as any other
   * fan-out in this file, instead of only ever following one branch and
   * silently dropping the rest (found via empirical audit, 2026-09-06).
   */
  private buildFanOut(flow: FlowGraph, targetIds: string[], visited: Set<string>): unknown[] {
    if (targetIds.length === 0) return [];
    if (targetIds.length === 1) {
      // Matches the copy-per-branch convention used everywhere else in
      // this file for a recursive continuation, so this single-target
      // shortcut behaves identically to the outgoing.length === 1 case it
      // replaced (a caller's own `visited` is never mutated by delegating
      // further down it; anything that needs those mutations reflected
      // back re-adds them explicitly afterward, e.g. buildRepeatBlock's
      // own backstop over pattern.bodyNodeIds/entryNodeId).
      return this.buildSequenceFromNode(flow, targetIds[0], new Set(visited));
    }

    const sequence: unknown[] = [];
    // findConvergenceSet (not findConvergencePoint) -- bug #12, found via
    // the randomized fuzzer, 2026-09-06: see buildFanOutUntilNode's doc
    // comment. When 2+ sibling convergence nodes are found, this function
    // recurses into itself on the sibling set rather than arbitrarily
    // picking one of them as "the" continuation.
    const convergenceSet = this.findConvergenceSet(flow, targetIds);

    if (convergenceSet.length > 0) {
      const boundSet = new Set(convergenceSet);
      const parallelActions = targetIds.map((id) =>
        this.buildSequenceUntilNode(flow, id, boundSet, new Set(visited))
      );
      const filteredBranches = parallelActions.filter((a) => a.length > 0);
      if (filteredBranches.length > 0) {
        // Flatten single-action branches to avoid double-nesting (- - service:)
        const flattenedBranches = filteredBranches.map((branch) =>
          branch.length === 1 ? branch[0] : branch
        );
        sequence.push({
          parallel: flattenedBranches,
        });
      }
      if (convergenceSet.length === 1) {
        sequence.push(...this.buildSequenceFromNode(flow, convergenceSet[0], new Set(visited)));
      } else {
        sequence.push(...this.buildFanOut(flow, convergenceSet, new Set(visited)));
      }
    } else {
      const parallelActions = targetIds.map((id) =>
        this.buildSequenceFromNode(flow, id, new Set(visited))
      );
      const filteredBranches = parallelActions.filter((a) => a.length > 0);
      if (filteredBranches.length > 0) {
        // Flatten single-action branches to avoid double-nesting (- - service:)
        const flattenedBranches = filteredBranches.map((branch) =>
          branch.length === 1 ? branch[0] : branch
        );
        sequence.push({
          parallel: flattenedBranches,
        });
      }
    }

    return sequence;
  }

  /**
   * Find the convergence point where multiple branches meet
   * Returns the node ID if all branches converge, null otherwise
   */
  private findConvergencePoint(flow: FlowGraph, branchStarts: string[]): string | null {
    if (branchStarts.length < 2) return null;

    // For each branch, find all reachable nodes. Back edges must be
    // excluded here exactly like every other forward traversal in this
    // file -- otherwise a branch that flows into a loop's own back edge
    // (e.g. an if/else's else-path looping back to an outer while-condition)
    // gets treated as being able to "reach" every node the loop body can
    // reach by walking all the way around it, which can make a completely
    // unrelated node (such as an inner loop's own while-condition) look
    // like a shared convergence point. Found via empirical audit, 2026-09-06:
    // an if/else whose then-branch was itself a while-loop had its loop
    // silently hoisted out of the `then:` block entirely because of this.
    const reachableSets = branchStarts.map((startId) => {
      const reachable = new Set<string>();
      const queue = [startId];
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (reachable.has(nodeId)) continue;
        reachable.add(nodeId);
        const outgoing = this.getOutgoingEdges(flow, nodeId).filter(
          (e) => !this.backEdgeIds.has(e.id)
        );
        for (const edge of outgoing) {
          queue.push(edge.target);
        }
      }
      return reachable;
    });

    // Find nodes that are reachable from ALL branches
    const firstSet = reachableSets[0];
    const commonNodes = [...firstSet].filter((nodeId) =>
      reachableSets.every((set) => set.has(nodeId))
    );

    if (commonNodes.length === 0) return null;

    // Find the earliest common node (closest to the branch starts)
    // by checking which node has the minimum maximum distance from any branch start
    let bestNode: string | null = null;
    let bestMaxDistance = Number.POSITIVE_INFINITY;

    for (const nodeId of commonNodes) {
      const distances = branchStarts.map((startId) =>
        this.getShortestDistance(flow, startId, nodeId)
      );
      const maxDist = Math.max(...distances);
      if (maxDist < bestMaxDistance) {
        bestMaxDistance = maxDist;
        bestNode = nodeId;
      }
    }

    return bestNode;
  }

  /**
   * Get shortest distance from start to target node using BFS
   */
  private getShortestDistance(flow: FlowGraph, startId: string, targetId: string): number {
    if (startId === targetId) return 0;

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; distance: number }> = [{ nodeId: startId, distance: 0 }];

    while (queue.length > 0) {
      const { nodeId, distance } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      // Exclude back edges for the same reason as findConvergencePoint above --
      // this is only ever called to rank candidate convergence nodes that were
      // already found via a forward-only reachability search, so a back edge
      // here would just as easily under-count the true forward distance (or
      // find a bogus path at all) as it would in that search.
      const outgoing = this.getOutgoingEdges(flow, nodeId).filter(
        (e) => !this.backEdgeIds.has(e.id)
      );
      for (const edge of outgoing) {
        if (edge.target === targetId) {
          return distance + 1;
        }
        if (!visited.has(edge.target)) {
          queue.push({ nodeId: edge.target, distance: distance + 1 });
        }
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  /**
   * Generalizes findConvergencePoint to the case where 2+ branches share
   * 2+ SIBLING downstream nodes rather than a single dominating one (bug
   * #12, found via the randomized fuzzer, 2026-09-06): e.g. two `parallel:`
   * branches that each independently fan out to the SAME two further
   * downstream nodes, where neither of those two nodes is reachable from
   * the other. findConvergencePoint's single-node contract silently
   * corrupted this shape -- it picked one of the two arbitrarily (a tie
   * broken only by iteration order) and treated the other as if it did
   * not exist, which either dropped it or duplicated it depending on the
   * exact downstream code path (see buildSequenceUntilNode's
   * outgoing.length > 1 handling for the mechanism).
   *
   * Returns [] when there is no shared node at all (same meaning as
   * findConvergencePoint's null), a single-element array for the classic
   * dominating-node case (semantically identical to before), or a 2+
   * element array for a genuine sibling set. The array is ordered by
   * ascending max-distance-from-any-branch-start, same ranking
   * findConvergencePoint used, so callers get a deterministic "nearest
   * first" order even when they only care about a single element.
   */
  private findConvergenceSet(flow: FlowGraph, branchStarts: string[]): string[] {
    if (branchStarts.length < 2) return [];

    // Same forward-only, back-edge-excluding reachability search as
    // findConvergencePoint -- see its own comment for why back edges must
    // be excluded here.
    const reachableSets = branchStarts.map((startId) => {
      const reachable = new Set<string>();
      const queue = [startId];
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (reachable.has(nodeId)) continue;
        reachable.add(nodeId);
        const outgoing = this.getOutgoingEdges(flow, nodeId).filter(
          (e) => !this.backEdgeIds.has(e.id)
        );
        for (const edge of outgoing) {
          queue.push(edge.target);
        }
      }
      return reachable;
    });

    const firstSet = reachableSets[0];
    const commonNodes = [...firstSet].filter((nodeId) =>
      reachableSets.every((set) => set.has(nodeId))
    );

    if (commonNodes.length === 0) return [];
    if (commonNodes.length === 1) return commonNodes;

    // Reduce to the minimal/undominated antichain: drop any common node
    // that is itself reachable (forward, excluding back edges) from
    // another common node -- it isn't a true sibling, it's downstream of
    // one, and belongs after that sibling's own convergence rather than
    // alongside it. Conceptually the same "drop dominated targets" idea
    // as state-machine.ts's filterIndependentFanOutTargets, reimplemented
    // locally here to avoid a cross-file dependency.
    const reaches = (fromId: string, toId: string): boolean => {
      if (fromId === toId) return false;
      const visited = new Set<string>();
      const queue = [fromId];
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        const outgoing = this.getOutgoingEdges(flow, nodeId).filter(
          (e) => !this.backEdgeIds.has(e.id)
        );
        for (const edge of outgoing) {
          if (edge.target === toId) return true;
          if (!visited.has(edge.target)) queue.push(edge.target);
        }
      }
      return false;
    };

    const minimal = commonNodes.filter(
      (nodeId) => !commonNodes.some((other) => other !== nodeId && reaches(other, nodeId))
    );

    if (minimal.length <= 1) return minimal;

    const withDistance = minimal.map((nodeId) => {
      const distances = branchStarts.map((startId) =>
        this.getShortestDistance(flow, startId, nodeId)
      );
      return { nodeId, maxDist: Math.max(...distances) };
    });
    withDistance.sort((a, b) => a.maxDist - b.maxDist);
    return withDistance.map((d) => d.nodeId);
  }

  /**
   * Build sequence from a node until reaching the stop node (exclusive)
   */
  private buildSequenceUntilNode(
    flow: FlowGraph,
    nodeId: string,
    stopNodeId: string | Set<string>,
    visited: Set<string>
  ): unknown[] {
    // stopNodeId may be a single node id (the classic case, unchanged
    // semantics) or a Set of node ids (bug #12 fix, 2026-09-06): when 2+
    // branches share 2+ sibling convergence nodes, a branch's walk must
    // stop at ANY member of that sibling set, not just one of them.
    const stopSet = stopNodeId instanceof Set ? stopNodeId : new Set([stopNodeId]);

    if (stopSet.has(nodeId)) {
      return []; // Don't include the stop node
    }

    if (visited.has(nodeId)) {
      return []; // Avoid infinite loops
    }

    // Check if this node is the entry point of a sequence (Grouping actions)
    // pattern — checked here too (not just in buildSequenceFromNode), since
    // this bounded walker is exactly what builds each Parallel branch's
    // mini-sequence, the primary motivating use case for naming a group.
    const sequencePattern = this.sequencePatterns.get(nodeId);
    if (sequencePattern) {
      visited.add(nodeId);
      const seq: unknown[] = [this.buildSequenceBlock(flow, sequencePattern, visited)];
      visited.add(sequencePattern.endNodeId);
      if (sequencePattern.exitNodeId && !stopSet.has(sequencePattern.exitNodeId)) {
        seq.push(
          ...this.buildSequenceUntilNode(
            flow,
            sequencePattern.exitNodeId,
            stopNodeId,
            new Set(visited)
          )
        );
      }
      return seq;
    }

    // Check if this node is the entry point of a repeat pattern — checked
    // here too (not just in buildSequenceFromNode), for the same reason as
    // the sequencePattern check above: this bounded walker is exactly what
    // builds each Parallel branch's mini-sequence, and a repeat/while or
    // repeat/until loop can live inside one just as easily as a named
    // group can. Without this check, a loop nested in a parallel branch
    // falls through to the plain condition handling below, where the
    // back-edge exclusion at the `outgoing` filter silently truncates the
    // loop body's "then" to a single pass and the "else" to whatever
    // follows the loop — turning "keep checking until clear, then run the
    // body" into "check once, maybe wait once, then give up forever" with
    // no error, warning, or validation failure to signal the corruption.
    const repeatPattern = this.repeatPatterns.get(nodeId);
    if (repeatPattern) {
      const repeatBlock = this.buildRepeatBlock(flow, repeatPattern, visited);
      if (repeatBlock) {
        const seq: unknown[] = [repeatBlock];
        if (repeatPattern.exitNodeId && !stopSet.has(repeatPattern.exitNodeId)) {
          seq.push(
            ...this.buildSequenceUntilNode(
              flow,
              repeatPattern.exitNodeId,
              stopNodeId,
              new Set(visited)
            )
          );
        }
        return seq;
      }
    }

    visited.add(nodeId);

    const node = this.getNode(flow, nodeId);
    if (!node) {
      return [];
    }

    const sequence: unknown[] = [];

    // Build the current node's action
    const action = this.buildNodeAction(node);
    if (action) {
      sequence.push(action);
    }

    // Get outgoing edges (excluding repeat back-edges)
    const outgoing = this.getOutgoingEdges(flow, nodeId).filter((e) => !this.backEdgeIds.has(e.id));

    if (node.type === 'condition') {
      // Condition nodes are handled specially
      const chooseAction = action as Record<string, unknown>;
      const truePath = outgoing.filter((edge) => edge.sourceHandle === 'true');
      const falsePath = outgoing.filter((edge) => edge.sourceHandle === 'false');

      // buildFanOutUntilNode, not a plain .flatMap -- found via empirical audit, 2026-09-06, as bug #12: a genuine multi-target then/else fan-out (an ordinary `parallel:` block as an if/then's or a choose case's own content) was being flattened via .flatMap into a plain sequential list instead of wrapped in `{ parallel: [...] }` -- silently turning concurrent branches into sequential ones, a real behavior change for any branch containing a delay/wait (same class of bug as #4/#9/#11, just on the DEFAULT/native if-then-else and choose-case builders instead of a loop/sequence-group body or StateMachineStrategy).
      if (truePath.length > 0) {
        chooseAction.then = this.buildFanOutUntilNode(
          flow,
          truePath.map((edge) => edge.target),
          stopNodeId,
          new Set(visited)
        );
      }

      if (falsePath.length > 0) {
        chooseAction.else = this.buildFanOutUntilNode(
          flow,
          falsePath.map((edge) => edge.target),
          stopNodeId,
          new Set(visited)
        );
      }
    } else if (outgoing.length === 1) {
      // Single outgoing edge - continue if not at stop node
      if (!stopSet.has(outgoing[0].target)) {
        const nextActions = this.buildSequenceUntilNode(
          flow,
          outgoing[0].target,
          stopNodeId,
          new Set(visited)
        );
        sequence.push(...nextActions);
      }
    } else if (outgoing.length > 1) {
      // Multiple outgoing edges - this is a nested parallel inside a
      // parallel (or other bounded body). Delegate to buildFanOutUntilNode
      // instead of a bespoke inline implementation (found via empirical
      // audit, 2026-09-06, as bug #12: the old inline version here bounded
      // every branch directly at the OUTER stopNodeId with no internal
      // convergence detection at all, which silently corrupted the case
      // where these targets themselves share further sibling convergence
      // node(s) before finally reaching stopNodeId -- exactly the shape
      // findConvergenceSet/buildFanOutUntilNode now handle correctly, the
      // same way the condition-node true/false fan-out above already did).
      sequence.push(
        ...this.buildFanOutUntilNode(
          flow,
          outgoing.map((edge) => edge.target),
          stopNodeId,
          new Set(visited)
        )
      );
    }

    return sequence;
  }

  /**
   * Build action configuration for a single node
   */
  private buildNodeAction(node: FlowNode): Record<string, unknown> | null {
    this.recordNodeOrder(node.id);
    switch (node.type) {
      case 'trigger':
        return null; // Triggers are handled separately

      case 'condition':
        return this.buildConditionChoose(node);

      case 'action':
        return this.buildActionCall(node);

      case 'delay':
        return this.buildDelay(node);

      case 'wait':
        return this.buildWait(node);

      case 'set_variables':
        return this.buildSetVariables(node);

      case 'start':
        return null; // Metadata-only entry marker; fields: are emitted at the script level, not as a step

      case 'join':
        // Transparent convergence marker — contributes no YAML of its own.
        // findConvergencePoint() (BFS reachability intersection) already
        // detects where fanned-out branches reconnect and the fan-out
        // handling in buildSequenceFromNode() already emits `parallel:` and
        // resumes from the convergence node. A user-placed join node simply
        // becomes that convergence point when branches are wired into it —
        // same pattern as 'trigger' above.
        return null;

      case 'sequence_start':
      case 'sequence_end':
        // Normally short-circuited by the sequencePatterns check in
        // buildSequenceFromNode/buildSequenceUntilNode before buildNodeAction
        // is ever called on a sequence_start. This case only fires for an
        // *unpaired* marker (no matching end found by detectSequencePatterns)
        // — transparent no-op, same fallback treatment as 'join' above,
        // rather than emitting a malformed YAML step.
        return null;

      default:
        return null;
    }
  }

  /**
   * Build a choose block for a condition node
   */
  private buildConditionChoose(node: ConditionNode): Record<string, unknown> {
    // Build the full condition including any nested conditions
    const condition = this.buildCondition(node);

    const choose: Record<string, unknown> = {
      alias: node.data.alias,
      if: [condition],
      then: [], // Will be filled by the caller
      else: [], // Will be filled by the caller
    };

    // Note: 'id' for trigger conditions belongs inside the condition object, not at the if/then/else level
    // The id is already included via buildCondition's ...rest spread

    return choose;
  }

  /**
   * Map a single condition object (used for individual conditions in an array)
   */
  private mapSingleCondition(data: Record<string, unknown>): Record<string, unknown> {
    const { condition, conditions, alias, template, ...rest } = this.stripInternalFields(data);
    const out: Record<string, unknown> = {
      condition: condition,
      ...stripDottedOnlyConditionFields(condition, rest),
      // Preserved even for conditions nested inside and/or groups — this was
      // previously dropped here (destructured out above, never re-added),
      // silently losing a user-set alias on every export of a named
      // sub-condition inside a logical group.
      ...(alias ? { alias } : {}),
    };
    // For template conditions, ensure value_template is set from template if needed
    if (condition === 'template' && !rest.value_template && template) {
      out.value_template = template;
    }
    // Recursively map nested group conditions
    if (Array.isArray(conditions) && conditions.length > 0) {
      out.conditions = (conditions as Record<string, unknown>[])
        .map((c) => this.mapSingleCondition(c))
        .filter(
          (c) => c && (!Array.isArray(c.conditions) || (c.conditions as unknown[]).length > 0)
        );
    }
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
  }

  /**
   * Build condition configuration
   */
  private buildCondition(node: ConditionNode): Record<string, unknown> {
    this.recordNodeOrder(node.id);
    // stripInternalFields is a method (needs `this`), so it's captured here
    // rather than called from inside the plain-function mapCondition closure
    // below, which recurses without a bound `this`.
    const stripInternal = this.stripInternalFields.bind(this);
    // A condition node stamped with one of these _blockKey values (see
    // YamlParser.ts's parseIfBlock/parseChooseBlock/repeat-while/repeat-until
    // comments, "Only the first condition in the chain gets the alias from
    // ifAction") is the GATE condition of a wrapping if/else, choose, or
    // repeat-while/until block: its `data.alias` was borrowed from that
    // wrapping block's own `alias:` field on PARSE purely so it survives a
    // save (there's no separate node type for "the block's own label").
    // Every call site that builds the wrapping block (buildConditionChoose,
    // the AND-chain if/then/else builder, buildRepeatBlock's while/until
    // branches) already re-attaches this same alias to ITS OWN `alias:`
    // key -- so re-adding it to the condition object here too would
    // duplicate a single user-set label onto two different YAML keys on
    // every export. Found via the decompile audit, 2026-09-06 (a plain
    // `if: / then: / else:` fixture came back with its alias on both the
    // if-step AND the nested `condition: or` object). Only the OUTERMOST
    // (gate) condition is suppressed here -- a genuinely-nested condition
    // inside its own `conditions: [...]` group (recursed into below) never
    // carries this _blockKey and keeps its own alias untouched, matching
    // mapSingleCondition's identical, deliberately-preserved behavior for
    // that case.
    const suppressGateAlias =
      node.data &&
      typeof node.data === 'object' &&
      ['if_else', 'choose', 'repeat_while', 'repeat_until'].includes(
        (node.data as Record<string, unknown>)._blockKey as string
      );
    // Helper to recursively map condition to condition
    function mapCondition(data: Record<string, unknown>, isTopLevel: boolean): Record<string, unknown> {
      if (!data || typeof data !== 'object') return data;
      // Destructure and exclude internal Circuitry fields and legacy 'template' key
      const { condition, conditions, alias, template, ...rest } = stripInternal(data);
      const out: Record<string, unknown> = {
        condition: condition,
        ...stripDottedOnlyConditionFields(condition, rest),
        // Preserved for conditions nested inside and/or groups — see the
        // identical fix/comment in mapSingleCondition above (this is that
        // function's OR-convergence/choose-path twin, previously dropping
        // alias here too). Suppressed only at the top level of a
        // block-gate condition (see suppressGateAlias above) — the
        // wrapping block already carries this same alias on its own key.
        ...(alias && !(isTopLevel && suppressGateAlias) ? { alias } : {}),
      };
      // For template conditions, ensure value_template is set from template if needed
      if (condition === 'template' && !rest.value_template && template) {
        out.value_template = template;
      }
      // Recursively map nested group conditions
      if (Array.isArray(conditions) && conditions.length > 0) {
        out.conditions = conditions
          .map((c) => mapCondition(c, false))
          .filter((c) => c && (!Array.isArray(c.conditions) || c.conditions.length > 0));
      }
      // Normalize id: ["x"] → "x" — HA API sometimes returns trigger condition ids as single-element arrays
      if (Array.isArray(out.id) && (out.id as unknown[]).length === 1) {
        out.id = (out.id as unknown[])[0];
      }
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
    }
    return mapCondition(node.data, true);
  }

  /**
   * Build service call action or device action
   */
  private buildActionCall(node: ActionNode): Record<string, unknown> {
    // Check if this is a device action (needs special format)
    if (isDeviceAction(node.data.data)) {
      const deviceData = node.data.data;
      const action: Record<string, unknown> = {
        device_id: deviceData.device_id,
        domain: deviceData.domain,
        type: deviceData.type,
      };

      if (node.data.alias) {
        action.alias = node.data.alias;
      }

      // Add entity_id if present
      if (deviceData.entity_id) {
        action.entity_id = deviceData.entity_id;
      }

      // Add subtype if present
      if (deviceData.subtype) {
        action.subtype = deviceData.subtype;
      }

      // Add any additional parameters (like 'option' for select)
      const knownFields = ['type', 'device_id', 'domain', 'entity_id', 'subtype'];
      for (const [key, value] of Object.entries(deviceData)) {
        if (!knownFields.includes(key) && value !== undefined) {
          action[key] = value;
        }
      }

      if (node.data.enabled === false) {
        action.enabled = false;
      }

      return action;
    }

    // Check if this is a fallback repeat action (opaque repeat block)
    if (node.data.repeat) {
      const repeatData = node.data.repeat;
      const action: Record<string, unknown> = {
        repeat: {
          ...(repeatData.count !== undefined ? { count: repeatData.count } : {}),
          ...(repeatData.while ? { while: repeatData.while } : {}),
          ...(repeatData.until ? { until: repeatData.until } : {}),
          ...(repeatData.for_each !== undefined ? { for_each: repeatData.for_each } : {}),
          sequence: repeatData.sequence ?? [],
        },
      };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.continue_on_error) action.continue_on_error = node.data.continue_on_error;
      if (node.data.enabled === false) action.enabled = false;
      return action;
    }

    // Check if this is a fire event action
    if (typeof node.data.event === 'string' && node.data.event.trim() !== '') {
      const action: Record<string, unknown> = { event: node.data.event };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.event_data && Object.keys(node.data.event_data).length > 0) {
        action.event_data = node.data.event_data;
      }
      if (node.data.continue_on_error) action.continue_on_error = node.data.continue_on_error;
      if (node.data.enabled === false) action.enabled = false;
      return action;
    }

    // Check if this is a stop action
    if ('stop' in node.data) {
      const action: Record<string, unknown> = { stop: node.data.stop ?? '' };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.error === true) action.error = true;
      // `response_variable` on `stop` — home-assistant.io/docs/scripts/#stopping-a-script-sequence:
      // "To return a response from a script, use the response_variable option.
      // This option expects the name of the variable that contains the data
      // to return." Same field name/shape as the service-call response_variable
      // above, so it round-trips through the same HAAction#response_variable
      // shared type — no schema change needed.
      if (node.data.response_variable) action.response_variable = node.data.response_variable;
      if (node.data.continue_on_error) action.continue_on_error = node.data.continue_on_error;
      if (node.data.enabled === false) action.enabled = false;
      return action;
    }

    // Standard service call format — output as 'action:' (HA 2024.8+ preferred key)
    // stripInternalFields (base.ts) drops every `_`-prefixed Circuitry-internal
    // field (_blockKey, _placeholder, _ifElseBranch, _parallelBranch, ...) up
    // front — see its doc comment for why this replaced a hand-maintained
    // per-field exclusion list here (a real save failure: "extra keys not
    // allowed @ ...['_ifElseBranch']", from _ifElseBranch/_parallelBranch
    // having been missing from that list).
    const {
      alias,
      service,
      action: _originalActionKey, // excluded from extraProps
      id: _id, // excluded from extraProps — HA doesn't support id on action steps, see below
      target,
      data,
      data_template,
      response_variable,
      continue_on_error,
      enabled,
      repeat: _repeat,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const action: Record<string, unknown> = {
      ...extraProps,
      alias,
      action: service, // use 'action:' key (replaces legacy 'service:')
    };

    // `id` is intentionally dropped here (not just excluded from
    // extraProps) — HA's SERVICE_SCHEMA (and the other action-type schemas
    // below) don't support a per-step `id:` at all; only triggers do. Real
    // HA rejects it outright ("extra keys not allowed"), it's not just
    // ignored, so this can't be preserved even for round-trip fidelity.

    if (target) {
      action.target = target;
    }

    if (data && Object.keys(data as object).length > 0) {
      action.data = data;
    }

    if (data_template) {
      action.data_template = data_template;
    }

    if (response_variable) {
      action.response_variable = response_variable;
    }

    if (continue_on_error) {
      action.continue_on_error = continue_on_error;
    }

    if (enabled === false) {
      action.enabled = false;
    }

    return action;
  }

  /**
   * Build delay action
   */
  private buildDelay(node: DelayNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, delay: delayValue, id: _id, ...extraProps } = this.stripInternalFields(node.data);
    const delay: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      delay: delayValue,
    };

    return delay;
  }

  /**
   * Build wait action
   */
  private buildWait(node: WaitNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const {
      alias,
      id: _id,
      wait_template,
      wait_for_trigger,
      timeout,
      continue_on_timeout,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const wait: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
    };

    if (wait_template) {
      wait.wait_template = wait_template;
    } else if (wait_for_trigger) {
      wait.wait_for_trigger = wait_for_trigger.map((triggerData) => {
        const trigger: Record<string, unknown> = { ...triggerData };
        return this.cleanTriggerFields(this.foldEventContextUserId(trigger));
      });
    }

    // A literal all-zero timeout is not "no limit" in HA — it's "give up
    // instantly" — so it must be treated the same as no timeout at all
    // (omit the key) rather than written verbatim. See
    // BaseStrategy.hasMeaningfulDuration's doc comment for the full
    // explanation and the HA issue confirming this.
    if (this.hasMeaningfulDuration(timeout)) {
      wait.timeout = timeout;
    }

    if (continue_on_timeout !== undefined) {
      wait.continue_on_timeout = continue_on_timeout;
    }

    return wait;
  }

  /**
   * Build set variables action
   */
  private buildSetVariables(node: SetVariablesNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, id: _id, variables, ...extraProps } = this.stripInternalFields(node.data);
    const setVars: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      variables,
    };

    if (alias) {
      setVars.alias = alias;
    }

    return setVars;
  }
}
