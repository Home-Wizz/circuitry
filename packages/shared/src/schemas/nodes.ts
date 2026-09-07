import { z } from 'zod';
import { PositionSchema } from './base';
import {
  HAActionSchema,
  HAConditionSchema,
  HADelaySchema,
  HAScriptFieldsSchema,
  HATriggerSchema,
  HAVariablesSchema,
  HAWaitSchema,
} from './ha-schemas';

// ============================================
// TRIGGER NODE
// ============================================

export const TriggerNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('trigger'),
  position: PositionSchema,
  data: HATriggerSchema,
});
export type TriggerNode = z.infer<typeof TriggerNodeSchema>;

// ============================================
// CONDITION NODE
// ============================================

export const ConditionNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('condition'),
  position: PositionSchema,
  data: HAConditionSchema,
});
export type ConditionNode = z.infer<typeof ConditionNodeSchema>;

// ============================================
// ACTION NODE
// ============================================

export const ActionNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('action'),
  position: PositionSchema,
  data: HAActionSchema,
});
export type ActionNode = z.infer<typeof ActionNodeSchema>;

// ============================================
// DELAY NODE
// ============================================

export const DelayNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('delay'),
  position: PositionSchema,
  data: HADelaySchema,
});
export type DelayNode = z.infer<typeof DelayNodeSchema>;

// ============================================
// WAIT NODE
// ============================================

export const WaitNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('wait'),
  position: PositionSchema,
  data: HAWaitSchema,
});
export type WaitNode = z.infer<typeof WaitNodeSchema>;

// ============================================
// SET VARIABLES NODE
// ============================================

export const SetVariablesNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('set_variables'),
  position: PositionSchema,
  data: HAVariablesSchema,
});
export type SetVariablesNode = z.infer<typeof SetVariablesNodeSchema>;

// ============================================
// START NODE
// ============================================

/**
 * Marks the entry point of a script-mode flow (a flow with no trigger
 * nodes): "run this flow from anywhere — another flow, a dashboard, or a
 * voice assistant."
 *
 * A flow becomes script-mode either because it has a `start` node
 * (explicit) or, for backward compatibility with flows created before this
 * node type existed, because it simply has no `trigger` nodes (implicit —
 * unchanged legacy behavior). When `data.fields` is non-empty, those fields
 * are compiled to the HA script's `fields:` block (typed input parameters),
 * which downstream nodes can reference as `{{ <field key> }}` exactly like
 * any other HA script field.
 */
export const StartNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('start'),
  position: PositionSchema,
  data: z.looseObject({
    alias: z.string().optional(),
    fields: HAScriptFieldsSchema.optional(),
  }),
});
export type StartNode = z.infer<typeof StartNodeSchema>;

// ============================================
// JOIN NODE (Any / All)
// ============================================

/**
 * Explicit join/convergence point for parallel branches — an "All" (and,
 * later, "Any") block, in the spirit of similar constructs in other
 * flow-based automation editors. Placing this node where multiple
 * branches reconnect makes the join visible on the canvas instead of
 * relying on the transpiler silently inferring it from graph shape.
 *
 * Only 'all' is exposed in the UI today (waits for every incoming branch to
 * finish — this maps directly onto HA's native `parallel:` action, which is
 * already all-join at the engine level). 'any' is reserved for a future
 * approximation once its trade-offs are settled (HA's engine has no true
 * task-cancellation primitive, so "any" can only ever mean "all branches
 * run, but the shared continuation fires once, on whichever finishes
 * first" — see docs/flow-parity-design.md).
 */
export const JoinNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('join'),
  position: PositionSchema,
  data: z.looseObject({
    alias: z.string().optional(),
    mode: z.enum(['all', 'any']).default('all'),
  }),
});
export type JoinNode = z.infer<typeof JoinNodeSchema>;

// ============================================
// SEQUENCE START / END NODES ("Grouping actions")
// ============================================

/**
 * Marks the start of an explicit "Grouping actions" block — HA's `sequence:`
 * building block (see home-assistant.io/docs/scripts/#grouping-actions).
 * Everything on the graph between a SequenceStartNode and its matching
 * SequenceEndNode transpiles to a single `{ sequence: [...], alias? }`
 * action step instead of being flattened into the surrounding sequence —
 * gives the group a name and a visible boundary, which matters most as one
 * named branch inside a Parallel block. The matching end node is found
 * structurally (same technique as repeat-pattern/join detection in
 * native.ts), not via an explicit id reference between the two nodes.
 */
export const SequenceStartNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('sequence_start'),
  position: PositionSchema,
  data: z.looseObject({
    alias: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
});
export type SequenceStartNode = z.infer<typeof SequenceStartNodeSchema>;

/** Matching close marker for SequenceStartNodeSchema — see its doc comment. */
export const SequenceEndNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('sequence_end'),
  position: PositionSchema,
  data: z.looseObject({}),
});
export type SequenceEndNode = z.infer<typeof SequenceEndNodeSchema>;

// ============================================
// DISCRIMINATED UNION
// ============================================

/**
 * Discriminated union of all node types
 * The 'type' field determines which schema is used for validation
 */
export const NodeSchema = z.discriminatedUnion('type', [
  TriggerNodeSchema,
  ConditionNodeSchema,
  ActionNodeSchema,
  DelayNodeSchema,
  WaitNodeSchema,
  SetVariablesNodeSchema,
  StartNodeSchema,
  JoinNodeSchema,
  SequenceStartNodeSchema,
  SequenceEndNodeSchema,
]);
export type FlowNode = z.infer<typeof NodeSchema>;

/**
 * Type guard functions for narrowing node types
 */
export function isTriggerNode(node: FlowNode): node is TriggerNode {
  return node.type === 'trigger';
}

export function isConditionNode(node: FlowNode): node is ConditionNode {
  return node.type === 'condition';
}

export function isActionNode(node: FlowNode): node is ActionNode {
  return node.type === 'action';
}

export function isDelayNode(node: FlowNode): node is DelayNode {
  return node.type === 'delay';
}

export function isWaitNode(node: FlowNode): node is WaitNode {
  return node.type === 'wait';
}

export function isSetVariablesNode(node: FlowNode): node is SetVariablesNode {
  return node.type === 'set_variables';
}

export function isStartNode(node: FlowNode): node is StartNode {
  return node.type === 'start';
}

export function isJoinNode(node: FlowNode): node is JoinNode {
  return node.type === 'join';
}

export function isSequenceStartNode(node: FlowNode): node is SequenceStartNode {
  return node.type === 'sequence_start';
}

export function isSequenceEndNode(node: FlowNode): node is SequenceEndNode {
  return node.type === 'sequence_end';
}
