import type { CircuitryMetadata, FlowEdge, FlowGraph, FlowNode } from '@circuitry/shared';
import {
  FlowGraphMetadataSchema,
  FlowGraphSchema,
  validateGraphStructure,
} from '@circuitry/shared';
import { load as yamlLoad } from 'js-yaml';
import { generateGraphId } from '../utils/generateIds';
import { applyHeuristicLayout, applyHeuristicLayoutSync } from './layout';
import { applyMetadataPositions, extractMetadata, extractUserVariables } from './parser-shared';
import {
  detectStateMachineFormat,
  parseStateMachineStructure,
} from './state-machine-format-parser';
import { parseAutomationStructure } from './standard-automation-parser';

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
        const metaNodes = applyMetadataPositions(nodes, metadata);
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
    const metadata = extractMetadata(parsed, warnings);
    const hadMetadata = metadata !== null;

    // Step 2b: Extract user-defined variables (excluding _flode_metadata)
    const userVariables = extractUserVariables(parsed);

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
      metadata?.strategy === 'state-machine' || detectStateMachineFormat(content);

    // Step 6: Parse nodes and edges from YAML structure
    const { nodes, edges } = isStateMachine
      ? parseStateMachineStructure(
          content,
          warnings,
          metadataNodeIds,
          metadata?.fan_outs,
          metadata?.markers
        )
      : parseAutomationStructure(content, warnings, metadataNodeIds);

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
}

// Export singleton instance
export const yamlParser = new YamlParser();
