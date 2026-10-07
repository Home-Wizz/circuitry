import {
  Clock,
  GitCompareArrows,
  GitFork,
  Hourglass,
  ListOrdered,
  Merge,
  Play,
  Radio,
  RefreshCcw,
  Repeat,
  Rocket,
  RotateCw,
  Signpost,
  Split,
  Variable,
} from 'lucide-react';
import type { CompoundBlockKey } from '@/lib/block-factories';
import type { NodeColorToken } from '@/lib/node-colors';

/**
 * The canonical catalog of simple node types and compound blocks — type,
 * label, icon, color, default data. Lives in its own module (rather than
 * inside NodePalette.tsx, which renders it) so ConditionNode.tsx/
 * ActionNode.tsx can also import just the icon lookup without pulling in
 * the whole sidebar component. NodePalette.tsx re-exports these for the
 * handful of other call sites that already import from it.
 */
export interface NodeTypeConfig {
  type: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Its colour (NODE_COLORS), as its card has it: the side panel tints the row's round icon with it. */
  tone: NodeColorToken;
  defaultData: Record<string, unknown>;
}

export const nodeTypes = [
  {
    type: 'start',
    labelKey: 'nodes:types.start',
    icon: Rocket,
    tone: 'start',
    defaultData: {
      fields: {},
    },
  },
  {
    type: 'trigger',
    labelKey: 'nodes:types.trigger',
    // Radio, not Zap — per direct user feedback the lightning bolt read as
    // dated; a signal/broadcast glyph reads as "listening for an event"
    // just as clearly with a cleaner, more modern line style.
    icon: Radio,
    tone: 'trigger',
    // Left empty on purpose: TriggerFields shows the "By target / By type" picker
    // (mirroring HA's own Add Trigger dialog) whenever `trigger` is unset, and
    // fills it in once the user picks something there.
    defaultData: {
      trigger: '',
      entity_id: '',
    },
  },
  {
    type: 'condition',
    labelKey: 'nodes:types.condition',
    // Signpost, not GitBranch — a fork-in-the-road glyph reads as "decision
    // point" on its own, without the source-control connotation GitBranch
    // carries, and stays clearly distinct from 'join' below now that it no
    // longer shares GitBranch/GitMerge's near-identical look at this size
    // (per direct user feedback on the Add Node panel).
    icon: Signpost,
    tone: 'condition',
    defaultData: {
      condition: 'state',
      entity_id: '',
    },
  },
  {
    type: 'action',
    labelKey: 'nodes:types.action',
    icon: Play,
    tone: 'action',
    defaultData: {
      service: 'light.turn_on',
    },
  },
  {
    type: 'delay',
    labelKey: 'nodes:types.delay',
    icon: Clock,
    tone: 'delay',
    defaultData: {
      delay: '00:00:05',
    },
  },
  {
    type: 'wait',
    labelKey: 'nodes:types.wait',
    icon: Hourglass,
    tone: 'wait',
    // No template yet (not ""): an unfilled wait stays an error.
    defaultData: {
      timeout: '00:01:00',
    },
  },
  {
    type: 'set_variables',
    labelKey: 'nodes:blocks.set_variables.label',
    icon: Variable,
    tone: 'variables',
    defaultData: {
      variables: {},
    },
  },
  {
    type: 'join',
    labelKey: 'nodes:types.join', // "Join": waits for every incoming parallel branch (all paths) before continuing
    // Merge, not GitMerge — a plain lane-merge glyph reads as "multiple
    // paths converge into one" without git's commit-dot styling, and no
    // longer looks near-identical to 'condition' above at this size.
    icon: Merge,
    tone: 'join',
    defaultData: {
      mode: 'all',
    },
  },
] as const satisfies readonly NodeTypeConfig[];

export interface CompoundTypeConfig {
  key: CompoundBlockKey;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Its colour (NODE_COLORS) — see NodeTypeConfig.tone. */
  tone: NodeColorToken;
}

// Icon choices below deliberately mirror Home Assistant's own automation
// editor (home-assistant/frontend's src/data/action.ts ACTION_ICONS map),
// swapped for the closest lucide-react equivalent since this app draws from
// lucide throughout rather than pulling in @mdi/js as a second icon set —
// per explicit user request to match HA's icon per block type. HA uses the
// exact same mdi:refresh glyph for all three repeat variants (count/while/
// until) and relies on adjacent label text to tell them apart; this app's
// compound blocks are identified by icon alone in places (the canvas card,
// the palette), so each repeat variant keeps its own distinct loop-family
// icon instead of collapsing to one.
export const compoundTypes = [
  {
    key: 'choose' as CompoundBlockKey,
    labelKey: 'nodes:blocks.choose.label',
    icon: Split, // HA: mdiArrowDecision
    tone: 'condition',
  },
  {
    key: 'if_else' as CompoundBlockKey,
    labelKey: 'nodes:blocks.if_else.label',
    icon: GitFork, // HA: mdiCallSplit
    tone: 'condition',
  },
  {
    key: 'repeat_while' as CompoundBlockKey,
    labelKey: 'nodes:blocks.repeat_while.label',
    icon: Repeat, // HA: mdiRefresh
    tone: 'condition',
  },
  {
    key: 'repeat_until' as CompoundBlockKey,
    labelKey: 'nodes:blocks.repeat_until.label',
    icon: RefreshCcw, // HA: mdiRefresh
    tone: 'condition',
  },
  {
    key: 'repeat_count' as CompoundBlockKey,
    labelKey: 'nodes:blocks.repeat_count.label',
    icon: RotateCw, // HA: mdiRefresh
    tone: 'delay',
  },
  {
    key: 'parallel' as CompoundBlockKey,
    labelKey: 'nodes:blocks.parallel.label',
    icon: GitCompareArrows, // HA: mdiShuffleDisabled
    tone: 'action',
  },
  {
    key: 'sequence' as CompoundBlockKey,
    labelKey: 'nodes:blocks.sequence.label',
    icon: ListOrdered, // HA: mdiFormatListNumbered
    tone: 'join',
  },
] as const satisfies readonly CompoundTypeConfig[];

/**
 * Resolve a node's `type` (a plain runtime string — @xyflow/react's own
 * `Node.type` field isn't narrowed to Circuitry's specific literal types) to its
 * i18next label key. Centralizing this lookup — rather than each call site
 * building `nodes:types.${type}` inline — keeps the mapping in one place and
 * sidesteps a type problem that inline approach had: `type` being a wide
 * `string` makes `` `nodes:types.${type}` `` a template-literal type
 * (`` `nodes:types.${string}` ``) that i18next's strict per-key typing
 * rejects outright (previously "fixed" with a blanket `@ts-expect-error`,
 * forbidden by this project's rules). Routing through nodeTypes' own
 * entries — and the two structural types it deliberately excludes from the
 * Add Node palette below — keeps every returned key a real literal (via
 * `as const satisfies`, never widened to plain `string`), which is what
 * lets `t()` accept the result without a suppression.
 *
 * `NodeSchema`'s full literal union (packages/shared/src/schemas/nodes.ts)
 * is trigger/condition/action/delay/wait/set_variables/start/join/
 * sequence_start/sequence_end — the last two are Sequence's internal
 * start/end markers, never offered as a palette pick, so they're handled
 * here rather than added to nodeTypes.
 */
export function getNodeTypeLabelKey(type: string) {
  const fromCatalog = nodeTypes.find((n) => n.type === type)?.labelKey;
  if (fromCatalog) return fromCatalog;
  switch (type) {
    case 'sequence_start':
      return 'nodes:types.sequence_start';
    case 'sequence_end':
      return 'nodes:types.sequence_end';
    default:
      return 'nodes:types.node';
  }
}

/** A step's kind colour (its `tone`), for the overview map and the wires
 * leaving it; a type with none (or none known) is muted. */
export function stepTone(type: string | undefined): string {
  return nodeTypes.find((n) => n.type === type)?.tone ?? 'muted-foreground';
}
