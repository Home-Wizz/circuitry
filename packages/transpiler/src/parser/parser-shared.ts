/**
 * Small, stateless helpers shared by both YamlParser format parsers
 * (standard-automation and state-machine) and by YamlParser itself.
 * Extracted from YamlParser.ts (the 2026-09-25 file-decomposition
 * work) as a pure move -- no logic changed, only relocated.
 */
import type {
  ActionNode,
  CircuitryMetadata,
  FlowEdge,
  FlowNode,
  HATrigger,
  TriggerNode,
} from '@circuitry/shared';
import { CircuitryMetadataSchema, HATriggerSchema } from '@circuitry/shared';
import { generateEdgeId } from '../utils/generateIds';

/**
 * Extract Circuitry metadata from variables section
 */
/**
 * Extract and validate Circuitry metadata from variables section using Zod schema.
 * Returns CircuitryMetadata if valid, otherwise null.
 */
export function extractMetadata(
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
export function extractUserVariables(parsed: Record<string, unknown>): Record<string, unknown> {
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
export function unfoldEventContextUserId(data: HATrigger): HATrigger {
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
 * Create an unknown node for unparseable content
 */
export function createUnknownNode(nodeId: string, originalData: unknown): ActionNode {
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
export function applyMetadataPositions(nodes: FlowNode[], metadata: CircuitryMetadata): FlowNode[] {
  return nodes.map((node) => ({
    ...node,
    position: metadata.nodes[node.id] || node.position,
  }));
}

/**
 * Create an edge between two nodes
 */
export function createEdge(source: string, target: string, sourceHandle?: string): FlowEdge {
  return {
    id: generateEdgeId(source, target),
    source,
    target,
    sourceHandle: sourceHandle || undefined,
  };
}

/**
 * Parse trigger configurations
 */
export function parseTriggers(
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
          return createFallbackTriggerNode(nodeId, trigger);
        }
        const node: TriggerNode = {
          id: nodeId,
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: unfoldEventContextUserId(result.data),
        };
        return node;
      } catch (error) {
        warnings.push(`Failed to parse trigger ${index}: ${error}`);
        return createFallbackTriggerNode(nodeId, trigger);
      }
    });
}

/**
 * Build a best-effort trigger node when HATriggerSchema validation fails.
 * Always returns type:'trigger' so validateGraphStructure does not fail.
 */
export function createFallbackTriggerNode(nodeId: string, originalData: unknown): TriggerNode {
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
