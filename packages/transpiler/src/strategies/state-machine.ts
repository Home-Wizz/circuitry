import type { ConditionNode, FlowEdge, FlowGraph, FlowNode, TriggerNode } from '@circuitry/shared';
import { isStartNode } from '@circuitry/shared';
import { counterVariableOf } from '../analyzer/count-loop';
import { branchMachineRegion, untilExit } from '../analyzer/loops';
import { findBackEdges, type TopologyAnalysis } from '../analyzer/topology';
import {
  branchMachineName,
  branchMachineSteps,
  branchNames,
  endOutside,
  MAIN_NAMES,
  renameMachineVariables,
} from '../utils/branchMachine';
import { fanOutHash } from '../utils/fanOutHash';
import { noStepsStop } from '../utils/stateMachineEntry';
import {
  beforeMovesInto,
  loopLimitStep,
  loopRoundsStep,
  loopRoundsVar,
  RUN_ALIAS,
  RUN_CHUNK,
} from '../utils/stateMachineLoops';
import { GraphClaimError } from '../utils/theOnly';
import { BaseStrategy, bareParallelBranch, type HAYamlOutput } from './base';
import { classifyLoopBackEdge, NativeStrategy } from './native';

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
/** The dispatcher's fixed `default:` (an unknown state logs and ends),
 * for the machine whose state is in `node` (#284: a branch machine's own). */
function dispatchDefault(node: string = MAIN_NAMES.node): unknown[] {
  return [
    {
      // `action`, not the old `service`: HA renames `service` to `action`
      // in the config it is sent while checking it, and stores that, so
      // the save never read back as sent (bug #280).
      action: 'system_log.write',
      data: {
        message: `Circuitry: Unknown state "{{ ${node} }}", ending flow`,
        level: 'warning',
      },
    },
    { variables: { [node]: 'END' } },
  ];
}

/** A drawn loop's round count (#157): see StateMachineStrategy.loopBudgets. */
interface LoopBudget {
  index: number;
  head: string;
  region: string[];
  /** Where the check goes: the head, or a while loop's list end. */
  checkAt: string;
  whileTest: boolean;
  /** #292: a while loop whose round is on its test's "no" side (#263's
   * shape, `while: [not C]`): the check goes before each move into the
   * loop's body from these tests (its list), not on their "yes" side --
   * the way out. */
  noSide?: { tests: string[]; bodyEntries: string[] };
}

export class StateMachineStrategy extends BaseStrategy {
  readonly name = 'state-machine';
  readonly description =
    'Generates state machine YAML for complex flows with cycles or cross-links';

  // Lazily constructed, reused for the lifetime of this strategy instance.
  // Every method called on it (findConvergenceSetForBranches,
  // buildParallelBranchesForTargets) does its own
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
    // A branch machine's own copy of a state (#284) isn't the state's: the
    // dispatcher's state is the one a reopen reads.
    if (this.machineRegions.length > 0) return;
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
    const budgets = this.loopBudgets(flow);
    const nodeBlocks = flow.nodes
      .filter((n) => n.type !== 'trigger' && n.type !== 'start')
      .map((node) => this.withLoopBookkeeping(this.generateNodeBlock(flow, node), node, budgets));

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
    const triggerCount = flow.nodes.filter((n) => n.type === 'trigger').length;
    const entryNodeExpr = this.generateEntryNodeExpression(triggerRouting, triggerCount);
    // A trigger with nothing joined starts at END: stop before the loop
    // (bug #195; see stateMachineEntry.ts).
    const someTriggerHasNoSteps = triggerRouting.size < triggerCount;

    // Build the action sequence for the state machine
    // In HA automations, actions are a flat list - we use:
    // 1. A variables action to initialize state
    // 2. A repeat action with choose dispatcher
    const dispatch = {
      choose: chooseBlocks,
      default: dispatchDefault(),
    };
    // HA stops a `repeat: while/until` after 10,000 rounds and never stops
    // a `repeat: count`. With a loop in the graph, each drawn loop keeps its
    // own rounds (`loop_rounds_N`, counted at its head from the state that
    // ran before, `prev_node`) and stops the run as HA would stop that loop;
    // the dispatch loop runs in chunks under HA's limit, so it never stops
    // a run itself (#157; #129 counted passes of the whole automation, which
    // loops inside loops shared, and stopped count loops too).
    const hasLoops = findBackEdges(flow).size > 0;
    const actionSequence: Record<string, unknown>[] = [
      // Initialize the state machine variables
      {
        variables: {
          current_node: entryNodeExpr,
          flow_context: {},
          ...(hasLoops
            ? {
                prev_node: '',
                this_node: '',
                run_rounds: 0,
                ...Object.fromEntries(budgets.map((b) => [loopRoundsVar(b.index), 0])),
              }
            : {}),
        },
      },
      ...(someTriggerHasNoSteps ? [noStepsStop()] : []),
      // The main execution loop
      {
        alias: 'State Machine Loop',
        repeat: {
          until: '{{ current_node == "END" }}',
          sequence: hasLoops
            ? [
                { variables: { run_rounds: 0 } },
                {
                  alias: RUN_ALIAS,
                  repeat: {
                    until: `{{ current_node == "END" or run_rounds >= ${RUN_CHUNK} }}`,
                    sequence: [
                      {
                        variables: {
                          prev_node: '{{ this_node }}',
                          this_node: '{{ current_node }}',
                          run_rounds: '{{ run_rounds + 1 }}',
                        },
                      },
                      dispatch,
                    ],
                  },
                },
              ]
            : [dispatch],
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
   * Build a mapping from trigger index to target action node(s)
   * Returns a Map where key = trigger index, value = array of target node IDs
   * When a trigger has multiple targets, they should execute in parallel
   */
  /** The node trigger `idx`'s run starts at (buildTriggerRouting's
   * numbering: the trigger nodes in order, or the start node when there
   * are none), as the entry to read loops from (#282). */
  private triggerEntry(flow: FlowGraph, idx: number): string[] {
    const triggers = flow.nodes.filter((n) => n.type === 'trigger');
    const node = triggers.length > 0 ? triggers[idx] : flow.nodes.find(isStartNode);
    return node ? [node.id] : [];
  }

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
   *
   * A trigger with nothing joined to it does nothing, as on the canvas: it
   * routes to END. Left out, it started wherever the other triggers did, or
   * fell into the template's `{% else %}` (bug #195).
   */
  private generateEntryNodeExpression(
    triggerRouting: Map<number, string[]>,
    triggerCount: number
  ): string {
    // Convert to effective entry points (handling parallel branches)
    const effectiveEntries = new Map<number, string>();
    for (const [idx, targets] of triggerRouting) {
      effectiveEntries.set(idx, this.getEffectiveEntryPoint(idx, targets));
    }
    for (let idx = 0; idx < triggerCount; idx++) {
      if (!effectiveEntries.has(idx)) effectiveEntries.set(idx, 'END');
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
      // Read from this trigger (#282): a loop another trigger joins
      // elsewhere is read from where this trigger's run joins it.
      const entries = this.triggerEntry(flow, idx);
      const convergenceSet = nativeSubBuilder.findConvergenceSetForBranches(flow, targets, entries);
      const convergenceBoundSet = this.fanOutBound(flow, targets, convergenceSet, entries);

      // Build parallel action calls for all target nodes.
      //
      // When the branches reconverge, every branch -- action or otherwise --
      // must stop exactly at the convergence boundary, so its own
      // continuation isn't duplicated inline AND skipped via the
      // current_node jump below. With no shared continuation, the branches
      // genuinely end independently, and each is inlined as its own
      // self-contained native action sequence (the exact tree-walker the
      // plain-tree generator uses): nothing downstream of it needs the
      // shared current_node state, since this block jumps current_node to
      // 'END' once every branch finishes.
      //
      // History: an action branch used to be rendered as just its own
      // service call, dropping whatever followed it in the branch (item 4,
      // 2026-09-26); other kinds of branch (condition, delay, wait, a whole
      // Choose/If/Else chain, ...) used to become a throwaway
      // `system_log.write` placeholder and an immediate jump to END -- the
      // "Template placeholder" reports.
      //
      // Branches that meet again before the boundary when not all of them
      // do are one branch, a parallel of their own followed by where they
      // meet (#99, NativeStrategy.buildParallelBranches).
      const parallelActions = this.branchGroups(
        flow,
        targets,
        convergenceBoundSet,
        entries[0],
        entries
      ).map(({ targets: branchTargets, steps }) =>
        this.parallelBranchStep(flow, branchTargets, steps)
      );

      // 2+ sibling convergence nodes (bug #12): current_node must stay a
      // single scalar dispatch value, so the second-level fan-out among
      // the siblings is delegated to buildFanOutFromTargets (already fixed
      // above to recurse correctly on arbitrary further nesting) and its
      // extraSteps are inlined directly into this same state's sequence,
      // right after the first parallel block.
      const extraSequenceSteps: unknown[] = [];
      let resolvedNextNode: string = convergenceSet[0] ?? 'END';
      if (convergenceSet.length > 1) {
        const inner = this.buildFanOutFromTargets(flow, convergenceSet, [], entries[0]);
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
      .map((node) => this.buildTrigger(node));
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
        return this.generateStepBlock(flow, node, outgoingEdges, [this.buildActionCall(node)]);
      case 'delay':
        return this.generateStepBlock(flow, node, outgoingEdges, [this.buildDelay(node)]);
      case 'wait':
        return this.generateStepBlock(flow, node, outgoingEdges, [this.buildWait(node)]);
      case 'set_variables':
        return this.generateStepBlock(flow, node, outgoingEdges, [this.buildSetVariables(node)]);
      default:
        // A join (a transparent convergence marker -- see the
        // mid-flow-fan-out warning emitted in generate() for this
        // strategy's one known limitation here) or any other passthrough.
        return this.generateStepBlock(flow, node, outgoingEdges, []);
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
    // Every edge of a step counts, whatever handle it carries:
    // a step has no true/false outcome, so an edge that carries one
    // anyway (a hand-edited graph) is just another branch. Such a fan-out
    // used to continue down the first edge only; native and both checkers
    // read it as the fan-out it is. (Conditions never get here.)
    if (edges.length < 2) {
      return { extraSteps: [], nextNode: edges[0]?.target ?? 'END' };
    }

    const targets = edges.map((e) => e.target);
    const backEdgeIds = findBackEdges(flow);
    const result = this.buildFanOutFromTargets(
      flow,
      targets,
      edges.filter((e) => backEdgeIds.has(e.id)).map((e) => e.target),
      node.id
    );
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
   * ways out are dead ends or back-edges to one and the same node; with
   * back-edges to two, the graph is refused (#285).
   */
  /** #285: branches of one fan-out going back round two different loops. */
  private twoLoopsReason(flow: FlowGraph, source?: string): string {
    return (
      `the branches of a parallel${source ? ` after "${this.stepName(flow, source)}"` : ''} ` +
      'go back round two different loops, so each would go round on its own, which ' +
      "Home Assistant can't run. Lead the branches back to one step (through a Join, so " +
      'the next round starts once both have finished), or move one of ' +
      'them out of the loop'
    );
  }

  private findLoopBackConvergence(
    flow: FlowGraph,
    targetIds: string[],
    source?: string
  ): string | null {
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
    let roundsAlways = false;
    let roundsSometimes: string | undefined;

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
      // Whether the branch goes back round, and on every path or only some.
      const goesRoundFrom = [...reachable].find((nodeId) =>
        this.getOutgoingEdges(flow, nodeId).some(
          (e) => backEdgeIds.has(e.id) && !reachable.has(e.target)
        )
      );
      // A list member with no "no" line of its own goes where its list's
      // head does (andMemberFalseTargets, as this strategy writes it): the
      // head is in the branch too, so its lines are counted already. Read
      // as a path end, an AND-list in a parallel branch inside a loop was
      // refused (#325).
      const ends = [...reachable].some((nodeId) => {
        const out = this.getOutgoingEdges(flow, nodeId);
        if (out.length === 0) return true;
        const node = flow.nodes.find((n) => n.id === nodeId);
        if (node?.type !== 'condition') return false;
        const hasNo =
          out.some((e) => e.sourceHandle === 'false') ||
          this.andMemberFalseTargets(flow, nodeId).length > 0;
        return !(out.some((e) => e.sourceHandle === 'true') && hasNo);
      });
      if (goesRoundFrom !== undefined) {
        if (ends) roundsSometimes ??= goesRoundFrom;
        else roundsAlways = true;
      }
      for (const nodeId of reachable) {
        for (const e of this.getOutgoingEdges(flow, nodeId)) {
          if (!backEdgeIds.has(e.id) || reachable.has(e.target)) continue;
          if (loopTarget !== null && loopTarget !== e.target) {
            // #285: two branches each going round a loop of their own go on
            // separately, each round of one starting the other again (the
            // canvas's graph walk): no automation runs that. Written as a
            // parallel ending the run, it stopped where the canvas goes round.
            throw new GraphClaimError(this.twoLoopsReason(flow, source));
          }
          loopTarget = e.target;
        }
      }
    }

    // Branches that go back round only on some paths, none on every path:
    // the round waits for them, but whether it comes depends on those
    // branches -- written as every round going on, the loop never ended
    // where the canvas's does (#134's loops, saved since #284 until the run
    // check compared runs the YAML never finishes, #285).
    if (loopTarget !== null && !roundsAlways && roundsSometimes !== undefined) {
      throw new GraphClaimError(
        `a branch of a parallel${source ? ` after "${this.stepName(flow, source)}"` : ''} goes ` +
          `back round its loop only on some paths (from "${this.stepName(flow, roundsSometimes)}"), ` +
          "and no branch always does, in a way the flags for that (one per branch) can't be written for: " +
          'its branches meet, another path leads into them, or one goes round on a test\'s "no"'
      );
    }
    return loopTarget;
  }

  /** A step as the person sees it: its name, or its id. */
  private stepName(flow: FlowGraph, id: string): string {
    return String(flow.nodes.find((n) => n.id === id)?.data.alias ?? id);
  }

  /**
   * Drops any target that some OTHER target in the same list can reach
   * (forward, one-way) without being reachable back -- see
   * buildFanOutFromTargets' doc comment for why this is needed. Mutually
   * reachable targets (a shared loop) are left alone, since neither
   * one-way-dominates the other there.
   */
  private filterIndependentFanOutTargets(
    flow: FlowGraph,
    targetIds: string[],
    /** The step that fans out: reaching a target through it is its next
     * pass, not a shortcut (#285). */
    source?: string
  ): string[] {
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
        if (visited.has(id) || id === source) continue;
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

  /**
   * Bug #267: among a fan-out's targets, the one where the flow carries on
   * -- a step other paths also lead to (a meeting point), or a loop's test
   * at its end -- when no other target gets there; null when there isn't
   * exactly one. extractStateMachineFromGraph.ts reads it the same way.
   */
  private carryOnTarget(flow: FlowGraph, targetIds: string[]): string | null {
    const backEdgeIds = findBackEdges(flow);
    const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const reaches = (fromId: string, toId: string): boolean => {
      const seen = new Set<string>();
      const queue = [fromId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (id === toId) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of lines) if (e.source === id && !backEdgeIds.has(e.id)) queue.push(e.target);
      }
      return false;
    };
    const nodeOf = (id: string) => flow.nodes.find((n) => n.id === id);
    // A loop's own test at its end (a do-while, an until, a count loop):
    // not a choose case or an if going back to an enclosing while's head.
    const testAtEnd = (id: string) => {
      const node = nodeOf(id);
      return lines.some((e) => {
        const head = nodeOf(e.target);
        if (e.source !== id || !backEdgeIds.has(e.id) || !node || !head) return false;
        const kind = classifyLoopBackEdge(node, head, e.sourceHandle);
        return kind === 'do-while' || kind === 'until' || kind === 'count';
      });
    };
    const carries = (id: string) =>
      lines.filter((e) => e.target === id && !backEdgeIds.has(e.id)).length > 1 || testAtEnd(id);
    const found = targetIds.filter(
      (id) => carries(id) && !targetIds.some((other) => other !== id && reaches(other, id))
    );
    if (found.length !== 1) return null;
    // A target that goes back round a loop from outside its own steps is
    // the way the flow carries on itself (a while's body beside a meeting
    // point): not a branch beside.
    const region = (start: string) => {
      const seen = new Set<string>();
      const queue = [start];
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of lines) if (e.source === id && !backEdgeIds.has(e.id)) queue.push(e.target);
      }
      return seen;
    };
    const goesRound = (id: string) => {
      const own = region(id);
      return lines.some((e) => backEdgeIds.has(e.id) && own.has(e.source) && !own.has(e.target));
    };
    return targetIds.some((id) => id !== found[0] && goesRound(id)) ? null : found[0];
  }

  /**
   * #267: the targets whose every way on ends without getting anywhere
   * else goes -- no step other lines also lead to, no loop's test, no line
   * back round a loop. extractStateMachineFromGraph.ts reads it the same
   * way.
   */
  private endingAlone(flow: FlowGraph, targetIds: string[]): string[] {
    const backEdgeIds = findBackEdges(flow);
    const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const forwardIn = (id: string) =>
      lines.filter((e) => e.target === id && !backEdgeIds.has(e.id)).length;
    const endsAlone = (start: string): boolean => {
      const seen = new Set<string>();
      const queue = [start];
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (forwardIn(id) > 1) return false;
        for (const e of lines) {
          if (e.source !== id) continue;
          if (backEdgeIds.has(e.id)) return false;
          queue.push(e.target);
        }
      }
      return true;
    };
    return targetIds.filter(endsAlone);
  }

  /**
   * #99: whether `meeting` is where these branches meet on their own --
   * nothing else leads into them or into it -- so it runs once after them,
   * inside the parallel beside the others (not waiting for those). When
   * something else also leads there (an enclosing if's paths meeting) the
   * branches beside are waited for (#267).
   * extractStateMachineFromGraph.ts reads it the same way.
   */
  private theirOwnMeeting(flow: FlowGraph, branches: string[], meeting: string): boolean {
    const backEdgeIds = findBackEdges(flow);
    const lines = flow.edges.filter(
      (e) => e.type !== 'hint' && e.type !== 'choose-hint' && !backEdgeIds.has(e.id)
    );
    const region = new Set<string>();
    const queue = [...branches];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (region.has(id) || id === meeting) continue;
      region.add(id);
      for (const e of lines) if (e.source === id) queue.push(e.target);
    }
    const sources = new Set(
      lines.filter((e) => branches.includes(e.target) && !region.has(e.source)).map((e) => e.source)
    );
    if (sources.size !== 1) return false;
    return [...region, meeting].every((id) =>
      lines.every((e) => e.target !== id || region.has(e.source) || sources.has(e.source))
    );
  }

  /**
   * #340: one target gone back to round a loop, and a step beside it (on
   * its forward lines) that goes back round to another step of that loop.
   */
  private besideGoesRoundElsewhere(
    flow: FlowGraph,
    targetIds: string[],
    goesRound: string[]
  ): boolean {
    const round = [...new Set(goesRound.filter((t) => targetIds.includes(t)))];
    if (round.length !== 1) return false;
    const sides = targetIds.filter((t) => t !== round[0]);
    if (sides.length === 0) return false;
    const backEdgeIds = findBackEdges(flow);
    const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const reach = (starts: string[]) => {
      const seen = new Set<string>();
      const queue = [...starts];
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of lines) if (e.source === id && !backEdgeIds.has(e.id)) queue.push(e.target);
      }
      return seen;
    };
    const beside = reach(sides);
    const loop = reach([round[0]]);
    return lines.some(
      (e) =>
        backEdgeIds.has(e.id) &&
        beside.has(e.source) &&
        e.target !== round[0] &&
        loop.has(e.target) &&
        !beside.has(e.target)
    );
  }

  /**
   * #265: one target gone back to round a loop, the others steps beside it
   * that lead nowhere the loop does (their own region); null otherwise.
   * extractStateMachineFromGraph.ts reads it the same way.
   */
  private stepsBesideGoingRound(
    flow: FlowGraph,
    targetIds: string[],
    goesRound: string[]
  ): { round: string; sides: string[] } | null {
    const round = [...new Set(goesRound.filter((t) => targetIds.includes(t)))];
    if (round.length !== 1) return null;
    const sides = [...new Set(targetIds.filter((t) => t !== round[0]))];
    if (sides.length === 0) return null;
    const backEdgeIds = findBackEdges(flow);
    const lines = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const reach = (starts: string[]) => {
      const seen = new Set<string>();
      const queue = [...starts];
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of lines) if (e.source === id && !backEdgeIds.has(e.id)) queue.push(e.target);
      }
      return seen;
    };
    const beside = reach(sides);
    const loop = reach([round[0]]);
    // The steps beside don't lead back into the loop.
    for (const e of lines) {
      if (beside.has(e.source) && loop.has(e.target) && !beside.has(e.target)) return null;
    }
    return { round: round[0], sides };
  }

  private buildFanOutFromTargets(
    flow: FlowGraph,
    rawTargetIds: string[],
    /** Targets the node goes back to round a loop (#265). */
    goesRound: string[] = [],
    /** The step that fans out (#284: a branch that goes round back to it
     * isn't a branch machine). */
    source?: string
  ): { extraSteps: unknown[]; nextNode: string } {
    // #284: inside a branch machine, a line out of the branch is where it
    // ends, not a branch of this fan-out.
    rawTargetIds = this.inMachine(rawTargetIds);
    goesRound = this.inMachine(goesRound);
    // #306: lines of one fan-out going back round to two different steps
    // (an outer loop's start and an inner one's, or the step itself): each
    // round would go on on its own (#285). The shortcut filter below took
    // one for a step the other reaches, and the line was lost.
    if (new Set(goesRound).size >= 2) throw new GraphClaimError(this.twoLoopsReason(flow, source));
    // #265: a line back round a loop beside steps of their own: they run
    // first, as steps of this state, then the loop goes round (the next
    // round waits for them). The shortcut filter below took them for steps
    // the loop reaches, and dropped them.
    // #340: a step beside the way round whose own line goes back round to
    // another step of the loop starts a second round beside the first:
    // each would go on on its own (#285, #306), as with two lines back.
    if (this.besideGoesRoundElsewhere(flow, rawTargetIds, goesRound))
      throw new GraphClaimError(this.twoLoopsReason(flow, source));
    const besideRound = this.stepsBesideGoingRound(flow, rawTargetIds, goesRound);
    if (besideRound !== null) {
      const groups = this.branchGroups(flow, besideRound.sides, null, source);
      const extraSteps =
        groups.length === 1
          ? groups[0].steps
          : [
              {
                parallel: groups.map(({ targets: branchTargets, steps }) =>
                  this.parallelBranchStep(flow, branchTargets, steps)
                ),
              },
            ];
      return { extraSteps, nextNode: besideRound.round };
    }
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
    const targetIds = this.filterIndependentFanOutTargets(flow, rawTargetIds, source);

    if (targetIds.length === 0) {
      return { extraSteps: [], nextNode: 'END' };
    }
    if (targetIds.length === 1) {
      return { extraSteps: [], nextNode: targetIds[0] };
    }

    // Bug #267: a line to where the flow carries on -- a meeting point, a
    // loop's test at its end -- beside branches that don't get there: the
    // branches run first, as steps of this state, then the flow carries on
    // there (what follows waits for them). They used to run in a parallel
    // with the meeting point's steps inlined, so a Stop in one came after.
    const carry = this.carryOnTarget(flow, targetIds);
    if (carry !== null) {
      const sides = targetIds.filter((id) => id !== carry);
      const groups = this.branchGroups(flow, sides, this.fanOutBound(flow, sides, [carry]), source);
      const extraSteps =
        groups.length === 1
          ? groups[0].steps
          : [
              {
                parallel: groups.map(({ targets: branchTargets, steps }) =>
                  this.parallelBranchStep(flow, branchTargets, steps)
                ),
              },
            ];
      return { extraSteps, nextNode: carry };
    }

    // #267, the same with several branches going on together: branches
    // that end on their own beside branches that meet somewhere. They run
    // alongside those, and where those meet waits for them (written as one
    // parallel, then the meeting point). They used to share no meeting point
    // with the rest, so everything was inlined, a loop's test with it.
    const alone = this.endingAlone(flow, targetIds);
    const together = targetIds.filter((id) => !alone.includes(id));
    if (alone.length > 0 && together.length >= 2) {
      const rest = this.buildFanOutFromTargets(flow, together, [], source);
      if (
        rest.nextNode !== 'END' &&
        flow.nodes.some((n) => n.id === rest.nextNode) &&
        !this.theirOwnMeeting(flow, together, rest.nextNode)
      ) {
        const groups = this.branchGroups(flow, alone, null, source);
        // The branches in the order they were drawn.
        const at = (ids: string[]) => Math.min(...ids.map((id) => targetIds.indexOf(id)));
        const branches = [
          ...groups.map(({ targets: branchTargets, steps }) => ({
            at: at(branchTargets),
            step: this.parallelBranchStep(flow, branchTargets, steps),
          })),
          { at: at(together), step: this.parallelBranchStep(flow, together, rest.extraSteps) },
        ].sort((a, b) => a.at - b.at);
        return {
          extraSteps: [{ parallel: branches.map((b) => b.step) }],
          nextNode: rest.nextNode,
        };
      }
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
    let boundSet = this.fanOutBound(flow, targetIds, convergenceSet);
    if (convergenceSet.length === 0) {
      const loopBack = this.findLoopBackConvergence(flow, targetIds, source);
      if (loopBack) {
        convergenceSet = [loopBack];
        boundSet = new Set(convergenceSet);
      }
    }

    // Branches that meet again before the boundary when not all of them do
    // are one branch (#99, NativeStrategy.buildParallelBranches).
    const parallelActions = this.branchGroups(flow, targetIds, boundSet, source).map(
      ({ targets: branchTargets, steps }) => this.parallelBranchStep(flow, branchTargets, steps)
    );

    const extraSteps: unknown[] = [{ parallel: parallelActions }];

    if (convergenceSet.length <= 1) {
      return { extraSteps, nextNode: convergenceSet[0] ?? 'END' };
    }

    const inner = this.buildFanOutFromTargets(flow, convergenceSet, [], source);
    extraSteps.push(...inner.extraSteps);
    return { extraSteps, nextNode: inner.nextNode };
  }

  /**
   * Decision D4: where a fan-out's branches stop, given where they meet
   * (`convergenceSet`, forward edges): there, and at anything after it. A
   * branch that runs on into a step after the meeting point, through a
   * step that isn't part of it (P and Q meet at M1, Q also leads to M2, M1
   * and M2 meet at Z), stops at that step, which runs once after the
   * meeting point, as drawn: when it runs on every way on from there.
   * When it doesn't, no tree writes it (the branch runs it, the steps after
   * the meeting point maybe again) and the graph is refused. Each branch
   * used to run on into Z, which ran again after M1.
   */
  private fanOutBound(
    flow: FlowGraph,
    targetIds: string[],
    convergenceSet: string[],
    entries: string[] = []
  ): Set<string> | null {
    if (convergenceSet.length === 0) return null;
    const backEdgeIds = findBackEdges(flow, entries);
    const edgesOut = (id: string) =>
      this.getOutgoingEdges(flow, id).filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const forward = (id: string) =>
      edgesOut(id)
        .filter((e) => !backEdgeIds.has(e.id))
        .map((e) => e.target);
    const after = new Set<string>();
    const queue = [...convergenceSet];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (after.has(id)) continue;
      after.add(id);
      queue.push(...forward(id));
    }
    // The steps after the meeting point the branches run into.
    const cuts = new Set<string>();
    const seen = new Set<string>();
    const walk = [...targetIds];
    while (walk.length > 0) {
      const id = walk.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (after.has(id)) {
        if (!convergenceSet.includes(id)) cuts.add(id);
        continue;
      }
      walk.push(...forward(id));
    }
    for (const cut of cuts) {
      if (!convergenceSet.some((id) => this.alwaysReaches(flow, id, cut, edgesOut, backEdgeIds))) {
        const name = this.stepName(flow, cut);
        throw new GraphClaimError(
          `a branch of a parallel leads to "${name}", which also comes after where the ` +
            `branches meet, but only on some paths from there. Connect the branch to where the ` +
            `branches meet, or make "${name}" run on every path after that point`
        );
      }
    }
    return after;
  }

  /**
   * Whether every way on from `from` runs `target`: a condition needs both
   * its sides to (a side left unwired ends the path), a step with several
   * edges (a parallel) needs one of them to, and a path that ends doesn't.
   * A step whose only edges go back to a loop's test returns there: the
   * test's way out decides. Forward edges otherwise.
   */
  private alwaysReaches(
    flow: FlowGraph,
    from: string,
    target: string,
    edgesOut: (id: string) => FlowEdge[],
    backEdgeIds: Set<string>,
    memo = new Map<string, boolean>()
  ): boolean {
    if (from === target) return true;
    const known = memo.get(from);
    if (known !== undefined) return known;
    memo.set(from, false);
    const edges = edgesOut(from);
    const ahead = edges.filter((e) => !backEdgeIds.has(e.id));
    const reaches = (e: FlowEdge) =>
      backEdgeIds.has(e.id) ||
      this.alwaysReaches(flow, e.target, target, edgesOut, backEdgeIds, memo);
    const node = flow.nodes.find((n) => n.id === from);
    let result: boolean;
    if (edges.length === 0) result = false;
    else if (ahead.length === 0) result = true;
    else if (node?.type === 'condition') {
      // A list member's "no" is its list head's (#325): its own lines, or
      // the head's when it has none.
      const yes = edges.filter((e) => e.sourceHandle === 'true');
      const no = edges.some((e) => e.sourceHandle === 'false')
        ? []
        : this.andMemberFalseEdges(flow, from);
      result =
        yes.length > 0 &&
        (no.length > 0 || edges.some((e) => e.sourceHandle === 'false')) &&
        [...edges, ...no].every((e) => reaches(e));
    } else result = ahead.some((e) => reaches(e));
    memo.set(from, result);
    return result;
  }

  /**
   * #157: each drawn loop's budget, by its head (where its back edges go).
   * A loop all of whose back edges close a count loop has none (HA never
   * stops a `repeat: count`). A while loop's test is checked where it
   * passes -- in its condition list's last member's yes side -- so a loop
   * that has run 10,000 rounds and then fails its test ends normally; any
   * other (an until, a loop drawn by hand) is checked as a round starts.
   * `region`: the states inside the loop, from which arriving at the head
   * means it goes round again.
   */
  private loopBudgets(flow: FlowGraph): LoopBudget[] {
    const backEdgeIds = findBackEdges(flow);
    const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const forwardOut = (id: string) =>
      edges.filter((e) => e.source === id && !backEdgeIds.has(e.id));
    const heads = [
      ...new Set(edges.filter((e) => backEdgeIds.has(e.id)).map((e) => e.target)),
    ].sort();
    const budgets: LoopBudget[] = [];
    for (const head of heads) {
      const headNode = byId.get(head);
      const into = edges.filter((e) => backEdgeIds.has(e.id) && e.target === head);
      if (!headNode) continue;
      const kinds = into.map((e) => {
        const source = byId.get(e.source);
        return source ? classifyLoopBackEdge(source, headNode, e.sourceHandle) : null;
      });
      if (kinds.every((k) => k === 'count')) continue;
      const fromHead = new Set<string>();
      const queue = [head];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (fromHead.has(id)) continue;
        fromHead.add(id);
        queue.push(...forwardOut(id).map((e) => e.target));
      }
      const region = new Set(into.map((e) => e.source));
      const back = [...region];
      while (back.length > 0) {
        const id = back.shift()!;
        for (const e of edges) {
          if (e.target !== id || backEdgeIds.has(e.id) || region.has(e.source)) continue;
          if (!fromHead.has(e.source)) continue;
          region.add(e.source);
          back.push(e.source);
        }
      }
      const isWhile = kinds.some((k) => k === 'while' || k === 'while-body-exit');
      const list = isWhile ? this.whileListOf(flow, head) : [head];
      const listEnd = list[list.length - 1];
      // #292: no line back is reached from the list's "yes" side: the round
      // is on its "no" side.
      const yesReach = new Set<string>();
      // The yes side's own lines count even when they are lines back: a
      // "yes" line straight back round is the round on that side.
      const yesQueue = edges
        .filter((e) => e.source === listEnd && e.sourceHandle === 'true')
        .map((e) => e.target);
      while (yesQueue.length > 0) {
        const id = yesQueue.shift()!;
        if (yesReach.has(id)) continue;
        yesReach.add(id);
        yesQueue.push(...forwardOut(id).map((e) => e.target));
      }
      const roundOnNoSide =
        isWhile &&
        into.every((e) => byId.get(e.source)?.type !== 'condition' && !yesReach.has(e.source));
      budgets.push({
        index: budgets.length + 1,
        head,
        region: [...region].sort(),
        checkAt: listEnd,
        whileTest: isWhile,
        // Lines back count (#345): a loop entered at two steps has its
        // "no" side's line into the other entry as a line back.
        ...(roundOnNoSide && edges.some((e) => e.source === head && e.sourceHandle === 'false')
          ? {
              noSide: {
                tests: list,
                bodyEntries: edges
                  .filter((e) => e.source === head && e.sourceHandle === 'false')
                  .map((e) => e.target),
              },
            }
          : {}),
      });
    }
    return budgets;
  }

  /** A while loop's condition list, head first (its last member's yes side
   * enters the body): conditions chained on yes edges with no `_blockKey`,
   * one way in, and no "no" edge or the head's own exits. */
  /** A while's condition list from its head, as loopBudgets reads it
   * (public for the list-rule agreement test). */
  whileListOf(flow: FlowGraph, head: string): string[] {
    const backEdgeIds = findBackEdges(flow);
    const edges = flow.edges.filter((e) => e.type !== 'hint' && e.type !== 'choose-hint');
    const forwardOut = (id: string) =>
      edges.filter((e) => e.source === id && !backEdgeIds.has(e.id));
    return this.whileList(flow, head, forwardOut, backEdgeIds);
  }

  private whileList(
    flow: FlowGraph,
    head: string,
    forwardOut: (id: string) => FlowEdge[],
    backEdgeIds: Set<string>
  ): string[] {
    const exitKey = (targets: string[]) => [...new Set(targets)].sort().join('\u0000');
    const headExits = exitKey(
      forwardOut(head)
        .filter((e) => e.sourceHandle === 'false')
        .map((e) => e.target)
    );
    const chain = [head];
    let current = head;
    while (true) {
      // Every "yes" line counts: one that also goes back round fans out,
      // so the test after it is no member (the list rule, #336).
      const yes = flow.edges.filter(
        (e) =>
          e.source === current &&
          e.sourceHandle === 'true' &&
          e.type !== 'hint' &&
          e.type !== 'choose-hint'
      );
      if (yes.length !== 1) break;
      const next = flow.nodes.find((n) => n.id === yes[0].target);
      if (next?.type !== 'condition' || chain.includes(next.id)) break;
      if (typeof (next.data as Record<string, unknown>)._blockKey === 'string') break;
      // Lines back round count: a test a line comes back into is a loop's
      // test, never a list member (the one list rule, list-members.ts).
      const waysIn = flow.edges.filter(
        (e) => e.target === next.id && e.type !== 'hint' && e.type !== 'choose-hint'
      );
      if (waysIn.length !== 1) break;
      const no = flow.edges.filter(
        (e) =>
          e.source === next.id &&
          e.sourceHandle === 'false' &&
          e.type !== 'hint' &&
          e.type !== 'choose-hint'
      );
      const noForward = no.filter((e) => !backEdgeIds.has(e.id));
      const foldable =
        no.length === 0 ||
        (headExits !== '' &&
          noForward.length === no.length &&
          exitKey(noForward.map((e) => e.target)) === headExits);
      if (!foldable) break;
      chain.push(next.id);
      current = next.id;
    }
    return chain;
  }

  /** A state's block with its loop bookkeeping (#157): a loop head counts
   * its round first; the check stops the run before a round past HA's
   * limit (a while loop's on its test's yes side). */
  private withLoopBookkeeping(
    block: Record<string, unknown>,
    node: FlowNode,
    budgets: LoopBudget[]
  ): Record<string, unknown> {
    let sequence = Array.isArray(block.sequence) ? [...block.sequence] : [];
    for (const budget of budgets) {
      if (budget.noSide?.tests.includes(node.id)) {
        // #339: a "no" side fanning out into the body is written inline,
        // its branches then the move: the check opens that side.
        if (budget.noSide.bodyEntries.length > 1) {
          sequence = sequence.map((step) => {
            const record = step as Record<string, unknown>;
            return 'if' in record && Array.isArray(record.else)
              ? { ...record, else: [loopLimitStep(budget.index), ...record.else] }
              : step;
          });
          continue;
        }
        sequence = beforeMovesInto(
          sequence,
          budget.noSide.bodyEntries,
          loopLimitStep(budget.index)
        );
        continue;
      }
      if (budget.checkAt === node.id && budget.whileTest) {
        sequence = sequence.map((step) => {
          const record = step as Record<string, unknown>;
          return 'if' in record && Array.isArray(record.then)
            ? { ...record, then: [loopLimitStep(budget.index), ...record.then] }
            : step;
        });
      }
    }
    const atHead = budgets.filter((b) => b.head === node.id);
    const first = atHead.flatMap((b) => [
      loopRoundsStep(b.index, b.region),
      ...(b.whileTest ? [] : [loopLimitStep(b.index)]),
    ]);
    return { ...block, sequence: [...first, ...sequence] };
  }

  /**
   * #284: a fan-out's branches (grouped where they meet, #99), each as
   * native steps or, when the branch goes round a loop of its own, as a
   * small state machine of its own (utils/branchMachine.ts): no loop needs
   * recognizing there, so none can be misread (the class behind
   * #259-#282).
   */
  private branchGroups(
    flow: FlowGraph,
    targetIds: string[],
    givenBound: Set<string> | null,
    source: string | undefined,
    entries: string[] = []
  ): { targets: string[]; steps: unknown[] }[] {
    // Inside a branch machine, the steps outside its branch are where the
    // branch ends: a fan-out in it never runs them.
    const bound = this.withinMachine(flow, givenBound);
    // A branch written as a machine isn't walked as native steps: a loop
    // there is what the walk can misread.
    const regions = new Map<string, Set<string> | null>();
    const regionOf = (group: string[]) => {
      const key = group.join('\u0000');
      if (!regions.has(key)) {
        regions.set(
          key,
          source === undefined ? null : branchMachineRegion(flow, group, bound, source)
        );
      }
      return regions.get(key) ?? null;
    };
    const groups = this.nativeSubBuilder.buildParallelBranchesForTargets(
      flow,
      targetIds,
      bound,
      entries,
      regionOf
    );
    return groups.map((group) => {
      const region = regionOf(group.targets);
      return region
        ? { targets: group.targets, steps: this.branchMachine(flow, region, group.targets[0]) }
        : group;
    });
  }

  /** The steps of the branch machine for `region`, starting at `entry`:
   * one state per step, generated as the main machine's are, a move out
   * of the branch made a move to END, then renamed onto its own
   * variables. */
  private branchMachine(flow: FlowGraph, region: Set<string>, entry: string): unknown[] {
    const budgets = this.loopBudgets(flow);
    this.machineRegions.push(region);
    let cases: unknown[];
    try {
      cases = flow.nodes
        .filter((n) => region.has(n.id) && n.type !== 'trigger' && n.type !== 'start')
        .map((n) => this.withLoopBookkeeping(this.generateNodeBlock(flow, n), n, budgets));
    } finally {
      this.machineRegions.pop();
    }
    const name = branchMachineName(region, entry);
    const names = branchNames(name);
    return branchMachineSteps(name, entry, {
      choose: renameMachineVariables(endOutside(cases, region), MAIN_NAMES, names),
      default: dispatchDefault(names.node),
    });
  }

  /**
   * #284: the branch machines whose states are being written, innermost
   * last. A state's lines out of its branch are where the branch ends (the
   * enclosing run goes on where the branches meet): they are no target of
   * the state's fan-out, and the steps there are a fan-out's bound.
   */
  private machineRegions: Set<string>[] = [];

  /** `targets` without those outside the innermost branch machine, if any. */
  private inMachine(targets: string[]): string[] {
    const region = this.machineRegions.at(-1);
    return region ? targets.filter((id) => region.has(id)) : targets;
  }

  /** `bound` with every step outside the innermost branch machine, if any. */
  private withinMachine(flow: FlowGraph, bound: Set<string> | null): Set<string> | null {
    const region = this.machineRegions.at(-1);
    if (!region) return bound;
    return new Set([
      ...(bound ?? []),
      ...flow.nodes.map((n) => n.id).filter((id) => !region.has(id)),
    ]);
  }

  /** One branch of a fan-out's `parallel:` as a step: a single step as
   * itself (matching NativeStrategy's flattening), several as a
   * `sequence:`, and a logged placeholder when the branch built nothing,
   * so a branch never silently vanishes. */
  private parallelBranchStep(flow: FlowGraph, targets: string[], steps: unknown[]): unknown {
    if (steps.length === 0) {
      const known = targets.every((id) => flow.nodes.some((n) => n.id === id));
      const message = `${known ? 'Node' : 'Unknown node'}: ${targets.join(', ')}`;
      return { action: 'system_log.write', data: { message } };
    }
    return bareParallelBranch(steps) ?? { sequence: steps };
  }

  /**
   * Bug #63 (2026-09-26): where an until loop goes when its test can't be
   * evaluated (an entity is missing, a numeric_state sensor unavailable).
   * HA's `repeat: until` stops the loop then (script.py: the test `in
   * [True, None]` ends it), while an `if:` reads the error as false; this
   * strategy tests each until condition with an `if:`, so an error re-ran
   * the body forever. For a condition of an until test -- the head, whose
   * own false edge loops back, or a later member of its condition list
   * (`until: [A, B]`, bug #27's list convention) -- returns the loop's exit
   * (the last member's true targets); null for any other condition.
   * Which conditions guard a loop is read from the loop structure
   * (analyzer/loops.ts, #283): a plain condition whose "no" side stays in
   * its loop and whose "yes" side leaves it, or an Until card's test.
   */
  private untilErrorExitTargets(flow: FlowGraph, node: ConditionNode): string[] | null {
    // #283: read from the loops themselves (analyzer/loops.ts), the same
    // rule as the graph walk's, so the answer never depends on which line
    // a search met first (#277).
    return untilExit(flow, node.id)?.map((e) => e.target) ?? null;
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
  /** This strategy's reading of a list, on its own: where `conditionId`'s
   * "no" goes when it has no "no" line of its own ([]: nowhere). For the
   * check that holds every reader of the list rule to the same answers. */
  listNoOf(flow: FlowGraph, conditionId: string): string[] {
    return this.andMemberFalseTargets(flow, conditionId);
  }

  private andMemberFalseTargets(flow: FlowGraph, conditionId: string): string[] {
    return this.andMemberFalseEdges(flow, conditionId).map((e) => e.target);
  }

  /** andMemberFalseTargets as the lines themselves: the nearest "no" lines
   * up the list (one may be a line back round). */
  private andMemberFalseEdges(
    flow: FlowGraph,
    conditionId: string,
    seen = new Set<string>()
  ): FlowEdge[] {
    if (seen.has(conditionId)) return [];
    seen.add(conditionId);
    const backEdgeIds = findBackEdges(flow);
    const node = this.getNode(flow, conditionId);
    if (node?.type !== 'condition') return [];
    const own = flow.edges.filter((e) => e.source === conditionId && e.sourceHandle === 'false');
    if (own.length > 0) return own;
    if (typeof (node.data as Record<string, unknown>)._blockKey === 'string') return [];
    // Lines back round count: a test a line comes back into is a loop's
    // test, never a list member (the maintainer, 2026-10-24).
    const incoming = flow.edges.filter(
      (e) => e.target === conditionId && e.type !== 'hint' && e.type !== 'choose-hint'
    );
    if (incoming.length !== 1 || incoming[0].sourceHandle !== 'true') return [];
    const parent = this.getNode(flow, incoming[0].source);
    if (parent?.type !== 'condition') return [];
    const parentTrue = flow.edges.filter(
      (e) => e.source === parent.id && e.sourceHandle === 'true'
    );
    if (parentTrue.length !== 1) return [];
    const parentElse = this.andMemberFalseEdges(flow, parent.id, seen);
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
        for (const e of flow.edges) {
          if (e.source !== id) continue;
          if (!backEdgeIds.has(e.id)) queue.push(e.target);
          // A line back into B itself: the else goes round into B, which
          // makes B where A's branches meet too (the every-small-drawing
          // test, tier single4; a line back since #283's last step).
          else if (e.target === conditionId) return true;
        }
      }
      return false;
    };
    return parentElse.some((e) => reaches(e.target)) ? [] : parentElse;
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
    const counter = counterVariableOf(node);
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
    const backEdgeIds = findBackEdges(flow);
    const goesRound = (side: FlowEdge[]) =>
      side.filter((e) => backEdgeIds.has(e.id)).map((e) => e.target);
    const trueFanOut = this.buildFanOutFromTargets(
      flow,
      trueTargets,
      goesRound(trueEdges),
      node.id
    );
    const falseTargets =
      falseEdges.length > 0
        ? falseEdges.map((e) => e.target)
        : this.andMemberFalseTargets(flow, node.id);
    const falseFanOut = this.buildFanOutFromTargets(
      flow,
      falseTargets,
      goesRound(falseEdges),
      node.id
    );
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
    // Bug #63: an until test that can't be evaluated ends the loop in HA.
    const errorExit = this.untilErrorExitTargets(flow, node);
    const errorFanOut = errorExit
      ? this.buildFanOutFromTargets(flow, errorExit, [], node.id)
      : null;

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
    const falseBranch = [
      ...falseFanOut.extraSteps,
      {
        variables: {
          current_node: falseTarget,
        },
      },
    ];

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
          // An until test's else holds an error guard (bug #63): HA reads
          // an error as false in `if:` but stops a `repeat: until`, so
          // "false" is re-checked as `not` -- true: really false, run the
          // body again; not true (the test can't be evaluated): leave the
          // loop, as HA's until does.
          else: errorFanOut
            ? [
                {
                  if: [{ condition: 'not', conditions: [condition] }],
                  then: falseBranch,
                  else: [
                    ...errorFanOut.extraSteps,
                    {
                      variables: {
                        current_node: errorFanOut.nextNode,
                      },
                    },
                  ],
                },
              ]
            : falseBranch,
        },
      ],
    };
  }

  /**
   * Build native HA condition object for use in if/then/else. The same
   * builder as NativeStrategy's (buildConditionData, bug #95's class):
   * this strategy's own field-by-field copy kept missing real HA condition
   * fields (`target`/`options`, `enabled`, `for:`; the 2026-09-06 audit),
   * and its later spread-based copy was a second copy to keep in step.
   */
  private buildNativeCondition(node: ConditionNode): Record<string, unknown> {
    // Called only from generateConditionBlock, for a condition node's own
    // gate condition: every condition node here compiles to its own
    // dispatcher `if:` step, which carries `node.data.alias` itself, so the
    // condition object doesn't carry it too (a nested condition keeps its
    // own; see buildConditionData).
    return this.buildConditionData(node.data, true);
  }

  /**
   * The dispatch block for a node that runs its own steps (an action,
   * delay, wait or set_variables node: one step, built by the same
   * builders NativeStrategy uses, bug #95; a join or any other passthrough
   * node: none) and moves on to the next node.
   */
  private generateStepBlock(
    flow: FlowGraph,
    node: FlowNode,
    edges: FlowEdge[],
    steps: Record<string, unknown>[]
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
        ...steps,
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
