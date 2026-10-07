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
  HACondition,
  HATrigger,
  TriggerNode,
} from '@circuitry/shared';
import {
  CircuitryMetadataSchema,
  HAConditionSchema,
  HATriggerSchema,
  OPAQUE_STEP_KEY,
} from '@circuitry/shared';
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
 * Read one Home Assistant condition into a condition node's data, exactly as
 * written (decision D3, bug #58). HAConditionSchema accepts at least what HA
 * accepts, so a condition it rejects is one HA would reject too: the import
 * fails with a message naming it, instead of the condition being rewritten
 * into something else. (Before #58 every caller rewrote it into a template
 * made from its JSON text, which HA always evaluates as false.)
 */
export function importCondition(condition: unknown, where: string): HACondition {
  const result = HAConditionSchema.safeParse(condition);
  if (result.success && typeof result.data.condition === 'string') return result.data;
  if (result.success) {
    // HA needs a condition type (shorthands are expanded before this).
    throw new Error(
      `${where}: this condition can't be read (it has no condition type): ${JSON.stringify(condition)}`
    );
  }
  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(condition)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`${where}: this condition can't be read (${issues}): ${JSON.stringify(condition)}`);
}

/**
 * A step's own `enabled`, as HA takes it: a boolean, or a template that HA
 * renders when it reaches the step (bug #70). A template used to be
 * dropped, so a step HA skips ran anyway. Anything else is left out.
 */
export function stepEnabledAsWritten(enabled: unknown): boolean | string | undefined {
  return typeof enabled === 'boolean' || typeof enabled === 'string' ? enabled : undefined;
}

/**
 * The aliases a block's condition node holds (#143): its first (gate)
 * condition carries the block's alias, where the canvas shows it, and the
 * condition's own alias beside it in `_conditionAlias` (both strategies
 * write that one back inside the condition); any other condition holds its
 * own. With one slot for both, the condition's own alias was lost (or took
 * the block's place) whenever it was a block's first.
 */
export function conditionAliases(
  isGate: boolean,
  blockAlias: unknown,
  conditionAlias: unknown
): { alias: string | undefined; _conditionAlias?: string } {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  if (!isGate) return { alias: text(conditionAlias) };
  const own = text(conditionAlias);
  return { alias: text(blockAlias), ...(own !== undefined ? { _conditionAlias: own } : {}) };
}

/**
 * A condition's own `enabled`, as written (bug #64): `false`, a template
 * (HA accepts `enabled: "{{ ... }}"` on a condition), or `undefined` for
 * enabled. `true` is the default, so it's dropped. A disabled block
 * disables every condition in it.
 */
export function conditionEnabledAsWritten(
  condition: unknown,
  blockDisabled: boolean
): false | string | undefined {
  if (blockDisabled) return false;
  if (!condition || typeof condition !== 'object' || !('enabled' in condition)) return undefined;
  const { enabled } = condition;
  if (enabled === false) return false;
  return typeof enabled === 'string' ? enabled : undefined;
}

/**
 * An action node holding a step the parser doesn't know (`scene:`, the
 * legacy `service_template:`, a step type Home Assistant adds later),
 * exactly as written, to be written back unchanged (bug #57, decision
 * D3; see OPAQUE_STEP_KEY). It used to become `action: unknown.unknown`
 * with the step under `data:`, which fails when run. Inside a disabled
 * block the step is disabled, like every other step there.
 */
export function createOpaqueStepNode(
  nodeId: string,
  step: Record<string, unknown>,
  blockDisabled: boolean
): ActionNode {
  const data: Record<string, unknown> = { ...step, [OPAQUE_STEP_KEY]: true };
  if (blockDisabled) data.enabled = false;
  return {
    id: nodeId,
    type: 'action',
    position: { x: 0, y: 0 },
    data: data as ActionNode['data'],
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
 * The triggers of a `wait_for_trigger` step, read the way top-level
 * triggers are. A trigger the schema can't read stops the import with the
 * reason (the parser's caller reports it). Both parsers used to drop it,
 * the native one with only a warning, which saved a wait for fewer
 * triggers than written, or for none.
 */
export function importWaitTriggers(triggers: readonly unknown[]): HATrigger[] {
  return triggers.map((trigger, index) => {
    const result = HATriggerSchema.safeParse(trigger);
    if (!result.success) {
      throw new Error(
        `Could not read trigger ${index + 1} of a wait_for_trigger: ${result.error.message}`
      );
    }
    return unfoldEventContextUserId(result.data);
  });
}

/**
 * Parse trigger configurations. A trigger the schema can't read stops the
 * import with the reason, as HA refuses it (decision D3; HATriggerSchema
 * accepts at least what HA does). Such a trigger used to become a
 * best-effort node -- the first object-valued key read as the trigger
 * type, or a `state` trigger when there was none -- and a trigger that
 * wasn't a mapping was dropped.
 */
export function parseTriggers(
  triggers: unknown[],
  _warnings: string[],
  getNextNodeId: (type: string) => string
): FlowNode[] {
  return triggers.map((trigger, index) => {
    const result = HATriggerSchema.safeParse(trigger);
    if (!result.success || typeof trigger !== 'object' || trigger === null) {
      throw new Error(
        `Could not read trigger ${index + 1}: ${
          result.success ? 'a trigger is a mapping' : result.error.message
        }`
      );
    }
    const node: TriggerNode = {
      id: getNextNodeId('trigger'),
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: unfoldEventContextUserId(result.data),
    };
    return node;
  });
}

