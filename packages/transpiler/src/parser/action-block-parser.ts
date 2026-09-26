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
import { HAConditionSchema, HATriggerSchema, isDeviceAction } from '@circuitry/shared';
import {
  isChooseAction,
  isConditionAction,
  isConditionListAction,
  isDelayAction,
  isEventAction,
  isIfThenAction,
  isParallelAction,
  isRepeatAction,
  isSequenceAction,
  isServiceAction,
  isSetConversationResponseAction,
  isStopAction,
  isVariablesAction,
  isWaitAction,
  resolveConditionType,
  transformConditions,
} from './action-type-guards';
import { createEdge, createUnknownNode, unfoldEventContextUserId } from './parser-shared';

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
   * Inherited enabled state from parent block.
   * When false, all child nodes will be created with enabled: false.
   * When undefined, nodes inherit their own enabled property.
   */
  inheritedEnabled?: boolean;
}

/**
 * Parse action sequences (including choose blocks, delays, etc.)
 */
export function parseActions(
  actions: (HAAction | HACondition)[],
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
  } = options;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let currentNodeIds = previousNodeIds;
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
  const getNodeEnabled = (nodeEnabled: boolean | undefined): boolean | undefined => {
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: large dispatch switch, refactoring deferred
  actions.forEach((action, index) => {
    if (!action || typeof action !== 'object') {
      // Unknown action type - create unknown node
      warnings.push(`Unknown action type (${JSON.stringify(action)}) at index ${index}`);
      const nodeId = getNextNodeId('unknown');
      nodes.push({
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          alias: 'Unknown Node',
          service: 'unknown.unknown',
          data: action as Record<string, unknown>,
        },
      });
      createEdgesFromCurrent(nodeId);
      currentNodeIds = [nodeId];
      return;
    }

    // Handle different action types
    if (isConditionAction(action) || isConditionListAction(action)) {
      // Inline condition guard in action sequence — either a single condition
      // object (condition acts as the type discriminator) or the "list of
      // conditions" shorthand (implicit AND), which we normalize to an
      // explicit `and` condition object before parsing so both forms share
      // one code path.
      const nodeId = getNextNodeId('condition');
      const rawAct = action as Record<string, unknown>;
      const act = isConditionListAction(action)
        ? { condition: 'and', conditions: rawAct.condition, alias: rawAct.alias }
        : rawAct;
      const validatedType = resolveConditionType(act.condition as string, 'template');

      // Use Zod schema for parsing and type safety
      let parsedData: ConditionNode['data'];
      try {
        parsedData = HAConditionSchema.parse(act);
      } catch (e) {
        warnings.push(
          `Inline condition at index ${index} failed schema validation: ${e instanceof Error ? e.message : JSON.stringify(e)}`
        );
        parsedData = {
          condition: validatedType,
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          value_template: JSON.stringify(act),
        };
      }
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
          enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
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
          delay:
            typeof delayValue === 'string'
              ? delayValue
              : typeof delayValue === 'object' && delayValue !== null
                ? (delayValue as {
                    hours?: number;
                    minutes?: number;
                    seconds?: number;
                    milliseconds?: number;
                  })
                : '',
          enabled: getNodeEnabled(typeof enabled === 'boolean' ? enabled : undefined),
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

      // Handle timeout as either string or object format
      let timeout: WaitNode['data']['timeout'];
      if (typeof timeoutValue === 'string') {
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
        enabled: getNodeEnabled(typeof enabled === 'boolean' ? enabled : undefined),
      };

      if (typeof waitTemplate === 'string') {
        waitData.wait_template = waitTemplate;
      } else if (Array.isArray(waitForTrigger)) {
        const parsedTriggers = [];
        for (const trigger of waitForTrigger) {
          const result = HATriggerSchema.safeParse(trigger);
          if (result.success) {
            parsedTriggers.push(unfoldEventContextUserId(result.data));
          } else {
            warnings.push(
              `Failed to parse a trigger inside wait_for_trigger: ${result.error.message}`
            );
          }
        }
        waitData.wait_for_trigger = parsedTriggers;
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
      const act = action as Record<string, unknown>;
      const ifArr = Array.isArray(act.if) ? act.if : [];
      const thenArr = Array.isArray(act.then) ? act.then : [];
      const elseArr = Array.isArray(act.else) ? act.else : undefined;
      // Phase 5 (2026-09-26): an if with nothing in either branch does
      // nothing (HA conditions have no side effects). Kept as nodes it had no
      // stable shape: its true and false paths both have to continue, and
      // each round trip through NativeStrategy re-rendered it as a larger
      // no-op. Trigger-id routing ifs are left to parseIfBlock.
      const isTriggerRouting = ifArr.some(
        (c) => c && typeof c === 'object' && (c as Record<string, unknown>).condition === 'trigger'
      );
      if (
        thenArr.length === 0 &&
        (elseArr === undefined || elseArr.length === 0) &&
        !isTriggerRouting
      ) {
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
      // For trigger-id routing: merge unconsumed trigger nodes (those that didn't match
      // this if block's trigger id) back into currentNodeIds so they are available
      // as entry points for the next if block.
      if (ifResult.unconsumedPreviousIds.length > 0) {
        currentNodeIds = ifResult.unconsumedPreviousIds;
      } else {
        currentNodeIds = ifResult.outputNodeIds;
      }
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
          enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
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
          enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
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

      if (blockEnabled === false) {
        // Bug #33 (2026-09-26, found by the Phase 5 disabled-steps fuzz): a
        // disabled loop (its own `enabled: false`, or inside a disabled
        // block) is skipped by HA. Decomposed, the only way to carry that
        // was to disable its nodes -- and a disabled condition counts as
        // REMOVED, i.e. true, so a disabled `while`/`count` loop became an
        // endless one. Keep it whole as one opaque repeat node instead,
        // rendered back verbatim with `enabled: false`.
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
            enabled: false,
          },
        };
        nodes.push(actionNode);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (Array.isArray(repeat.while) && repeat.while.length > 0) {
        // ── repeat.while ──
        // condition_node →(true)→ body... →(back-edge)→ condition_node
        // condition_node →(false)→ [continues]
        const whileConditions = repeat.while as HACondition[];

        // Create condition nodes (chain them like if-block conditions)
        const conditionNodes: ConditionNode[] = [];
        for (let ci = 0; ci < whileConditions.length; ci++) {
          const condId = getNextNodeId('condition');
          let parsedData: ConditionNode['data'];
          try {
            parsedData = HAConditionSchema.parse(whileConditions[ci]);
          } catch {
            parsedData = {
              condition: 'template',
              value_template: JSON.stringify(whileConditions[ci]),
            };
          }
          if (ci === 0 && blockAlias) {
            parsedData.alias = blockAlias;
          }
          // Bug #32: keep the condition's own `enabled: false`.
          // (A disabled loop never gets here -- it's kept whole, bug #33.)
          parsedData.enabled =
            (whileConditions[ci] as Record<string, unknown>)?.enabled === false ? false : undefined;
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
        });
        nodes.push(...bodyResult.nodes);
        edges.push(...bodyResult.edges);

        // Fix the first edge from last condition to body to use 'true' handle
        if (bodyResult.nodes.length > 0) {
          const firstBodyId = bodyResult.nodes[0].id;
          const trueEdge = edges.find((e) => e.source === lastCondId && e.target === firstBodyId);
          if (trueEdge) {
            trueEdge.sourceHandle = 'true';
          }
        }

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
      } else if (
        (Array.isArray(repeat.until) && repeat.until.length > 0) ||
        typeof repeat.until === 'string'
      ) {
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
        const untilConditions: HACondition[] =
          typeof repeat.until === 'string'
            ? [{ condition: 'template', value_template: repeat.until }]
            : (repeat.until as HACondition[]);

        const conditionNodes: ConditionNode[] = [];
        for (let ci = 0; ci < untilConditions.length; ci++) {
          const condId = getNextNodeId('condition');
          let parsedData: ConditionNode['data'];
          try {
            parsedData = HAConditionSchema.parse(untilConditions[ci]);
          } catch {
            parsedData = {
              condition: 'template',
              value_template: JSON.stringify(untilConditions[ci]),
            };
          }
          if (ci === 0 && blockAlias && bodyResult.nodes.length === 0) {
            parsedData.alias = blockAlias;
          }
          // Bug #32: keep the condition's own `enabled: false`.
          // (A disabled loop never gets here -- it's kept whole, bug #33.)
          parsedData.enabled =
            (untilConditions[ci] as Record<string, unknown>)?.enabled === false ? false : undefined;
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
        // Unknown repeat type - create opaque action node as fallback
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
            enabled: getNodeEnabled(typeof enabled === 'boolean' ? enabled : undefined),
          },
        };
        nodes.push(actionNode);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } catch (error) {
        warnings.push(`Failed to parse action ${index}: ${error}`);
        nodes.push(createUnknownNode(nodeId, action));
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
          enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
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
          enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
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
      // Unknown action type - create unknown node
      warnings.push(`Unknown action type (${JSON.stringify(action)}) at index ${index}`);
      const nodeId = getNextNodeId('unknown');
      nodes.push({
        id: nodeId,
        type: 'action',
        position: { x: 0, y: 0 },
        data: {
          alias: 'Unknown Node',
          service: 'unknown.unknown',
          data: action as Record<string, unknown>,
        },
      });
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

  // Build reverse map: trigger-id-value → trigger-node-id (for hint edges)
  // triggerNodeMap is: triggerNodeId → triggerIdValue
  const triggerIdToNodeId = new Map<string, string>();
  if (triggerNodeMap) {
    for (const [nodeId, triggerId] of triggerNodeMap.entries()) {
      triggerIdToNodeId.set(triggerId, nodeId);
    }
  }
  // Set of trigger node IDs — used to skip plain flow edges from triggers to case1.
  // Hint edges already show the matching trigger→condition connection visually.
  const triggerNodeIds = new Set(triggerIdToNodeId.values());

  // Compute effective enabled state: if parent is disabled or this block is disabled
  const blockEnabled = chooseAction.enabled;
  const effectiveEnabled =
    inheritedEnabled === false ? false : blockEnabled === false ? false : undefined;

  // Bug #32 (2026-09-26, found by the Phase 5 disabled-steps fuzz): a
  // condition's OWN `enabled: false` (HA: that condition counts as removed)
  // was overwritten by the block's enabled state, so a condition disabled
  // in HA came back active.
  const conditionEnabled = (condition: Record<string, unknown> | undefined): false | undefined =>
    effectiveEnabled === false || condition?.enabled === false ? false : undefined;

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
    if (chooseAction.default || syntheticDefaultSequence) {
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
    // choice.conditions can be an array of conditions or a single condition object
    const conditionsArray = Array.isArray(choice.conditions)
      ? choice.conditions
      : [choice.conditions];

    // Create separate condition nodes for each condition in the choice (explode AND conditions)
    const choiceConditionNodes: ConditionNode[] = [];

    for (let i = 0; i < conditionsArray.length; i++) {
      const condition = conditionsArray[i] as Record<string, unknown>;
      const conditionId = getNextNodeId('condition');

      let conditionNode: ConditionNode;

      if (condition && Array.isArray(condition.conditions)) {
        // Condition with nested conditions (or/and/not) - preserve structure
        const conditionType = resolveConditionType(condition.condition as string, 'and');

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
        const conditionType = resolveConditionType(condition?.condition as string, 'template');

        // Build object with alias override for first condition
        const looseObj = {
          ...condition,
          alias: i === 0 ? (choice.alias ?? condition?.alias) : condition?.alias,
          condition: conditionType,
          enabled: conditionEnabled(condition),
        };

        // Validate and normalize with HAConditionSchema
        let data: HACondition;
        try {
          data = HAConditionSchema.parse(looseObj);
        } catch {
          // Fallback: minimal valid template
          data = {
            alias: i === 0 ? choice.alias : undefined,
            condition: 'template',
            value_template: JSON.stringify(condition),
            enabled: conditionEnabled(condition),
          };
        }

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
    if (triggerIdToNodeId.size > 0 && triggersAreDirectPredecessors) {
      for (const condNode of choiceConditionNodes) {
        const condData = condNode.data as Record<string, unknown>;
        if (condData.condition === 'trigger' && condData.id) {
          const rawId = condData.id;
          const lookupId = Array.isArray(rawId) ? String(rawId[0]) : String(rawId);
          const matchingTriggerNodeId = triggerIdToNodeId.get(lookupId);
          if (matchingTriggerNodeId) {
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
      });
      nodes.push(...sequenceResult.nodes);
      edges.push(...sequenceResult.edges);

      // Connect last condition node to first action in sequence via 'true' handle
      if (sequenceResult.nodes.length > 0) {
        const firstActionId = sequenceResult.nodes[0].id;
        const trueEdge = edges.find(
          (e) => e.source === lastConditionId && e.target === firstActionId
        );
        if (trueEdge) {
          trueEdge.sourceHandle = 'true';
        }
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
  if (chooseAction.default || syntheticDefaultSequence) {
    const rawDefault = chooseAction.default ?? syntheticDefaultSequence;
    const defaultSequence = Array.isArray(rawDefault) ? rawDefault : [rawDefault];
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
    });
    nodes.push(...defaultResult.nodes);
    edges.push(...defaultResult.edges);
    // Tag the first edge as a visual 'choose-default' type, matching what
    // the previous find-and-patch used to mark.
    if (currentPreviousIds.length > 0 && defaultResult.nodes.length > 0) {
      const firstDefaultId = defaultResult.nodes[0].id;
      const defaultEdge = edges.find(
        (e) => e.source === lastConditionId && e.target === firstDefaultId
      );
      if (defaultEdge) {
        (defaultEdge as Record<string, unknown>).type = 'choose-default';
      }
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
 * Parse if/then/else block
 */
export function parseIfBlock(
  ifAction: {
    if: HACondition[];
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
} {
  const {
    warnings,
    previousNodeIds,
    getNextNodeId,
    conditionNodeIds = new Set(),
    falsePathConditionIds: incomingFalsePathIds = new Set(),
    triggerNodeMap,
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
  const conditionEnabled = (condition: Record<string, unknown> | undefined): false | undefined =>
    effectiveEnabled === false || condition?.enabled === false ? false : undefined;

  const ifConditions = Array.isArray(ifAction.if) ? ifAction.if : [ifAction.if];

  // Create separate condition nodes for each condition in the if: array
  // This "explodes" combined conditions into separate linked nodes
  const conditionNodes: ConditionNode[] = [];

  for (let i = 0; i < ifConditions.length; i++) {
    const condition = ifConditions[i] as Record<string, unknown>;
    const conditionId = getNextNodeId('condition');

    let conditionNode: ConditionNode;

    if (condition && Array.isArray(condition.conditions)) {
      // Condition with nested conditions (or/and/not) - preserve structure
      const conditionType = resolveConditionType(condition.condition as string, 'and');

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
      const conditionType = resolveConditionType(condition?.condition as string, 'numeric_state');

      // Use Zod looseObject for normalization and type safety
      const looseObj = {
        ...condition,
        // Only first condition gets the alias from ifAction
        alias: i === 0 ? (ifAction.alias ?? condition?.alias) : condition?.alias,
        condition: conditionType,
        enabled: conditionEnabled(condition),
      };

      // Validate and normalize with HAConditionSchema
      let data: HACondition;
      try {
        data = HAConditionSchema.parse(looseObj);
      } catch {
        // Fallback: minimal valid template
        data = {
          alias: i === 0 ? ifAction.alias : undefined,
          condition: 'template',
          value_template: JSON.stringify(condition),
          enabled: conditionEnabled(condition),
        };
      }

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

  // Detect trigger-id routing: a single `condition: trigger` with no else.
  // The `id` field can be a string or an array of strings in HA YAML.
  const triggerConditionIds: string[] | null = (() => {
    const elseIsEmpty = !ifAction.else || (Array.isArray(ifAction.else) && ifAction.else.length === 0);
    if (!elseIsEmpty || ifConditions.length !== 1) return null;
    const cond = ifConditions[0] as Record<string, unknown>;
    if (cond?.condition !== 'trigger') return null;
    const rawId = cond?.id;
    if (typeof rawId === 'string') return [rawId];
    if (Array.isArray(rawId) && rawId.length > 0 && rawId.every((x) => typeof x === 'string'))
      return rawId as string[];
    return null;
  })();

  for (const prevId of previousNodeIds) {
    // If this is a trigger-id condition and we have trigger routing info,
    // only connect triggers whose id is listed in this condition's id array.
    if (triggerConditionIds !== null && triggerNodeMap) {
      const triggerIdForNode = triggerNodeMap.get(prevId);
      if (triggerIdForNode !== undefined && !triggerConditionIds.includes(triggerIdForNode)) {
        // This trigger's id doesn't match — don't connect it here
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
    });
    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);

    // The edges from last condition to first action should use 'true' handle
    if (thenResult.nodes.length > 0) {
      const firstActionId = thenResult.nodes[0].id;
      const trueEdge = edges.find(
        (e) => e.source === lastConditionId && e.target === firstActionId
      );
      if (trueEdge) {
        trueEdge.sourceHandle = 'true';
      }
    }

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
  const unconsumedPreviousIds =
    triggerConditionIds !== null && triggerNodeMap
      ? previousNodeIds.filter((id) => {
          const triggerId = triggerNodeMap.get(id);
          // Keep: trigger nodes whose id is not in this condition's id list, OR non-trigger nodes
          return triggerId === undefined || !triggerConditionIds.includes(triggerId);
        })
      : [];

  return { nodes, edges, outputNodeIds, falsePathOutputIds, unconsumedPreviousIds };
}
