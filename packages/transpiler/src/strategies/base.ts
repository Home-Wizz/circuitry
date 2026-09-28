import type {
  ActionNode,
  DelayNode,
  FlowGraph,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@circuitry/shared';
import { isDeviceAction, isOpaqueStepData } from '@circuitry/shared';
import type { TopologyAnalysis } from '../analyzer/topology';
import { stripDottedOnlyConditionFields } from '../utils/conditionFields';

/** An and/or/not group, whose `conditions:` HA requires even when empty (bug #71). */
export function isConditionGroup(condition: unknown): boolean {
  return condition === 'and' || condition === 'or' || condition === 'not';
}

/**
 * The step of a one-step `parallel:` branch when it can be written bare
 * (`parallel: [step, ...]`, not `parallel: [[step], ...]`), or `undefined`
 * when it can't. HA reads a bare branch that has a `sequence:` key as a
 * branch container (config_validation's _SCRIPT_PARALLEL_SCHEMA tries
 * that schema first), and a container keeps only its `sequence`,
 * `alias` and a boolean `enabled` (script.py, _async_prep_parallel_scripts):
 * a `sequence:` step's `continue_on_error` or template `enabled` written
 * bare was ignored, so a step HA skips ran (bug #94, found in a
 * real HA). Such a step stays in a list of its own.
 */
export function bareParallelBranch(steps: unknown[]): unknown {
  if (steps.length !== 1) return undefined;
  const [step] = steps;
  if (!step || typeof step !== 'object' || Array.isArray(step) || !('sequence' in step)) {
    return step;
  }
  return Object.keys(step).every((key) => key === 'sequence' || key === 'alias') ? step : undefined;
}

/**
 * Output format from a transpiler strategy
 */
export interface HAYamlOutput {
  /**
   * Generated automation config (for native strategy)
   */
  automation?: Record<string, unknown>;
  /**
   * Generated script config (for state machine strategy)
   */
  script?: Record<string, unknown>;
  /**
   * Warnings generated during transpilation
   */
  warnings: string[];
  /**
   * The strategy used for transpilation
   */
  strategy: string;
  /**
   * Node IDs in the exact order they were materialized into the generated
   * YAML (see NativeStrategy's recordNodeOrder doc comment). Optional —
   * only NativeStrategy currently populates this; StateMachineStrategy's
   * parser already matches node identity directly from choose-block
   * templates rather than positionally, so it doesn't need this. When
   * present, FlowTranspiler.ts's generateCircuitryMetadata uses it (instead
   * of flow.nodes' raw array order) to decide what order to write
   * `_circuitry_metadata.nodes` in, so it lines up with the order
   * YamlParser.ts will re-encounter the same nodes on reload.
   */
  nodeOrder?: string[];
  /**
   * StateMachineStrategy only (Phase 5): the fan-outs it rendered inline --
   * see its recordFanOut. Written to `_circuitry_metadata.fan_outs`.
   */
  fanOuts?: Record<string, { targets: string[]; hash: string }>;
}

export { stripDottedOnlyConditionFields };

/**
 * Base interface for transpiler strategies
 */
export interface TranspilerStrategy {
  /**
   * Unique name for this strategy
   */
  readonly name: string;

  /**
   * Description of when this strategy should be used
   */
  readonly description: string;

  /**
   * Check if this strategy can handle the given topology
   */
  canHandle(analysis: TopologyAnalysis): boolean;

  /**
   * Generate Home Assistant YAML from a flow graph
   */
  generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput;
}

/**
 * Base class with common utility methods for strategies
 */
export abstract class BaseStrategy implements TranspilerStrategy {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract canHandle(analysis: TopologyAnalysis): boolean;
  abstract generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput;

  /**
   * Find the entry node(s) of a flow
   */
  protected findEntryNodes(flow: FlowGraph): string[] {
    const targetNodes = new Set(flow.edges.map((e) => e.target));
    return flow.nodes.filter((n) => !targetNodes.has(n.id)).map((n) => n.id);
  }

  /**
   * Get outgoing edges from a node
   */
  protected getOutgoingEdges(flow: FlowGraph, nodeId: string) {
    return flow.edges.filter((e) => e.source === nodeId);
  }

  /**
   * Get incoming edges to a node
   */
  protected getIncomingEdges(flow: FlowGraph, nodeId: string) {
    return flow.edges.filter((e) => e.target === nodeId);
  }

  /**
   * Get a node by ID
   */
  protected getNode(flow: FlowGraph, nodeId: string) {
    return flow.nodes.find((n) => n.id === nodeId);
  }

  /**
   * Strips Circuitry's own internal bookkeeping fields from a node's `data`
   * before any part of it gets spread into generated YAML. Every one of
   * these — `_blockKey`, `_placeholder`, `_chooseCase`, `_chooseCaseTotal`,
   * `_ifElseBranch`, `_parallelBranch`, `_conditionId`, and any future one —
   * shares the same leading-underscore naming convention (see
   * block-factories.ts, config/handledProperties.ts), so a single
   * pattern-based rule catches all of them at once.
   *
   * This replaces what used to be a hand-maintained, per-call-site
   * destructure exclusion list (`const { ..., _blockKey, _placeholder,
   * ...extraProps } = node.data`) repeated across both strategies'
   * condition/action/delay/wait/set_variables builders. That approach had
   * already proven unreliable in practice: `_ifElseBranch`/`_parallelBranch`
   * were missing from NativeStrategy's own action builder (confirmed via a
   * real save failure — "extra keys not allowed @ ...['_ifElseBranch']" —
   * since HA's schemas reject any unrecognized key outright), and
   * StateMachineStrategy's action/delay/wait/set_variables builders excluded
   * none of these fields at all. A name-pattern rule needs no maintenance
   * when block-factories.ts grows a new internal field later — unlike an
   * enumerable list, it can't silently fall out of date.
   */
  protected stripInternalFields<T extends Record<string, unknown>>(data: T): T {
    // Cast back to T is safe: this only ever removes whole keys, it never
    // changes the type of any value that survives, so every remaining field
    // a caller destructures out afterward keeps its real type (e.g.
    // `wait_for_trigger` staying an array, not widening to `unknown`).
    return Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_'))) as T;
  }

  /**
   * Writes a step's `enabled` the way HA takes it: `false`, or a template
   * HA renders when it reaches the step (bug #70: a template used to be
   * dropped, so a step HA skips ran). Enabled (true or unset) writes
   * nothing. Shared by both strategies' action builders.
   */
  protected writeEnabled(step: Record<string, unknown>, enabled: unknown): void {
    if (enabled === false || typeof enabled === 'string') step.enabled = enabled;
  }

  /**
   * The step an opaque action node holds (a step Circuitry doesn't know,
   * see OPAQUE_STEP_KEY in @circuitry/shared), exactly as written: its
   * data without Circuitry's internal `_` keys and without a key the
   * editor cleared (`undefined`). Shared by both strategies'
   * buildActionCall (bug #57).
   */
  protected buildOpaqueStep(node: ActionNode): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.stripInternalFields(node.data)).filter(([, value]) => value !== undefined)
    );
  }

  /**
   * Cleans up a trigger's fields for YAML output: drops `undefined`/`''`
   * (never meaningful in generated YAML), but — unlike a blanket
   * `v !== null` filter — keeps an explicit `null` on `from`/`to`, since HA's
   * `state` trigger gives `from: null`/`to: null` real, different-from-unset
   * meaning ("any state, including the very first ever recorded, ignoring
   * attribute-only changes" — see home-assistant.io/docs/automation/trigger/
   * #state-trigger's "Good to know"). Every other field keeps the old
   * behavior of dropping `null` outright, since HA gives it no meaning there
   * and it's more likely leftover UI state than an intentional value.
   *
   * Shared by both strategies' trigger builders (NativeStrategy's
   * buildTrigger, StateMachineStrategy's extractTriggers) and both
   * strategies' `wait_for_trigger` list builders, which used to each
   * hand-roll the identical `Object.entries(...).filter(...)` — per
   * CLAUDE.md's DRY mandate, one implementation instead of four copies that
   * could each fix (or fail to fix) this bug independently.
   */
  protected cleanTriggerFields(trigger: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(trigger).filter(([key, v]) => {
        // "" is kept: HA accepts it (`event_type: ""`, `value_template: ""`),
        // and dropping it left a trigger without its required key, which HA
        // refused (bug #72). The editor stores a cleared field as unset.
        if (v === undefined) return false;
        if (v === null) return key === 'from' || key === 'to';
        return true;
      })
    );
  }

  /**
   * Folds the event trigger's "Limit to events triggered by" field back into
   * HA's real YAML shape. It's edited as a flat `context_user_id` (see
   * config/triggerFields.ts's doc comment — matches every other
   * flattened-for-editing field in that table, and reuses the plain 'user'
   * field type instead of a bespoke nested-object editor), but HA's actual
   * wire shape nests it under `context: { user_id }` (confirmed via
   * home-assistant.io/triggers/event/'s "Options in YAML": "context map —
   * Optional event context that must match"). Shared by both strategies'
   * trigger builders and both strategies' `wait_for_trigger` list builders —
   * any of the four could hold an `event` trigger with this field set.
   */
  protected foldEventContextUserId(trigger: Record<string, unknown>): Record<string, unknown> {
    const { context_user_id: contextUserId, ...rest } = trigger;
    return typeof contextUserId === 'string' && contextUserId
      ? { ...rest, context: { user_id: contextUserId } }
      : rest;
  }

  /**
   * Build service call action or device action. One copy for both
   * strategies (bug #95): StateMachineStrategy had its own, which drifted
   * -- it dropped a wait trigger's `alias`, and wrote an action's `id`,
   * which HA refuses.
   */
  protected buildActionCall(node: ActionNode): Record<string, unknown> {
    // A step Circuitry doesn't know: written back exactly as written (#57).
    if (isOpaqueStepData(node.data)) return this.buildOpaqueStep(node);

    // Check if this is a device action (needs special format)
    if (isDeviceAction(node.data.data)) {
      const deviceData = node.data.data;
      const action: Record<string, unknown> = {
        device_id: deviceData.device_id,
        domain: deviceData.domain,
        type: deviceData.type,
      };

      if (node.data.alias) {
        action.alias = node.data.alias;
      }

      // Add entity_id if present
      if (deviceData.entity_id) {
        action.entity_id = deviceData.entity_id;
      }

      // Add subtype if present
      if (deviceData.subtype) {
        action.subtype = deviceData.subtype;
      }

      // Add any additional parameters (like 'option' for select)
      const knownFields = ['type', 'device_id', 'domain', 'entity_id', 'subtype'];
      for (const [key, value] of Object.entries(deviceData)) {
        if (!knownFields.includes(key) && value !== undefined) {
          action[key] = value;
        }
      }

      this.writeEnabled(action, node.data.enabled);

      return action;
    }

    // Check if this is a fallback repeat action (opaque repeat block)
    if (node.data.repeat) {
      const repeatData = node.data.repeat;
      const action: Record<string, unknown> = {
        repeat: {
          ...(repeatData.count !== undefined ? { count: repeatData.count } : {}),
          ...(repeatData.while ? { while: repeatData.while } : {}),
          ...(repeatData.until ? { until: repeatData.until } : {}),
          ...(repeatData.for_each !== undefined ? { for_each: repeatData.for_each } : {}),
          sequence: repeatData.sequence ?? [],
        },
      };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.continue_on_error) action.continue_on_error = node.data.continue_on_error;
      this.writeEnabled(action, node.data.enabled);
      return action;
    }

    // Check if this is a fire event action
    if (typeof node.data.event === 'string' && node.data.event.trim() !== '') {
      const action: Record<string, unknown> = { event: node.data.event };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.event_data && Object.keys(node.data.event_data).length > 0) {
        action.event_data = node.data.event_data;
      }
      if (node.data.continue_on_error) action.continue_on_error = node.data.continue_on_error;
      this.writeEnabled(action, node.data.enabled);
      return action;
    }

    // Check if this is a stop action
    if ('stop' in node.data) {
      const action: Record<string, unknown> = { stop: node.data.stop ?? '' };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.error === true) action.error = true;
      // `response_variable` on `stop` — home-assistant.io/docs/scripts/#stopping-a-script-sequence:
      // "To return a response from a script, use the response_variable option.
      // This option expects the name of the variable that contains the data
      // to return." Same field name/shape as the service-call response_variable
      // above, so it round-trips through the same HAAction#response_variable
      // shared type — no schema change needed.
      if (node.data.response_variable) action.response_variable = node.data.response_variable;
      if (node.data.continue_on_error) action.continue_on_error = node.data.continue_on_error;
      this.writeEnabled(action, node.data.enabled);
      return action;
    }

    // Standard service call format — output as 'action:' (HA 2024.8+ preferred key)
    // stripInternalFields (base.ts) drops every `_`-prefixed Circuitry-internal
    // field (_blockKey, _placeholder, _ifElseBranch, _parallelBranch, ...) up
    // front — see its doc comment for why this replaced a hand-maintained
    // per-field exclusion list here (a real save failure: "extra keys not
    // allowed @ ...['_ifElseBranch']", from _ifElseBranch/_parallelBranch
    // having been missing from that list).
    const {
      alias,
      service,
      action: _originalActionKey, // excluded from extraProps
      id: _id, // excluded from extraProps — HA doesn't support id on action steps, see below
      target,
      data,
      data_template,
      response_variable,
      continue_on_error,
      enabled,
      repeat: _repeat,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const action: Record<string, unknown> = {
      ...extraProps,
      alias,
      action: service, // use 'action:' key (replaces legacy 'service:')
    };

    // `id` is intentionally dropped here (not just excluded from
    // extraProps) — HA's SERVICE_SCHEMA (and the other action-type schemas
    // below) don't support a per-step `id:` at all; only triggers do. Real
    // HA rejects it outright ("extra keys not allowed"), it's not just
    // ignored, so this can't be preserved even for round-trip fidelity.

    if (target) {
      action.target = target;
    }

    if (data && Object.keys(data as object).length > 0) {
      action.data = data;
    }

    if (data_template) {
      action.data_template = data_template;
    }

    if (response_variable) {
      action.response_variable = response_variable;
    }

    if (continue_on_error) {
      action.continue_on_error = continue_on_error;
    }

    this.writeEnabled(action, enabled);

    return action;
  }

  /**
   * Build delay action
   */
  protected buildDelay(node: DelayNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const {
      alias,
      delay: delayValue,
      id: _id,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const delay: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      delay: delayValue,
    };

    return delay;
  }

  /**
   * Build wait action
   */
  protected buildWait(node: WaitNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const {
      alias,
      id: _id,
      wait_template,
      wait_for_trigger,
      timeout,
      continue_on_timeout,
      ...extraProps
    } = this.stripInternalFields(node.data);
    const wait: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
    };

    // "" is a template HA accepts (bug #72): only an unset one is left out.
    if (wait_template !== undefined && wait_template !== null) {
      wait.wait_template = wait_template;
    } else if (wait_for_trigger) {
      wait.wait_for_trigger = wait_for_trigger.map((triggerData) => {
        const trigger: Record<string, unknown> = { ...triggerData };
        return this.cleanTriggerFields(this.foldEventContextUserId(trigger));
      });
    }

    // A timeout the node holds is written as it is, zero included: in HA
    // zero means "give up at once" (home-assistant/core#109586) and only no
    // `timeout` waits forever. It used to drop every zero, because the
    // editor's duration picker reported its untouched state as zeros; the
    // Wait node's Timeout switch now leaves it unset when off (bug #66).
    if (timeout !== undefined && timeout !== null) {
      wait.timeout = timeout;
    }

    if (continue_on_timeout !== undefined) {
      wait.continue_on_timeout = continue_on_timeout;
    }

    return wait;
  }

  /**
   * Build set variables action
   */
  protected buildSetVariables(node: SetVariablesNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, id: _id, variables, ...extraProps } = this.stripInternalFields(node.data);
    const setVars: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      variables,
    };

    if (alias) {
      setVars.alias = alias;
    }

    return setVars;
  }

  /**
   * A condition node's data as the HA condition it is. One copy for both
   * strategies (bug #95's class: StateMachineStrategy had its own, as did
   * NativeStrategy twice). `dropTopAlias`: the node's own alias is written
   * on the block that wraps the condition instead (a block gate, or every
   * state-machine condition's `if:` step), so it isn't written here too; a
   * condition nested in an and/or/not group always keeps its own alias,
   * which used to be dropped, losing a named sub-condition's label.
   */
  protected buildConditionData(
    data: Record<string, unknown>,
    dropTopAlias: boolean
  ): Record<string, unknown> {
    if (!data || typeof data !== 'object') return data;
    // Internal Circuitry fields and the legacy `template` key are left out.
    const { condition, conditions, alias, template, ...rest } = this.stripInternalFields(data);
    const out: Record<string, unknown> = {
      condition,
      ...stripDottedOnlyConditionFields(condition, rest),
      ...(alias && !dropTopAlias ? { alias } : {}),
    };
    // For template conditions, ensure value_template is set from template if needed
    if (condition === 'template' && !rest.value_template && template) {
      out.value_template = template;
    }
    // An and/or/not group keeps its list as written, empty or not: HA
    // requires `conditions:` and gives an empty group a meaning (and: true,
    // or: false, not: true). Dropping it (or an empty nested group) made HA
    // refuse the output or changed what the group means (bug #71).
    if (Array.isArray(conditions) && (conditions.length > 0 || isConditionGroup(condition))) {
      out.conditions = (conditions as Record<string, unknown>[]).map((c) =>
        this.buildConditionData(c, false)
      );
    }
    // Normalize id: ["x"] -> "x" -- HA API sometimes returns trigger
    // condition ids as single-element arrays.
    if (Array.isArray(out.id) && out.id.length === 1) {
      out.id = out.id[0];
    }
    // Only unset (undefined) fields are left out: an empty string is a value
    // HA accepts (`state: ""` compares with an empty state), and dropping
    // it made the gate refuse the automation (bug #65). The editor stores a
    // cleared field as unset, not as "".
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
  }

  /**
   * Build a single trigger configuration
   */
  protected buildTrigger(node: TriggerNode): Record<string, unknown> {
    // Trigger nodes aren't currently tagged with any internal Circuitry field by
    // block-factories.ts, but stripping here too costs nothing and closes
    // the gap automatically if that ever changes (see stripInternalFields's
    // doc comment in base.ts).
    const trigger: Record<string, unknown> = this.stripInternalFields(node.data);

    // Clean up undefined/empty values (but keep explicit from/to: null — see cleanTriggerFields)
    return this.cleanTriggerFields(this.foldEventContextUserId(trigger));
  }
}
