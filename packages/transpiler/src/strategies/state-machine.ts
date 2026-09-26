import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowGraph,
  FlowNode,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@circuitry/shared';
import { isDeviceAction, isStartNode } from '@circuitry/shared';
import { findBackEdges, type TopologyAnalysis } from '../analyzer/topology';
import { fanOutHash } from '../utils/fanOutHash';
import { BaseStrategy, type HAYamlOutput } from './base';
import { NativeStrategy, stripDottedOnlyConditionFields } from './native';

/**
 * State Machine strategy for complex flows with cycles, cross-links, or converging paths
 *
 * Implements the "Virtual CPU" pattern:
 * - current_node: A variable acting as the Program Counter
 * - repeat: A loop that keeps the automation alive until END
 * - choose: A dispatcher that executes the current node's logic
 *
 * This allows for arbitrary graph topologies including:
 * - Back-loops (returning to earlier nodes)
 * - Cross-links (jumping across branches)
 * - Converging paths (multiple paths merging)
 * - Complex state machines
 */
export class StateMachineStrategy extends BaseStrategy {
  readonly name = 'state-machine';
  readonly description =
    'Generates state machine YAML for complex flows with cycles or cross-links';

  // Lazily constructed, reused for the lifetime of this strategy instance.
  // Every method called on it (findConvergencePointForBranches,
  // buildActionsUntilNode, buildActionsFromEntryPoint) does its own
  // prepareForTraversal() internally, so sharing one instance across many
  // generate() calls -- this strategy is itself reused across many
  // transpile() calls by FlowTranspiler, see its `strategies` array -- is
  // safe: nothing here carries state between calls.
  private _nativeSubBuilder: NativeStrategy | null = null;
  private get nativeSubBuilder(): NativeStrategy {
    this._nativeSubBuilder ??= new NativeStrategy();
    return this._nativeSubBuilder;
  }

  canHandle(_analysis: TopologyAnalysis): boolean {
    // State machine can handle any topology
    return true;
  }

  /** Phase 5: see recordFanOut. Reset per generate() call. */
  private fanOutRecords: Record<string, { targets: string[]; hash: string }> = {};

  /**
   * Phase 5 (2026-09-26): remembers, for a state that renders a fan-out
   * inline, which graph targets it fans out to (and a fingerprint of the
   * rendered steps). FlowTranspiler writes these to
   * `_circuitry_metadata.fan_outs`, so reopening this YAML without its
   * canonical graph rebuilds the original edges instead of turning each
   * inline copy of the branches into new nodes.
   */
  private recordFanOut(key: string, targets: string[], extraSteps: unknown[]): void {
    if (extraSteps.length > 0) this.fanOutRecords[key] = { targets, hash: fanOutHash(extraSteps) };
  }

  generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput {
    const warnings: string[] = [];
    this.fanOutRecords = {};

    // Strip hint edges (visual-only trigger-routing aids) before any processing
    flow = {
      ...flow,
      edges: flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint'),
    };

    // Build trigger-to-action mapping for routing
    const triggerRouting = this.buildTriggerRouting(flow);

    if (triggerRouting.size === 0) {
      warnings.push('No action nodes found after triggers');
      // Extract triggers to determine output format
      const triggers = this.extractTriggers(flow);
      if (triggers.length > 0) {
        // Output as automation with empty action
        return {
          automation: this.withAutomationSettings(flow, {
            alias: flow.name,
            description: flow.description || '',
            triggers: triggers,
            actions: [],
            mode: flow.metadata?.mode ?? 'single',
          }),
          warnings,
          strategy: this.name,
        };
      }
      // No triggers - output as script
      const emptyScript: Record<string, unknown> = {
        alias: flow.name,
        description: flow.description || '',
        sequence: [],
        mode: flow.metadata?.mode ?? 'single',
      };
      const emptyScriptFields = flow.nodes.find(isStartNode)?.data.fields;
      if (emptyScriptFields && Object.keys(emptyScriptFields).length > 0) {
        emptyScript.fields = emptyScriptFields;
      }
      return {
        script: emptyScript,
        warnings,
        strategy: this.name,
      };
    }

    // Build choose blocks for each non-trigger, non-start node (start nodes,
    // like trigger nodes, are metadata-only entry markers and never a valid
    // `current_node` dispatch state)
    const nodeBlocks = flow.nodes
      .filter((n) => n.type !== 'trigger' && n.type !== 'start')
      .map((node) => this.generateNodeBlock(flow, node));

    // Historical note (bug #18 investigation, 2026-09-25): this block used to
    // warn that an explicit Join node with 2+ incoming branches "may only
    // have its first branch wired correctly" under this strategy. That was
    // true when the warning was first added (this project's very first
    // commit, predating every fan-out fix below), but buildFanOutContinuation
    // / filterIndependentFanOutTargets / buildFanOutFromTargets now resolve
    // genuine multi-edge convergence correctly: parallel branches, if/else
    // branches, and raw multi-edge dominance (both a no-op dominated target
    // and one with real, non-duplicated content) all converge on a Join node
    // without dropping or duplicating any action - see
    // state-machine-behavioral-check.test.ts's Join-node cases. The warning
    // was therefore pure noise (a confusing false positive for anyone who
    // hit it) and has been removed rather than kept "just in case". If a
    // genuine convergence gap into a Join node is found in the future, add a
    // regression test that reproduces it first, then reintroduce a warning
    // scoped to that specific shape.

    // Generate parallel entry blocks for triggers with multiple targets
    const parallelEntryBlocks = this.generateParallelEntryBlocks(flow, triggerRouting);

    // Combine node blocks and parallel entry blocks
    const chooseBlocks = [...parallelEntryBlocks, ...nodeBlocks];

    // Warn about potential infinite loops
    if (analysis.hasCycles) {
      const cycleWarning = this.detectPotentialInfiniteLoop(flow, analysis);
      if (cycleWarning) {
        warnings.push(cycleWarning);
      }
    }

    // Extract triggers for the automation wrapper
    const triggers = this.extractTriggers(flow);

    // Generate the initial node expression
    // If all triggers lead to the same node, use that directly
    // Otherwise, use a Jinja2 template to route based on trigger.idx
    const entryNodeExpr = this.generateEntryNodeExpression(triggerRouting);

    // Build the action sequence for the state machine
    // In HA automations, actions are a flat list - we use:
    // 1. A variables action to initialize state
    // 2. A repeat action with choose dispatcher
    const actionSequence: Record<string, unknown>[] = [
      // Initialize the state machine variables
      {
        variables: {
          current_node: entryNodeExpr,
          flow_context: {},
        },
      },
      // The main execution loop
      {
        alias: 'State Machine Loop',
        repeat: {
          until: '{{ current_node == "END" }}',
          sequence: [
            {
              choose: chooseBlocks,
              default: [
                {
                  service: 'system_log.write',
                  data: {
                    message: 'Circuitry: Unknown state "{{ current_node }}", ending flow',
                    level: 'warning',
                  },
                },
                {
                  variables: {
                    current_node: 'END',
                  },
                },
              ],
            },
          ],
        },
      },
    ];

    // If there are triggers, output as automation format
    if (triggers.length > 0) {
      return {
        automation: this.withAutomationSettings(flow, {
          alias: flow.name,
          description: flow.description || '',
          triggers: triggers,
          actions: actionSequence,
          mode: flow.metadata?.mode ?? 'single',
        }),
        warnings,
        strategy: this.name,
        fanOuts: this.fanOutRecords,
      };
    }

    // No triggers - output as script format
    const script: Record<string, unknown> = {
      alias: flow.name,
      description: flow.description || '',
      sequence: actionSequence,
      mode: flow.metadata?.mode ?? 'single',
    };
    const scriptFields = flow.nodes.find(isStartNode)?.data.fields;
    if (scriptFields && Object.keys(scriptFields).length > 0) {
      script.fields = scriptFields;
    }
    return {
      script,
      warnings,
      strategy: this.name,
      fanOuts: this.fanOutRecords,
    };
  }

  /**
   * Adds the automation-level settings NativeStrategy.generate() carries
   * through (same keys, same conditions, same order). Bug #20, 2026-09-26:
   * this strategy used to emit only `mode`, so `max`, `max_exceeded`,
   * `initial_state: false`, `trace` and `trigger_variables` were silently
   * lost whenever an automation needed the state machine. Top-level
   * `variables` is not added here: FlowTranspiler.generateAndSerialize
   * merges flow.userVariables into every strategy's output.
   */
  private withAutomationSettings(
    flow: FlowGraph,
    automation: Record<string, unknown>
  ): Record<string, unknown> {
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
    return automation;
  }

  /**
   * Build a mapping from trigger index to target action node(s)
   * Returns a Map where key = trigger index, value = array of target node IDs
   * When a trigger has multiple targets, they should execute in parallel
   */
  private buildTriggerRouting(flow: FlowGraph): Map<number, string[]> {
    const routing = new Map<number, string[]>();

    // Get trigger nodes in order (they will be output in this order)
    const triggerNodes = flow.nodes.filter((n): n is TriggerNode => n.type === 'trigger');

    triggerNodes.forEach((trigger, index) => {
      const outgoing = this.getOutgoingEdges(flow, trigger.id);
      if (outgoing.length > 0) {
        // filterIndependentFanOutTargets here too -- found via empirical
        // audit, 2026-09-06 (Phase B item 6): a trigger's own direct
        // targets can be "shortcut"-dominated exactly the same way a
        // mid-flow fan-out's can (buildFanOutFromTargets' doc comment) --
        // most concretely, a second edge connected straight from a trigger
        // onto a downstream Choose-block Case (or If/Else branch) that's
        // ALREADY reachable from that trigger's real entry point via the
        // block's own internal chain edge. Without this filter, that
        // downstream node is treated as its own independent second
        // parallel branch; since it's also the fan-out's own convergence
        // point (it's what the first branch's chain leads back to), the
        // convergence-bounded branch-builder degenerates to zero actions
        // for it (start node === stop node), and the pre-existing
        // zero-actions fallback silently stubs it with a throwaway
        // `system_log.write` placeholder -- precisely the corruption class
        // buildFanOutFromTargets' own identical filter already exists to
        // prevent for every OTHER fan-out call site in this file. Confirmed
        // via the new StateMachineStrategy verification gate (Phase B item
        // 4), which caught this shape as a real behavioral mismatch rather
        // than silently accepting the stub.
        routing.set(
          index,
          this.filterIndependentFanOutTargets(
            flow,
            outgoing.map((e) => e.target)
          )
        );
      }
    });

    // Script-mode flows (entered via a "Start block") have no trigger nodes
    // at all — the flow is entered via a `start` node instead. Treat it exactly
    // like a single synthetic trigger (index 0) so all the existing
    // entry-routing machinery (generateEntryNodeExpression,
    // generateParallelEntryBlocks) works completely unmodified.
    if (routing.size === 0) {
      const startNode = flow.nodes.find(isStartNode);
      if (startNode) {
        const outgoing = this.getOutgoingEdges(flow, startNode.id);
        if (outgoing.length > 0) {
          routing.set(
            0,
            this.filterIndependentFanOutTargets(
              flow,
              outgoing.map((e) => e.target)
            )
          );
        }
      }
    }

    return routing;
  }

  /**
   * Get the effective entry point for a trigger
   * If trigger has single target, return that target ID
   * If trigger has multiple targets (parallel), return synthetic parallel entry ID
   */
  private getEffectiveEntryPoint(triggerIndex: number, targets: string[]): string {
    if (targets.length === 1) {
      return targets[0];
    }
    // Multiple targets - use synthetic parallel entry point
    return `__parallel_trigger_${triggerIndex}`;
  }

  /**
   * Generate the entry node expression for initialization
   * If all triggers lead to the same node, return that node ID
   * Otherwise, return a Jinja2 template that routes based on trigger.idx
   */
  private generateEntryNodeExpression(triggerRouting: Map<number, string[]>): string {
    // Convert to effective entry points (handling parallel branches)
    const effectiveEntries = new Map<number, string>();
    for (const [idx, targets] of triggerRouting) {
      effectiveEntries.set(idx, this.getEffectiveEntryPoint(idx, targets));
    }

    const uniqueTargets = new Set(effectiveEntries.values());

    // If all triggers lead to the same node (or there's only one trigger)
    if (uniqueTargets.size === 1) {
      return [...uniqueTargets][0];
    }

    // Multiple different targets - generate routing template
    // Using trigger.idx which is 0-based index of which trigger fired
    const entries = [...effectiveEntries.entries()].sort((a, b) => a[0] - b[0]);

    // Build a Jinja2 if/elif chain
    // Note: trigger.idx is a string in HA, so compare with quoted string values
    // Node IDs should NOT be quoted - they're compared with quoted strings in conditions
    const parts: string[] = [];
    entries.forEach(([idx, nodeId], i) => {
      if (i === 0) {
        parts.push(`{% if trigger.idx == "${idx}" %}${nodeId}`);
      } else if (i === entries.length - 1) {
        parts.push(`{% else %}${nodeId}{% endif %}`);
      } else {
        parts.push(`{% elif trigger.idx == "${idx}" %}${nodeId}`);
      }
    });

    // Handle edge case where we have only one entry
    if (entries.length === 1) {
      return entries[0][1];
    }

    return parts.join('');
  }

  /**
   * Generate choose blocks for parallel entry points
   * When a trigger has multiple targets, we create a synthetic state that
   * executes all targets in a parallel block
   */
  private generateParallelEntryBlocks(
    flow: FlowGraph,
    triggerRouting: Map<number, string[]>
  ): Record<string, unknown>[] {
    const parallelBlocks: Record<string, unknown>[] = [];
    const nativeSubBuilder = this.nativeSubBuilder;

    for (const [idx, targets] of triggerRouting) {
      // Only generate parallel blocks for triggers with multiple targets
      if (targets.length <= 1) {
        continue;
      }

      const parallelEntryId = `__parallel_trigger_${idx}`;

      // Do these targets reconverge on a shared continuation node once
      // they finish (e.g. a plain `parallel:` block followed by more
      // actions -- an entirely ordinary automation shape, not a
      // canvas-only construct)? If so, each branch must be built only up
      // to that boundary, and the state machine must hand off to that
      // node's own already-generated dispatch afterward instead of ending
      // the flow -- otherwise everything after the branches reconverge is
      // silently dropped (found via empirical audit, 2026-09-06: every
      // branch here used to unconditionally jump current_node to 'END',
      // regardless of whether there was more flow after the join).
      // findConvergenceSetForBranches (not the single-node
      // findConvergencePointForBranches) -- bug #12, found via the
      // randomized fuzzer, 2026-09-06: see buildFanOutFromTargets' own doc
      // comment for the full explanation. This site is architecturally the
      // same class of bug, just scoped to a trigger's own direct fan-out
      // targets instead of a mid-flow one.
      const convergenceSet = nativeSubBuilder.findConvergenceSetForBranches(flow, targets);
      const convergenceBoundSet = convergenceSet.length > 0 ? new Set(convergenceSet) : null;

      // Build parallel action calls for all target nodes
      const parallelActions = targets.map((targetId) => {
        const targetNode = flow.nodes.find((n) => n.id === targetId);
        if (!targetNode) {
          return { service: 'system_log.write', data: { message: `Unknown node: ${targetId}` } };
        }

        // When the branches reconverge, every branch -- action or
        // otherwise -- must stop exactly at the convergence boundary, so
        // its own continuation isn't duplicated inline AND skipped via the
        // current_node jump below. buildActionsUntilNode (built on the
        // same tree-walker as buildActionsFromEntryPoint) handles a lone
        // action node just as well as a whole condition/delay/wait chain.
        if (convergenceBoundSet) {
          const branchActions = nativeSubBuilder.buildActionsUntilNode(
            flow,
            targetId,
            convergenceBoundSet
          );
          if (branchActions.length === 0) {
            return { service: 'system_log.write', data: { message: `Node: ${targetId}` } };
          }
          return branchActions.length === 1 ? branchActions[0] : { sequence: branchActions };
        }

        // No shared continuation -- these branches genuinely end
        // independently.
        //
        // Item 4 (2026-09-26): an action branch used to be rendered as just
        // its own service call ("a lone action node stays a single step"),
        // dropping whatever followed it in the branch -- the rest of a
        // sequence, or the loop the action opens (an until whose body
        // starts with it). The gate refused every such automation. An
        // action branch is inlined like every other kind below;
        // buildActionsFromEntryPoint still renders a lone action as that
        // one step. (buildFanOutFromTargets, the mid-flow equivalent, never
        // had the special case.)

        // Other kinds of branch (condition, delay, wait, set_variables, a
        // whole Choose/If/Else chain, ...) used to get replaced with a throwaway
        // `system_log.write` placeholder and an immediate jump to END —
        // silently discarding the real branch. That's the corruption behind
        // the "Template placeholder" reports: a trigger with 2+ direct
        // targets is exactly what a hand-built Choose/If block looks like
        // before its topology qualifies for the plain tree-shaped
        // generator, and every one of those branches starts with a
        // condition, not an action.
        //
        // Fix: inline this branch as its own self-contained native action
        // sequence (NativeStrategy.buildActionsFromEntryPoint, reusing the
        // exact tree-walker the plain-tree generator itself uses — see its
        // doc comment) instead of stubbing it. Each parallel branch is
        // necessarily its own independent, non-cyclic subtree here (no
        // convergenceId was found above) — nothing downstream of it needs
        // to interact with the shared current_node state machine, since
        // this block jumps current_node to 'END' once every branch
        // finishes (see below).
        const branchActions = nativeSubBuilder.buildActionsFromEntryPoint(flow, targetId);
        if (branchActions.length === 0) {
          // Entry node itself didn't resolve to anything (shouldn't happen
          // given targetNode was found above, but keep the graph from ever
          // silently vanishing a branch without any actions at all).
          return { service: 'system_log.write', data: { message: `Node: ${targetId}` } };
        }
        // A single step doesn't need an extra sequence-wrapper level inside
        // the parallel block, matching NativeStrategy's own flattening for
        // this exact shape (see its "flattenedBranches" trigger-fan-out
        // case).
        return branchActions.length === 1 ? branchActions[0] : { sequence: branchActions };
      });

      // 2+ sibling convergence nodes (bug #12): current_node must stay a
      // single scalar dispatch value, so the second-level fan-out among
      // the siblings is delegated to buildFanOutFromTargets (already fixed
      // above to recurse correctly on arbitrary further nesting) and its
      // extraSteps are inlined directly into this same state's sequence,
      // right after the first parallel block.
      const extraSequenceSteps: unknown[] = [];
      let resolvedNextNode: string = convergenceSet[0] ?? 'END';
      if (convergenceSet.length > 1) {
        const inner = this.buildFanOutFromTargets(flow, convergenceSet);
        extraSequenceSteps.push(...inner.extraSteps);
        resolvedNextNode = inner.nextNode;
      }

      this.recordFanOut(parallelEntryId, targets, [
        { parallel: parallelActions },
        ...extraSequenceSteps,
      ]);
      parallelBlocks.push({
        conditions: [
          {
            condition: 'template',
            value_template: `{{ current_node == "${parallelEntryId}" }}`,
          },
        ],
        sequence: [
          {
            parallel: parallelActions,
          },
          ...extraSequenceSteps,
          {
            variables: {
              // Continue to the shared convergence node's own dispatch if
              // one was found above, instead of always ending the flow.
              current_node: resolvedNextNode,
            },
          },
        ],
      });
    }

    return parallelBlocks;
  }

  /**
   * Extract triggers from trigger nodes
   */
  private extractTriggers(flow: FlowGraph): unknown[] {
    return flow.nodes
      .filter((n): n is TriggerNode => n.type === 'trigger')
      .map((node) => {
        // See stripInternalFields's doc comment (base.ts) — same fix as
        // NativeStrategy's buildTrigger.
        const trigger: Record<string, unknown> = this.stripInternalFields(node.data);

        return this.cleanTriggerFields(this.foldEventContextUserId(trigger));
      });
  }

  /**
   * Generate a choose block for a single node
   */
  private generateNodeBlock(flow: FlowGraph, node: FlowNode): Record<string, unknown> {
    const outgoingEdges = this.getOutgoingEdges(flow, node.id);

    switch (node.type) {
      case 'condition':
        return this.generateConditionBlock(flow, node, outgoingEdges);
      case 'action':
        return this.generateActionBlock(flow, node, outgoingEdges);
      case 'delay':
        return this.generateDelayBlock(flow, node, outgoingEdges);
      case 'wait':
        return this.generateWaitBlock(flow, node, outgoingEdges);
      case 'set_variables':
        return this.generateSetVariablesBlock(flow, node, outgoingEdges);
      case 'join':
        // Transparent convergence marker, same treatment as any other
        // passthrough node — see the mid-flow-fan-out warning emitted in
        // generate() for this strategy's one known limitation here.
        return this.generatePassthroughBlock(flow, node, outgoingEdges);
      default:
        return this.generatePassthroughBlock(flow, node, outgoingEdges);
    }
  }

  /**
   * Resolves how a node's dispatch block should continue once its own step
   * finishes: normally that's just `edges[0]?.target ?? 'END'` (every
   * per-type builder below used to inline this itself), but a genuine
   * mid-flow parallel fan-out -- 2+ outgoing edges, none of them a
   * condition's true/false branch -- needs real handling instead. Before
   * this fix, generateActionBlock/generateDelayBlock/generateWaitBlock/
   * generateSetVariablesBlock/generatePassthroughBlock all silently used
   * only `edges[0]`, so the second and later branches of a mid-flow
   * `parallel:` block (the fan-out SOURCE being an ordinary action/delay/
   * wait/etc. node, not a trigger -- see generateParallelEntryBlocks for
   * the trigger-direct case) were never dispatched at all: current_node
   * never became their id from anywhere, so those nodes' own actions
   * permanently never ran (found via empirical audit, 2026-09-06 -- a
   * plain "action -> parallel(A, B) -> continue" flow forced onto
   * state-machine dropped B's action entirely, with no warning, since the
   * existing Join-node warning only covers the join's incoming side, not a
   * fan-out node's outgoing side).
   *
   * Mirrors generateParallelEntryBlocks' own convergence-aware handling:
   * find where the branches reconverge (if anywhere) via NativeStrategy's
   * back-edge-aware search, build each branch only up to that boundary,
   * and route current_node there afterward instead of unconditionally to
   * 'END'.
   */
  private buildFanOutContinuation(
    flow: FlowGraph,
    node: FlowNode,
    edges: FlowEdge[]
  ): { extraSteps: unknown[]; nextNode: string } {
    const isRealFanOut =
      edges.length >= 2 &&
      node.type !== 'condition' &&
      edges.every((e) => e.sourceHandle !== 'true' && e.sourceHandle !== 'false');

    if (!isRealFanOut) {
      const nextNodeId = edges[0]?.target ?? 'END';
      return { extraSteps: [], nextNode: nextNodeId === 'END' ? 'END' : nextNodeId };
    }

    const targets = edges.map((e) => e.target);
    const result = this.buildFanOutFromTargets(flow, targets);
    this.recordFanOut(node.id, targets, result.extraSteps);
    return result;
  }

  /**
   * Lower-level counterpart to buildFanOutContinuation, taking a plain list
   * of target node ids instead of deriving them from one node's outgoing
   * edges. Needed because a condition node's true and false paths are two
   * SEPARATE potential fan-outs (generateConditionBlock calls this once per
   * side), not one combined edge list like every other node type.
   *
   * 0 targets -> 'END' (no edge at all, matches every builder's prior
   * `edges[0]?.target ?? 'END'` default). 1 target -> that target directly,
   * no parallel wrapper (matches the prior single-edge behavior exactly).
   * 2+ targets -> a genuine fan-out: found via empirical audit, 2026-09-06,
   * as bug #9 -- generateConditionBlock used to take only
   * `edges.find(e => e.sourceHandle === 'true')` (a single .find(), not a
   * filter), so an `if:` whose `then:` immediately fans out into a
   * `parallel:` block (an entirely ordinary YAML shape, no canvas-only
   * construct needed) had every target but the first silently dropped,
   * with no warning -- the same class of bug as #7/#8, just on a
   * condition's branch instead of a plain node's single edge list.
   */
  /**
   * Narrow fallback for when a fan-out's branches don't share an ordinary
   * forward convergence point, but ARE the tail end of a loop body -- so
   * their real shared continuation is looping back to the loop's own
   * condition node, not ending the flow. Only fires when every branch's
   * ways out are dead ends or back-edges to one and the same node; anything
   * else returns null rather than guess.
   */
  private findLoopBackConvergence(flow: FlowGraph, targetIds: string[]): string | null {
    // Bug #25 (2026-09-26, found by running compiled YAML with
    // sm-interpreter.ts): this used to look only at each target's OWN
    // outgoing edges, so a branch with more than one step (`parallel: [A,
    // [B, C]]` as the last statement of a loop body: B's only edge is a
    // forward one to C) made it bail, and the fan-out dead-ended into END
    // after the first iteration instead of looping. Walk each branch's
    // whole forward-reachable subgraph instead: its exits are dead ends
    // (compatible with anything) and back-edges leaving that subgraph (a
    // back-edge into the branch's own nodes is an inner loop, not an exit).
    // Every branch's exits must be back-edges to the same one node.
    // extractStateMachineFromGraph.ts applies the same rule independently.
    const backEdgeIds = findBackEdges(flow);
    let loopTarget: string | null = null;

    for (const id of targetIds) {
      const reachable = new Set<string>();
      const queue = [id];
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (reachable.has(nodeId)) continue;
        reachable.add(nodeId);
        for (const e of this.getOutgoingEdges(flow, nodeId)) {
          if (!backEdgeIds.has(e.id)) queue.push(e.target);
        }
      }
      for (const nodeId of reachable) {
        for (const e of this.getOutgoingEdges(flow, nodeId)) {
          if (!backEdgeIds.has(e.id) || reachable.has(e.target)) continue;
          if (loopTarget !== null && loopTarget !== e.target) return null;
          loopTarget = e.target;
        }
      }
    }

    return loopTarget;
  }

  /**
   * Drops any target that some OTHER target in the same list can reach
   * (forward, one-way) without being reachable back -- see
   * buildFanOutFromTargets' doc comment for why this is needed. Mutually
   * reachable targets (a shared loop) are left alone, since neither
   * one-way-dominates the other there.
   */
  private filterIndependentFanOutTargets(flow: FlowGraph, targetIds: string[]): string[] {
    if (targetIds.length <= 1) return targetIds;

    // Exclude back edges from the reachability walk, same convention used
    // everywhere in native.ts (e.g. its findConvergencePoint, fixed as bug
    // #5). Without this exclusion, a fan-out sibling that happens to sit on
    // a loop's own back-edge path (e.g. one branch of a parallel block
    // inside a while-loop body, which loops back to the while-condition)
    // looks like it "reaches" every other sibling by wrapping all the way
    // around the loop -- which would wrongly get every other sibling
    // dropped as a false "shortcut" target. Found via empirical audit,
    // 2026-09-06: a `repeat.while` body whose sequence is a single
    // `parallel: [A, B]` had the back edge attached (by the parser) only to
    // B, not A; without this exclusion the filter concluded B "reaches" A
    // (by looping back through the while-condition) and silently dropped A,
    // the exact same silent-data-loss failure mode as bug #9 itself, just
    // one level deeper in the fix for it.
    const backEdgeIds = findBackEdges(flow);
    const reaches = (fromId: string, toId: string): boolean => {
      const visited = new Set<string>();
      const queue = [fromId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (id === toId) return true;
        if (visited.has(id)) continue;
        visited.add(id);
        for (const edge of this.getOutgoingEdges(flow, id)) {
          if (backEdgeIds.has(edge.id)) continue;
          queue.push(edge.target);
        }
      }
      return false;
    };

    return targetIds.filter(
      (id) =>
        !targetIds.some(
          (otherId) => otherId !== id && reaches(otherId, id) && !reaches(id, otherId)
        )
    );
  }

  private buildFanOutFromTargets(
    flow: FlowGraph,
    rawTargetIds: string[]
  ): { extraSteps: unknown[]; nextNode: string } {
    // A same-handle edge list can legitimately contain more than genuine
    // sibling branches: the parser also emits "shortcut" edges (e.g. a
    // condition whose own true-path terminal also gets wired directly to
    // whatever comes after the whole if-block, alongside the real body
    // chain that reaches the same place) that are structural bookkeeping,
    // not additional parallel work. Found as a regression while fixing bug
    // #9 (2026-09-06): treating every same-handle edge as a fan-out target
    // triplicated `media_player.volume_set` in issue #164's nested-if
    // regression test, because one of the outer condition's two "true"
    // edges pointed at a node its OTHER true-edge's own body already
    // reaches naturally. Filtered out here: a target that some OTHER
    // target can reach but that can't reach back (one-way dominance, not a
    // shared loop) isn't an independent branch -- it's already covered by
    // that other branch's own continuation.
    const targetIds = this.filterIndependentFanOutTargets(flow, rawTargetIds);

    if (targetIds.length === 0) {
      return { extraSteps: [], nextNode: 'END' };
    }
    if (targetIds.length === 1) {
      return { extraSteps: [], nextNode: targetIds[0] };
    }

    // Ordinary forward convergence first (excludes ALL back edges, per
    // NativeStrategy's own bug-#5-fixed search -- deliberately conservative
    // so an unrelated OUTER loop's back edge is never mistaken for a shared
    // convergence). Found via empirical audit, 2026-09-06: this alone isn't
    // enough for a fan-out that's the last thing in a loop's own body -- a
    // `repeat.while` whose sequence is just `parallel: [A, B]` has no
    // ordinary downstream node for the branches to reconverge on, since
    // "what's next" IS the loop wrapping back to its own condition. Without
    // the fallback below, this fell through to the "no convergence" case
    // and the fan-out dead-ended into END after one iteration, instead of
    // looping.
    //
    // findConvergenceSetForBranches (not the single-node
    // findConvergencePointForBranches) -- bug #12, found via the
    // randomized fuzzer, 2026-09-06: when 2+ targets share 2+ SIBLING
    // downstream nodes (neither reachable from the other), there is no
    // single dominating convergence node -- see native.ts's
    // findConvergenceSet doc comment for the full explanation. current_node
    // must stay a single scalar dispatch value here (state-machine's core
    // architectural constraint), so when a genuine 2+-member sibling set is
    // found, this function recurses into itself on that sibling set and
    // splices the recursive call's own extraSteps in as more inline YAML,
    // rather than arbitrarily picking one sibling as "the" continuation.
    let convergenceSet = this.nativeSubBuilder.findConvergenceSetForBranches(flow, targetIds);
    if (convergenceSet.length === 0) {
      const loopBack = this.findLoopBackConvergence(flow, targetIds);
      if (loopBack) convergenceSet = [loopBack];
    }
    const boundSet = convergenceSet.length > 0 ? new Set(convergenceSet) : null;

    const parallelActions = targetIds.map((targetId) => {
      const branchActions = boundSet
        ? this.nativeSubBuilder.buildActionsUntilNode(flow, targetId, boundSet)
        : this.nativeSubBuilder.buildActionsFromEntryPoint(flow, targetId);
      if (branchActions.length === 0) {
        return { service: 'system_log.write', data: { message: `Node: ${targetId}` } };
      }
      return branchActions.length === 1 ? branchActions[0] : { sequence: branchActions };
    });

    const extraSteps: unknown[] = [{ parallel: parallelActions }];

    if (convergenceSet.length <= 1) {
      return { extraSteps, nextNode: convergenceSet[0] ?? 'END' };
    }

    const inner = this.buildFanOutFromTargets(flow, convergenceSet);
    extraSteps.push(...inner.extraSteps);
    return { extraSteps, nextNode: inner.nextNode };
  }

  /**
   * Generate block for action node
   * Executes the service call then moves to the next node
   */
  private generateActionBlock(
    flow: FlowGraph,
    node: ActionNode,
    edges: FlowEdge[]
  ): Record<string, unknown> {
    const currentNodeId = node.id;
    const actionCall = this.buildActionCall(node);
    const { extraSteps, nextNode } = this.buildFanOutContinuation(flow, node, edges);

    return {
      conditions: [
        {
          condition: 'template',
          value_template: `{{ current_node == "${currentNodeId}" }}`,
        },
      ],
      sequence: [
        actionCall,
        ...extraSteps,
        {
          variables: {
            current_node: nextNode,
          },
        },
      ],
    };
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
      const actionCall: Record<string, unknown> = {
        repeat: {
          ...(repeatData.count !== undefined ? { count: repeatData.count } : {}),
          ...(repeatData.while ? { while: repeatData.while } : {}),
          ...(repeatData.until ? { until: repeatData.until } : {}),
          ...(repeatData.for_each !== undefined ? { for_each: repeatData.for_each } : {}),
          sequence: repeatData.sequence ?? [],
        },
      };
      if (node.data.alias) actionCall.alias = node.data.alias;
      if (node.data.continue_on_error) actionCall.continue_on_error = node.data.continue_on_error;
      if (node.data.enabled === false) actionCall.enabled = false;
      return actionCall;
    }

    // Check if this is a fire event action
    if (typeof node.data.event === 'string' && node.data.event.trim() !== '') {
      const actionCall: Record<string, unknown> = { event: node.data.event };
      if (node.data.alias) actionCall.alias = node.data.alias;
      if (node.data.event_data && Object.keys(node.data.event_data).length > 0) {
        actionCall.event_data = node.data.event_data;
      }
      if (node.data.continue_on_error) actionCall.continue_on_error = node.data.continue_on_error;
      if (node.data.enabled === false) actionCall.enabled = false;
      return actionCall;
    }

    // Standard service call format — output as 'action:' (HA 2024.8+ preferred key)
    // stripInternalFields (base.ts) drops every `_`-prefixed Circuitry-internal
    // field before this spreads into the generated action — see its doc
    // comment. This mirrors NativeStrategy's identical fix; this whole
    // function is a near-duplicate of NativeStrategy.buildActionCall, and
    // this exact class of bug (a real save failure — "extra keys not
    // allowed @ ...['_ifElseBranch']") existed here too, just unreported
    // since fewer automations reach StateMachineStrategy with a compound
    // block attached.
    const {
      alias,
      service,
      action: _originalActionKey,
      id,
      target,
      data,
      data_template,
      response_variable,
      continue_on_error,
      enabled,
      repeat: _repeat,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const actionCall: Record<string, unknown> = {
      ...extraProps,
      alias,
      action: service,
    };

    if (id) {
      actionCall.id = id;
    }

    if (target) {
      actionCall.target = target;
    }

    // Only attach `data` when it actually has content -- an empty `data:
    // {}` on a service-call node must be omitted the same way
    // NativeStrategy.buildActionCall already does, rather than written
    // verbatim. Found via the StateMachineStrategy audit (2026-09-06):
    // this branch previously lacked the emptiness check, so every
    // service-call node with no configured data fields round-tripped
    // fine through NativeStrategy but grew a spurious `data: {}` here.
    if (data && Object.keys(data as object).length > 0) {
      actionCall.data = data;
    }

    if (data_template) {
      actionCall.data_template = data_template;
    }

    if (response_variable) {
      actionCall.response_variable = response_variable;
    }

    if (continue_on_error) {
      actionCall.continue_on_error = continue_on_error;
    }

    if (enabled === false) {
      actionCall.enabled = false;
    }

    return actionCall;
  }

  /**
   * Generate block for condition node
   * Evaluates the condition and sets current_node based on result
   */
  /**
   * Bug #27 (2026-09-26, found by the canvas-graph fuzzer): where a
   * condition with NO false edge should go when it's false.
   *
   * A multi-condition list (`if: [A, B]`, a choose case's `conditions: [A,
   * B]`, `while: [A, B]`, `until: [A, B]`) is wired A -true-> B with only A's
   * false edge; B has none and shares A's. The canvas's AND-chains of plain
   * conditions use the same convention, and NativeStrategy and the
   * verifiers have always read it that way. This strategy rendered B's
   * missing false edge literally, as END -- so "A true, B false" skipped the
   * else branch and everything after it.
   *
   * B is such a list member when its only incoming edge is the true edge of
   * a condition A that doesn't fan out on true, B isn't itself the head of
   * a nested construct (no `_blockKey` -- bug #21), and A's false targets
   * don't lead back to B (then B is where A's branches meet again -- bug
   * #26). Then B's false targets are A's (recursively, for longer lists).
   * Otherwise a missing false edge really does mean nothing happens: [].
   * extractStateMachineFromGraph.ts applies the same rule independently.
   */
  private andMemberFalseTargets(
    flow: FlowGraph,
    conditionId: string,
    seen = new Set<string>()
  ): string[] {
    if (seen.has(conditionId)) return [];
    seen.add(conditionId);
    const backEdgeIds = findBackEdges(flow);
    const node = this.getNode(flow, conditionId);
    if (node?.type !== 'condition') return [];
    const own = flow.edges.filter((e) => e.source === conditionId && e.sourceHandle === 'false');
    if (own.length > 0) return own.map((e) => e.target);
    if (typeof (node.data as Record<string, unknown>)._blockKey === 'string') return [];
    const incoming = flow.edges.filter((e) => e.target === conditionId && !backEdgeIds.has(e.id));
    if (incoming.length !== 1 || incoming[0].sourceHandle !== 'true') return [];
    const parent = this.getNode(flow, incoming[0].source);
    if (parent?.type !== 'condition') return [];
    const parentTrue = flow.edges.filter(
      (e) => e.source === parent.id && e.sourceHandle === 'true'
    );
    if (parentTrue.length !== 1) return [];
    const parentElse = this.andMemberFalseTargets(flow, parent.id, seen);
    const reaches = (from: string): boolean => {
      const visited = new Set<string>();
      const queue = [from];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (id === conditionId) return true;
        // Never through the parent: an else that loops back to an
        // enclosing loop's head reaches B only by going around the loop
        // through A, which doesn't make B a meeting point.
        if (visited.has(id) || id === parent.id) continue;
        visited.add(id);
        for (const e of flow.edges)
          if (e.source === id && !backEdgeIds.has(e.id)) queue.push(e.target);
      }
      return false;
    };
    return parentElse.some(reaches) ? [] : parentElse;
  }

  /**
   * Bug #23 (2026-09-26): YamlParser wires a `repeat: count` loop as
   * init(counter = 0) -> body -> increment -> test(counter < N), with the
   * test's true edge looping back to the INIT node. That edge means "run
   * the body again" -- NativeStrategy and extractFromGraph.ts both read it
   * that way (it gives a body that opens with a `parallel:` a single
   * loop-back target). Rendered literally here, every iteration re-ran
   * `counter = 0` and the loop never finished. So when `targetId` is the
   * init node of the count loop whose test is `node`, the real targets are
   * the init node's own successors (the body entry, or every branch of an
   * opening `parallel:`). Returns null for any other edge.
   * extractStateMachineFromGraph.ts applies the same rule independently.
   */
  private countLoopRepeatTargets(
    flow: FlowGraph,
    node: ConditionNode,
    targetId: string
  ): string[] | null {
    const data = node.data as Record<string, unknown>;
    if (data.condition !== 'template' || typeof data.value_template !== 'string') return null;
    const counter = data.value_template.match(/(_repeat_counter_[A-Za-z0-9_]+)\s*<\s*\d+/)?.[1];
    if (!counter) return null;
    const target = this.getNode(flow, targetId);
    if (target?.type !== 'set_variables') return null;
    const vars = (target.data as Record<string, unknown>).variables as
      | Record<string, unknown>
      | undefined;
    if (!vars || Object.keys(vars).length !== 1 || vars[counter] !== 0) return null;
    return this.getOutgoingEdges(flow, targetId).map((e) => e.target);
  }

  private generateConditionBlock(
    flow: FlowGraph,
    node: ConditionNode,
    edges: FlowEdge[]
  ): Record<string, unknown> {
    // Each side of the branch can independently fan out to 2+ targets (an
    // `if:` whose `then:` -- or `else:` -- is itself a `parallel:` block)
    // -- see buildFanOutFromTargets' doc comment for bug #9, found via
    // empirical audit 2026-09-06. Handled as two separate fan-out
    // resolutions rather than one, since the true and false paths can
    // reconverge at different (or no) points.
    const trueEdges = edges.filter((e) => e.sourceHandle === 'true');
    const falseEdges = edges.filter((e) => e.sourceHandle === 'false');
    const trueTargets = trueEdges.flatMap(
      (e) => this.countLoopRepeatTargets(flow, node, e.target) ?? [e.target]
    );
    const trueFanOut = this.buildFanOutFromTargets(flow, trueTargets);
    const falseTargets =
      falseEdges.length > 0
        ? falseEdges.map((e) => e.target)
        : this.andMemberFalseTargets(flow, node.id);
    const falseFanOut = this.buildFanOutFromTargets(flow, falseTargets);
    // Recorded as the node's own edges: for a count loop's test that's the
    // edge back to the loop's init node (the graph convention), not the
    // init node's successors it's rendered as. An AND-list member's
    // inherited else is recorded as is: reopened, it becomes an explicit
    // false edge to the same place (which the decompiler then drops again).
    this.recordFanOut(
      `${node.id}:true`,
      trueEdges.map((e) => e.target),
      trueFanOut.extraSteps
    );
    this.recordFanOut(`${node.id}:false`, falseTargets, falseFanOut.extraSteps);
    const trueTarget = trueFanOut.nextNode;
    const falseTarget = falseFanOut.nextNode;
    const currentNodeId = node.id;

    // Always use a native HA condition inside a real if/then/else — each
    // branch assigns current_node a plain string. This used to be
    // conditional: a "needsNativeConditionCheck" helper only took this path
    // for template conditions containing raw {% %} statements; every other
    // "simple" condition type (state/numeric_state/time/sun/...) went
    // through a hand-rolled buildConditionTemplate re-implementation
    // instead and got inlined as a single Jinja ternary —
    // `current_node: "{% if X %}A{% else %}B{% endif %}"`.
    // That was broken two ways: (1) YamlParser.ts's state-machine parser
    // reads each choose-case's current_node target as a literal string, so
    // a templated ternary value can't be reconstructed at all — the node
    // ends up with no outgoing edge and everything downstream is orphaned
    // on reopen (confirmed via a real user automation: cascading "not
    // connected to any trigger" validation errors after every reopen). (2)
    // buildConditionTemplate's per-type re-implementations are themselves
    // unreliable — e.g. buildSunCondition only recognizes two narrow
    // after/before combinations and silently falls back to the literal
    // string 'true' for anything else, making that branch always execute
    // regardless of the real sun state. buildNativeCondition below instead
    // emits a genuine `condition: sun`/`condition: time`/etc. object and
    // lets HA's own condition evaluator run it — correct by construction,
    // and always reparseable since each branch's current_node is a plain
    // string.
    const condition = this.buildNativeCondition(node);

    return {
      conditions: [
        {
          condition: 'template',
          value_template: `{{ current_node == "${currentNodeId}" }}`,
        },
      ],
      sequence: [
        {
          alias: node.data.alias,
          if: [condition],
          then: [
            ...trueFanOut.extraSteps,
            {
              variables: {
                current_node: trueTarget,
              },
            },
          ],
          else: [
            ...falseFanOut.extraSteps,
            {
              variables: {
                current_node: falseTarget,
              },
            },
          ],
        },
      ],
    };
  }

  /**
   * Build native HA condition object for use in if/then/else
   *
   * Rewritten (2026-09-06, StateMachineStrategy audit) to reuse
   * NativeStrategy's own spread-based mapCondition approach (via the
   * now-exported stripDottedOnlyConditionFields helper) instead of the
   * hand-rolled field-by-field allowlist this function used before. That
   * allowlist had already needed two prior patches for exactly the same
   * failure mode -- a real HA condition field silently missing because it
   * wasn't in the list (`target`/`options` for purpose-specific dotted
   * conditions, both at the top level and again for nested and/or-group
   * conditions) -- and a third instance was found via direct source
   * comparison against NativeStrategy during this audit: `enabled` was
   * never copied at all, at either level. HA's own docs
   * (https://www.home-assistant.io/docs/scripts/conditions/, verified via
   * fetch during this audit rather than assumed) confirm `enabled: false`
   * on a condition is a real, documented, behaviorally significant field
   * ("A disabled condition will behave as if it were removed"), not an
   * internal-only one. Rather than patch in `enabled` as a fourth one-off
   * fix, this now spreads `...rest` the same way
   * NativeStrategy.buildCondition's own local mapCondition does, so any
   * other current or future HA condition field (e.g. a `for:` duration on
   * a state/numeric_state condition, also missing from the old allowlist
   * and only now noticed because of this rewrite) rides along
   * automatically and this whole bug class can't recur here.
   */
  private buildNativeCondition(node: ConditionNode): Record<string, unknown> {
    const stripInternal = this.stripInternalFields.bind(this);

    // This function is only ever called (from generateConditionBlock,
    // this class's sole call site) for a condition node's own top-level
    // gate condition -- there is no state-machine equivalent of
    // NativeStrategy's separate choose/repeat_while/repeat_until
    // block-gate cases, since every condition node here compiles to its
    // own dispatcher `if:` step. generateConditionBlock always attaches
    // `node.data.alias` to that wrapping step itself (`sequence: [{
    // alias: node.data.alias, if: [condition], ... }]`), so the top-level
    // condition object built here must never also carry `alias` --
    // otherwise a single user-set label would be duplicated onto both the
    // if-step and the nested condition object (the same class of bug
    // NativeStrategy.buildCondition's suppressGateAlias guards against for
    // its own, differently-shaped, block-gate case). A genuinely nested
    // condition -- inside its own `conditions: [...]` and/or group,
    // recursed into below -- keeps its own alias untouched, matching
    // NativeStrategy's mapCondition's identical behavior for that case
    // (and matching this function's own prior behavior, which always
    // copied a nested condition's alias but never the top-level one).
    function mapCondition(data: Record<string, unknown>, isTopLevel: boolean): Record<string, unknown> {
      if (!data || typeof data !== 'object') return data;
      const { condition, conditions, alias, template, ...rest } = stripInternal(data);
      const out: Record<string, unknown> = {
        condition,
        ...stripDottedOnlyConditionFields(condition, rest),
        ...(alias && !isTopLevel ? { alias } : {}),
      };
      if (condition === 'template' && !rest.value_template && template) {
        out.value_template = template;
      }
      if (Array.isArray(conditions) && conditions.length > 0) {
        out.conditions = (conditions as Record<string, unknown>[])
          .map((c) => mapCondition(c, false))
          .filter((c) => c && (!Array.isArray(c.conditions) || (c.conditions as unknown[]).length > 0));
      }
      // Normalize id: ["x"] -> "x" -- HA API sometimes returns trigger
      // condition ids as single-element arrays (same normalization as
      // NativeStrategy.buildCondition's mapCondition).
      if (Array.isArray(out.id) && (out.id as unknown[]).length === 1) {
        out.id = (out.id as unknown[])[0];
      }
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
    }

    return mapCondition(node.data, true);
  }

  /**
   * Generate block for delay node
   */
  private generateDelayBlock(
    flow: FlowGraph,
    node: DelayNode,
    edges: FlowEdge[]
  ): Record<string, unknown> {
    const { extraSteps, nextNode } = this.buildFanOutContinuation(flow, node, edges);
    const currentNodeId = node.id;

    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped -- HA's action-step schemas don't support it, only
    // triggers do (see NativeStrategy.buildDelay's identical handling).
    // Found via the StateMachineStrategy audit (2026-09-06): this used to
    // re-add `id` below, producing an `id` key HA rejects on any delay
    // node that happened to carry one.
    const { alias, delay, id: _id, ...extraProps } = this.stripInternalFields(node.data);
    const delayAction: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      delay,
    };

    return {
      conditions: [
        {
          condition: 'template',
          value_template: `{{ current_node == "${currentNodeId}" }}`,
        },
      ],
      sequence: [
        delayAction,
        ...extraSteps,
        {
          variables: {
            current_node: nextNode,
          },
        },
      ],
    };
  }

  /**
   * Generate block for wait node
   */
  private generateWaitBlock(
    flow: FlowGraph,
    node: WaitNode,
    edges: FlowEdge[]
  ): Record<string, unknown> {
    const { extraSteps, nextNode } = this.buildFanOutContinuation(flow, node, edges);
    const currentNodeId = node.id;

    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped -- HA's action-step schemas don't support it, only
    // triggers do (see NativeStrategy.buildWait's identical handling).
    const {
      alias,
      id: _id,
      wait_template,
      wait_for_trigger,
      timeout,
      continue_on_timeout,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const waitAction: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
    };

    if (wait_template) {
      waitAction.wait_template = wait_template;
    } else if (wait_for_trigger) {
      waitAction.wait_for_trigger = wait_for_trigger.map((triggerData) => {
        const { alias: _alias, ...rest } = triggerData;
        const trigger: Record<string, unknown> = { ...rest };
        return this.cleanTriggerFields(this.foldEventContextUserId(trigger));
      });
    }

    // See BaseStrategy.hasMeaningfulDuration's doc comment — a literal
    // all-zero timeout means "give up instantly" in HA, not "no limit", so
    // it must be omitted the same as an unset timeout rather than written
    // verbatim.
    if (this.hasMeaningfulDuration(timeout)) {
      waitAction.timeout = timeout;
    }

    if (continue_on_timeout !== undefined) {
      waitAction.continue_on_timeout = continue_on_timeout;
    }

    return {
      conditions: [
        {
          condition: 'template',
          value_template: `{{ current_node == "${currentNodeId}" }}`,
        },
      ],
      sequence: [
        waitAction,
        ...extraSteps,
        {
          variables: {
            current_node: nextNode,
          },
        },
      ],
    };
  }

  /**
   * Generate block for set_variables node
   */
  private generateSetVariablesBlock(
    flow: FlowGraph,
    node: SetVariablesNode,
    edges: FlowEdge[]
  ): Record<string, unknown> {
    const { extraSteps, nextNode } = this.buildFanOutContinuation(flow, node, edges);
    const currentNodeId = node.id;

    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped -- HA's action-step schemas don't support it, only
    // triggers do (see NativeStrategy.buildSetVariables's identical handling).
    const { alias, id: _id, variables, ...extraProps } = this.stripInternalFields(node.data);
    const setVarsAction: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      variables,
    };

    if (alias) {
      setVarsAction.alias = alias;
    }

    return {
      conditions: [
        {
          condition: 'template',
          value_template: `{{ current_node == "${currentNodeId}" }}`,
        },
      ],
      sequence: [
        setVarsAction,
        ...extraSteps,
        {
          variables: {
            current_node: nextNode,
          },
        },
      ],
    };
  }

  /**
   * Generate passthrough block for unknown node types
   */
  private generatePassthroughBlock(
    flow: FlowGraph,
    node: FlowNode,
    edges: FlowEdge[]
  ): Record<string, unknown> {
    const { extraSteps, nextNode } = this.buildFanOutContinuation(flow, node, edges);
    const currentNodeId = node.id;

    return {
      conditions: [
        {
          condition: 'template',
          value_template: `{{ current_node == "${currentNodeId}" }}`,
        },
      ],
      sequence: [
        ...extraSteps,
        {
          variables: {
            current_node: nextNode,
          },
        },
      ],
    };
  }

  /**
   * Detect if the flow could potentially run forever
   */
  private detectPotentialInfiniteLoop(flow: FlowGraph, analysis: TopologyAnalysis): string | null {
    if (!analysis.hasCycles) {
      return null;
    }

    // Check if all cycles have a condition that could break them
    // This is a simple heuristic - we check if there's at least one condition in the flow
    const hasConditions = flow.nodes.some((n) => n.type === 'condition');

    if (!hasConditions) {
      return (
        'Warning: This flow contains cycles but no conditions. ' +
        'This could result in an infinite loop. Consider adding a condition to break the cycle.'
      );
    }

    return (
      'Note: This flow contains cycles. Ensure your conditions can eventually evaluate to ' +
      'break the cycle, or the automation may run indefinitely.'
    );
  }
}
