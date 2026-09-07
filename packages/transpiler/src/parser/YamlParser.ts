import type {
  ActionNode,
  CircuitryMetadata,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowGraph,
  FlowNode,
  HAAction,
  HACondition,
  HADelay,
  HATrigger,
  HAWait,
  SetVariablesNode,
  Target,
  TriggerNode,
  WaitNode,
} from '@circuitry/shared';
import {
  CircuitryMetadataSchema,
  FlowGraphMetadataSchema,
  FlowGraphSchema,
  HAConditionSchema,
  HATriggerSchema,
  isDeviceAction,
  isHACondition,
  validateGraphStructure,
} from '@circuitry/shared';
import { load as yamlLoad } from 'js-yaml';
import { generateEdgeId, generateGraphId, generateNodeId } from '../utils/generateIds';
import { applyHeuristicLayout, applyHeuristicLayoutSync } from './layout';

// Type guards for Home Assistant objects

/** Returns true if the action is a delay node */
function isDelayAction(action: unknown): action is HADelay {
  return (
    typeof action === 'object' &&
    action !== null &&
    'delay' in action &&
    (typeof (action as Record<string, unknown>).delay === 'string' ||
      typeof (action as Record<string, unknown>).delay === 'number' ||
      (typeof (action as Record<string, unknown>).delay === 'object' &&
        (action as Record<string, unknown>).delay !== null))
  );
}

/** Returns true if the action is a wait node */
function isWaitAction(action: unknown): action is HAWait {
  return (
    typeof action === 'object' &&
    action !== null &&
    ('wait_template' in action || 'wait_for_trigger' in action)
  );
}

/** Returns true if the action is a choose block */
function isChooseAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'choose' in action;
}

/** Returns true if the action is a parallel block */
function isParallelAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'parallel' in action &&
    Array.isArray((action as Record<string, unknown>).parallel)
  );
}

/** Returns true if the action is an if/then/else block */
function isIfThenAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'if' in action &&
    Array.isArray((action as Record<string, unknown>).if) &&
    'then' in action &&
    Array.isArray((action as Record<string, unknown>).then)
  );
}

/** Returns true if the action is a service or action call */
function isServiceAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    (typeof (action as Record<string, unknown>).service === 'string' ||
      typeof (action as Record<string, unknown>).action === 'string')
  );
}

/** Returns true if the action is an inline condition (guard) in the action sequence */
function isConditionAction(action: unknown): action is HACondition {
  return (
    typeof action === 'object' &&
    action !== null &&
    'condition' in action &&
    typeof (action as Record<string, unknown>).condition === 'string'
  );
}

/**
 * Returns true if the action is the "list of conditions" shorthand for an
 * inline condition guard — `condition: [cond1, cond2, ...]` — which HA treats
 * as an implicit AND of the listed conditions, stopping the sequence if any
 * evaluate false. Distinct from isConditionAction, whose `condition` value is
 * always a single type-discriminator string (e.g. 'state', 'and').
 */
function isConditionListAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'condition' in action &&
    Array.isArray((action as Record<string, unknown>).condition)
  );
}

/**
 * Returns true if the action is a plain "Grouping actions" building block —
 * a nested sequence run as one unit (`sequence: [...]`) — as opposed to a
 * repeat body or a parallel branch, which also carry a `sequence` key but are
 * matched by their own more specific guards first.
 */
function isSequenceAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'sequence' in action &&
    Array.isArray((action as Record<string, unknown>).sequence) &&
    !('repeat' in action) &&
    !('parallel' in action)
  );
}

/** Returns true if the action is a variables block */
function isVariablesAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'variables' in action &&
    typeof (action as Record<string, unknown>).variables === 'object' &&
    // Make sure it's not mistaken for other action types that might have variables
    !('service' in action) &&
    !('action' in action) &&
    !('delay' in action) &&
    !('wait_template' in action) &&
    !('choose' in action) &&
    !('if' in action)
  );
}

/** Returns true if the action is a set_conversation_response action */
function isSetConversationResponseAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'set_conversation_response' in action;
}

/** Returns true if the action is a stop action */
function isStopAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'stop' in action;
}

/** Returns true if the action is a repeat block */
function isRepeatAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'repeat' in action &&
    typeof (action as Record<string, unknown>).repeat === 'object' &&
    (action as Record<string, unknown>).repeat !== null
  );
}

/** Returns true if the action is an event firing action */
function isEventAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'event' in action &&
    typeof (action as Record<string, unknown>).event === 'string'
  );
}
/**
 * Result of parsing YAML
 */
export interface ParseResult {
  success: boolean;
  graph?: FlowGraph;
  errors?: string[];
  warnings: string[];
  hadMetadata: boolean;
}

/**
 * Valid condition types for Home Assistant
 */
const VALID_CONDITIONS = [
  'state',
  'numeric_state',
  'template',
  'time',
  'sun',
  'zone',
  'and',
  'or',
  'not',
  'device',
  'trigger',
] as const;

type ValidConditionType = (typeof VALID_CONDITIONS)[number];

/**
 * Resolves a raw `condition:` string from imported YAML to what Circuitry should
 * store as a condition node's `data.condition`.
 *
 * VALID_CONDITIONS above only covers the legacy, non-dotted condition kinds
 * (state, numeric_state, sun, time, ...). HA 2024.8+ also has "purpose-
 * specific" dotted condition types — `condition: sun.is_up`, `condition:
 * light.is_on`, `condition: climate.is_cooling`, etc. — which are a
 * completely different, open-ended namespace (any `domain.is_*`/`domain.
 * all_*` string a component chooses to register), so they can never be
 * enumerated in a fixed allowlist the way the legacy kinds are.
 *
 * Every call site below used to run the raw type through
 * `VALID_CONDITIONS.includes(...)` unconditionally and silently fall back to
 * 'template' for anything not in that closed list — which meant every
 * dotted condition lost its real type on import and showed up as a generic,
 * unconfigured "Template" node (confirmed via a real user automation whose
 * saved YAML had `condition: sun.is_up` / `condition: sun.is_night` and
 * parsed back as `condition: template` both times). That data loss was
 * needless: HAConditionSchema's own `condition` field (packages/shared/src/
 * schemas/ha-schemas.ts) is a plain `z.string()` with no such restriction,
 * and ConditionNode.tsx's card display already has first-class handling for
 * a dotted `data.condition` (`isDottedCondition`/`dottedPhrase`) — only this
 * parser-side gate didn't know dotted types existed yet.
 *
 * A dotted type (contains a literal '.') is passed through completely
 * unvalidated instead of being checked against VALID_CONDITIONS, matching
 * ConditionNode.tsx's own `data.condition.includes('.')` test elsewhere in
 * the codebase for "is this a purpose-specific condition".
 */
function resolveConditionType(
  rawType: string | undefined,
  fallback: ValidConditionType
): ValidConditionType | string {
  if (!rawType) return fallback;
  if (rawType.includes('.')) return rawType;
  return VALID_CONDITIONS.includes(rawType as ValidConditionType)
    ? (rawType as ValidConditionType)
    : fallback;
}

/**
 * Options for parsing actions and nested blocks
 */
interface ParseOptions {
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
 * Nested condition type (supports recursive nesting)
 */
type NestedCondition = NonNullable<ConditionNode['data']['conditions']>[number];

/**
 * Transform an array of Home Assistant conditions to internal format
 */
function transformConditions(conditions: HACondition[]): NestedCondition[] {
  return conditions.map((c) => transformToNestedCondition(c));
}

/**
 * Transform Home Assistant condition format to internal nested condition format
 * HA uses 'condition' field, internal schema uses 'condition'
 * Recursively handles nested conditions for and/or/not
 */
function transformToNestedCondition(condition: HACondition): NestedCondition {
  // Use spread pattern to preserve unknown properties from custom integrations
  const { condition: conditionField, conditions, ...rest } = condition;
  const validatedType = resolveConditionType(conditionField, 'template');

  // Recursively transform nested conditions if present
  const nestedConditions = Array.isArray(conditions) ? transformConditions(conditions) : undefined;

  return {
    ...rest, // Preserve extra properties (including weekday, after, before, etc.)
    condition: validatedType,
    conditions: nestedConditions,
  };
}

/**
 * Parser for converting Home Assistant YAML back to FlowGraph
 */
export class YamlParser {
  /**
   * Parse Home Assistant YAML string into FlowGraph
   */
async parse(yamlString: string): Promise<ParseResult> {
    const warnings: string[] = [];

    try {
      const pre = this.parseToNodesAndEdges(yamlString, warnings);
      if (!pre.ok) {
        return pre.result;
      }
      const { nodes, edges, metadata, hadMetadata, content, userVariables } = pre;

      // Step 7: Apply positions from metadata or generate heuristic layout
      let nodesWithPositions: FlowNode[];
      if (hadMetadata && metadata) {
        const metaNodes = this.applyMetadataPositions(nodes, metadata);
        // Validate layout: if any choose-chain edge goes right-to-left, the saved
        // positions are stale/manually rearranged in a confusing way — recompute.
        const nodePositionMap = new Map(metaNodes.map((n) => [n.id, n.position.x]));
        const hasBackwardsChooseChain = edges.some(
          (e) =>
            e.type === 'choose-chain' &&
            (nodePositionMap.get(e.target) ?? 0) < (nodePositionMap.get(e.source) ?? 0) - 100
        );
        if (hasBackwardsChooseChain) {
          console.warn(
            'Circuitry: saved layout had a backwards choose-chain edge, discarding it in favor of auto-layout'
          );
        }
        nodesWithPositions = hasBackwardsChooseChain
          ? await applyHeuristicLayout(nodes, edges)
          : metaNodes;
      } else {
        // Use async heuristic layout if metadata is missing
        nodesWithPositions = await applyHeuristicLayout(nodes, edges);
      }

      return this.finalizeGraph(
        content,
        nodesWithPositions,
        edges,
        metadata,
        hadMetadata,
        userVariables,
        warnings
      );
    } catch (error) {
      // Enhanced catch block: log YAML and error
      console.error('YAML parsing error:', error);
      console.error('YAML string:', yamlString);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown parsing error'],
        warnings,
        hadMetadata: false,
      };
    }
  }

  /**
   * Synchronous variant of parse(). Used only where an async decompile can't
   * be awaited synchronously -- currently just FlowTranspiler's native-
   * strategy generate-then-verify gate, which must stay inside transpile()'s
   * existing synchronous public contract (transpile() is called unawaited
   * from several existing call sites, e.g. flow-store.ts's save/update
   * actions, so making it async would be a breaking change across the
   * frontend -- not something to do just to satisfy an internal
   * verification step).
   *
   * Reuses the *exact* same node/edge parsing and graph validation logic as
   * parse() (parseToNodesAndEdges + finalizeGraph below) -- nothing about
   * how nodes, edges, or graph structure are derived is reimplemented or
   * duplicated here. The only difference from parse() is that node
   * *positions* are computed with the synchronous grid fallback
   * (applyHeuristicLayoutSync) instead of the async ELK-based layout, and
   * the metadata-position-preference branching (steps around
   * applyMetadataPositions / backwards-choose-chain detection) is skipped
   * entirely, because callers of parseSync never look at node position --
   * see verifyNativeOutput.ts's doc comment: position is explicitly and
   * deliberately excluded from its structural comparison. Never use this
   * for anything that displays positions to a user (the visual editor's
   * real import path) -- for that, always use parse().
   */
  parseSync(yamlString: string): ParseResult {
    const warnings: string[] = [];

    try {
      const pre = this.parseToNodesAndEdges(yamlString, warnings);
      if (!pre.ok) {
        return pre.result;
      }
      const { nodes, edges, metadata, hadMetadata, content, userVariables } = pre;

      const nodesWithPositions = applyHeuristicLayoutSync(nodes, edges);

      return this.finalizeGraph(
        content,
        nodesWithPositions,
        edges,
        metadata,
        hadMetadata,
        userVariables,
        warnings
      );
    } catch (error) {
      console.error('YAML parsing error (sync):', error);
      console.error('YAML string:', yamlString);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown parsing error'],
        warnings,
        hadMetadata: false,
      };
    }
  }

  /**
   * Steps 1-6 of parse()/parseSync(): YAML load, Circuitry-metadata and
   * user-variable extraction, the blueprint-automation rejection check, and
   * node/edge construction (via parseAutomationStructure /
   * parseStateMachineStructure). Pure and synchronous -- everything here is
   * identical between parse() and parseSync(); only what happens to
   * *positions* afterward differs between the two callers, which is why
   * this stops right before position assignment.
   *
   * Returns `{ ok: false, result }` with a fully-formed failure ParseResult
   * on any early-exit condition (mirrors parse()'s original inline early
   * returns exactly), or `{ ok: true, ... }` with everything the caller
   * needs to finish the job.
   */
  private parseToNodesAndEdges(
    yamlString: string,
    warnings: string[]
  ):
    | {
        ok: true;
        nodes: FlowNode[];
        edges: FlowEdge[];
        metadata: CircuitryMetadata | null;
        hadMetadata: boolean;
        content: Record<string, unknown>;
        userVariables: Record<string, unknown>;
      }
    | { ok: false; result: ParseResult } {
    // Step 1: Parse YAML string
    let parsed = yamlLoad(yamlString) as Record<string, unknown> | unknown[];

    // Handle array format (list of automations) - use the first one
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return {
          ok: false,
          result: {
            success: false,
            errors: ['Empty automation array'],
            warnings,
            hadMetadata: false,
          },
        };
      }
      parsed = parsed[0] as Record<string, unknown>;
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        result: {
          success: false,
          errors: ['Invalid YAML structure'],
          warnings,
          hadMetadata: false,
        },
      };
    }

    // Step 2: Extract Circuitry metadata if present
    const metadata = this.extractMetadata(parsed, warnings);
    const hadMetadata = metadata !== null;

    // Step 2b: Extract user-defined variables (excluding _flode_metadata)
    const userVariables = this.extractUserVariables(parsed);

    // Step 3: Only support automation format (no script import)
    const content = parsed;
    // Defensive: ensure content is Record<string, unknown>
    if (typeof content !== 'object' || content === null) {
      return {
        ok: false,
        result: {
          success: false,
          errors: ['Invalid YAML content structure'],
          warnings,
          hadMetadata,
        },
      };
    }

    // Step 3b: Blueprint-based automations (`use_blueprint:`) store their
    // triggers/conditions/actions inside the blueprint file itself, keyed
    // by `input:` variables here -- there is nothing in this YAML for the
    // parser to build trigger/action nodes from. Without this check the
    // parse falls through to the generic zero-trigger-nodes graph
    // validation error, which doesn't explain why. Fail clearly and
    // immediately instead (found via decompile audit, 2026-09-06).
    if ('use_blueprint' in (content as Record<string, unknown>)) {
      return {
        ok: false,
        result: {
          success: false,
          errors: [
            'Blueprint-based automations are not currently supported by the visual editor. ' +
              'Expand the blueprint into a plain automation (in Home Assistant: Automations > \u22ee > Edit in YAML, after unlinking the blueprint) and import that instead.',
          ],
          warnings,
          hadMetadata,
        },
      };
    }

    // Step 4: Extract node IDs from metadata if available
    const metadataNodeIds = metadata ? Object.keys(metadata.nodes) : [];

    // Step 5: Check if this is a state-machine format automation
    const isStateMachine =
      metadata?.strategy === 'state-machine' || this.detectStateMachineFormat(content);

    // Step 6: Parse nodes and edges from YAML structure
    const { nodes, edges } = isStateMachine
      ? this.parseStateMachineStructure(content, warnings, metadataNodeIds)
      : this.parseAutomationStructure(content, warnings, metadataNodeIds);

    return { ok: true, nodes, edges, metadata, hadMetadata, content, userVariables };
  }

  /**
   * Step 8 onward of parse()/parseSync(): builds the final FlowGraph object
   * from already-positioned nodes, validates it against FlowGraphSchema,
   * validates overall graph structure, and returns the final ParseResult.
   * Pure and synchronous; identical for both parse() and parseSync() --
   * nothing here depends on how nodesWithPositions was computed.
   */
  private finalizeGraph(
    content: Record<string, unknown>,
    nodesWithPositions: FlowNode[],
    edges: FlowEdge[],
    metadata: CircuitryMetadata | null,
    hadMetadata: boolean,
    userVariables: Record<string, unknown>,
    warnings: string[]
  ): ParseResult {
    // Step 8: Build FlowGraph object
    // Validate and parse metadata block using FlowGraphMetadataSchema
    const rawMetadata = {
      mode: content.mode,
      max: content.max,
      max_exceeded: content.max_exceeded,
      initial_state: content.initial_state,
      hide_entity: content.hide_entity,
      trace: content.trace,
    };
    const metadataResult = FlowGraphMetadataSchema.safeParse(rawMetadata);
    const metadataBlock = metadataResult.success
      ? metadataResult.data
      : FlowGraphMetadataSchema.parse({});

    const userTriggerVariables =
      typeof content.trigger_variables === 'object' &&
      content.trigger_variables !== null &&
      !Array.isArray(content.trigger_variables)
        ? (content.trigger_variables as Record<string, unknown>)
        : undefined;

    const graph: FlowGraph = {
      id: metadata?.graph_id || generateGraphId(),
      name: typeof content.alias === 'string' ? content.alias : 'Imported Automation',
      description: typeof content.description === 'string' ? content.description : '',
      nodes: nodesWithPositions,
      edges,
      metadata: metadataBlock,
      version: 1 as const,
      // Preserve user-defined variables for round-trip
      userVariables: Object.keys(userVariables).length > 0 ? userVariables : undefined,
      userTriggerVariables:
        userTriggerVariables && Object.keys(userTriggerVariables).length > 0
          ? userTriggerVariables
          : undefined,
    };

    // Step 7: Validate with Zod schema
    const validation = FlowGraphSchema.safeParse(graph);

    if (!validation.success) {
      // Enhanced error logging: show node data and schema path
      // Zod v4 uses 'issues' instead of 'errors'
      const errorDetails = validation.error.issues.map((e) => {
        let nodeInfo = '';
        if (e.path && e.path.length > 0) {
          // Try to extract node id/type if error is in nodes array
          if (e.path[0] === 'nodes' && typeof e.path[1] === 'number') {
            const idx = e.path[1];
            const node = graph.nodes[idx];
            nodeInfo = `Node index ${idx} (id: ${node?.id}, type: ${
              node?.type
            })\nData: ${JSON.stringify(node?.data, null, 2)}`;
          }
        }
        return `Schema path: ${e.path.join('.')}\nMessage: ${e.message}${
          nodeInfo ? `\n${nodeInfo}` : ''
        }`;
      });
      // Also log to console for debugging
      console.error('Zod validation error details:', errorDetails);
      return {
        success: false,
        errors: errorDetails,
        warnings,
        hadMetadata,
      };
    }

    // Step 8: Validate graph structure (triggers, edges, etc.)
    const structureValidation = validateGraphStructure(validation.data);

    if (!structureValidation.valid) {
      return {
        success: false,
        errors: structureValidation.errors,
        warnings,
        hadMetadata,
      };
    }

    return {
      success: true,
      graph: validation.data,
      warnings,
      hadMetadata,
    };
  }

  /**
   * Extract Circuitry metadata from variables section
   */
  /**
   * Extract and validate Circuitry metadata from variables section using Zod schema.
   * Returns CircuitryMetadata if valid, otherwise null.
   */
  private extractMetadata(
    parsed: Record<string, unknown>,
    warnings?: string[]
  ): CircuitryMetadata | null {
    try {
      let variables: unknown;
      if (typeof parsed.variables === 'object' && parsed.variables !== null) {
        variables = parsed.variables;
      }
      if (variables && typeof variables === 'object') {
        const vars = variables as Record<string, unknown>;
        // _circuitry_metadata is the only key this fork writes now.
        // _flode_metadata/_cafe_metadata are read-only fallbacks for an
        // automation saved by an earlier link in the fork chain (FLODE,
        // or the original C.A.F.E.) that hasn't been
        // re-saved by Circuitry yet — see ha-schemas.ts's
        // CircuitryMetadataSchema doc comment for the full chain.
        const raw = vars._circuitry_metadata ?? vars._flode_metadata ?? vars._cafe_metadata;
        if (typeof raw === 'object' && raw !== null) {
          const result = CircuitryMetadataSchema.safeParse(raw);
          if (result.success) {
            return result.data;
          }
          // Metadata was present but didn't pass CircuitryMetadataSchema —
          // this used to fail *silently* (caught below, treated identically
          // to "no metadata at all"), which is why a saved layout getting
          // discarded on every reopen had no visible cause anywhere. Now
          // logs the actual zod issues (which field, what value) so this is
          // debuggable from the browser console, and surfaces a warning the
          // same way a lossy YAML import already does (see
          // useLoadAutomation.ts — becomes both a toast and a Repair issue),
          // rather than silently re-arranging the canvas with no explanation.
          console.warn(
            'Circuitry: saved layout metadata failed validation, falling back to auto-layout',
            result.error.issues,
            raw
          );
          warnings?.push(
            'Saved node layout could not be restored (metadata failed validation) — automation was auto-arranged.'
          );
        }
      }
    } catch (err) {
      console.warn('Circuitry: error reading saved layout metadata, falling back to auto-layout', err);
      warnings?.push(
        'Saved node layout could not be restored (error reading metadata) — automation was auto-arranged.'
      );
    }
    return null;
  }

  /**
   * Extract user-defined variables from the root variables section.
   * Excludes _circuitry_metadata (and its _flode_metadata/_cafe_metadata
   * predecessors) which is handled separately.
   */
  private extractUserVariables(parsed: Record<string, unknown>): Record<string, unknown> {
    const userVariables: Record<string, unknown> = {};

    if (typeof parsed.variables === 'object' && parsed.variables !== null) {
      const variables = parsed.variables as Record<string, unknown>;
      for (const [key, value] of Object.entries(variables)) {
        // Skip metadata keys - handled separately
        if (key !== '_circuitry_metadata' && key !== '_flode_metadata' && key !== '_cafe_metadata') {
          userVariables[key] = value;
        }
      }
    }

    return userVariables;
  }

  /**
   * Detect if automation is in state-machine format
   * State-machine format has:
   * - A variables action with current_node and flow_context
   * - A repeat loop with choose blocks
   */
  private detectStateMachineFormat(content: Record<string, unknown>): boolean {
    const actions = (content.actions || content.action) as unknown[];
    if (!Array.isArray(actions)) return false;

    let hasCurrentNodeVar = false;
    let hasRepeatChoose = false;

    for (const action of actions) {
      const actionObj = action as Record<string, unknown>;

      // Check for variables with current_node
      if (actionObj.variables) {
        const vars = actionObj.variables as Record<string, unknown>;
        if ('current_node' in vars && 'flow_context' in vars) {
          hasCurrentNodeVar = true;
        }
      }

      // Check for repeat with choose
      if (actionObj.repeat) {
        const repeat = actionObj.repeat as Record<string, unknown>;
        const sequence = repeat.sequence as unknown[];
        if (Array.isArray(sequence)) {
          for (const seqItem of sequence) {
            const seqObj = seqItem as Record<string, unknown>;
            if (Array.isArray(seqObj.choose)) {
              hasRepeatChoose = true;
              break;
            }
          }
        }
      }
    }

    return hasCurrentNodeVar && hasRepeatChoose;
  }

  /**
   * Parse state-machine format automation into nodes and edges
   *
   * State-machine format structure:
   * - Triggers are parsed normally
   * - Actions contain: variables (current_node init) + repeat/choose blocks
   * - Each choose block represents a node:
   *   - condition: {{ current_node == "node-id" }}
   *   - sequence: [node action, variables: { current_node: "next-node" }]
   */
  private parseStateMachineStructure(
    content: Record<string, unknown>,
    warnings: string[],
    metadataNodeIds: string[]
  ): { nodes: FlowNode[]; edges: FlowEdge[] } {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    // Find the entry node and parse the state machine
    const actions = (content.actions || content.action) as unknown[];
    if (!Array.isArray(actions)) {
      warnings.push('No actions found in automation');
      return { nodes, edges };
    }

    let entryNodeId: string | null = null;
    const nodeInfoMap = new Map<
      string,
      {
        nodeId: string;
        nodeType: 'action' | 'condition' | 'delay' | 'wait';
        data: Record<string, unknown>;
        trueTarget: string | null;
        falseTarget: string | null;
      }
    >();

    for (const action of actions) {
      const actionObj = action as Record<string, unknown>;

      // Find entry node from initial variables
      if (actionObj.variables) {
        const vars = actionObj.variables as Record<string, unknown>;
        if (typeof vars.current_node === 'string' && vars.current_node !== 'END') {
          entryNodeId = vars.current_node;
        }
      }

      // Parse repeat/choose structure
      if (actionObj.repeat) {
        const repeat = actionObj.repeat as Record<string, unknown>;
        const sequence = repeat.sequence as unknown[];

        if (Array.isArray(sequence)) {
          for (const seqItem of sequence) {
            const seqObj = seqItem as Record<string, unknown>;

            if (Array.isArray(seqObj.choose)) {
              for (const chooseBlock of seqObj.choose) {
                const nodeInfo = this.parseStateMachineChooseBlock(
                  chooseBlock as Record<string, unknown>
                );
                if (nodeInfo) {
                  nodeInfoMap.set(nodeInfo.nodeId, nodeInfo);
                }
              }
            }
          }
        }
      }
    }

    // In state-machine strategy, action/condition/delay/wait node IDs are extracted
    // directly from the Jinja2 templates in the YAML choose blocks. Only trigger
    // node IDs need to be allocated via getNextNodeId, so we filter out IDs that
    // are already claimed by the choose blocks to avoid assigning them to triggers.
    const stateMachineNodeIds = new Set(nodeInfoMap.keys());
    const triggerMetadataIds = metadataNodeIds.filter((id) => !stateMachineNodeIds.has(id));
    let triggerIdIndex = 0;
    let nodeIdIndex = 0;

    const getNextNodeId = (type: string): string => {
      if (triggerIdIndex < triggerMetadataIds.length) {
        return triggerMetadataIds[triggerIdIndex++];
      }
      return generateNodeId(type, nodeIdIndex++);
    };

    // Parse triggers
    const triggerData = content.triggers || content.trigger;
    if (!triggerData) {
      warnings.push('No triggers found in automation');
      return { nodes, edges };
    }
    const triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
    const triggerNodes = this.parseTriggers(
      triggers as Record<string, unknown>[],
      warnings,
      getNextNodeId
    );
    nodes.push(...triggerNodes);

    // Create nodes from parsed info
    for (const [nodeId, info] of nodeInfoMap) {
      const nodeType = info.nodeType;

      switch (nodeType) {
        case 'condition':
          nodes.push({
            id: nodeId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: info.data as ConditionNode['data'],
          });
          break;
        case 'action':
          nodes.push({
            id: nodeId,
            type: 'action',
            position: { x: 0, y: 0 },
            data: info.data as ActionNode['data'],
          });
          break;
        case 'delay':
          nodes.push({
            id: nodeId,
            type: 'delay',
            position: { x: 0, y: 0 },
            data: info.data as DelayNode['data'],
          });
          break;
        case 'wait':
          nodes.push({
            id: nodeId,
            type: 'wait',
            position: { x: 0, y: 0 },
            data: info.data as WaitNode['data'],
          });
          break;
      }
    }

    // Create edges
    // Connect triggers to entry node(s)
    if (entryNodeId) {
      // Check if entryNodeId is a Jinja2 template for trigger routing
      const triggerRouting = this.parseEntryNodeTemplate(entryNodeId);

      if (triggerRouting && triggerRouting.size > 0) {
        // Different triggers route to different nodes
        for (let i = 0; i < triggerNodes.length; i++) {
          const targetNodeId = triggerRouting.get(i);
          if (targetNodeId) {
            edges.push(this.createEdge(triggerNodes[i].id, targetNodeId));
          }
        }
      } else {
        // All triggers route to same node (simple case)
        for (const trigger of triggerNodes) {
          edges.push(this.createEdge(trigger.id, entryNodeId));
        }
      }
    }

    // Create edges between nodes based on transitions.
    // The true-target edge's handle must be keyed off the node's actual
    // type, not off whether a false-target happens to exist: a condition
    // node whose false branch leads to 'END' has extractTransitionTarget
    // (parseStateMachineChooseBlock) correctly return `null` for
    // falseTarget (since 'END' isn't a real node to draw an edge to) — but
    // that condition is still a genuine two-way branch and its true-target
    // edge still needs sourceHandle: 'true' (validateGraphStructure
    // requires every edge sourced from a condition node to declare 'true'
    // or 'false'). The previous `info.falseTarget ? 'true' : undefined`
    // left this edge's handle undefined whenever a case's condition had no
    // real (non-END) false path — confirmed via a real user automation
    // failing import with "must have sourceHandle 'true' or 'false', got:
    // undefined" for exactly this shape. Non-condition nodes (action/
    // delay/wait) never have a real sourceHandle concept, hence undefined.
    for (const [nodeId, info] of nodeInfoMap) {
      if (info.trueTarget && info.trueTarget !== 'END') {
        edges.push({
          id: `edge-${nodeId}-${info.trueTarget}`,
          source: nodeId,
          target: info.trueTarget,
          sourceHandle: info.nodeType === 'condition' ? 'true' : undefined,
        });
      }
      if (info.falseTarget && info.falseTarget !== 'END') {
        edges.push({
          id: `edge-${nodeId}-${info.falseTarget}`,
          source: nodeId,
          target: info.falseTarget,
          sourceHandle: 'false',
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Parse Jinja2 entry node template to extract trigger-to-node routing
   *
   * Template format: {% if trigger.idx == "0" %}action_0{% elif trigger.idx == "1" %}action_1{% else %}action_2{% endif %}
   * Note: trigger.idx is a string in HA, so comparisons use quoted values
   * Returns a Map where key = trigger index, value = target node ID
   */
  private parseEntryNodeTemplate(entryNodeId: string): Map<number, string> | null {
    // Check if it's a Jinja2 template
    if (!entryNodeId.includes('{%') || !entryNodeId.includes('trigger.idx')) {
      return null;
    }

    const routing = new Map<number, string>();

    // Match {% if trigger.idx == "N" %}nodeId or {% elif trigger.idx == "N" %}nodeId
    // trigger.idx is a string in HA, so index is quoted; node IDs are NOT quoted
    const ifPattern =
      /{%\s*(?:if|elif)\s+trigger\.idx\s*==\s*["'](\d+)["']\s*%}\s*([^{%]+?)(?={%|$)/g;
    const matches = entryNodeId.matchAll(ifPattern);

    for (const match of matches) {
      const triggerIdx = parseInt(match[1], 10);
      const nodeId = match[2].trim();
      routing.set(triggerIdx, nodeId);
    }

    // Match {% else %}nodeId for the default case (last trigger if not explicitly matched)
    const elseMatch = entryNodeId.match(/{%\s*else\s*%}\s*([^{%]+?)(?={%|$)/);
    if (elseMatch && routing.size > 0) {
      // The else branch is for the last trigger index not explicitly matched
      // Find the highest trigger index and add 1
      const maxIdx = Math.max(...routing.keys());
      routing.set(maxIdx + 1, elseMatch[1].trim());
    }

    return routing.size > 0 ? routing : null;
  }

  /**
   * Parse a single choose block from state-machine format
   */
  private parseStateMachineChooseBlock(chooseBlock: Record<string, unknown>): {
    nodeId: string;
    nodeType: 'action' | 'condition' | 'delay' | 'wait';
    data: Record<string, unknown>;
    trueTarget: string | null;
    falseTarget: string | null;
  } | null {
    const conditions = chooseBlock.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return null;
    }

    // Extract node ID from condition: {{ current_node == "node-id" }}
    const firstCondition = conditions[0] as Record<string, unknown>;
    const valueTemplate = firstCondition.value_template as string;
    if (!valueTemplate) return null;

    const match = valueTemplate.match(/current_node\s*==\s*["']([^"']+)["']/);
    if (!match) return null;

    const nodeId = match[1];
    const sequence = chooseBlock.sequence;
    if (!Array.isArray(sequence) || sequence.length === 0) {
      return null;
    }

    // Parse sequence to determine node type and data
    let nodeType: 'action' | 'condition' | 'delay' | 'wait' = 'action';
    const data: Record<string, unknown> = {};
    let trueTarget: string | null = null;
    let falseTarget: string | null = null;

    for (const item of sequence) {
      const seqItem = item as Record<string, unknown>;

      // Check for a native if/then/else condition block — this is what
      // StateMachineStrategy's generateConditionBlock (state-machine.ts)
      // emits for every condition node: a real HA condition object under
      // `if:`, with each branch's `then:`/`else:` sequence assigning
      // `current_node` a plain string. (Older saved automations may still
      // have the previous, now-removed shape — a single `variables:
      // {current_node: "{% if %}...{% endif %}"}` entry with the branch
      // baked into a Jinja ternary — handled by the `seqItem.variables`
      // case below for backward compatibility with already-saved YAML.)
      if (Array.isArray(seqItem.if) && seqItem.if.length > 0) {
        nodeType = 'condition';

        const rawCondition = seqItem.if[0] as Record<string, unknown>;
        const conditionType = resolveConditionType(rawCondition?.condition as string, 'template');
        try {
          const parsed = HAConditionSchema.parse({ ...rawCondition, condition: conditionType });
          Object.assign(data, parsed);
        } catch {
          data.condition = 'template';
          data.value_template = JSON.stringify(rawCondition);
        }
        if (seqItem.alias) data.alias = seqItem.alias;

        // Each branch's sequence contains exactly one `variables: {current_node: "id"}`
        // entry (see generateConditionBlock) — find it and read the target back out.
        const extractTransitionTarget = (branch: unknown): string | null => {
          if (!Array.isArray(branch)) return null;
          for (const branchItem of branch) {
            const bi = branchItem as Record<string, unknown>;
            const vars = bi.variables as Record<string, unknown> | undefined;
            if (vars && typeof vars.current_node === 'string') {
              return vars.current_node === 'END' ? null : vars.current_node;
            }
          }
          return null;
        };
        trueTarget = extractTransitionTarget(seqItem.then);
        falseTarget = extractTransitionTarget(seqItem.else);
      }
      // Check for variables action (sets next node / edge)
      else if (seqItem.variables) {
        const vars = seqItem.variables as Record<string, unknown>;
        const currentNodeValue = vars.current_node;

        if (typeof currentNodeValue === 'string') {
          // Check if it's a Jinja conditional (condition node)
          if (currentNodeValue.includes('{%') && currentNodeValue.includes('%}')) {
            nodeType = 'condition';

            // Extract true and false targets
            const trueMatch = currentNodeValue.match(/{%\s*if[^%]*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);
            const falseMatch = currentNodeValue.match(/{%\s*else\s*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);

            trueTarget = trueMatch ? trueMatch[1] : null;
            falseTarget = falseMatch ? falseMatch[1] : null;

            // Extract condition expression from Jinja template
            const conditionMatch = currentNodeValue.match(/{%\s*if\s+(.+?)\s*%}/);
            if (conditionMatch) {
              const conditionExpr = conditionMatch[1];
              Object.assign(data, this.parseJinjaCondition(conditionExpr));
            }
          } else {
            // Simple transition
            trueTarget = currentNodeValue === 'END' ? null : currentNodeValue;
          }
        }
      }
      // Check for delay action
      else if (seqItem.delay !== undefined) {
        nodeType = 'delay';
        data.delay = seqItem.delay;
        if (seqItem.alias) data.alias = seqItem.alias;
      }
      // Check for wait action (either form — see generateWaitBlock in
      // state-machine.ts, which emits wait_template for a template-based
      // wait or wait_for_trigger for a trigger-based one; only the former
      // was handled here, so a "Wait for [x]" node built the wait_for_trigger
      // way always fell through to the generic service-call/action case
      // below and lost its wait semantics on reopen).
      else if (seqItem.wait_template !== undefined || seqItem.wait_for_trigger !== undefined) {
        nodeType = 'wait';
        if (typeof seqItem.wait_template === 'string') {
          data.wait_template = seqItem.wait_template;
        } else if (Array.isArray(seqItem.wait_for_trigger)) {
          // Validate/normalize each trigger the same way the native-strategy
          // wait parser does (isWaitAction branch above), rather than
          // trusting the raw YAML shape.
          const parsedTriggers = [];
          for (const trigger of seqItem.wait_for_trigger) {
            const result = HATriggerSchema.safeParse(trigger);
            if (result.success) parsedTriggers.push(this.unfoldEventContextUserId(result.data));
          }
          data.wait_for_trigger = parsedTriggers;
        }
        if (seqItem.timeout) data.timeout = seqItem.timeout;
        if (seqItem.continue_on_timeout !== undefined) {
          data.continue_on_timeout = seqItem.continue_on_timeout;
        }
        if (seqItem.alias) data.alias = seqItem.alias;
      }
      // Check for service call action
      else if (seqItem.service || seqItem.action) {
        nodeType = 'action';
        data.service = seqItem.service || seqItem.action;
        if (seqItem.target) data.target = seqItem.target;
        if (seqItem.data) data.data = seqItem.data;
        if (seqItem.alias) data.alias = seqItem.alias;
      }
    }

    return { nodeId, nodeType, data, trueTarget, falseTarget };
  }

  /**
   * Parse Jinja condition expression to extract condition data
   */
  private parseJinjaCondition(expr: string): Record<string, unknown> {
    // is_state('entity', 'state')
    const isStateMatch = expr.match(/is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (isStateMatch) {
      const entityId = isStateMatch[1];
      const state = isStateMatch[2];

      // Check for sun entity
      if (entityId === 'sun.sun') {
        if (state === 'above_horizon') {
          return { condition: 'sun', after: 'sunrise', before: 'sunset' };
        } else if (state === 'below_horizon') {
          return { condition: 'sun', after: 'sunset', before: 'sunrise' };
        }
      }

      return { condition: 'state', entity_id: entityId, state };
    }

    // states('entity') | float > number
    const numericMatch = expr.match(
      /states\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\|\s*float\s*([<>=]+)\s*(\d+(?:\.\d+)?)/
    );
    if (numericMatch) {
      const entityId = numericMatch[1];
      const operator = numericMatch[2];
      const value = parseFloat(numericMatch[3]);

      const result: Record<string, unknown> = {
        condition: 'numeric_state',
        entity_id: entityId,
      };
      if (operator.includes('>')) result.above = value;
      if (operator.includes('<')) result.below = value;
      return result;
    }

    // Fallback to template condition
    return { condition: 'template', value_template: `{{ ${expr} }}` };
  }

  /**
   * Parse automation structure into nodes and edges (native format)
   */
  private parseAutomationStructure(
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
    const triggerNodes = this.parseTriggers(triggers, warnings, getNextNodeId);
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
    // Normalize to array and check if non-empty
    const conditions = Array.isArray(conditionData)
      ? conditionData
      : conditionData
        ? [conditionData]
        : [];

    if (conditions.length > 0) {
      const conditionResults = this.parseConditions(conditions, warnings, getNextNodeId);
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
          edges.push(this.createEdge(trigger.id, conditionNodes[0].id));
        }
        firstActionNodeIds = [conditionNodes[0].id];
      } else {
        // Multiple conditions - chain them sequentially
        // Connect triggers to first condition
        for (const trigger of triggerNodes) {
          edges.push(this.createEdge(trigger.id, conditionNodes[0].id));
        }

        // Chain conditions: each condition's TRUE path leads to next condition
        for (let i = 0; i < conditionNodes.length - 1; i++) {
          edges.push(this.createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
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
    const actions = Array.isArray(actionData) ? actionData : [actionData];
    const actionResults = this.parseActions(actions, {
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
   * Flattens a parsed trigger's `context: { user_id }` (HA's real YAML shape
   * for the event trigger's "Limit to events triggered by" filter — see
   * home-assistant.io/triggers/event/'s "Options in YAML") into the flat
   * `context_user_id` the UI edits (config/triggerFields.ts, matching every
   * other flattened-for-editing field there). HATriggerSchema is a
   * passthrough schema (see its doc comment), so `context` survives parsing
   * untouched, nested — without this, a saved-then-reopened event trigger's
   * user filter would round-trip correctly in the YAML but silently
   * disappear from the property panel, since the panel only reads/writes
   * `context_user_id`. Mirrors NativeStrategy/StateMachineStrategy's
   * `foldEventContextUserId` (base.ts) in the opposite direction.
   */
  private unfoldEventContextUserId(data: HATrigger): HATrigger {
    // HATriggerSchema is a union of per-platform `.looseObject(...)` shapes
    // (passthrough with an unknown catchall at runtime), so a real parsed
    // trigger can carry extra keys like `context` that TS's static
    // HATrigger union type doesn't know about on every branch. This is
    // exactly the "external API boundary" case CLAUDE.md's `as` exception
    // allows for: the runtime shape is genuinely looser than any single
    // branch of the statically-known union.
    const raw = data as Record<string, unknown>;
    const context = raw.context;
    if (
      !context ||
      typeof context !== 'object' ||
      Array.isArray(context) ||
      raw.context_user_id !== undefined
    ) {
      return data;
    }
    const user_id = (context as Record<string, unknown>).user_id;
    if (typeof user_id !== 'string') return data;
    const result: Record<string, unknown> = { ...raw };
    delete result.context;
    result.context_user_id = user_id;
    return result as HATrigger;
  }

  /**
   * Parse trigger configurations
   */
  private parseTriggers(
    triggers: unknown[],
    warnings: string[],
    getNextNodeId: (type: string) => string
  ): FlowNode[] {
    // Process all object-type trigger items — do NOT filter with isHATrigger here,
    // because modern HA may use formats (e.g. dict-keyed or novel trigger types)
    // that don't have 'platform', 'trigger', or 'entity_id' at the top level.
    return triggers
      .filter((t) => typeof t === 'object' && t !== null)
      .map((trigger, index) => {
        const nodeId = getNextNodeId('trigger');
        try {
          // Validate and parse trigger using HATriggerSchema
          const result = HATriggerSchema.safeParse(trigger);
          if (!result.success) {
            warnings.push(
              `Trigger ${index} failed schema validation: ${JSON.stringify(result.error.issues)}`
            );
            // Return a fallback TRIGGER node (not an action node) so the graph
            // always has at least one trigger — allowing the import to succeed.
            return this.createFallbackTriggerNode(nodeId, trigger);
          }
          const node: TriggerNode = {
            id: nodeId,
            type: 'trigger',
            position: { x: 0, y: 0 },
            data: this.unfoldEventContextUserId(result.data),
          };
          return node;
        } catch (error) {
          warnings.push(`Failed to parse trigger ${index}: ${error}`);
          return this.createFallbackTriggerNode(nodeId, trigger);
        }
      });
  }

  /**
   * Build a best-effort trigger node when HATriggerSchema validation fails.
   * Always returns type:'trigger' so validateGraphStructure does not fail.
   */
  private createFallbackTriggerNode(nodeId: string, originalData: unknown): TriggerNode {
    const data = (
      typeof originalData === 'object' && originalData !== null
        ? (originalData as Record<string, unknown>)
        : {}
    ) as Record<string, unknown>;

    // Determine trigger type from various formats:
    // 1. Modern HA: { trigger: 'state', ... }
    // 2. Legacy HA: { platform: 'state', ... }
    // 3. Dict-keyed: { state: { entity_id: '...' } }
    let triggerType: string;
    let nestedFields: Record<string, unknown> = {};

    if (typeof data.trigger === 'string') {
      triggerType = data.trigger;
      const { platform: _p, trigger: _t, ...rest } = data;
      nestedFields = rest;
    } else if (typeof data.platform === 'string') {
      triggerType = data.platform;
      const { platform: _p, ...rest } = data;
      nestedFields = rest;
    } else {
      // Dict-keyed format: first key is the trigger type, value contains fields
      const firstKey = Object.keys(data).find(
        (k) => !['alias', 'id', 'enabled', 'variables'].includes(k)
      );
      if (firstKey && typeof data[firstKey] === 'object' && data[firstKey] !== null) {
        triggerType = firstKey;
        nestedFields = data[firstKey] as Record<string, unknown>;
      } else {
        triggerType = 'state';
      }
    }

    return {
      id: nodeId,
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: {
        trigger: triggerType,
        ...nestedFields,
      } as TriggerNode['data'],
    };
  }

  /**
   * Parse condition configurations
   */
  private parseConditions(
    conditions: unknown[],
    warnings: string[],
    getNextNodeId: (type: string) => string
  ): { nodes: ConditionNode[]; edges: FlowEdge[]; outputNodeIds: string[] } {
    const nodes: ConditionNode[] = [];
    const edges: FlowEdge[] = [];
    const outputNodeIds: string[] = [];

    conditions.filter(isHACondition).forEach((condition, index) => {
      const nodeId = getNextNodeId('condition');
      try {
        const result = HAConditionSchema.safeParse(condition);
        if (!result.success) {
          warnings.push(
            `Condition ${index} failed schema validation: ${JSON.stringify(result.error.issues)}`
          );
          nodes.push({
            id: nodeId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: {
              condition: 'template',
              alias: 'Unknown Condition',
              value_template: JSON.stringify(condition),
            },
          });
          return;
        }

        const node: ConditionNode = {
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: result.data,
        };
        nodes.push(node);
        outputNodeIds.push(nodeId);
      } catch (error) {
        warnings.push(`Failed to parse condition ${index}: ${error}`);
        // Create a minimal valid unknown condition node
        nodes.push({
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            condition: 'template',
            alias: 'Unknown Condition',
            value_template: JSON.stringify(condition),
          },
        });
      }
    });
    return { nodes, edges, outputNodeIds };
  }

  /**
   * Parse action sequences (including choose blocks, delays, etc.)
   */
  private parseActions(
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
        edges.push(this.createEdge(prevId, targetId, sourceHandle));
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
              parsedTriggers.push(this.unfoldEventContextUserId(result.data));
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
        const chooseResult = this.parseChooseBlock(action as Record<string, unknown>, {
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
        const ifAction = {
          if: ifArr,
          then: thenArr,
          else: elseArr,
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          enabled: act.enabled,
        };
        const ifResult = this.parseIfBlock(ifAction, {
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
            // It's a sequence array
            const seqResult = this.parseActions(parallelItem as Record<string, unknown>[], {
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
              inheritedEnabled,
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
            const singleResult = this.parseActions([parallelItem] as Record<string, unknown>[], {
              warnings,
              previousNodeIds: parallelStartNodes,
              getNextNodeId,
              conditionNodeIds: localConditionNodeIds,
              // Same forwarding fix as the array-branch case just above --
              // see bug #17's comment there for the full explanation.
              falsePathConditionIds,
              inheritedEnabled,
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

        if (Array.isArray(repeat.while) && repeat.while.length > 0) {
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
            parsedData.enabled = blockEnabled;
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
            edges.push(this.createEdge(conditionNodes[ci].id, conditionNodes[ci + 1].id, 'true'));
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
          const bodyResult = this.parseActions(repeatSequence as (HAAction | HACondition)[], {
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
              const backEdge = this.createEdge(termId, conditionNodes[0].id, sourceHandle);
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
          const bodyResult = this.parseActions(repeatSequence as (HAAction | HACondition)[], {
            warnings,
            previousNodeIds: currentNodeIds,
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
          const firstBodyNodeId = bodyResult.nodes.length > 0 ? bodyResult.nodes[0].id : null;

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
            parsedData.enabled = blockEnabled;
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
              edges.push(this.createEdge(termId, conditionNodes[0].id, sourceHandle));
            }
          } else {
            // Empty body - connect previous nodes directly to condition
            createEdgesFromCurrent(conditionNodes[0].id);
          }

          // Chain condition nodes together with 'true' edges
          for (let ci = 0; ci < conditionNodes.length - 1; ci++) {
            edges.push(this.createEdge(conditionNodes[ci].id, conditionNodes[ci + 1].id, 'true'));
          }

          const lastCondId = conditionNodes[conditionNodes.length - 1].id;

          // Create back-edge from first condition →(false)→ first body node
          if (firstBodyNodeId) {
            const backEdge = this.createEdge(conditionNodes[0].id, firstBodyNodeId, 'false');
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
          const bodyResult = this.parseActions(repeatSequence as (HAAction | HACondition)[], {
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
              edges.push(this.createEdge(termId, incrId, sourceHandle));
            }
          } else {
            edges.push(this.createEdge(counterId, incrId));
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
          edges.push(this.createEdge(incrId, condId));

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
          const backEdge = this.createEdge(condId, loopTargetId, 'true');
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
              target:
                typeof target === 'object' && target !== null ? (target as Target) : undefined,
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
          nodes.push(this.createUnknownNode(nodeId, action));
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
        const nestedResult = this.parseActions(nestedSequence, {
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
  private parseChooseBlock(
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

    // Helper to get enabled state for nodes in this block
    const getNodeEnabled = (): boolean | undefined => effectiveEnabled;

    const choices = Array.isArray(chooseAction.choose)
      ? chooseAction.choose
      : [chooseAction.choose];

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
              enabled: getNodeEnabled(),
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
            enabled: getNodeEnabled(),
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
              enabled: getNodeEnabled(),
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
        const fanEdge = this.createEdge(entryId, firstConditionId, fanHandle);
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
          const e = this.createEdge(prevId, firstConditionId);
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
        const e = this.createEdge(prevId, firstConditionId, sourceHandle);
        if (isChooseChainEdge) {
          (e as Record<string, unknown>).type = 'choose-chain';
        }
        edges.push(e);
      }

      // Chain condition nodes together with 'true' edges
      for (let i = 0; i < choiceConditionNodes.length - 1; i++) {
        edges.push(
          this.createEdge(choiceConditionNodes[i].id, choiceConditionNodes[i + 1].id, 'true')
        );
      }

      // Parse sequence for this choice (TRUE path from last condition)
      if (choice.sequence) {
        const sequence = Array.isArray(choice.sequence) ? choice.sequence : [choice.sequence];
        const sequenceResult = this.parseActions(sequence, {
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
      const defaultResult = this.parseActions(defaultSequence, {
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
  private parseIfBlock(
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

    // Helper to get enabled state for nodes in this block
    const getNodeEnabled = (): boolean | undefined => effectiveEnabled;

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
            enabled: getNodeEnabled(),
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
          enabled: getNodeEnabled(),
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
            enabled: getNodeEnabled(),
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
      if (ifAction.else || ifConditions.length !== 1) return null;
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
      edges.push(this.createEdge(prevId, firstConditionId, sourceHandle));
    }

    // Chain condition nodes together with 'true' edges
    for (let i = 0; i < conditionNodes.length - 1; i++) {
      edges.push(this.createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
    }

    // The last condition node connects to the 'then' actions
    const lastConditionId = conditionNodes[conditionNodes.length - 1].id;

    // Parse 'then' sequence (true branch) - connects from last condition
    if (ifAction.then) {
      const thenSequence = Array.isArray(ifAction.then) ? ifAction.then : [ifAction.then];
      const thenResult = this.parseActions(thenSequence, {
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
    if (ifAction.else) {
      const elseSequence = Array.isArray(ifAction.else) ? ifAction.else : [ifAction.else];
      // Mark firstConditionId as a false-path source via falsePathConditionIds
      // (not conditionNodeIds, which means "true"-path) so parseActions'
      // createEdgesFromCurrent assigns 'false' to the very first edge
      // automatically and — critically — forwards this same set into any
      // nested if/choose block within the else sequence, so deeply nested
      // structures get correct handles throughout, not just at the first
      // level. See parseActions' falsePathConditionIds seeding above for
      // the full explanation of why this replaced a previous manual
      // create-then-patch workaround.
      const elseResult = this.parseActions(elseSequence, {
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

  /**
   * Create an unknown node for unparseable content
   */
  private createUnknownNode(nodeId: string, originalData: unknown): ActionNode {
    const data = originalData as Record<string, unknown> | null | undefined;
    return {
      id: nodeId,
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        alias: `Unknown: ${data?.service || data?.trigger || 'Node'}`,
        service: (data?.service as string) || 'unknown.unknown',
        data: data as Record<string, unknown> | undefined,
      },
    };
  }

  /**
   * Apply positions from metadata
   */
  private applyMetadataPositions(nodes: FlowNode[], metadata: CircuitryMetadata): FlowNode[] {
    return nodes.map((node) => ({
      ...node,
      position: metadata.nodes[node.id] || node.position,
    }));
  }

  /**
   * Create an edge between two nodes
   */
  private createEdge(source: string, target: string, sourceHandle?: string): FlowEdge {
    return {
      id: generateEdgeId(source, target),
      source,
      target,
      sourceHandle: sourceHandle || undefined,
    };
  }
}

// Export singleton instance
export const yamlParser = new YamlParser();
