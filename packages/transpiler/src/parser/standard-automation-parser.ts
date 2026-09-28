/**
 * Parses a standard (non-state-machine) Home Assistant automation's
 * top-level structure -- triggers, root-level conditions, and the actions
 * sequence -- into FlowNodes/FlowEdges. Extracted from YamlParser.ts
 * (the 2026-09-25 file-decomposition
 * work) as a pure move -- no logic changed,
 * only relocated.
 */
import type { ConditionNode, FlowEdge, FlowNode } from '@circuitry/shared';
import { generateNodeId } from '../utils/generateIds';
import { parseActions } from './action-block-parser';
import {
  conditionList,
  normalizeActionLists,
  toList,
  withoutNoOpSteps,
} from './action-type-guards';
import { createEdge, importCondition, parseTriggers } from './parser-shared';

/**
 * Parse automation structure into nodes and edges (native format)
 */
export function parseAutomationStructure(
  content: Record<string, unknown>,
  warnings: string[],
  metadataNodeIds: string[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const conditionNodeIds = new Set<string>();
  let nodeIdIndex = 0;

  // Helper to get next node ID (from metadata if available, otherwise generate)
  const getNextNodeId = (type: string): string => {
    if (nodeIdIndex < metadataNodeIds.length) {
      return metadataNodeIds[nodeIdIndex++];
    }
    return generateNodeId(type, nodeIdIndex++);
  };

  // Parse triggers (support both 'trigger' and 'triggers')
  const triggerData = content.triggers || content.trigger;
  if (!triggerData) {
    warnings.push('No triggers found in automation');
    return { nodes, edges };
  }
  const triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
  const triggerNodes = parseTriggers(triggers, warnings, getNextNodeId);
  nodes.push(...triggerNodes);

  // Build a map from trigger node ID → trigger's `id` field (for trigger-id condition routing)
  const triggerNodeMap = new Map<string, string>();
  for (let i = 0; i < triggerNodes.length; i++) {
    const triggerId = (triggers[i] as Record<string, unknown>)?.id;
    if (typeof triggerId === 'string') {
      triggerNodeMap.set(triggerNodes[i].id, triggerId);
    }
  }

  // Parse conditions (if present at top level - support both 'condition' and 'conditions')
  let firstActionNodeIds: string[] = [];
  const conditionData = content.conditions || content.condition;
  // One condition, a list or a template string, shorthands expanded the
  // way HA expands them (bug #59; `or:`/`not:`/template shorthands used to
  // be filtered out here, and the import then crashed).
  const conditions = conditionList(conditionData);

  if (conditions.length > 0) {
    const conditionResults = parseConditions(conditions, getNextNodeId);
    nodes.push(...conditionResults.nodes);
    edges.push(...conditionResults.edges);

    // Track condition node IDs
    for (const condNode of conditionResults.nodes) {
      conditionNodeIds.add(condNode.id);
    }

    // Root-level conditions in Home Assistant are implicitly AND-ed together.
    // They should be chained sequentially: trigger → cond1 → cond2 → cond3 → actions
    // Each condition's TRUE path leads to the next condition (or to actions if last)
    const conditionNodes = conditionResults.nodes;

    if (conditionNodes.length === 1) {
      // Single condition - connect triggers to it
      for (const trigger of triggerNodes) {
        edges.push(createEdge(trigger.id, conditionNodes[0].id));
      }
      firstActionNodeIds = [conditionNodes[0].id];
    } else {
      // Multiple conditions - chain them sequentially
      // Connect triggers to first condition
      for (const trigger of triggerNodes) {
        edges.push(createEdge(trigger.id, conditionNodes[0].id));
      }

      // Chain conditions: each condition's TRUE path leads to next condition
      for (let i = 0; i < conditionNodes.length - 1; i++) {
        edges.push(createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
      }

      // The last condition's TRUE path leads to actions
      firstActionNodeIds = [conditionNodes[conditionNodes.length - 1].id];
    }
  } else {
    firstActionNodeIds = triggerNodes.map((t) => t.id);
  }

  // Parse actions (support both 'action' and 'actions')
  const actionData = content.actions || content.action;
  if (!actionData) {
    warnings.push('No actions found in automation');
    return { nodes, edges };
  }
  // Every nested action list in list form, as HA reads it (bugs #62, #67),
  // without the steps that do nothing (bug #78).
  const actions = withoutNoOpSteps(normalizeActionLists(toList(actionData)));
  const actionResults = parseActions(actions, {
    warnings,
    previousNodeIds: firstActionNodeIds,
    getNextNodeId,
    conditionNodeIds,
    triggerNodeMap,
  });
  nodes.push(...actionResults.nodes);
  edges.push(...actionResults.edges);

  return { nodes, edges };
}

/**
 * Parse condition configurations
 */
export function parseConditions(
  conditions: unknown[],
  getNextNodeId: (type: string) => string
): { nodes: ConditionNode[]; edges: FlowEdge[]; outputNodeIds: string[] } {
  const nodes: ConditionNode[] = [];
  const edges: FlowEdge[] = [];
  const outputNodeIds: string[] = [];

  conditions.forEach((condition, index) => {
    const node: ConditionNode = {
      id: getNextNodeId('condition'),
      type: 'condition',
      position: { x: 0, y: 0 },
      data: importCondition(condition, `Condition ${index}`),
    };
    nodes.push(node);
    outputNodeIds.push(node.id);
  });
  return { nodes, edges, outputNodeIds };
}
