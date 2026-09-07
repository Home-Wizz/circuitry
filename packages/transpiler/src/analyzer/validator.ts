import { type FlowGraph, FlowGraphSchema, validateGraphStructure } from '@circuitry/shared';
import { ZodError } from 'zod';

/**
 * Validation result containing parsed graph or errors
 */
export interface ValidationResult {
  success: boolean;
  graph?: FlowGraph;
  errors: ValidationError[];
}

/**
 * Structured validation error
 */
export interface ValidationError {
  code: string;
  message: string;
  path?: string[];
}

/**
 * Validate a flow graph input
 * Performs both schema validation and structural validation
 */
export function validateFlowGraph(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // Step 1: Schema validation with Zod
  let graph: FlowGraph;
  try {
    graph = FlowGraphSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      for (const issue of error.issues) {
        errors.push({
          code: issue.code,
          message: issue.message,
          path: issue.path.map(String),
        });
      }
    } else {
      errors.push({
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown validation error',
      });
    }
    return { success: false, errors };
  }

  // Step 2: Structural validation
  const structuralResult = validateGraphStructure(graph);
  if (!structuralResult.valid) {
    for (const errorMsg of structuralResult.errors) {
      errors.push({
        code: 'STRUCTURAL_ERROR',
        message: errorMsg,
      });
    }
  }

  // Step 3: Semantic validation
  const semanticErrors = validateSemantics(graph);
  errors.push(...semanticErrors);

  return {
    success: errors.length === 0,
    graph: errors.length === 0 ? graph : undefined,
    errors,
  };
}

/**
 * Validate semantic correctness of the flow
 */
function validateSemantics(graph: FlowGraph): ValidationError[] {
  const errors: ValidationError[] = [];

  // NOTE: this function deliberately does NOT reject a condition node that
  // has zero outgoing edges on BOTH the true and false handles.
  //
  // Removed 2026-09-06 as bug #15, found by the canvas block-factory fuzzer
  // (canvas-block-fuzz.test.ts, "maximal integration stress test" round 1):
  // a `choose` block's LAST case, left with its case-body (true handle) and
  // implicit-default (false handle) both unwired on the canvas, hit this
  // check and hard-failed with `CONDITION_NO_EDGES` before transpilation
  // even reached the actual YAML generation code -- even though that code
  // (native.ts's choose-chain builder, and state-machine.ts's
  // buildFanOutContinuation) both already handle zero edges on a branch
  // gracefully (`thenNodeIds.length > 0 ? ... : []`, `edges[0]?.target ??
  // 'END'`), because a condition with one populated branch already has to
  // be supported (that's an ordinary if-with-no-else). A condition with
  // BOTH branches empty is exactly the same case applied twice: it
  // transpiles to `sequence: []` / an omitted `default`, which is
  // completely valid, constructible-natively HA YAML (an `if:`/`choose:`
  // whose branches do nothing is a no-op, not an invalid automation) --
  // failing the whole transpile over it violates the "only restrict what's
  // 100% impossible to build natively" rule. Reachability (is this
  // condition node connected to a trigger at all) is already covered
  // separately by the orphaned-node check below; that is the correct place
  // to catch a truly meaningless floating node, not this one.

  // Check that action nodes have valid service format
  const actionNodes = graph.nodes.filter((n) => n.type === 'action');
  for (const node of actionNodes) {
    if (node.type === 'action') {
      // Opaque repeat nodes (repeat.count/while/until/for_each) are a valid
      // action shape without service/event — mirrors validation.ts's
      // ActionNodeValidationSchema exemption.
      if (node.data.repeat !== null && typeof node.data.repeat === 'object') continue;

      // Stop actions (`stop: "<message>"`, optional `error`) are a third
      // valid action shape alongside service/event — HA's own "Stop" action
      // ends the automation/script. An empty string is a legitimate stop
      // message (real HA UI defaults new Stop actions to it), so this only
      // checks presence/type, not content — mirrors validation.ts's own
      // `typeof data.stop === 'string'` exemption. Without this, a Stop
      // action whose node still carried a stale placeholder `service: ''`
      // (left over because the "Blocks" picker's commit merges onto the
      // existing placeholder data via updateNodeData rather than replacing
      // it) tripped this check even though validation.ts's real-time check
      // already passed the very same node — reported directly by a user
      // whose save got past the "Cannot save: N node(s) have validation
      // errors" dialog only to fail here instead with a confusing
      // "invalid service format" for a service that was never set.
      if (typeof node.data.stop === 'string') continue;

      // A real (non-empty) event name is a fourth valid action shape —
      // mirrors validation.ts's own `hasEvent` check. (An empty-string
      // event, like an empty-string service, isn't considered "complete"
      // here — same as before this fix.)
      if (typeof node.data.event === 'string' && node.data.event.trim() !== '') continue;

      const service = node.data.service;

      // Special action types that don't follow domain.service format
      const specialActionTypes = [
        'variables',
        'delay',
        'wait',
        'wait_template',
        'wait_for_trigger',
        'stop',
        'repeat',
        'choose',
        'if',
      ];

      if (
        typeof service === 'string' &&
        !service.includes('.') &&
        !specialActionTypes.includes(service)
      ) {
        errors.push({
          code: 'INVALID_SERVICE',
          message: `Action node "${node.id}" has invalid service format: "${service}". Expected "domain.service"`,
          path: ['nodes', node.id, 'data', 'service'],
        });
      }
    }
  }

  // Check for orphaned nodes (nodes not connected to any trigger)
  const connectedNodes = new Set<string>();
  const triggerNodes = graph.nodes.filter((n) => n.type === 'trigger');

  // BFS from all triggers
  const queue = [...triggerNodes.map((n) => n.id)];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (connectedNodes.has(nodeId)) continue;
    connectedNodes.add(nodeId);

    const outgoing = graph.edges.filter((e) => e.source === nodeId);
    for (const edge of outgoing) {
      if (!connectedNodes.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  for (const node of graph.nodes) {
    if (!connectedNodes.has(node.id) && node.type !== 'trigger') {
      errors.push({
        code: 'ORPHANED_NODE',
        message: `Node "${node.id}" is not connected to any trigger`,
        path: ['nodes', node.id],
      });
    }
  }

  return errors;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const pathStr = e.path ? ` at ${e.path.join('.')}` : '';
      return `[${e.code}]${pathStr}: ${e.message}`;
    })
    .join('\n');
}
