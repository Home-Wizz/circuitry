import {
  Blocks,
  Hand,
  Hourglass,
  ListRestart,
  type LucideIcon,
  Megaphone,
  Variable,
} from 'lucide-react';
import { compoundTypes, nodeTypes } from '@/config/nodeTypeCatalog';
import type { CompoundBlockKey } from '@/lib/block-factories';

/**
 * ThenActionDialog.tsx's "Blocks" catalog — HA's own script editor "Building
 * blocks" (If-then/Choose, Repeat [count/while/until/for-each], Wait for
 * trigger/template, Parallel, Stop, Delay, Set variables, Test a condition,
 * Fire an event, Grouping actions), audited directly against
 * home-assistant.io/docs/scripts/ and HA core's config_validation.py to make
 * sure every building block has an entry here. ("Respond to a conversation"
 * is the one HA building block intentionally *not* represented — low-value/
 * niche, skipped for now.) Unlike lib/conditionRecipes.ts's CONDITION_BLOCKS
 * (always a single node's `data`), a block here commits one of two genuinely
 * different ways:
 *
 *  - `{ kind: 'node', ... }` — a single simple node (delay/wait/set_variables,
 *    the 'condition' type for "Test a condition", plus the 'action' node's
 *    own `stop`/event/opaque-repeat-for_each variants), added via
 *    `useAddNodeAtCenter`'s `addNodeAtCenter` — same mechanism
 *    WhenTriggerDialog/AndConditionDialog already use.
 *  - `{ kind: 'compound', ... }` — a multi-node subgraph (if/else, choose,
 *    the count/while/until repeat variants, parallel) that already exists as
 *    its own first-class concept in this codebase (`lib/block-factories.ts`'s
 *    `createCompoundBlock`, `config/nodeTypeCatalog.ts`'s `compoundTypes`,
 *    `useAddNodeAtCenter`'s `addCompoundAtCenter`) — reused directly rather
 *    than reimplemented, per CLAUDE.md's DRY mandate. This is *why*
 *    ThenActionDialog needs a second `onCommitCompound` prop alongside
 *    `onCommit`, unlike the other two dialogs: a compound block is a
 *    (nodes, edges) pair, not a single node's `data`.
 *
 *  Repeat for-each is deliberately a `node` block, not a `compound` one like
 *  its count/while/until siblings: those loop by a condition Circuitry can
 *  visualize as a graph back-edge (a real per-iteration decision point);
 *  for_each has no such natural per-iteration graph shape, so it round-trips
 *  as a single opaque node carrying the raw `repeat.for_each`/`repeat.sequence`
 *  data — the same shape YamlParser.ts's fallback "opaque repeat" branch
 *  already produces when importing a for_each block from existing YAML.
 */
/** The blocks, by key. Their names and descriptions are Home Assistant's
 * (`nodes:blocks.<key>`, from HA's own translations: "If-then", "Run in
 * parallel", "Define variables", ...), except Wait for…, Circuitry's one
 * row for HA's three waits (named as HA names them in its column). */
export type ActionBlockKey =
  | 'if_else'
  | 'choose'
  | 'repeat_count'
  | 'repeat_while'
  | 'repeat_until'
  | 'repeat_for_each'
  | 'parallel'
  | 'wait_for'
  | 'stop'
  | 'set_variables'
  | 'test_condition'
  | 'fire_event'
  | 'sequence';

export interface ActionBlock {
  key: ActionBlockKey;
  commit:
    | {
        kind: 'node';
        type: 'action' | 'set_variables' | 'condition';
        data: Record<string, unknown>;
      }
    | { kind: 'compound'; compoundKey: CompoundBlockKey }
    // Doesn't commit anything itself — pushes a further column in the
    // dialog instead. Currently only 'wait_for' uses this, to offer
    // template/trigger/delay as one dropdown-style choice rather than three
    // separate top-level cards (see ThenActionDialog.tsx's 'waitForOptions'
    // column and WaitForOptionsColumn).
    | { kind: 'drill' };
}

export const ACTION_BLOCKS: ActionBlock[] = [
  {
    key: 'if_else',
    commit: { kind: 'compound', compoundKey: 'if_else' },
  },
  {
    key: 'choose',
    commit: { kind: 'compound', compoundKey: 'choose' },
  },
  {
    key: 'repeat_count',
    commit: { kind: 'compound', compoundKey: 'repeat_count' },
  },
  {
    key: 'repeat_while',
    commit: { kind: 'compound', compoundKey: 'repeat_while' },
  },
  {
    key: 'repeat_until',
    commit: { kind: 'compound', compoundKey: 'repeat_until' },
  },
  {
    key: 'repeat_for_each',
    // Opaque single-node form (like the 'stop' block below), not a compound
    // block — for_each has no natural per-iteration graph shape the way
    // count/while/until's condition-driven loops do, so it round-trips as a
    // single node carrying the raw `repeat.for_each`/`repeat.sequence` data,
    // same mechanism YamlParser.ts's fallback "opaque repeat" branch already
    // uses when importing a for_each block from existing YAML.
    // service/event/stop/target/data explicitly cleared (not just omitted):
    // this commit can land on a node that already has data (a compound
    // block's branch placeholder, created by block-factories.ts with
    // `service: ''`, or a node being switched from another action type via
    // the Blocks picker) — useAddNodeDialogs.tsx's onCommit merges this
    // object onto the existing node.data with updateNodeData rather than
    // replacing it, so any field not mentioned here would otherwise survive
    // untouched. A stale leftover `service: ''` alongside a real `repeat`
    // slipped past validation.ts's real-time check (which returns early once
    // it sees `data.repeat`) but still tripped validator.ts's semantic
    // "invalid service format" check at save time — same class of bug fixed
    // for 'stop' and 'fire_event' below.
    commit: {
      kind: 'node',
      type: 'action',
      data: {
        repeat: { for_each: [], sequence: [] },
        service: undefined,
        target: undefined,
        data: undefined,
        event: undefined,
        event_data: undefined,
        stop: undefined,
        error: undefined,
      },
    },
  },
  {
    key: 'parallel',
    commit: { kind: 'compound', compoundKey: 'parallel' },
  },
  {
    key: 'wait_for',
    // Pushes a further column (template / trigger / time to pass) instead
    // of committing directly — consolidates what used to be three separate
    // top-level cards (Wait for trigger, Wait for template, Delay) into one.
    // See ThenActionDialog.tsx's 'waitForOptions' column.
    commit: { kind: 'drill' },
  },
  {
    key: 'stop',
    // Other action-shape fields explicitly cleared to undefined, not just
    // omitted — this commit can land on a node that already has data (e.g. an
    // If/Else branch placeholder from block-factories.ts, which defaults to
    // `service: ''`), and useAddNodeDialogs.tsx's onCommit merges this object
    // onto the existing node.data via updateNodeData rather than replacing
    // it. Without this, a stale `service: ''` survived alongside the new
    // `stop: ''` — validation.ts's real-time check didn't notice (it returns
    // early once it sees `data.stop`), but validator.ts's separate semantic
    // check at save time did, throwing a confusing "invalid service format"
    // for a service the user never touched. Mirrors ActionFields.tsx's own
    // `handleActionTypeChange('stop')`, which does the same clearing when the
    // action type is switched from the node's own inspector panel.
    commit: {
      kind: 'node',
      type: 'action',
      data: {
        stop: '',
        service: undefined,
        target: undefined,
        data: undefined,
        event: undefined,
        event_data: undefined,
      },
    },
  },
  {
    key: 'set_variables',
    commit: { kind: 'node', type: 'set_variables', data: { variables: {} } },
  },
  {
    key: 'test_condition',
    // A plain condition node with no "false" edge attached already transpiles
    // to an inline `condition:` guard step (see native.ts's buildCondition
    // usage for non-branching condition nodes) — no separate action-side
    // representation needed.
    // `state` starts unset, not "" (bug #65; see conditionRecipes.ts).
    commit: { kind: 'node', type: 'condition', data: { condition: 'state', entity_id: '' } },
  },
  {
    key: 'fire_event',
    // service/target/data/stop explicitly cleared — same stale-placeholder-
    // field bug as 'stop' and 'repeat_for_each' above (see their comments):
    // this commit can merge onto a node that already carries a placeholder
    // `service: ''`, which would otherwise survive untouched and trip
    // validator.ts's semantic "invalid service format" check at save time.
    commit: {
      kind: 'node',
      type: 'action',
      data: {
        // No event name yet (not ""): HA accepts `event: ""` and the
        // transpiler writes it, so an unnamed event would save with only a
        // warning (the trigger/action audit after bug #65). Unset, it stays
        // an error until named, as before.
        event: undefined,
        event_data: {},
        service: undefined,
        target: undefined,
        data: undefined,
        stop: undefined,
        error: undefined,
      },
    },
  },
  {
    key: 'sequence',
    commit: { kind: 'compound', compoundKey: 'sequence' },
  },
];

// Per-block icon for ThenActionDialog.tsx's BlocksColumn — was previously a
// single hardcoded `icon={Blocks}` for every row (all six Flow Control
// blocks rendering identically), reported directly by the user. Compound
// blocks (if_else/choose/repeat_*/parallel/sequence) reuse the icon already
// chosen for them in nodeTypeCatalog.ts's `compoundTypes` rather than a
// second, duplicate icon list, per CLAUDE.md's DRY mandate — that catalog is
// the canonical source since it's also what the sidebar palette and canvas
// cards render. The remaining node/drill-kind blocks have no compound-block
// entry to borrow from, so each gets its own icon chosen to match Home
// Assistant's own action.ts ACTION_ICONS map, swapped for the closest
// lucide-react equivalent (same approach compoundTypes' own doc comment
// documents): stop -> mdiHandBackRight, variables ->
// mdiApplicationVariableOutline, event -> mdiGestureDoubleTap. HA uses the
// same mdiRefresh glyph for repeat_for_each as it does for count/while/until,
// but — like compoundTypes already does for its three repeat variants —
// for_each keeps its own distinct icon rather than colliding with them.
const compoundIconByKey = new Map<CompoundBlockKey, LucideIcon>(
  compoundTypes.map((c) => [c.key, c.icon])
);

// test_condition deliberately isn't hardcoded here — it reuses nodeTypes'
// own 'condition' icon (looked up below) so it can't drift from the plain
// condition node's icon elsewhere in the app, the same reasoning
// compoundIconByKey above already follows for compound blocks.
const NODE_BLOCK_ICONS: Record<string, LucideIcon> = {
  repeat_for_each: ListRestart, // HA: mdiRefresh
  wait_for: Hourglass, // HA: mdiTimerOutline / mdiCodeBraces / mdiTrafficLight (drills into all three)
  stop: Hand, // HA: mdiHandBackRight
  set_variables: Variable, // HA: mdiApplicationVariableOutline
  fire_event: Megaphone, // HA: mdiGestureDoubleTap
};

const conditionIcon = nodeTypes.find((n) => n.type === 'condition')?.icon ?? Blocks;

export function getActionBlockIcon(block: ActionBlock): LucideIcon {
  if (block.commit.kind === 'compound') {
    return compoundIconByKey.get(block.commit.compoundKey) ?? Blocks;
  }
  if (block.key === 'test_condition') {
    return conditionIcon;
  }
  return NODE_BLOCK_ICONS[block.key] ?? Blocks;
}

// ThenActionDialog.tsx's "Generic"/"Integration" entries in the "By type"
// list used to be hardcoded here (GENERIC_ACTION_BLOCKS/
// INTEGRATION_ACTION_BLOCKS) — a hand-guessed handful of `homeassistant.*`/
// `persistent_notification.*`/`notify.*`/`tts.*`/... services. Verified
// against real HA's own home-assistant/frontend source
// (src/data/action.ts's `ACTION_COLLECTIONS`,
// add-automation-element-dialog.ts's `_classifyDomain`/`_services`) that
// this was wrong on both counts: Generic is *only* ever "Device" (a plain
// device_id picker, `groups: { device_id: {} }`), and Integration is every
// service-only domain the connected instance actually has installed —
// commonly 30-40 items (Activity, Automation, Backup, File, Home Assistant
// Cloud, ...), which cannot be hardcoded since it depends on which
// integrations a given user has configured. Both are now generated live in
// ThenActionDialog.tsx from `manifest/list` (useIntegrationManifests.ts) +
// `hass.services`, matching real HA's own algorithm instead of guessing.
