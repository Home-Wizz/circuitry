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
import { NODE_COLORS } from '@/lib/node-colors';

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
  /** Solid-color button class (NODE_COLORS.*.palette) — NodePalette.tsx renders each row as a solid-colored button in this color, per user request to drop the previous washed-out translucent look. The icon itself sits in a neutral chip overlay (see NodePalette.tsx), not a second token-colored badge, since that would blend into the now-solid button. */
  color: string;
  defaultData: Record<string, unknown>;
}

export const nodeTypes = [
  {
    type: 'start',
    labelKey: 'nodes:types.start',
    icon: Rocket,
    color: NODE_COLORS.start.palette,
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
    color: NODE_COLORS.trigger.palette,
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
    color: NODE_COLORS.condition.palette,
    defaultData: {
      condition: 'state',
      entity_id: '',
    },
  },
  {
    type: 'action',
    labelKey: 'nodes:types.action',
    icon: Play,
    color: NODE_COLORS.action.palette,
    defaultData: {
      service: 'light.turn_on',
    },
  },
  {
    type: 'delay',
    labelKey: 'nodes:types.delay',
    icon: Clock,
    color: NODE_COLORS.delay.palette,
    defaultData: {
      delay: '00:00:05',
    },
  },
  {
    type: 'wait',
    labelKey: 'nodes:types.wait',
    icon: Hourglass,
    color: NODE_COLORS.wait.palette,
    defaultData: {
      wait_template: '',
      timeout: '00:01:00',
    },
  },
  {
    type: 'set_variables',
    labelKey: 'nodes:types.set_variables',
    icon: Variable,
    color: NODE_COLORS.variables.palette,
    defaultData: {
      variables: {},
    },
  },
  {
    type: 'join',
    labelKey: 'nodes:types.join', // renders as "All" — waits for every incoming parallel branch before continuing
    // Merge, not GitMerge — a plain lane-merge glyph reads as "multiple
    // paths converge into one" without git's commit-dot styling, and no
    // longer looks near-identical to 'condition' above at this size.
    icon: Merge,
    color: NODE_COLORS.join.palette,
    defaultData: {
      mode: 'all',
    },
  },
] as const satisfies readonly NodeTypeConfig[];

export interface CompoundTypeConfig {
  key: CompoundBlockKey;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Solid-color button class (NODE_COLORS.*.palette) — see NodeTypeConfig.color's doc comment. */
  color: string;
  group: 'branching' | 'loops' | 'parallel' | 'grouping';
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
    labelKey: 'nodes:compoundBlocks.choose',
    icon: Split, // HA: mdiArrowDecision
    color: NODE_COLORS.condition.palette,
    group: 'branching',
  },
  {
    key: 'if_else' as CompoundBlockKey,
    labelKey: 'nodes:compoundBlocks.if_else',
    icon: GitFork, // HA: mdiCallSplit
    color: NODE_COLORS.condition.palette,
    group: 'branching',
  },
  {
    key: 'repeat_while' as CompoundBlockKey,
    labelKey: 'nodes:compoundBlocks.repeat_while',
    icon: Repeat, // HA: mdiRefresh
    color: NODE_COLORS.condition.palette,
    group: 'loops',
  },
  {
    key: 'repeat_until' as CompoundBlockKey,
    labelKey: 'nodes:compoundBlocks.repeat_until',
    icon: RefreshCcw, // HA: mdiRefresh
    color: NODE_COLORS.condition.palette,
    group: 'loops',
  },
  {
    key: 'repeat_count' as CompoundBlockKey,
    labelKey: 'nodes:compoundBlocks.repeat_count',
    icon: RotateCw, // HA: mdiRefresh
    color: NODE_COLORS.delay.palette,
    group: 'loops',
  },
  {
    key: 'parallel' as CompoundBlockKey,
    labelKey: 'nodes:compoundBlocks.parallel',
    icon: GitCompareArrows, // HA: mdiShuffleDisabled
    color: NODE_COLORS.action.palette,
    group: 'parallel',
  },
  {
    key: 'sequence' as CompoundBlockKey,
    labelKey: 'nodes:compoundBlocks.sequence',
    icon: ListOrdered, // HA: mdiFormatListNumbered
    color: NODE_COLORS.join.palette,
    group: 'grouping',
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

export const compoundGroupOrder = ['branching', 'loops', 'parallel', 'grouping'] as const;
