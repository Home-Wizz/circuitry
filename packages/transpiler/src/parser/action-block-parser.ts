/**
 * Parses a Home Assistant automation's `action:`/`actions:` sequence
 * (including nested `choose:`/`if:` blocks) into FlowNodes/FlowEdges.
 * Extracted from YamlParser.ts (the 2026-09-25 file-decomposition
 * work) as a pure move -- no logic changed, only relocated. This is
 * the largest single chunk of YamlParser.ts's own parsing logic: parseActions,
 * parseChooseBlock, and parseIfBlock recurse into each other constantly
 * (a choose/if branch's own body is itself parsed by parseActions), so they
 * stay together in one module rather than being split further.
 */
import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowNode,
  HAAction,
  HACondition,
  SetVariablesNode,
  Target,
  WaitNode,
} from '@circuitry/shared';
import { isDeviceAction } from '@circuitry/shared';
import {
  isChooseAction,
  conditionList,
  expandConditionShorthand,
  isConditionAction,
  isConditionListAction,
  isConditionShorthandAction,
  isDelayAction,
  isEventAction,
  isIfThenAction,
  isParallelAction,
  isRepeatAction,
  isSequenceAction,
  isServiceAction,
  isSetConversationResponseAction,
  isStepKeptAsWritten,
  isStopAction,
  isTemplateEnabledBlock,
  isUnexpandableCountRepeat,
  isVariablesAction,
  isWaitAction,
  isWaitScopedParallel,
  resolveConditionType,
  toList,
  transformConditions,
} from './action-type-guards';
import { mentionsLoopVariable } from '../analyzer/loop-variable';
import {
  conditionEnabledAsWritten,
  createEdge,
  createOpaqueStepNode,
  importCondition,
  importWaitTriggers,
  stepEnabledAsWritten,
} from './parser-shared';

/**
 * Options for parsing actions and nested blocks
 */
export interface ParseOptions {
  /** Warnings array to append to */
  warnings: string[];
  /** Node IDs to connect from */
  previousNodeIds: string[];
  /** Function to generate unique node IDs */
  getNextNodeId: (type: string) => string;
  /** Set of condition node IDs for proper edge handle assignment */
  conditionNodeIds?: Set<string>;
  /** Set of condition node IDs whose FALSE path should connect to next action */
  falsePathConditionIds?: Set<string>;
  /**
   * Map from trigger node ID → trigger's `id` field.
   * Used to route trigger-id conditions directly to matching trigger nodes.
   */
  triggerNodeMap?: Map<string, string>;
  /**
   * The automation's own list only: nodes that end the branch of a
   * trigger-id routing if, with the trigger ids whose run they carry on
   * (bug #105). A later routing if for other ids lets them pass by, as it
   * does those triggers; any other step joins them all.
   */
  laneIds?: Map<string, string[]>;
  /**
   * True for every list but the automation's own: an if's or a Choose's
   * branch, a parallel branch, a `sequence:` group, a loop's body. HA runs
   * each as a script of its own, and a condition step that doesn't pass
   * ends only that script -- what comes after the block still runs, and a
   * loop goes on to its next pass (script.py: `_ConditionFail` is caught
   * by the sub-script's own run). So in such a list a condition step is
   * read as an if around the rest of the list (bug #78). In the
   * automation's own list it ends the run, as a path that just ends does
   * on the canvas (decision D1).
   */
  nested?: boolean;
  /**
   * Inherited enabled state from parent block.
   * When false, all child nodes will be created with enabled: false.
   * When undefined, nodes inherit their own enabled property.
   */
  inheritedEnabled?: boolean;
}

/** True when the step being parsed is reached straight from a trigger
 * (the only place a trigger-id if routes triggers, bug #80). */
function startsFromTriggers(
  previousNodeIds: readonly string[],
  triggerNodeMap: Map<string, string> | undefined
): boolean {
  return !!triggerNodeMap && previousNodeIds.some((id) => triggerNodeMap.has(id));
}

/** The trigger ids whose run a node carries at a routing if: a trigger's
 * own id, or a routed branch's lane (bug #105); undefined for any other
 * node (every trigger's run). */
function laneOf(
  id: string,
  triggerNodeMap: Map<string, string> | undefined,
  laneIds: Map<string, string[]> | undefined
): string[] | undefined {
  const triggerId = triggerNodeMap?.get(id);
  return triggerId !== undefined ? [triggerId] : laneIds?.get(id);
}

/**
 * The trigger ids of a trigger-id routing if, or null when the if doesn't
 * route: a single `condition: trigger` with no else, reached straight
 * from the triggers (or the branches earlier routing ifs gave them).
 * Anywhere else -- after another step, inside a branch or a loop -- it is
 * an ordinary if: when it doesn't pass, what follows it still runs (bug
 * #80). A run that it would pass for some of its triggers and not others
 * can't be routed either, so the if is an ordinary one then too.
 */
function routingTriggerIds(
  ifAction: { else?: unknown },
  ifConditions: unknown[],
  previousNodeIds: readonly string[],
  triggerNodeMap: Map<string, string> | undefined,
  laneIds: Map<string, string[]> | undefined
): string[] | null {
  if (!startsFromTriggers(previousNodeIds, triggerNodeMap)) return null;
  const elseIsEmpty =
    !ifAction.else || (Array.isArray(ifAction.else) && ifAction.else.length === 0);
  if (!elseIsEmpty || ifConditions.length !== 1) return null;
  const cond = ifConditions[0] as Record<string, unknown>;
  if (cond?.condition !== 'trigger') return null;
  const rawId = cond?.id;
  const ids =
    typeof rawId === 'string'
      ? [rawId]
      : Array.isArray(rawId) && rawId.length > 0 && rawId.every((x) => typeof x === 'string')
        ? (rawId as string[])
        : null;
  if (ids === null) return null;
  const splits = previousNodeIds.some((id) => {
    const lane = laneOf(id, triggerNodeMap, laneIds);
    return lane !== undefined && lane.some((t) => ids.includes(t)) && !lane.every((t) => ids.includes(t));
  });
  return splits ? null : ids;
}

/**
 * Parse action sequences (including choose blocks, delays, etc.)
 */
export function parseActions(
  actions: readonly unknown[],
  options: ParseOptions
): {
  nodes: FlowNode[];
  edges: FlowEdge[];
  terminalNodeIds: string[];
  /**
   * Subset of `terminalNodeIds` that are themselves unresolved condition
   * nodes whose TRUE path is what a subsequent action should connect to
   * (e.g. a trailing inline condition guard, or an if-without-else whose
   * true branch fell through to here) — vs. `falsePathTerminalNodeIds`
   * below for the FALSE-path equivalent. A caller that consumes
   * `terminalNodeIds` to seed ITS OWN `previousNodeIds` for further
   * parsing (parseIfBlock's then/else already does this internally, see
   * its `ifResult.falsePathOutputIds` handling above) needs these to
   * correctly re-seed its own conditionNodeIds/falsePathConditionIds
   * tracking sets — otherwise the next edge created from one of these
   * terminal ids has no way to know which handle to use, reproducing the
   * "Edge ... from condition node must have sourceHandle 'true' or
   * 'false', got: undefined" class of bug this parser has already been
   * fixed for once (parseIfBlock's nested else-branch case) but which
   * still applied to any OTHER caller — e.g. isParallelAction's
   * branch-parsing below — that discarded this classification instead of
   * threading it through.
   */
  truePathConditionTerminalIds: string[];
  falsePathTerminalNodeIds: string[];
} {
  const {
    warnings,
    previousNodeIds,
    getNextNodeId,
    conditionNodeIds = new Set(),
    falsePathConditionIds: incomingFalsePathConditionIds = new Set(),
    triggerNodeMap,
    inheritedEnabled,
    nested = false,
  } = options;
  const laneIds = options.laneIds ?? new Map<string, string[]>();

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let currentNodeIds = previousNodeIds;
  // Set once a condition step in a nested list has taken the rest of the
  // list into its if (bug #78; see ParseOptions.nested).
  let restTakenByConditionStep = false;
  // Create a mutable copy so we can track condition nodes created during parsing
  const localConditionNodeIds = new Set(conditionNodeIds);
  // Track condition nodes whose FALSE path should connect to next action.
  // Seeded from the caller's own set (e.g. parseIfBlock's else-branch call
  // marks its own firstConditionId as a false-path source here) so this
  // cascades correctly into arbitrarily nested if/choose blocks — this was
  // previously always a fresh empty set regardless of what callers passed
  // in, silently dropping that information. That forced parseIfBlock's
  // else-branch to fall back to a manual "create the edge, then find and
  // patch its handle after the fact" workaround, which only ever fixed
  // the outermost edge — any if-block nested inside an else branch had no
  // way to inherit the false-path marker, so ITS OWN edges came out with
  // sourceHandle left undefined (confirmed via a real user automation:
  // "Edge ... from condition node must have sourceHandle 'true' or
  // 'false', got: undefined" on import, for edges several levels into a
  // nested if/then/else).
  const falsePathConditionIds = new Set(incomingFalsePathConditionIds);

  // Helper to compute the enabled state for a node
  const getNodeEnabled = <T extends boolean | string | undefined>(nodeEnabled: T): T | false => {
    // If parent is disabled, child is always disabled
    if (inheritedEnabled === false) return false;
    // Otherwise use the node's own enabled state
    return nodeEnabled;
  };

  // Helper to create edges from current nodes to a target
  const createEdgesFromCurrent = (targetId: string): void => {
    for (const prevId of currentNodeIds) {
      let sourceHandle: string | undefined;
      if (falsePathConditionIds.has(prevId)) {
        // This condition's FALSE path should connect to next action
        sourceHandle = 'false';
      } else if (localConditionNodeIds.has(prevId)) {
        // This condition's TRUE path should connect to next action
        sourceHandle = 'true';
      }
      edges.push(createEdge(prevId, targetId, sourceHandle));
    }
  };

  /** Condition steps this list read as plain condition nodes. */
  const plainConditionStepIds = new Set<string>();
  /** Whether the list has got to the "yes" exit of a block's own condition
   * (an until loop's test, the last of an if's conditions with an empty
   * then) rather than of one of this list's condition steps: see bug #83
   * below. */
  const followsBlockYesExit = (): boolean =>
    currentNodeIds.some(
      (id) =>
        localConditionNodeIds.has(id) &&
        !falsePathConditionIds.has(id) &&
        !plainConditionStepIds.has(id) &&
        nodes.some((n) => n.id === id && n.type === 'condition')
    );

  /** An if/then/else step (or a nested condition step read as one, bug
   * #78), parsed from where the list has got to. */
  const parseIfStep = (act: Record<string, unknown>): void => {
    const ifArr = conditionList(act.if);
    const thenArr = Array.isArray(act.then) ? act.then : [];
    const elseArr = Array.isArray(act.else) ? act.else : undefined;
    // Phase 5 (2026-09-26): an if with nothing in either branch does
    // nothing (HA conditions have no side effects). Kept as nodes it had no
    // stable shape: its true and false paths both have to continue, and
    // each round trip through NativeStrategy re-rendered it as a larger
    // no-op. A trigger-id if too (bug #105: routed, the run it passed for
    // ended there).
    if (thenArr.length === 0 && (elseArr === undefined || elseArr.length === 0)) {
      return;
    }
    const ifAction = {
      if: ifArr,
      then: thenArr,
      else: elseArr,
      alias: typeof act.alias === 'string' ? act.alias : undefined,
      enabled: act.enabled,
    };
    const ifResult = parseIfBlock(ifAction, {
      warnings,
      previousNodeIds: currentNodeIds,
      getNextNodeId,
      conditionNodeIds: localConditionNodeIds,
      falsePathConditionIds,
      triggerNodeMap,
      laneIds,
      inheritedEnabled,
    });
    nodes.push(...ifResult.nodes);
    edges.push(...ifResult.edges);
    // Route condition outputs to the correct handle tracking set
    for (const outId of ifResult.outputNodeIds) {
      const outNode = ifResult.nodes.find((n) => n.id === outId);
      if (outNode?.type === 'condition') {
        if (ifResult.falsePathOutputIds.includes(outId)) {
          // This condition's FALSE path should connect to subsequent actions
          falsePathConditionIds.add(outId);
        } else {
          // This condition's TRUE path should connect to subsequent actions
          localConditionNodeIds.add(outId);
        }
      }
    }
    // For trigger-id routing: the triggers (and routed branches) this if
    // didn't take carry on past it, and so does the branch it routed, as
    // a lane of its own: HA runs what follows the if for every trigger
    // (bug #105: the routed trigger's run used to end with the branch). A
    // later routing if for other ids lets the lane pass by; any other
    // step joins every lane.
    if (ifResult.routedIds !== null) {
      for (const outId of ifResult.outputNodeIds) laneIds.set(outId, ifResult.routedIds);
      currentNodeIds = [...new Set([...ifResult.unconsumedPreviousIds, ...ifResult.outputNodeIds])];
    } else {
      currentNodeIds = ifResult.outputNodeIds;
    }
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: large dispatch switch, refactoring deferred
  actions.forEach((action, index) => {
    if (restTakenByConditionStep) return;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      // HA refuses a step that isn't a mapping ("expected a dictionary"),
      // so the automation is already broken: say so and name the step
      // (decision D3). It used to become an "Unknown Node" that failed
      // the graph's own schema with a message about `data`.
      throw new Error(
        `Step ${index + 1} of an action list is not a step Home Assistant can run: ${JSON.stringify(action)}`
      );
    }

    // A block whose `enabled:` is a template: kept exactly as written
    // (bug #70; see isTemplateEnabledBlock). Inside a disabled block its
    // template doesn't matter (HA skips the outer block), so it is read as
    // a disabled block like any other.
    if (inheritedEnabled !== false && isTemplateEnabledBlock(action)) {
      const nodeId = getNextNodeId('action');
      nodes.push(createOpaqueStepNode(nodeId, action, false));
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
      return;
    }

    // A `repeat: count` the counter loop can't express (0 or less, not a
    // whole number, a template), a parallel of one branch that sets
    // `wait`, or a step its node can't hold whole: kept exactly as written
    // (bugs #73, #81, #88-#90; see isUnexpandableCountRepeat,
    // isWaitScopedParallel, isStepKeptAsWritten).
    if (
      isUnexpandableCountRepeat(action) ||
      isWaitScopedParallel(action) ||
      isStepKeptAsWritten(action)
    ) {
      const nodeId = getNextNodeId('action');
      nodes.push(createOpaqueStepNode(nodeId, action, inheritedEnabled === false));
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
      return;
    }

    const isConditionStep =
      isConditionAction(action) ||
      isConditionListAction(action) ||
      isConditionShorthandAction(action);

    // Handle different action types
    if (isConditionStep && (nested || followsBlockYesExit())) {
      // A condition step in a nested list ends only that list when it
      // doesn't pass, so it is an if around the rest of the list, with no
      // else (bug #78; see ParseOptions.nested). Its own alias and
      // `enabled` stay on the condition.
      // In the automation's own list it ends the run, and so does an if
      // around the rest of the list (nothing comes after it). That's how
      // it's read right after a block whose way out is one of its own
      // conditions' "yes" -- an until loop's test, an if with an empty
      // then: a plain condition there would read as a member of that
      // condition's list (the until loop ran until both passed; bug #83).
      restTakenByConditionStep = true;
      parseIfStep({
        if: [expandConditionShorthand(action)],
        then: actions.slice(index + 1) as (HACondition | HAAction)[],
      });
    } else if (isConditionStep) {
      // Inline condition guard in action sequence — either a single condition
      // object (condition acts as the type discriminator) or the "list of
      // conditions" shorthand (implicit AND), which we normalize to an
      // explicit `and` condition object before parsing so both forms share
      // one code path.
      const nodeId = getNextNodeId('condition');
      // Shorthands (`condition: [...]`, `and:`/`or:`/`not:`) expanded the
      // way HA expands them (bug #59).
      const act = expandConditionShorthand(action);
      const parsedData: ConditionNode['data'] = importCondition(act, `Condition step ${index}`);
      // Apply inherited enabled state
      parsedData.enabled = getNodeEnabled(parsedData.enabled);
      const conditionNode: ConditionNode = {
        id: nodeId,
        type: 'condition',
        position: { x: 0, y: 0 },
        data: parsedData,
      };

      nodes.push(conditionNode);
      createEdgesFromCurrent(nodeId);
      plainConditionStepIds.add(nodeId);
      // Track this condition node so subsequent edges use 'true' handle
      localConditionNodeIds.add(nodeId);
      currentNodeIds = [nodeId];
    } else if (isVariablesAction(action)) {
      // Variables block - create set_variables node
      const nodeId = getNextNodeId('set_variables');
      const act = action as Record<string, unknown>;
      const setVariablesNode: SetVariablesNode = {
        id: nodeId,
        type: 'set_variables',
        position: { x: 0, y: 0 },
        data: {
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          variables: (act.variables as Record<string, unknown>) || {},
          enabled: getNodeEnabled(stepEnabledAsWritten(act.enabled)),
        },
      };
      nodes.push(setVariablesNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isDelayAction(action)) {
      const nodeId = getNextNodeId('delay');
      const act = action as Record<string, unknown>;
      // Use spread pattern to preserve unknown properties from custom integrations
      const { alias, delay: delayValue, enabled, ...extraProps } = act;
      const delayNode: DelayNode = {
        id: nodeId,
        type: 'delay',
        position: { x: 0, y: 0 },
        data: {
          ...extraProps, // Preserve extra properties
          alias: typeof alias === 'string' ? alias : undefined,
          // A number is seconds (`delay: 5`), kept as written; it used to
          // become `delay: ""` (bug #60).
          delay:
            typeof delayValue === 'string' || typeof delayValue === 'number'
              ? delayValue
              : typeof delayValue === 'object' && delayValue !== null
                ? (delayValue as {
                    hours?: number;
                    minutes?: number;
                    seconds?: number;
                    milliseconds?: number;
                  })
                : '',
          enabled: getNodeEnabled(stepEnabledAsWritten(enabled)),
        },
      };
      nodes.push(delayNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isWaitAction(action)) {
      const nodeId = getNextNodeId('wait');
      const act = action as Record<string, unknown>;
      // Use spread pattern to preserve unknown properties from custom integrations
      const {
        alias,
        wait_template: waitTemplate,
        wait_for_trigger: waitForTrigger,
        timeout: timeoutValue,
        continue_on_timeout: continueOnTimeoutValue,
        enabled,
        ...extraProps
      } = act;

      // Handle timeout as a string, a number of seconds (`timeout: 30`,
      // kept as written; it used to be dropped, bug #61) or an object
      let timeout: WaitNode['data']['timeout'];
      if (typeof timeoutValue === 'string' || typeof timeoutValue === 'number') {
        timeout = timeoutValue;
      } else if (typeof timeoutValue === 'object' && timeoutValue !== null) {
        timeout = timeoutValue as {
          hours?: number;
          minutes?: number;
          seconds?: number;
          milliseconds?: number;
        };
      }

      const waitData: WaitNode['data'] = {
        ...extraProps, // Preserve extra properties
        alias: typeof alias === 'string' ? alias : undefined,
        timeout,
        continue_on_timeout:
          typeof continueOnTimeoutValue === 'boolean' ? continueOnTimeoutValue : undefined,
        enabled: getNodeEnabled(stepEnabledAsWritten(enabled)),
      };

      if (typeof waitTemplate === 'string') {
        waitData.wait_template = waitTemplate;
      } else if (Array.isArray(waitForTrigger)) {
        // One trigger instead of a list is already a list here
        // (normalizeActionLists, bug #62).
        waitData.wait_for_trigger = importWaitTriggers(waitForTrigger);
      }

      const waitNode: WaitNode = {
        id: nodeId,
        type: 'wait',
        position: { x: 0, y: 0 },
        data: waitData,
      };

      nodes.push(waitNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isChooseAction(action)) {
      // Handle condition branching (choose blocks)
      const chooseResult = parseChooseBlock(action as Record<string, unknown>, {
        warnings,
        previousNodeIds: currentNodeIds,
        getNextNodeId,
        conditionNodeIds: localConditionNodeIds,
        falsePathConditionIds,
        inheritedEnabled,
        triggerNodeMap,
      });
      nodes.push(...chooseResult.nodes);
      edges.push(...chooseResult.edges);
      // Add any new condition nodes to our tracking set
      // But NOT condition nodes that are outputs via FALSE path (no default choose)
      for (const outId of chooseResult.outputNodeIds) {
        const outNode = chooseResult.nodes.find((n) => n.id === outId);
        if (outNode?.type === 'condition') {
          if (chooseResult.falsePathOutputIds.includes(outId)) {
            // This condition's FALSE path should connect to subsequent actions
            falsePathConditionIds.add(outId);
          } else {
            // This condition's TRUE path should connect to subsequent actions
            localConditionNodeIds.add(outId);
          }
        }
      }
      currentNodeIds = chooseResult.outputNodeIds;
    } else if (isIfThenAction(action)) {
      // Handle if/then/else blocks
      parseIfStep(action as Record<string, unknown>);
    } else if (isDeviceAction(action)) {
      // Device action (type + device_id + domain)
      const nodeId = getNextNodeId('action');
      const act = action as Record<string, unknown>;

      // Extract known metadata fields vs additional parameters
      const knownFields = [
        'type',
        'device_id',
        'domain',
        'entity_id',
        'subtype',
        'alias',
        'enabled',
      ];
      const additionalParams: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(act)) {
        if (!knownFields.includes(key) && value !== undefined) {
          additionalParams[key] = value;
        }
      }

      // Convert device action to service-like format for the action node
      const actionNode: ActionNode = {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          // Store the device action fields directly
          service: `${act.domain}.${act.type}`,
          target: {
            device_id: act.device_id as string,
          },
          // Preserve original device action metadata and additional params (like 'option')
          data: {
            type: act.type,
            device_id: act.device_id,
            domain: act.domain,
            entity_id: act.entity_id,
            subtype: act.subtype,
            ...additionalParams,
          } as Record<string, unknown>,
          enabled: getNodeEnabled(stepEnabledAsWritten(act.enabled)),
        },
      };
      nodes.push(actionNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isParallelAction(action)) {
      // Parallel block - all branches start from the same source nodes
      const act = action as Record<string, unknown>;
      const parallelActions = act.parallel as unknown[];
      // Bug #34 (2026-09-26, found by the Phase 5 disabled-steps fuzz): a
      // disabled `parallel:` block ran anyway -- its branches inherited the
      // PARENT's enabled state, not the block's own.
      const parallelEnabled = getNodeEnabled(
        typeof act.enabled === 'boolean' ? act.enabled : undefined
      );

      // Store the starting nodes - all parallel branches connect FROM these
      const parallelStartNodes = [...currentNodeIds];
      // Collect the end nodes from all branches
      const allBranchEndNodes: string[] = [];

      // Merges a branch's terminal-node classification back into this
      // scope's own tracking sets — same pattern isIfAction's handler uses
      // for ifResult.outputNodeIds/falsePathOutputIds above. Without this,
      // a branch ending in an unresolved condition (a bare if-without-else,
      // or a repeat loop) would have its terminal id wired to whatever
      // comes after the parallel block with no sourceHandle at all
      // ("Edge ... from condition node must have sourceHandle 'true' or
      // 'false', got: undefined").
      const mergeConditionTracking = (result: {
        truePathConditionTerminalIds: string[];
        falsePathTerminalNodeIds: string[];
      }): void => {
        for (const id of result.truePathConditionTerminalIds) localConditionNodeIds.add(id);
        for (const id of result.falsePathTerminalNodeIds) falsePathConditionIds.add(id);
      };

      // Parse each parallel branch - each starts from the same source
      for (const parallelItem of parallelActions) {
        if (Array.isArray(parallelItem)) {
          // It's a sequence array (HA's shorthand for `sequence:`).
          // Bug #56 (2026-09-26, found by the adversarial fuzzer's
          // generator): when such a branch opens with a parallel and goes
          // on, the inner parallel's branches started from the same nodes
          // as the outer parallel's, so the graph had no way to say which
          // branches the steps after the inner parallel wait for: `[[par
          // [A, B], L], C]` came out as three branches A, B, C, with L after
          // A and B only, and was read back as L running twice. Parsed as
          // the `sequence:` group HA treats it as, the group's markers
          // keep the boundary.
          const opensWithParallel = parallelItem.length > 1 && isParallelAction(parallelItem[0]);
          const branchActions = opensWithParallel
            ? [{ sequence: parallelItem } as Record<string, unknown>]
            : (parallelItem as Record<string, unknown>[]);
          const seqResult = parseActions(branchActions, {
            warnings,
            previousNodeIds: parallelStartNodes,
            getNextNodeId,
            conditionNodeIds: localConditionNodeIds,
            // Bug #17 (2026-09-06, found via the extended random-graph
            // fuzzer's maximal stress test, round 2): falsePathConditionIds
            // was never forwarded into a parallel branch's own
            // parseActions call, unlike every other recursive call site in
            // this file (parseChooseBlock, the repeat-body calls, etc.).
            // A `parallel:` block sitting as the FIRST action of a
            // condition's FALSE path (an if/else's `else:`, or any other
            // false-path-continuation context) had `parallelStartNodes`
            // include the condition node, but this nested call's own
            // `falsePathConditionIds` started EMPTY -- so
            // createEdgesFromCurrent inside it had no way to know that
            // source was a false-path source, and wired every branch's
            // entry edge with sourceHandle left undefined instead of
            // 'false'. That produced a structurally invalid graph
            // (validateGraphStructure: "Edge ... from condition node must
            // have sourceHandle 'true' or 'false', got: undefined") for
            // ANY if/else, choose-default, or while/until-false-exit whose
            // branch opened with a parallel block -- silently failing to
            // parse rather than corrupting data, but a real, previously
            // untested construct combination.
            falsePathConditionIds,
            inheritedEnabled: parallelEnabled,
            nested: true,
          });
          if (seqResult.nodes.length > 0) {
            nodes.push(...seqResult.nodes);
            edges.push(...seqResult.edges);
            // Use the branch's own tracked terminal nodes (what it was
            // still building onto when parsing finished) rather than
            // guessing from edge shape — a branch ending in a loop has its
            // loop-condition/loop-body nodes still carrying outgoing
            // (back-)edges, so a "no outgoing edge" heuristic wrongly
            // excludes them and silently drops that branch's continuation
            // entirely.
            allBranchEndNodes.push(...seqResult.terminalNodeIds);
            mergeConditionTracking(seqResult);
          }
        } else if (typeof parallelItem === 'object' && parallelItem !== null) {
          // Single action in parallel - parse it as a single-item array.
          // A branch item shaped `{ sequence: [...], alias? }` (HA's
          // "Grouping actions" shorthand for naming a branch) is handled
          // by this exact same call, since parseActions's own
          // isSequenceAction dispatch already builds the matching
          // sequence_start/sequence_end marker pair for it — no need for
          // a separate case here (see isSequenceAction's handler above).
          const singleResult = parseActions([parallelItem] as Record<string, unknown>[], {
            warnings,
            previousNodeIds: parallelStartNodes,
            getNextNodeId,
            conditionNodeIds: localConditionNodeIds,
            // Same forwarding fix as the array-branch case just above --
            // see bug #17's comment there for the full explanation.
            falsePathConditionIds,
            inheritedEnabled: parallelEnabled,
            nested: true,
          });
          if (singleResult.nodes.length > 0) {
            nodes.push(...singleResult.nodes);
            edges.push(...singleResult.edges);
            // Same reasoning as the array-branch case above — use the
            // branch's own terminal nodes, not "the last node parsed"
            // (wrong for a branch that's itself an if/repeat/choose block,
            // whose last-*pushed* node isn't necessarily its actual exit).
            allBranchEndNodes.push(...singleResult.terminalNodeIds);
            mergeConditionTracking(singleResult);
          }
        }
      }

      // After parallel block, all branch end nodes become the current nodes
      // (subsequent actions will connect from all of them)
      currentNodeIds = allBranchEndNodes.length > 0 ? allBranchEndNodes : parallelStartNodes;
    } else if (isEventAction(action)) {
      // Event action - fires a Home Assistant event
      const nodeId = getNextNodeId('action');
      const act = action as Record<string, unknown>;
      const actionNode: ActionNode = {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          event: typeof act.event === 'string' ? act.event : undefined,
          event_data:
            typeof act.event_data === 'object' && act.event_data !== null
              ? (act.event_data as Record<string, unknown>)
              : undefined,
          continue_on_error:
            typeof act.continue_on_error === 'boolean' ? act.continue_on_error : undefined,
          enabled: getNodeEnabled(stepEnabledAsWritten(act.enabled)),
        },
      };
      nodes.push(actionNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isRepeatAction(action)) {
      // Repeat block - explode into individual nodes with loop-back edges
      const act = action as Record<string, unknown>;
      const repeat = act.repeat as Record<string, unknown>;
      const repeatSequence = Array.isArray(repeat.sequence) ? repeat.sequence : [];
      const blockAlias = typeof act.alias === 'string' ? act.alias : undefined;
      const blockEnabled = getNodeEnabled(
        typeof act.enabled === 'boolean' ? act.enabled : undefined
      );

      // A loop kept whole, as one repeat node written back verbatim (both
      // strategies write it as a real `repeat:`, and the gate reads its
      // structure from the node).
      const keepRepeatWhole = (): void => {
        const nodeId = getNextNodeId('action');
        const actionNode: ActionNode = {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: blockAlias,
            repeat: repeat as ActionNode['data']['repeat'],
            continue_on_error:
              typeof act.continue_on_error === 'boolean' ? act.continue_on_error : undefined,
            enabled: blockEnabled,
          },
        };
        nodes.push(actionNode);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      };

      if (
        blockEnabled === false ||
        repeatSequence.length === 0 ||
        mentionsLoopVariable(repeat)
      ) {
        // Kept whole:
        // - a disabled loop (its own `enabled: false`, or inside a disabled
        //   block), which HA skips. Decomposed, the only way to carry that
        //   was to disable its nodes -- and a disabled condition counts as
        //   REMOVED, i.e. true, so a disabled `while`/`count` loop became
        //   an endless one (bug #33, found by the Phase 5 disabled-steps
        //   fuzz);
        // - a loop with nothing in its body, which the canvas can't draw:
        //   decomposed, its test was left with no loop to belong to (an
        //   until loop's test became a condition on the whole automation;
        //   bug #84);
        // - a loop whose test or body reads HA's loop variable
        //   (`repeat.index`, ...): the state machine writes a decomposed
        //   loop as states of its own dispatch loop, whose `repeat` that
        //   would then read (bug #79).
        keepRepeatWhole();
      } else if (conditionList(repeat.while).length > 0) {
        // ── repeat.while ──
        // condition_node →(true)→ body... →(back-edge)→ condition_node
        // condition_node →(false)→ [continues]
        // One condition, a list or a template string, shorthands expanded (bug #59).
        const whileConditions = conditionList(repeat.while);

        // Create condition nodes (chain them like if-block conditions)
        const conditionNodes: ConditionNode[] = [];
        for (let ci = 0; ci < whileConditions.length; ci++) {
          const condId = getNextNodeId('condition');
          const parsedData: ConditionNode['data'] = importCondition(
            whileConditions[ci],
            'repeat while'
          );
          if (ci === 0 && blockAlias) {
            parsedData.alias = blockAlias;
          }
          // Bug #32: keep the condition's own `enabled: false`.
          // (A disabled loop never gets here -- it's kept whole, bug #33.)
          parsedData.enabled = conditionEnabledAsWritten(whileConditions[ci], false);
          // Stamp _blockKey on the while-condition (i === 0 only, matching
          // the single-condition-node native shape from block-factories.ts's
          // createRepeatWhileBlock) so it opens the AND miller and gets the
          // "While" role badge/false-edge handle like a natively-built
          // Repeat While block — see the Choose-case comment above for the
          // full explanation of this import gap.
          if (ci === 0) {
            (parsedData as Record<string, unknown>)._blockKey = 'repeat_while';
          }
          const condNode: ConditionNode = {
            id: condId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: parsedData,
          };
          conditionNodes.push(condNode);
          nodes.push(condNode);
          localConditionNodeIds.add(condId);
        }

        // Connect previous nodes → first condition
        createEdgesFromCurrent(conditionNodes[0].id);

        // Chain condition nodes together with 'true' edges
        for (let ci = 0; ci < conditionNodes.length - 1; ci++) {
          edges.push(createEdge(conditionNodes[ci].id, conditionNodes[ci + 1].id, 'true'));
        }

        const lastCondId = conditionNodes[conditionNodes.length - 1].id;

        // Parse body sequence from last condition's TRUE path.
        // falsePathConditionIds is forwarded here (bug found 2026-09-07,
        // maximal parser stress test round 3, same family as bug #17):
        // every OTHER recursive parseActions call in this file forwards
        // the caller's falsePathConditionIds so a false-path source several
        // levels up still resolves correctly deep inside nested
        // constructs -- this repeat.while body call was a missed case.
        // previousNodeIds here is [lastCondId] (a TRUE-path source, not a
        // false-path one), so this specific gap couldn't manifest for a
        // while-loop's own immediate body entry -- but the SAME parseActions
        // call also seeds the tracking sets used for everything parsed
        // deeper inside the body, so leaving it unforwarded was still a
        // latent inconsistency with every other call site. Fixed for
        // consistency and to close off this class of bug for good.
        const bodyResult = parseActions(repeatSequence as (HAAction | HACondition)[], {
          warnings,
          previousNodeIds: [lastCondId],
          getNextNodeId,
          conditionNodeIds: localConditionNodeIds,
          falsePathConditionIds,
          inheritedEnabled: blockEnabled,
          nested: true,
        });
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);

        // Every edge from the last condition into the body is its 'true'
        // edge (all of them, not the one to the first node
        // made -- a body opening with a parallel has several).
        markEntryEdges(bodyResult.edges, lastCondId, { sourceHandle: 'true' });

        // Create back-edge(s) from the body's own tracked terminal nodes
        // back to the loop's first condition (bug found 2026-09-07,
        // maximal parser stress test round 3). The OLD approach inferred
        // "the last body node" by scanning for a node with no further
        // outgoing edge inside the body's own edge list -- a heuristic
        // that silently breaks whenever the body's real trailing
        // statement is itself a nested repeat/if/parallel, because that
        // construct's OWN internal machinery nodes (e.g. a nested
        // repeat.count's counter-check condition) can *also* look
        // "terminal" by that same test, and array order has no
        // relationship to which one is the actual control-flow exit.
        // Confirmed via a real repro: a `repeat.while` whose body ends in
        // `repeat: {count: 1, ...}` had its back-edge wired FROM the
        // inner count-loop's own termination-check condition node
        // straight to the outer while's header -- silently bypassing the
        // outer loop's real body content and producing an edge from a
        // condition node with no sourceHandle at all (the same
        // "must have sourceHandle 'true' or 'false', got: undefined"
        // rejection as bug #17, but a structurally different cause).
        // `bodyResult.terminalNodeIds` is the exact, already-computed,
        // authoritative answer to "what is this parsed body actually
        // still hanging open at" -- it's currentNodeIds at the end of
        // parseActions, the same value every other consumer in this file
        // (the parallel-block handling above, sequence-block handling
        // below) already trusts for this exact question. Using it here
        // fixes both the wrong-node selection AND the missing-handle
        // issue in one pass, since falsePathTerminalNodeIds/
        // truePathConditionTerminalIds tell us exactly which handle (if
        // any) each terminal needs.
        if (bodyResult.nodes.length > 0) {
          const terminalIds =
            bodyResult.terminalNodeIds.length > 0
              ? bodyResult.terminalNodeIds
              : [bodyResult.nodes[bodyResult.nodes.length - 1].id];
          for (const termId of terminalIds) {
            const sourceHandle = bodyResult.falsePathTerminalNodeIds.includes(termId)
              ? 'false'
              : bodyResult.truePathConditionTerminalIds.includes(termId)
                ? 'true'
                : undefined;
            const backEdge = createEdge(termId, conditionNodes[0].id, sourceHandle);
            (backEdge as Record<string, unknown>).type = 'loop-back';
            edges.push(backEdge);
          }
        }

        // Output continues from first condition's FALSE path
        currentNodeIds = [conditionNodes[0].id];
        falsePathConditionIds.add(conditionNodes[0].id);
      } else if (conditionList(repeat.until).length > 0) {
        // ── repeat.until ──
        // body... → condition_node →(true)→ [continues]
        // condition_node →(false, back-edge)→ first body node

        // Parse body sequence first. falsePathConditionIds forwarded
        // here for the same reason as repeat.while's body call above
        // (bug found 2026-09-07, maximal parser stress test round 3) --
        // this one DOES have real exposure, since previousNodeIds here is
        // `currentNodeIds` (whatever was active before this repeat.until
        // block), which can genuinely be a false-path source (e.g. a
        // repeat.until as the very first statement of an if/else's
        // else:). Without forwarding, an edge from that outer false-path
        // node into this loop's own first body node would lose its
        // 'false' handle the same way bug #17's parallel-block edges did.
        // Bug #24 (2026-09-26, found by running compiled YAML with the
        // Phase 4 interpreter): the loop-back edge below targets ONE node,
        // `firstBodyNodeId`. When the body opens with a `parallel:` block
        // there is no single first node -- each branch is its own entry --
        // so the loop re-entered only one branch on every iteration after
        // the first (the rest silently skipped). When the body opens with
        // another loop, that loop's entry node doubles as this loop's, and
        // both loops' patterns collide on it. In both cases, open the body
        // with a pass-through Join node (transparent to every strategy and
        // verifier) and loop back to that instead: a single, unambiguous
        // re-entry point that fans out to every branch.
        const firstStatement = (repeatSequence as unknown[])[0] as
          | Record<string, unknown>
          | undefined;
        const needsLoopAnchor =
          !!firstStatement &&
          typeof firstStatement === 'object' &&
          ('parallel' in firstStatement || 'repeat' in firstStatement);
        let bodyPreviousIds = currentNodeIds;
        let loopAnchorId: string | null = null;
        if (needsLoopAnchor) {
          loopAnchorId = getNextNodeId('join');
          nodes.push({
            id: loopAnchorId,
            type: 'join',
            position: { x: 0, y: 0 },
            data: { mode: 'all' },
          } as FlowNode);
          createEdgesFromCurrent(loopAnchorId);
          bodyPreviousIds = [loopAnchorId];
        }

        const bodyResult = parseActions(repeatSequence as (HAAction | HACondition)[], {
          warnings,
          previousNodeIds: bodyPreviousIds,
          getNextNodeId,
          conditionNodeIds: localConditionNodeIds,
          falsePathConditionIds,
          inheritedEnabled: blockEnabled,
          nested: true,
        });
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);

        // Find the first body node. NOTE: this "first node CREATED, not
        // first node actually entered" selection has the same known
        // limitation bug #14 fixed for repeat.count (via redirecting to
        // counterId) -- repeat.until has no equivalent dedicated anchor
        // node to redirect to, and a prior attempt at a graph-structural
        // workaround was found (via the fuzzer) to corrupt an unrelated
        // class of automations where this same body-building code is
        // reused as state-machine.ts's nativeSubBuilder, and was reverted
        // (see project memory). Deliberately left AS-IS here -- this
        // round's fix only touches the LAST-node/terminal selection below,
        // which is a separate, purely-structural bookkeeping question with
        // no such reuse hazard.
        const firstBodyNodeId =
          loopAnchorId ?? (bodyResult.nodes.length > 0 ? bodyResult.nodes[0].id : null);

        // Create condition nodes from until conditions
        // One condition, a list or a template string, shorthands expanded (bug #59).
        const untilConditions = conditionList(repeat.until);

        const conditionNodes: ConditionNode[] = [];
        for (let ci = 0; ci < untilConditions.length; ci++) {
          const condId = getNextNodeId('condition');
          const parsedData: ConditionNode['data'] = importCondition(
            untilConditions[ci],
            'repeat until'
          );
          if (ci === 0 && blockAlias && bodyResult.nodes.length === 0) {
            parsedData.alias = blockAlias;
          }
          // Bug #32: keep the condition's own `enabled: false`.
          // (A disabled loop never gets here -- it's kept whole, bug #33.)
          parsedData.enabled = conditionEnabledAsWritten(untilConditions[ci], false);
          // Stamp _blockKey on the until-condition — same reasoning as
          // repeat.while's condition node above.
          if (ci === 0) {
            (parsedData as Record<string, unknown>)._blockKey = 'repeat_until';
          }
          const condNode: ConditionNode = {
            id: condId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: parsedData,
          };
          conditionNodes.push(condNode);
          nodes.push(condNode);
          localConditionNodeIds.add(condId);
        }

        // Connect the body's own tracked terminal node(s) to the first
        // until-condition (bug found 2026-09-07, maximal parser stress
        // test round 3 -- same root cause and fix as repeat.while's
        // back-edge above: bodyResult.terminalNodeIds is the authoritative
        // "what does this body actually still hang open at" answer,
        // replacing the old single-node "no further outgoing edge inside
        // the body" heuristic that picked the wrong node whenever the
        // body's real trailing statement was itself a nested loop/if/
        // parallel). falsePathTerminalNodeIds/truePathConditionTerminalIds
        // give the correct handle (if any) for each terminal directly.
        if (bodyResult.nodes.length > 0) {
          const terminalIds =
            bodyResult.terminalNodeIds.length > 0
              ? bodyResult.terminalNodeIds
              : [bodyResult.nodes[bodyResult.nodes.length - 1].id];
          for (const termId of terminalIds) {
            const sourceHandle = bodyResult.falsePathTerminalNodeIds.includes(termId)
              ? 'false'
              : bodyResult.truePathConditionTerminalIds.includes(termId)
                ? 'true'
                : undefined;
            edges.push(createEdge(termId, conditionNodes[0].id, sourceHandle));
          }
        } else {
          // Empty body - connect previous nodes directly to condition
          createEdgesFromCurrent(conditionNodes[0].id);
        }

        // Chain condition nodes together with 'true' edges
        for (let ci = 0; ci < conditionNodes.length - 1; ci++) {
          edges.push(createEdge(conditionNodes[ci].id, conditionNodes[ci + 1].id, 'true'));
        }

        const lastCondId = conditionNodes[conditionNodes.length - 1].id;

        // Create back-edge from first condition →(false)→ first body node
        if (firstBodyNodeId) {
          const backEdge = createEdge(conditionNodes[0].id, firstBodyNodeId, 'false');
          (backEdge as Record<string, unknown>).type = 'loop-back';
          edges.push(backEdge);
        }

        // Output continues from last condition's TRUE path
        currentNodeIds = [lastCondId];
      } else if (repeat.count !== undefined) {
        // ── repeat.count ──
        // set_vars(counter=0) → body... → set_vars(counter+1) → condition(counter < N)
        //                        ↑                                     │(true)    │(false)
        //                        └──── back-edge (repeatType=count) ──┘           → [continues]
        const countValue = repeat.count;
        const counterId = getNextNodeId('set_variables');
        const counterVarName = `_repeat_counter_${counterId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

        // Create init set_variables node: counter = 0
        const initNode: SetVariablesNode = {
          id: counterId,
          type: 'set_variables',
          position: { x: 0, y: 0 },
          data: {
            alias: blockAlias,
            variables: { [counterVarName]: 0 },
            enabled: blockEnabled,
          },
        };
        nodes.push(initNode);
        createEdgesFromCurrent(counterId);

        // Parse body sequence. falsePathConditionIds forwarded here for
        // the same reason as the while/until body calls above (bug found
        // 2026-09-07, maximal parser stress test round 3) -- previousNodeIds
        // is [counterId], a freshly-created node for THIS block, so this
        // specific call has no direct exposure to an outer false-path
        // source, but forwarding it keeps this call consistent with every
        // other recursive parseActions call site and correctly threads it
        // to whatever gets parsed further inside the body.
        const bodyResult = parseActions(repeatSequence as (HAAction | HACondition)[], {
          warnings,
          previousNodeIds: [counterId],
          getNextNodeId,
          conditionNodeIds: localConditionNodeIds,
          falsePathConditionIds,
          inheritedEnabled: blockEnabled,
          nested: true,
        });
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);

        // Create increment set_variables node: counter = counter + 1
        const incrId = getNextNodeId('set_variables');
        const incrNode: SetVariablesNode = {
          id: incrId,
          type: 'set_variables',
          position: { x: 0, y: 0 },
          data: {
            variables: { [counterVarName]: `{{ ${counterVarName} + 1 }}` },
            enabled: blockEnabled,
          },
        };
        nodes.push(incrNode);
        // Wire the body's own tracked terminal node(s) into the increment
        // step (bug found 2026-09-07, maximal parser stress test round 3
        // -- same root cause and fix as the while/until back-edges above:
        // bodyResult.terminalNodeIds replaces the old "no further outgoing
        // edge inside the body" heuristic, which picked the wrong node
        // whenever the body's real trailing statement was itself a nested
        // loop/if/parallel -- e.g. a repeat.count body ending in a nested
        // repeat.while wired this edge from the INNER loop's own header
        // condition instead of correctly using its terminalNodeIds
        // (the inner loop's real exit-continuation point)).
        if (bodyResult.nodes.length > 0) {
          const terminalIds =
            bodyResult.terminalNodeIds.length > 0
              ? bodyResult.terminalNodeIds
              : [bodyResult.nodes[bodyResult.nodes.length - 1].id];
          for (const termId of terminalIds) {
            const sourceHandle = bodyResult.falsePathTerminalNodeIds.includes(termId)
              ? 'false'
              : bodyResult.truePathConditionTerminalIds.includes(termId)
                ? 'true'
                : undefined;
            edges.push(createEdge(termId, incrId, sourceHandle));
          }
        } else {
          edges.push(createEdge(counterId, incrId));
        }

        // Create condition node: counter < N
        const condId = getNextNodeId('condition');
        const condNode: ConditionNode = {
          id: condId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            condition: 'template',
            value_template: `{{ ${counterVarName} < ${countValue} }}`,
            enabled: blockEnabled,
          },
        };
        nodes.push(condNode);
        localConditionNodeIds.add(condId);
        edges.push(createEdge(incrId, condId));

        // Back-edge: condition →(true)→ body's true entry point (or init if
        // no body). This must be `counterId` -- the node whose OWN forward
        // edges (wired above, via `createEdgesFromCurrent(counterId)` +
        // `parseActions({ previousNodeIds: [counterId] })`) already fan out
        // to every one of the body's first-step branches -- and NOT
        // `bodyResult.nodes[0]`, which is merely the first node CREATED
        // while parsing the body. Those are only the same node when the
        // body's first step is a single action. When the body's first step
        // is itself a `parallel:` block, `bodyResult.nodes[0]` is just ONE
        // arbitrary sibling of that parallel (whichever branch happened to
        // be parsed first) with no outgoing edge of its own back to the
        // other siblings -- looping back onto it re-runs only that one
        // sibling on iteration 2+, silently dropping the rest every
        // subsequent iteration (found via empirical audit, 2026-09-06:
        // `repeat: {count: N, sequence: [parallel: [...]]}` decompiled
        // back with only the parallel's first branch surviving inside
        // `repeat.sequence`). Targeting `counterId` instead re-enters the
        // body through the same fan-out point real (first-iteration)
        // execution already uses, for both the single-action and
        // multi-branch-first-step cases alike.
        const loopTargetId = bodyResult.nodes.length > 0 ? counterId : incrId;
        const backEdge = createEdge(condId, loopTargetId, 'true');
        (backEdge as Record<string, unknown>).type = 'loop-back';
        edges.push(backEdge);

        // Output continues from condition's FALSE path
        currentNodeIds = [condId];
        falsePathConditionIds.add(condId);
      } else {
        // Unknown repeat type (`for_each`) - kept whole
        keepRepeatWhole();
      }
    } else if (isServiceAction(action)) {
      // Regular service call action (support both 'service' and 'action' fields)
      const nodeId = getNextNodeId('action');
      try {
        const act = action as Record<string, unknown>;
        // Use spread pattern to preserve unknown properties from custom integrations
        const {
          alias,
          service,
          action: actionField,
          target,
          data,
          data_template,
          response_variable,
          continue_on_error,
          enabled,
          ...extraProps
        } = act;
        const actionNode: ActionNode = {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // Preserve extra properties
            alias: typeof alias === 'string' ? alias : undefined,
            service:
              typeof service === 'string'
                ? service
                : typeof actionField === 'string'
                  ? actionField
                  : undefined,
            target: typeof target === 'object' && target !== null ? (target as Target) : undefined,
            data:
              typeof data === 'object' && data !== null
                ? (data as Record<string, unknown>)
                : undefined,
            data_template:
              typeof data_template === 'object' && data_template !== null
                ? (data_template as Record<string, string>)
                : undefined,
            response_variable:
              typeof response_variable === 'string' ? response_variable : undefined,
            continue_on_error:
              typeof continue_on_error === 'boolean' ? continue_on_error : undefined,
            enabled: getNodeEnabled(stepEnabledAsWritten(enabled)),
          },
        };
        nodes.push(actionNode);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } catch (error) {
        // Kept exactly as written rather than rewritten (bug #57); it used
        // to become a detached `unknown.unknown` node.
        warnings.push(`Failed to parse action ${index}: ${error}`);
        nodes.push(
          createOpaqueStepNode(
            nodeId,
            action as Record<string, unknown>,
            inheritedEnabled === false
          )
        );
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      }
    } else if (isSetConversationResponseAction(action)) {
      // set_conversation_response action - convert to service call format
      const nodeId = getNextNodeId('action');
      const act = action as Record<string, unknown>;
      const actionNode: ActionNode = {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          // Store the response as a special action
          set_conversation_response:
            typeof act.set_conversation_response === 'string'
              ? act.set_conversation_response
              : undefined,
          enabled: getNodeEnabled(stepEnabledAsWritten(act.enabled)),
        },
      };
      nodes.push(actionNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isStopAction(action)) {
      // Stop action - halts automation execution
      const nodeId = getNextNodeId('action');
      const act = action as Record<string, unknown>;
      const actionNode: ActionNode = {
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          stop: typeof act.stop === 'string' ? act.stop : '',
          ...(act.error === true ? { error: true } : {}),
          ...(typeof act.response_variable === 'string'
            ? { response_variable: act.response_variable }
            : {}),
          ...(typeof act.continue_on_error === 'boolean'
            ? { continue_on_error: act.continue_on_error }
            : {}),
          enabled: getNodeEnabled(stepEnabledAsWritten(act.enabled)),
        },
      };
      nodes.push(actionNode);
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    } else if (isSequenceAction(action)) {
      // "Grouping actions" building block — represented explicitly on
      // canvas as a matched sequence_start/sequence_end marker pair (see
      // native.ts's detectSequencePatterns, the write-side counterpart of
      // this), so a re-imported automation shows the same named boundary
      // a user creates via the canvas's Sequence block, rather than
      // silently flattening it away.
      const act = action as Record<string, unknown>;
      const blockEnabled = getNodeEnabled(
        typeof act.enabled === 'boolean' ? act.enabled : undefined
      );
      const startId = getNextNodeId('sequence_start');
      nodes.push({
        id: startId,
        type: 'sequence_start',
        position: { x: 0, y: 0 },
        data: {
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          enabled: blockEnabled,
        },
      });
      createEdgesFromCurrent(startId);

      const nestedSequence = act.sequence as (HAAction | HACondition)[];
      const nestedResult = parseActions(nestedSequence, {
        warnings,
        previousNodeIds: [startId],
        getNextNodeId,
        conditionNodeIds: localConditionNodeIds,
        inheritedEnabled: blockEnabled,
        nested: true,
      });
      nodes.push(...nestedResult.nodes);
      edges.push(...nestedResult.edges);
      // Propagate any condition nodes created inside so the edge into the
      // end marker below (via createEdgesFromCurrent) uses the correct
      // true/false handle (mirrors how repeat bodies propagate this).
      for (const n of nestedResult.nodes) {
        if (n.type === 'condition') localConditionNodeIds.add(n.id);
      }
      // Bug #31 (2026-09-26, found by yaml-shapes-fuzz): ...and the ones
      // whose way OUT is their false handle -- a `repeat: count`/`while`
      // test, an else-less if -- must say so, or the edge into the end
      // marker hangs off the true handle. A group ending in a count loop
      // then ended the whole automation after the loop (bug #11's class:
      // the nested parse already knows which terminals exit on false).
      for (const id of nestedResult.falsePathTerminalNodeIds) falsePathConditionIds.add(id);

      const endId = getNextNodeId('sequence_end');
      nodes.push({ id: endId, type: 'sequence_end', position: { x: 0, y: 0 }, data: {} });
      currentNodeIds =
        nestedResult.terminalNodeIds.length > 0 ? nestedResult.terminalNodeIds : [startId];
      createEdgesFromCurrent(endId);
      currentNodeIds = [endId];
    } else {
      // A step this parser doesn't know (`scene:`, the legacy
      // `service_template:`, a step type HA adds later): kept exactly as
      // written and written back unchanged (bug #57, decision D3).
      const nodeId = getNextNodeId('action');
      nodes.push(
        createOpaqueStepNode(nodeId, action as Record<string, unknown>, inheritedEnabled === false)
      );
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
    }
  });

  return {
    nodes,
    edges,
    terminalNodeIds: currentNodeIds,
    truePathConditionTerminalIds: currentNodeIds.filter((id) => localConditionNodeIds.has(id)),
    falsePathTerminalNodeIds: currentNodeIds.filter((id) => falsePathConditionIds.has(id)),
  };
}

/**
 * Parse choose block (condition branching in actions)
 *
 * Home Assistant `choose` semantics:
 * - Evaluate conditions in order
 * - Execute ONLY the first matching branch's sequence
 * - If no conditions match, execute the default (if present)
 *
 * This creates a chain: condition1 → (true: seq1) → (false: condition2) → (true: seq2) → ... → default
 */
export function parseChooseBlock(
  chooseAction: Record<string, unknown>,
  options: ParseOptions
): {
  nodes: FlowNode[];
  edges: FlowEdge[];
  outputNodeIds: string[];
  falsePathOutputIds: string[];
} {
  const {
    warnings,
    previousNodeIds,
    getNextNodeId,
    conditionNodeIds = new Set(),
    falsePathConditionIds = new Set(),
    inheritedEnabled,
    triggerNodeMap,
  } = options;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const outputNodeIds: string[] = [];
  const falsePathOutputIds: string[] = [];
  const localConditionIds = new Set(conditionNodeIds);

  // Build reverse map: trigger-id-value → trigger-node-ids (for hint edges)
  // triggerNodeMap is: triggerNodeId → triggerIdValue. Several triggers
  // can share an id (a map to one node kept only the last).
  const triggerIdToNodeIds = new Map<string, string[]>();
  if (triggerNodeMap) {
    for (const [nodeId, triggerId] of triggerNodeMap.entries()) {
      triggerIdToNodeIds.set(triggerId, [...(triggerIdToNodeIds.get(triggerId) ?? []), nodeId]);
    }
  }
  // Set of trigger node IDs — used to skip plain flow edges from triggers to case1.
  // Hint edges already show the matching trigger→condition connection visually.
  const triggerNodeIds = new Set(triggerNodeMap?.keys() ?? []);

  // Compute effective enabled state: if parent is disabled or this block is disabled
  const blockEnabled = chooseAction.enabled;
  const effectiveEnabled =
    inheritedEnabled === false ? false : blockEnabled === false ? false : undefined;

  // Bug #32 (2026-09-26, found by the Phase 5 disabled-steps fuzz): a
  // condition's OWN `enabled: false` (HA: that condition counts as removed)
  // was overwritten by the block's enabled state, so a condition disabled
  // in HA came back active.
  const conditionEnabled = (condition: Record<string, unknown> | undefined) =>
    conditionEnabledAsWritten(condition, effectiveEnabled === false);

  const choices = Array.isArray(chooseAction.choose) ? chooseAction.choose : [chooseAction.choose];

  // Filter to only valid choices with non-empty conditions
  const validChoices = choices.filter((choice) => {
    if (typeof choice !== 'object' || choice === null) return false;
    const conds = (choice as Record<string, unknown>).conditions;
    return Array.isArray(conds) ? conds.length > 0 : Boolean(conds);
  });

  // A choice with empty/no conditions is vacuously always-true in HA and has no
  // condition to hang a node off of. Rather than silently dropping its actions
  // (issue: such a choice disappeared entirely on import), fold the first one's
  // sequence into the default branch - an always-true case behaves like a
  // fallback. A second one, or a clash with an explicit `default:`, can't be
  // merged unambiguously, so we warn instead of silently losing the actions.
  let syntheticDefaultSequence: unknown;
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null || validChoices.includes(choice)) continue;
    const choiceSequence = (choice as Record<string, unknown>).sequence;
    if (!choiceSequence) continue;
    if (toList(chooseAction.default).length > 0 || syntheticDefaultSequence) {
      warnings.push(
        'Choose block has a choice with empty conditions whose actions could not be preserved (would clash with the default branch).'
      );
      continue;
    }
    syntheticDefaultSequence = choiceSequence;
  }

  // Track what nodes should connect to the next condition (false path of current)
  let currentPreviousIds = [...previousNodeIds];

  validChoices.forEach((choice, choiceIndex) => {
    // One condition, a list or a template string, shorthands expanded (bug #59).
    const conditionsArray = conditionList(choice.conditions);

    // Create separate condition nodes for each condition in the choice (explode AND conditions)
    const choiceConditionNodes: ConditionNode[] = [];

    for (let i = 0; i < conditionsArray.length; i++) {
      const condition = conditionsArray[i] as Record<string, unknown>;
      const conditionId = getNextNodeId('condition');

      let conditionNode: ConditionNode;

      if (condition && Array.isArray(condition.conditions)) {
        // Condition with nested conditions (or/and/not) - preserve structure
        const conditionType = resolveConditionType(condition.condition);

        conditionNode = {
          id: conditionId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            // Only first condition in first choice gets the alias
            alias: i === 0 ? choice.alias : undefined,
            condition: conditionType,
            conditions: transformConditions(condition.conditions),
            // Preserve id for trigger conditions
            id: condition.id as string | undefined,
            enabled: conditionEnabled(condition),
            // Mark first condition of each case for visual case label, and
            // stamp _blockKey so this card opens the AND miller on
            // double-click the same way a natively-built Choose case does
            // (block-factories.ts's createChooseBlock) — see this file's
            // header comment on the _blockKey import gap. Only the first
            // (case-entry) condition gets it, matching the native shape
            // (one condition node per case) and _chooseCase's own
            // i === 0-only convention just above; AND-exploded sibling
            // conditions (i > 0) stay plain nodes edited via the property
            // panel, not the miller.
            ...(i === 0
              ? {
                  _chooseCase: choiceIndex + 1,
                  _chooseCaseTotal: validChoices.length,
                  _blockKey: 'choose',
                }
              : {}),
          },
        };
      } else {
        // Simple condition - use Zod schema for parsing and type safety
        const conditionType = resolveConditionType(condition?.condition);

        // Build object with alias override for first condition
        const looseObj = {
          ...condition,
          alias: i === 0 ? (choice.alias ?? condition?.alias) : condition?.alias,
          condition: conditionType,
          enabled: conditionEnabled(condition),
        };

        let data: HACondition = importCondition(looseObj, `choose case ${choiceIndex + 1}`);

        // Normalize id: single-element array → string (HA API returns arrays)
        if (Array.isArray(data.id) && (data.id as string[]).length === 1) {
          data = { ...data, id: (data.id as string[])[0] };
        }

        conditionNode = {
          id: conditionId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            ...data,
            // Mark first condition of each case for visual case label, and
            // stamp _blockKey — see the matching comment in the nested-
            // conditions branch above for the full explanation.
            ...(i === 0
              ? {
                  _chooseCase: choiceIndex + 1,
                  _chooseCaseTotal: validChoices.length,
                  _blockKey: 'choose',
                }
              : {}),
          },
        };
      }

      choiceConditionNodes.push(conditionNode);
      nodes.push(conditionNode);
      localConditionIds.add(conditionId);
    }

    // Guard: skip this choice entirely if no condition nodes were created
    if (choiceConditionNodes.length === 0) return;

    const firstConditionId = choiceConditionNodes[0].id;
    const lastConditionId = choiceConditionNodes[choiceConditionNodes.length - 1].id;

    // Fan-out: add a visible hint edge from each original entry node (e.g. the
    // Vorlage/gate, or a trigger) directly to this case's first condition.
    // This shows "Vorlage → Fall 1, Vorlage → Fall 2" as a fork, while the invisible
    // choose-entry/choose-chain edge still exists for transpiler topology.
    for (const entryId of previousNodeIds) {
      const fanHandle = conditionNodeIds.has(entryId) ? 'true' : undefined;
      const fanEdge = createEdge(entryId, firstConditionId, fanHandle);
      (fanEdge as Record<string, unknown>).type = 'hint';
      edges.push(fanEdge);
    }

    // Add visual hint edges: matching trigger → first condition of this choice.
    // Only when triggers are direct predecessors of this choose block (no root-level
    // condition node sits between them). If previousNodeIds contains only condition
    // nodes from an outer scope, the trigger→case connection is already implied
    // through the visible Vorlage→case path and adding a hint edge would create a
    // misleading bypass line that skips the gate.
    const triggersAreDirectPredecessors = previousNodeIds.some((id) => triggerNodeIds.has(id));
    if (triggerIdToNodeIds.size > 0 && triggersAreDirectPredecessors) {
      for (const condNode of choiceConditionNodes) {
        const condData = condNode.data as Record<string, unknown>;
        if (condData.condition === 'trigger' && condData.id) {
          // Every id in a list, and every trigger with it:
          // `id: [a, b]` passes for either, and the hint showed only the
          // first id's last trigger.
          const triggerIds = new Set(toList(condData.id).map(String));
          for (const lookupId of triggerIds) {
            for (const matchingTriggerNodeId of triggerIdToNodeIds.get(lookupId) ?? []) {
              edges.push({
                id: `hint-${matchingTriggerNodeId}-${condNode.id}`,
                source: matchingTriggerNodeId,
                target: condNode.id,
                type: 'hint',
              });
            }
          }
        }
      }
    }

    // Connect from current previous nodes to first condition of this choice
    // For first choice, connect from original previousNodeIds
    // For subsequent choices, connect from previous choice's first condition's FALSE path
    for (const prevId of currentPreviousIds) {
      let sourceHandle: string | undefined;
      let isChooseChainEdge = false;
      // In trigger-based choose blocks (choiceIndex=0), edges from trigger nodes to case1_cond
      // are marked as 'choose-entry' so they stay invisible in the UI.
      // The matching hint edges already show the visual trigger→condition connection.
      if (choiceIndex === 0 && triggerNodeIds.has(prevId)) {
        const e = createEdge(prevId, firstConditionId);
        (e as Record<string, unknown>).type = 'choose-entry';
        edges.push(e);
        continue;
      }
      if (choiceIndex > 0 && localConditionIds.has(prevId) && !conditionNodeIds.has(prevId)) {
        // Previous is a condition from this choose block - use FALSE path (choose-chain visual)
        sourceHandle = 'false';
        isChooseChainEdge = true;
      } else if (falsePathConditionIds.has(prevId)) {
        // Previous is a condition whose FALSE path should connect here
        sourceHandle = 'false';
      } else if (conditionNodeIds.has(prevId)) {
        // Previous is an external condition (e.g., root-level) - use TRUE path
        sourceHandle = 'true';
      }
      // else: previous is not a condition - no sourceHandle needed
      const e = createEdge(prevId, firstConditionId, sourceHandle);
      if (isChooseChainEdge) {
        (e as Record<string, unknown>).type = 'choose-chain';
      }
      edges.push(e);
    }

    // Chain condition nodes together with 'true' edges
    for (let i = 0; i < choiceConditionNodes.length - 1; i++) {
      edges.push(createEdge(choiceConditionNodes[i].id, choiceConditionNodes[i + 1].id, 'true'));
    }

    // Parse sequence for this choice (TRUE path from last condition)
    if (choice.sequence) {
      const sequence = Array.isArray(choice.sequence) ? choice.sequence : [choice.sequence];
      const sequenceResult = parseActions(sequence, {
        warnings,
        previousNodeIds: [lastConditionId],
        getNextNodeId,
        conditionNodeIds: localConditionIds,
        inheritedEnabled: effectiveEnabled,
        nested: true,
      });
      nodes.push(...sequenceResult.nodes);
      edges.push(...sequenceResult.edges);

      // Connect last condition node to the sequence via its 'true' handle
      if (sequenceResult.nodes.length > 0) {
        markEntryEdges(sequenceResult.edges, lastConditionId, { sourceHandle: 'true' });
        // Every actual terminal node of the sequence is an output — NOT
        // just `nodes[nodes.length - 1]` (the last node CREATED, in
        // insertion order). Found via empirical stress-test audit,
        // 2026-09-06 (Phase B item 3, round 3): when a choose case's own
        // sequence ends with a nested if/else (rather than a single
        // flat action), `sequenceResult.nodes` contains every node from
        // BOTH of that inner if's branches, pushed in the order
        // parseIfBlock builds them (condition, then then-branch nodes,
        // then else-branch nodes) — so the array's last element is
        // always the else-branch's own last node, never the then-
        // branch's, regardless of which one is actually this case's
        // real terminal(s). That silently left the then-branch's
        // terminal node with NO outgoing edge to whatever follows the
        // whole choose: block (e.g. a shared trailing action), a real
        // decompile-time data-loss bug: re-saving such a YAML without
        // ever touching that branch would silently drop the shared
        // tail action from just that one path. `parseActions` already
        // computes the correct full set via `terminalNodeIds` (used
        // this same way by parseIfBlock's own then/else handling just
        // below in this file) — reuse it here instead of re-deriving a
        // second, narrower rule.
        outputNodeIds.push(...sequenceResult.terminalNodeIds);
        // Bug #11 (2026-09-06, Phase B item 3 round 3, found via the
        // randomized fuzzer): terminalNodeIds alone only tells the CALLER
        // which node(s) to wire forward from -- it says nothing about
        // WHICH handle to use when a terminal is itself a condition node
        // (e.g. a repeat-while/until whose own body/entry already
        // consumed its "true" meaning internally, so the real forward
        // continuation is via "false"). Without this, the classification
        // loop in parseActions' isChooseAction handler (which decides
        // localConditionNodeIds vs falsePathConditionIds per output id)
        // always fell into its "true path" default for any such id,
        // because falsePathOutputIds never carried the information.
        // Concretely: a choose-case whose entire sequence is a single
        // `repeat: while` block produced a real behavioral corruption --
        // the while-condition's true edge (meant only for its own loop
        // body) got a SECOND, spurious 'true'-handle edge wired to
        // whatever follows the whole choose block, alongside the
        // legitimate 'false'-handle edge that should have carried it.
        // state-machine.ts's generateConditionBlock then fanned both
        // 'true' targets out together into one bogus `parallel:` block,
        // merging the loop body with a totally unrelated downstream
        // subtree -- verified via direct StateMachineStrategy.generate()
        // bypass on the fuzzer's iteration-13 repro, which failed
        // verifyStateMachineOutput with "no way to match up the 2
        // parallel branch(es)" even though state-machine is the
        // strategy of last resort with no further fallback.
        // parseActions' own falsePathTerminalNodeIds (the subset of
        // terminalNodeIds already known to need the false handle) is the
        // exact, already-computed answer -- propagate it, the same way
        // parseIfBlock's else-branch already seeds falsePathConditionIds
        // for its OWN nested calls, just one level further out.
        falsePathOutputIds.push(...sequenceResult.falsePathTerminalNodeIds);
      } else {
        // Empty sequence - last condition itself is output
        outputNodeIds.push(lastConditionId);
      }
    } else {
      // No sequence - the last condition's true path is an output
      outputNodeIds.push(lastConditionId);
    }

    // Next choice connects from this choice's FIRST condition's FALSE path
    // (If any condition in the chain fails, we skip to the next choice)
    currentPreviousIds = [firstConditionId];
  });

  // Handle default sequence (connects from last condition's FALSE path).
  // Marks the last condition as a false-path source via
  // falsePathConditionIds (not conditionNodeIds — see parseActions'
  // falsePathConditionIds seeding and parseIfBlock's else-branch for the
  // full explanation) so the first edge, and any if/choose block nested
  // inside the default sequence, all get correct handles automatically
  // instead of relying on a single-level find-and-patch that a real user
  // automation proved doesn't reach nested structures.
  // An empty `default: []` is no default at all (HA runs nothing there):
  // the last case's false path carries on after the choose. It used to
  // count as a default, so that path ended the automation (bug #84).
  const defaultSequence = toList(
    toList(chooseAction.default).length > 0 ? chooseAction.default : syntheticDefaultSequence
  );
  if (defaultSequence.length > 0) {
    const lastConditionId = currentPreviousIds[0];
    const defaultResult = parseActions(defaultSequence, {
      warnings,
      previousNodeIds: currentPreviousIds,
      getNextNodeId,
      conditionNodeIds: new Set(),
      falsePathConditionIds:
        currentPreviousIds.length > 0 && localConditionIds.has(lastConditionId)
          ? new Set([lastConditionId])
          : new Set(),
      inheritedEnabled: effectiveEnabled,
      nested: true,
    });
    nodes.push(...defaultResult.nodes);
    edges.push(...defaultResult.edges);
    // Tag the edges into the default as the visual 'choose-default' type
    // (all of them: a default opening with a parallel has several).
    if (currentPreviousIds.length > 0 && defaultResult.nodes.length > 0) {
      markEntryEdges(defaultResult.edges, lastConditionId, { type: 'choose-default' });
      // Every actual terminal node of the default sequence is an
      // output -- same class of bug as bug #2/#11 above (nodes[length-1]
      // is "last node CREATED", not necessarily the real exit point,
      // when the default sequence itself ends in a nested
      // if/choose/repeat), plus the false-path handle propagation via
      // falsePathTerminalNodeIds so a default sequence ending in a
      // repeat-while/until doesn't suffer the exact same corruption
      // fixed above for cases. Found in the same audit pass, 2026-09-06.
      outputNodeIds.push(...defaultResult.terminalNodeIds);
      falsePathOutputIds.push(...defaultResult.falsePathTerminalNodeIds);
    }
  } else if (validChoices.length > 0) {
    // No default - the last condition's false path is an implicit output
    // (the automation continues after the choose if no condition matches)
    const lastConditionId = currentPreviousIds[0];
    outputNodeIds.push(lastConditionId);
    // Track that this output should use FALSE path, not TRUE
    falsePathOutputIds.push(lastConditionId);
  }

  return { nodes, edges, outputNodeIds, falsePathOutputIds };
}

/**
 * Marks every plain edge from `from` among a branch's own edges: the
 * branch's ways in, several when it opens with a parallel (only
 * the edge to the first node made used to be marked). Visual hint
 * edges are left as they are; the old lookup could find a choose's fan
 * hint first and retype it into a real edge.
 */
function markEntryEdges(
  branchEdges: FlowEdge[],
  from: string,
  mark: { sourceHandle?: 'true'; type?: 'choose-default' }
): void {
  for (const edge of branchEdges) {
    if (edge.source !== from || edge.type !== undefined) continue;
    if (mark.sourceHandle) edge.sourceHandle = mark.sourceHandle;
    if (mark.type) (edge as Record<string, unknown>).type = mark.type;
  }
}

/**
 * Parse if/then/else block
 */
export function parseIfBlock(
  ifAction: {
    /** One condition, a list or a template string, as HA accepts (bug #59). */
    if: unknown;
    then: (HACondition | HAAction)[];
    else?: (HACondition | HAAction)[];
    alias?: string;
    enabled?: unknown;
  },
  options: ParseOptions
): {
  nodes: FlowNode[];
  edges: FlowEdge[];
  outputNodeIds: string[];
  falsePathOutputIds: string[];
  unconsumedPreviousIds: string[];
  /** A routing if's trigger ids, carried by its branch's ends as their
   * lane; null for any other if (or when a lane-less run joins it). */
  routedIds: string[] | null;
} {
  const {
    warnings,
    previousNodeIds,
    getNextNodeId,
    conditionNodeIds = new Set(),
    falsePathConditionIds: incomingFalsePathIds = new Set(),
    triggerNodeMap,
    laneIds,
    inheritedEnabled,
  } = options;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const outputNodeIds: string[] = [];
  const falsePathOutputIds: string[] = [];
  const localConditionIds = new Set(conditionNodeIds);

  // Compute effective enabled state: if parent is disabled or this block is disabled
  const effectiveEnabled =
    inheritedEnabled === false ? false : ifAction.enabled === false ? false : undefined;

  // Bug #32 (2026-09-26, found by the Phase 5 disabled-steps fuzz): a
  // condition's OWN `enabled: false` (HA: that condition counts as removed)
  // was overwritten by the block's enabled state, so a condition disabled
  // in HA came back active.
  const conditionEnabled = (condition: Record<string, unknown> | undefined) =>
    conditionEnabledAsWritten(condition, effectiveEnabled === false);

  // One condition, a list or a template string, shorthands expanded (bug #59).
  const ifConditions = conditionList(ifAction.if);

  // Create separate condition nodes for each condition in the if: array
  // This "explodes" combined conditions into separate linked nodes
  const conditionNodes: ConditionNode[] = [];

  for (let i = 0; i < ifConditions.length; i++) {
    const condition = ifConditions[i] as Record<string, unknown>;
    const conditionId = getNextNodeId('condition');

    let conditionNode: ConditionNode;

    if (condition && Array.isArray(condition.conditions)) {
      // Condition with nested conditions (or/and/not) - preserve structure
      const conditionType = resolveConditionType(condition.condition);

      conditionNode = {
        id: conditionId,
        type: 'condition',
        position: { x: 0, y: 0 },
        data: {
          // Only first condition gets the alias from ifAction
          alias: i === 0 ? ifAction.alias : undefined,
          condition: conditionType,
          conditions: transformConditions(condition.conditions),
          enabled: conditionEnabled(condition),
          // Stamp _blockKey on the gate condition so it opens the AND
          // miller and shows the "If" role badge/false-edge handle the
          // same way a natively-built If/Else block does
          // (block-factories.ts's createIfElseBlock) — see this file's
          // header comment on the _blockKey import gap. Only the first
          // condition in the (possibly AND-exploded) chain represents the
          // block's actual gate node, matching the native single-node
          // shape; later chain links stay plain.
          ...(i === 0 ? { _blockKey: 'if_else' } : {}),
        },
      };
    } else {
      // Simple condition - use its properties directly
      const conditionType = resolveConditionType(condition?.condition);

      // Use Zod looseObject for normalization and type safety
      const looseObj = {
        ...condition,
        // Only first condition gets the alias from ifAction
        alias: i === 0 ? (ifAction.alias ?? condition?.alias) : condition?.alias,
        condition: conditionType,
        enabled: conditionEnabled(condition),
      };

      let data: HACondition = importCondition(looseObj, 'if');

      // Normalize id: single-element array → string (HA API returns arrays)
      if (Array.isArray(data.id) && (data.id as string[]).length === 1) {
        data = { ...data, id: (data.id as string[])[0] };
      }

      conditionNode = {
        id: conditionId,
        type: 'condition',
        position: { x: 0, y: 0 },
        // Stamp _blockKey on the gate condition — see the matching
        // comment in the nested-conditions branch above. Applies equally
        // to the trigger-id-routing shape (a single `condition: trigger`
        // with no `else:`, used to dispatch independent branches off
        // shared triggers) — for that case the always-shown false handle
        // is just an available "wire an else onto this" connection point,
        // same as any plain condition someone's manually wired one onto.
        data: i === 0 ? { ...data, _blockKey: 'if_else' } : data,
      };
    }

    conditionNodes.push(conditionNode);
    nodes.push(conditionNode);
    localConditionIds.add(conditionId);
  }

  // Connect from previous nodes to the first condition.
  // Special case: if this is a single trigger-id condition (no else), only connect
  // the trigger(s) whose id matches — this creates independent parallel flows instead
  // of a single chained sequence when multiple if-trigger blocks exist.
  const firstConditionId = conditionNodes[0].id;

  // Detect trigger-id routing: a single `condition: trigger` with no else,
  // reached straight from the triggers. Anywhere else -- after another
  // step, inside a branch or a loop -- it is an ordinary if: when it
  // doesn't pass, what follows it still runs (bug #80; it used to end the
  // run there).
  // The `id` field can be a string or an array of strings in HA YAML.
  const triggerConditionIds = routingTriggerIds(
    ifAction,
    ifConditions,
    previousNodeIds,
    triggerNodeMap,
    laneIds
  );

  for (const prevId of previousNodeIds) {
    // If this is a trigger-id condition and we have trigger routing info,
    // only connect triggers whose id is listed in this condition's id array.
    if (triggerConditionIds !== null) {
      const lane = laneOf(prevId, triggerNodeMap, laneIds);
      if (lane !== undefined && !lane.some((t) => triggerConditionIds.includes(t))) {
        // Not this if's trigger(s) -- don't connect it here
        continue;
      }
    }

    let sourceHandle: string | undefined;
    if (incomingFalsePathIds.has(prevId)) {
      sourceHandle = 'false';
    } else if (localConditionIds.has(prevId)) {
      sourceHandle = 'true';
    }
    edges.push(createEdge(prevId, firstConditionId, sourceHandle));
  }

  // Chain condition nodes together with 'true' edges
  for (let i = 0; i < conditionNodes.length - 1; i++) {
    edges.push(createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
  }

  // The last condition node connects to the 'then' actions
  const lastConditionId = conditionNodes[conditionNodes.length - 1].id;

  // Parse 'then' sequence (true branch) - connects from last condition
  const thenSequence = Array.isArray(ifAction.then)
    ? ifAction.then
    : ifAction.then
      ? [ifAction.then]
      : [];
  // `then: []` is a no-op in HA (identical to omitting `then` entirely)
  // -- an empty array is truthy in JS, so this checks actual content
  // instead of just key presence (see the matching `ifAction.else` fix
  // just below for the real bug this caused, found via real-automation
  // round-trip testing, 2026-09-07).
  if (thenSequence.length > 0) {
    const thenResult = parseActions(thenSequence, {
      warnings,
      previousNodeIds: [lastConditionId],
      getNextNodeId,
      conditionNodeIds: localConditionIds,
      inheritedEnabled: effectiveEnabled,
      nested: true,
    });
    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);

    // The edges from the last condition into then use its 'true' handle
    markEntryEdges(thenResult.edges, lastConditionId, { sourceHandle: 'true' });

    // Track all terminal nodes from then branch (not just the last created node,
    // as the last action in the sequence may itself be an if/then/else with multiple exits)
    outputNodeIds.push(...thenResult.terminalNodeIds);
    // Bug #11 (2026-09-06): propagate which of those terminals are
    // themselves false-path exits (e.g. a nested repeat-while/until
    // whose real forward continuation is via its own "false" handle) --
    // see parseChooseBlock's per-case sequence handling above for the
    // full explanation and the corruption this prevents.
    falsePathOutputIds.push(...thenResult.falsePathTerminalNodeIds);
  }

  // Parse 'else' sequence (false branch) - connects from FIRST condition only
  // (This matches the expected behavior: only the first condition handles the else path)
  const elseSequence = Array.isArray(ifAction.else)
    ? ifAction.else
    : ifAction.else
      ? [ifAction.else]
      : [];
  // `else: []` is a no-op in HA (identical to omitting `else` entirely)
  // -- an empty array is truthy in JS, so this checks actual content
  // instead of just key presence. Getting this wrong was a real bug
  // (found via real-automation round-trip testing, 2026-09-07): an explicit
  // `else: []` was wrongly treated as "has content", so
  // parseActions([]) produced a pass-through terminal node (the
  // condition itself, forwarded unchanged) that got pushed into
  // outputNodeIds/falsePathOutputIds *in addition to* the identical id
  // `then: []` had already pushed there via the exact same bug -- two
  // entries for the same physical node, which downstream connection
  // logic then read as two separate edges to the next node instead of
  // one, corrupting the decompiled graph with duplicate edges.
  if (elseSequence.length > 0) {
    // Mark firstConditionId as a false-path source via falsePathConditionIds
    // (not conditionNodeIds, which means "true"-path) so parseActions'
    // createEdgesFromCurrent assigns 'false' to the very first edge
    // automatically and — critically — forwards this same set into any
    // nested if/choose block within the else sequence, so deeply nested
    // structures get correct handles throughout, not just at the first
    // level. See parseActions' falsePathConditionIds seeding above for
    // the full explanation of why this replaced a previous manual
    // create-then-patch workaround.
    const elseResult = parseActions(elseSequence, {
      warnings,
      previousNodeIds: [firstConditionId],
      getNextNodeId,
      conditionNodeIds: new Set(),
      falsePathConditionIds: new Set([firstConditionId]),
      inheritedEnabled: effectiveEnabled,
      nested: true,
    });
    nodes.push(...elseResult.nodes);
    edges.push(...elseResult.edges);

    // Track all terminal nodes from else branch
    outputNodeIds.push(...elseResult.terminalNodeIds);
    // Bug #11 (2026-09-06): same false-path propagation as the then-
    // branch just above -- see parseChooseBlock's per-case sequence
    // handling for the full explanation.
    falsePathOutputIds.push(...elseResult.falsePathTerminalNodeIds);
  } else if (triggerConditionIds !== null) {
    // Trigger-id routing: this if block is a dedicated branch for one trigger.
    // There is no sequential false-path continuation — subsequent if blocks are
    // independent branches, each connected directly from their matching trigger.
    // Don't add condition nodes to outputs; they are leaf nodes for this branch.
  } else {
    // No else branch: every condition node is an implicit false exit.
    // The first condition's false path skips the entire if block; each subsequent
    // condition in the AND-chain also exits false when it fails.
    for (const condNode of conditionNodes) {
      outputNodeIds.push(condNode.id);
      falsePathOutputIds.push(condNode.id);
    }
  }

  // If no outputs were added (empty then + else branch), the last condition is the output
  if (outputNodeIds.length === 0 && triggerConditionIds === null) {
    outputNodeIds.push(lastConditionId);
    falsePathOutputIds.push(lastConditionId);
  }

  // Bug #38 (2026-09-26, found by the Phase 5 round-trip checks): with an
  // empty `then:`, the conditions' TRUE path was left unwired -- as if the
  // flow ended there -- instead of carrying on with what follows the if.
  // `if: C, then: [], else: [X]` followed by Y came back as "not C gates
  // Y", and NativeStrategy promoted it to a root condition. That's the
  // shape NativeStrategy itself writes for an "if NOT" drawn on the canvas.
  // (An if with both branches empty never gets here -- parseActions drops
  // it as the no-op it is.)
  if (
    thenSequence.length === 0 &&
    triggerConditionIds === null &&
    !falsePathOutputIds.includes(lastConditionId)
  ) {
    outputNodeIds.push(lastConditionId);
  }

  // For trigger-id routing: the trigger nodes that were NOT consumed by this if block
  // must remain available for subsequent if blocks.
  const passesBy = (id: string): boolean => {
    const lane = laneOf(id, triggerNodeMap, laneIds);
    return lane !== undefined && !lane.some((t) => triggerConditionIds?.includes(t));
  };
  const unconsumedPreviousIds =
    triggerConditionIds !== null ? previousNodeIds.filter(passesBy) : [];
  // The routed branch carries the if's ids on, unless a run with no lane
  // (every trigger's) came in too.
  const routedIds =
    triggerConditionIds !== null &&
    previousNodeIds.every((id) => passesBy(id) || laneOf(id, triggerNodeMap, laneIds) !== undefined)
      ? triggerConditionIds
      : null;

  return { nodes, edges, outputNodeIds, falsePathOutputIds, unconsumedPreviousIds, routedIds };
}
