import type { FlowGraph } from '@circuitry/shared';
import type { TopologyAnalysis } from '../analyzer/topology';

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
}

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
   * True if a duration value (HA's `{hours,minutes,seconds,milliseconds}`
   * object form, or a legacy "HH:MM:SS[.ms]" string) represents an actual
   * positive length of time — false for undefined/empty, an all-zero
   * object, or an all-zero string like "00:00:00".
   *
   * Used to gate whether a Wait node's `timeout` gets written into generated
   * YAML at all. This matters because a *literal* zero timeout is not the
   * same thing as no timeout in HA: confirmed directly against HA's own
   * issue tracker (home-assistant/core#109586, "'Wait for trigger' with
   * defined but zero timeout timesout immediately," closed as working-as-
   * intended) — `wait_for_trigger`/`wait_template` treat an explicit
   * `timeout: {hours:0,...}` as "give up after 0 seconds," not "wait
   * forever." Only *omitting* `timeout` entirely waits indefinitely.
   *
   * Before this fix, both strategies' wait-step builders used a bare
   * `if (timeout)` truthy check, which always passed for a real object even
   * when every field inside it was 0 — so a Wait node whose Timeout field
   * was left untouched (DurationField.tsx's underlying HA duration-picker
   * widget reports its unset/default state as an all-zero object, not
   * `undefined`) silently produced an explicit zero timeout in the output
   * YAML. Reported directly: a "turn light on, wait for occupancy to clear,
   * turn off" automation turned the light straight back off within about a
   * second of turning on, because the wait step timed out (and, with
   * `continue_on_timeout` defaulting to true, fell straight through to the
   * turn-off step) instead of actually waiting — confirmed by diffing
   * against a hand-written HA automation with no `timeout:` key at all,
   * which waited correctly.
   */
  protected hasMeaningfulDuration(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') {
      return /[1-9]/.test(value);
    }
    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some((v) => {
        const n = typeof v === 'string' ? Number(v) : v;
        return typeof n === 'number' && !Number.isNaN(n) && n > 0;
      });
    }
    return false;
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
        if (v === undefined || v === '') return false;
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
}
