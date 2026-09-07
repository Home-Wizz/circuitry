import { Handle, type NodeProps, Position, useEdges } from '@xyflow/react';
import { AlertCircle, Ban } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DOMAIN_GROUP_LABELS } from '@/components/panels/node-fields/TriggerTypePicker';
import { BlockRoleBadge } from '@/components/nodes/BlockRoleBadge';
import { DottedThresholdInlineEditor } from '@/components/nodes/DottedThresholdInlineEditor';
import { NumericStateInlineEditor } from '@/components/nodes/NumericStateInlineEditor';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { compoundTypes, nodeTypes } from '@/config/nodeTypeCatalog';
import { getDomainIcon } from '@/lib/domain-icons';
import { useMoreInfo } from '@/hooks/useMoreInfo';
import { type EntityTargetDisplay, useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getConditionRoleLabel } from '@/lib/block-role-label';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import {
  getConditionThresholdShape,
  getThresholdRange,
  getThresholdUnit,
  type TypedThreshold,
} from '@/lib/nativeThreshold';
import { BINARY_SENSOR_CLASSES } from '@/lib/triggerRecipes';
import { cn, prettify, singleEntityIdFrom } from '@/lib/utils';
import type { ConditionNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

const COLORS = NODE_COLORS.condition;

interface ConditionNodeProps extends NodeProps {
  data: ConditionNodeData;
}

const MAX_VISIBLE = 3;

/**
 * The entity a nested and/or/not sub-condition is "about", if any — mirrors
 * the top-level card's own singleStateEntityId/singleDottedEntityId
 * resolution: state/numeric_state/zone read `entity_id` directly, purpose-
 * specific dotted conditions (e.g. `door.is_open`) read `target.entity_id`.
 */
function getConditionPrimaryEntityId(cond: ConditionNodeData): string | undefined {
  if (
    cond.condition === 'state' ||
    cond.condition === 'numeric_state' ||
    cond.condition === 'zone'
  ) {
    return Array.isArray(cond.entity_id) ? cond.entity_id[0] : cond.entity_id;
  }
  if (cond.condition.includes('.')) {
    return Array.isArray(cond.target?.entity_id) ? cond.target.entity_id[0] : cond.target?.entity_id;
  }
  return undefined;
}

/**
 * Title for a nested and/or/not sub-condition's mini-card — alias first
 * (ConditionGroupEditor.tsx lets a nested condition carry one), then the
 * same resolved device/area name the top-level card and the If/Then/Else
 * action cards already show ("Door - Knoll Crest"), falling back to the raw
 * condition-type label only when there's no entity to resolve at all (e.g.
 * template/time/sun/trigger). Previously this mini-card always showed the
 * raw condition-type string as its title (e.g. the literal "door.is_open"
 * for a dotted purpose-specific condition) and the entity's raw technical
 * slug in the line below, instead of a human-readable name anywhere —
 * reported directly via screenshot, compared against the If/Then/Else
 * reference which already resolves names this way.
 */
function getNestedConditionTitle(
  cond: ConditionNodeData,
  resolveEntityTarget: (entityId: string | undefined) => EntityTargetDisplay | null,
  labelOf: (type: string) => string
): string {
  if (typeof cond.alias === 'string' && cond.alias) return cond.alias;
  const entityId = getConditionPrimaryEntityId(cond);
  const resolved = entityId ? resolveEntityTarget(entityId) : null;
  if (resolved?.label) return resolved.label;
  // Purpose-specific dotted conditions with no single entity to resolve at
  // all (singletons like `sun.is_night`/`sun.is_up`, which have no target)
  // still shouldn't fall through to the raw "sun.is_night" condition-type
  // string as their title — mirrors the top-level card's own dottedDomain
  // fallback (ConditionNode's header: primaryTarget?.label ||
  // DOMAIN_GROUP_LABELS[dottedDomain] || ...). `labelOf` only recognizes
  // legacy flat condition types (state/numeric_state/...), so without this
  // it prints the dotted string verbatim — reported directly via screenshot
  // ("sun.is_night" / "sun.is_set" instead of "Sun" as the mini-card title
  // inside an AND/OR group).
  if (cond.condition.includes('.')) {
    const domain = cond.condition.split('.')[0];
    return DOMAIN_GROUP_LABELS[domain] ?? prettify(domain);
  }
  return labelOf(cond.condition);
}

function getConditionSummary(cond: ConditionNodeData, labelOf: (type: string) => string): string {
  switch (cond.condition) {
    case 'state':
      return cond.state
        ? Array.isArray(cond.state)
          ? cond.state.join(', ')
          : String(cond.state)
        : labelOf('state');
    case 'numeric_state': {
      const parts = [
        cond.above !== undefined ? `> ${cond.above}` : null,
        cond.below !== undefined ? `< ${cond.below}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return parts || labelOf('numeric_state');
    }
    case 'zone':
      return cond.zone ?? labelOf('zone');
    case 'template':
      return cond.template
        ? cond.template.slice(0, 28) + (cond.template.length > 28 ? '…' : '')
        : labelOf('template');
    case 'time':
      return cond.after
        ? `after ${cond.after}`
        : cond.before
          ? `before ${cond.before}`
          : labelOf('time');
    case 'sun':
      return labelOf('sun');
    case 'device':
      return cond.type ?? labelOf('device');
    case 'trigger':
      return labelOf('trigger');
    case 'or':
    case 'and':
    case 'not': {
      const subs = cond.conditions ?? [];
      if (subs.length === 0) return labelOf(cond.condition);
      const labels = subs.map((c) => {
        const e = Array.isArray(c.entity_id) ? c.entity_id[0] : c.entity_id;
        if (e) return e.split('.').pop() ?? e;
        return c.condition;
      });
      return labels.join(' · ');
    }
    default: {
      // Purpose-specific dotted condition (e.g. `climate.is_cooling`) inside
      // an AND/OR/NOT group — the entity/device name is now the mini-card's
      // title (getNestedConditionTitle), so this only needs the phrase.
      if (cond.condition.includes('.')) {
        const [, ...rest] = cond.condition.split('.');
        const suffix = rest.join('.');
        return prettify(suffix.startsWith('is_') ? suffix.slice(3) : suffix);
      }
      return cond.condition;
    }
  }
}

export const ConditionNode = memo(function ConditionNode({
  id,
  data,
  selected,
}: ConditionNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const requestNodeEdit = useFlowStore((s) => s.requestNodeEdit);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const openMoreInfo = useMoreInfo();
  const { resolveEntityTarget } = useNodeCardDisplay();
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;
  const edges = useEdges();
  const isIfElseBlock = data._blockKey === 'if_else';
  const hasFalseEdge =
    edges.some((e) => e.source === id && e.sourceHandle === 'false') ||
    data._blockKey === 'repeat_while' ||
    isIfElseBlock;
  const [expanded, setExpanded] = useState(false);

  // AND/OR/NOT are added from the Blocks list with `conditions: []` and no
  // `_blockKey` at all (lib/conditionRecipes.ts's CONDITION_BLOCKS) — unlike
  // the compound-block placeholders below, they're a single node holding a
  // nested list rather than several linked nodes, so "configured" means
  // "has at least one sub-condition" instead of `_placeholder`.
  const isGroupCondition =
    data.condition === 'and' || data.condition === 'or' || data.condition === 'not';
  const hasNoNestedConditions = !Array.isArray(data.conditions) || data.conditions.length === 0;

  // Repeat While/Until, If/Else, and Choose are all added to the canvas
  // immediately with blank placeholder condition(s)
  // ({condition:'state', entity_id:''}) rather than pre-seeded via the
  // miller — per user request. Clicking a card opens the AND miller to
  // configure (or reconfigure) that specific node in place instead, via
  // flow-store.ts's nodeEditRequest — see useAddNodeDialogs.tsx's
  // openAndForNode doc comment for the full flow. Choose's two (or more)
  // case cards each carry their own `_blockKey: 'choose'`, so each is
  // independently clickable — see block-factories.ts's createChooseBlock.
  // AND/OR/NOT groups reuse the exact same AND miller (its whole purpose is
  // picking multiple conditions to combine), so they're always clickable
  // too — both to fill in an empty group and to add/edit conditions in an
  // already-populated one.
  const opensConditionMiller =
    data._blockKey === 'repeat_while' ||
    data._blockKey === 'repeat_until' ||
    data._blockKey === 'if_else' ||
    data._blockKey === 'choose' ||
    isGroupCondition;
  // block-factories.ts's condNode marks every blank entry condition with
  // `_placeholder: true`, cleared once the user actually configures it (see
  // useAddNodeDialogs.tsx). Deliberately not inferred from `!data.entity_id`
  // — that only detects entity-based condition types (state/numeric_state/
  // zone) and would keep showing "click to configure" forever for a
  // genuinely-configured template/time/sun/device condition, which don't
  // use entity_id at all. AND/OR/NOT groups use their own "no sub-conditions
  // yet" signal instead, since they never carry `_placeholder`.
  const isUnconfigured =
    (opensConditionMiller && data._placeholder === true) ||
    (isGroupCondition && hasNoNestedConditions);

  const conditionTypeLabels: Record<string, string> = {
    state: t('nodes:conditions.types.state'),
    numeric_state: t('nodes:conditions.types.numeric_state'),
    time: t('nodes:conditions.types.time'),
    sun: t('nodes:conditions.types.sun'),
    zone: t('nodes:conditions.types.zone'),
    template: t('nodes:conditions.types.template'),
    device: t('nodes:conditions.types.device'),
    trigger: t('nodes:conditions.types.trigger'),
    and: t('nodes:conditions.types.and'),
    or: t('nodes:conditions.types.or'),
    not: t('nodes:conditions.types.not'),
  };
  const getConditionLabel = (type: string) => conditionTypeLabels[type] ?? type;

  const nodeData = data as ConditionNodeData & { _chooseCase?: number; _chooseCaseTotal?: number };
  const chooseCase = nodeData._chooseCase;
  const chooseCaseTotal = nodeData._chooseCaseTotal;
  const roleLabel = getConditionRoleLabel(
    data._blockKey as string | undefined,
    chooseCase,
    chooseCaseTotal,
    t,
    data.condition
  );
  // Single source of truth for which icon represents which compound block —
  // config/nodeTypeCatalog.ts's compoundTypes (also drives the sidebar
  // palette and the Blocks catalog), rather than a second hardcoded
  // per-blockKey ternary living here too. Falls back to the same icon used
  // for the simple 'condition' node type (nodeTypes, same catalog) for
  // anything that isn't a recognized compound block (a plain condition, or
  // an and/or/not group) — kept as a lookup rather than a second hardcoded
  // icon reference so both stay in sync automatically.
  const BlockIcon =
    compoundTypes.find((c) => c.key === data._blockKey)?.icon ??
    nodeTypes.find((n) => n.type === 'condition')?.icon ??
    Ban;

  // Device-name-plus-plain-language-phrase card resolution for the common single-entity 'state' case
  // ("Hallway Light" / "On") — same resolveEntityTarget + phrase pattern as
  // TriggerNode.tsx/ActionNode.tsx, instead of the generic "State" type
  // label and raw entity_id. Every other legacy condition type
  // (numeric_state, template, time, sun, device, trigger, and/or/not
  // groups) keeps its existing technical summary — there's no single
  // natural-language phrase for a threshold, template, or time-window
  // condition the way there is for "the light is on".
  const singleStateEntityId =
    data.condition === 'state' ? singleEntityIdFrom(data.entity_id) : undefined;
  // Device-class-aware on/off phrasing — a contact sensor condition should
  // read "Open"/"Closed", not the generic "On"/"Off" (matches
  // useTriggerCardDisplay.ts's identical fix for the equivalent trigger
  // card). Falls back to the generic isOn/isOff phrase when there's no
  // device_class match.
  const stateTarget = singleStateEntityId ? resolveEntityTarget(singleStateEntityId) : null;
  const stateBinaryClass = stateTarget?.deviceClass ? BINARY_SENSOR_CLASSES[stateTarget.deviceClass] : undefined;
  const statePhrase = Array.isArray(data.state)
    ? undefined
    : data.state === 'on'
      ? (stateBinaryClass?.onLabel ?? t('nodes:conditions.cardPhrases.isOn'))
      : data.state === 'off'
        ? (stateBinaryClass?.offLabel ?? t('nodes:conditions.cardPhrases.isOff'))
        : data.state;

  // Purpose-specific conditions (HA 2025.12+ era, dotted `domain.is_*` —
  // e.g. `climate.is_cooling`) — same shape as TriggerNode.tsx's identical
  // `triggerType.includes('.')` branch, handled before this file had any of
  // this dotted format at all: conditionTypeLabels only ever had keys for
  // the legacy types below, so `getConditionLabel` fell through to its
  // `?? type` fallback and printed the raw "climate.is_cooling" string
  // verbatim — as both the title *and* the summary line, since both used to
  // call the same getConditionLabel(data.condition). That's the "second/
  // blue node's name isn't displayed correctly" bug: the first node in a
  // Repeat/If/Choose entry condition is very often a legacy 'state'
  // condition (handled above already), while later conditions added via the
  // AND-dialog's recipe catalog (lib/conditionRecipes.ts) are *always* this
  // dotted form — see that file's doc comment.
  const isDottedCondition = data.condition.includes('.');
  const dottedDomain = isDottedCondition ? data.condition.split('.')[0] : undefined;
  const dottedTypeSuffix =
    isDottedCondition && dottedDomain ? data.condition.slice(dottedDomain.length + 1) : undefined;
  // Most of these are boolean-style ("is_on", "is_closed", "is_cooling") —
  // stripping the "is_" prefix reads more naturally as a phrase under the
  // device name ("Thermostat" / "Cooling") than "Is cooling" would. A few
  // (all_completed, not_playing, is_hvac_mode) don't have that prefix or
  // need a value from `data.options` this card doesn't show — prettify
  // alone is still far better than the raw dotted string for those.
  const dottedPhrase = dottedTypeSuffix
    ? prettify(dottedTypeSuffix.startsWith('is_') ? dottedTypeSuffix.slice(3) : dottedTypeSuffix)
    : undefined;
  const singleDottedEntityId = isDottedCondition
    ? singleEntityIdFrom(data.target?.entity_id)
    : undefined;

  const primaryEntityId = singleStateEntityId ?? singleDottedEntityId;
  const primaryTarget = primaryEntityId ? resolveEntityTarget(primaryEntityId) : null;
  const primaryPhrase = singleStateEntityId ? statePhrase : dottedPhrase;
  const dottedTargetCount = isDottedCondition
    ? (Array.isArray(data.target?.entity_id) ? data.target.entity_id.length : data.target?.entity_id ? 1 : 0)
    : 0;

  // Device/domain icon (light bulb, fan, ...) for a plain single-entity
  // condition — matching TriggerNode.tsx/ActionNode.tsx, which already
  // resolve this via getDomainIcon (reported directly: "action correctly
  // displays the bulb icon and trigger node also correctly displays the
  // trigger icon" but condition doesn't). Left as the structural BlockIcon
  // (and/or/not group glyph, or the compound block's own icon — Choose,
  // If/Else, Repeat, ...) for anything that isn't one plain condition
  // representing one entity, since those icons carry real meaning of their
  // own that a device icon would replace rather than improve.
  const isPlainCondition = !data._blockKey && !isGroupCondition;
  // Option A (2026-09-07): a bare condition's `false` handle used to only
  // render once something was already wired to it -- a chicken-and-egg gap,
  // since there was no way to *start* that wire. Plain conditions now always
  // show it, so a chain (condition -> condition -> ...) can be dragged out
  // the same way Flow's UI exposes today. Scope is deliberately narrow: only
  // `isPlainCondition` nodes are affected. Choose/If-Else/Repeat-While/
  // AND-OR-NOT already decide their own handle visibility via `hasFalseEdge`
  // above (Choose's case-cards get their false edge wired programmatically by
  // block-factories.ts's createChooseBlock, so they satisfy hasFalseEdge's
  // first clause on their own) and are completely untouched by this change.
  const showFalseHandle = hasFalseEdge || isPlainCondition;
  const HeaderIcon =
    isPlainCondition && primaryTarget?.domain ? getDomainIcon(primaryTarget.domain, BlockIcon) : BlockIcon;

  // Inline threshold editing directly on the canvas card for HA's
  // purpose-specific (dotted) conditions — e.g. "Illuminance is value" or
  // "Battery level" — mirroring the numeric_state Above/Below editor below
  // and TriggerNode.tsx's identical treatment for dotted triggers. Only
  // offered for a plain (non-group) dotted condition; and/or/not groups have
  // no threshold of their own. FLAT-SIMPLE (currently only
  // `humidifier.is_target_humidity`) is deliberately excluded here — it's
  // rare enough, and its two-bound {above, below} shape different enough
  // from DottedThresholdInlineEditor's flat/typed editors, that it's left as
  // panel/miller-dialog-only (SimpleThresholdField) rather than building a
  // third inline-editor variant for one type.
  const conditionThresholdShape =
    isPlainCondition && isDottedCondition ? getConditionThresholdShape(data.condition) : 'none';
  const conditionOptions = (data.options as Record<string, unknown> | undefined) ?? {};
  const setConditionThreshold = (next: number | TypedThreshold) =>
    updateNodeData(id, { options: { ...conditionOptions, threshold: next } });

  const isGroup = isGroupCondition;
  const nestedConditions = isGroup && Array.isArray(data.conditions) ? data.conditions : [];
  const hasNested = nestedConditions.length > 0;
  const separator = getConditionLabel(data.condition);

  const visibleCount = expanded
    ? nestedConditions.length
    : Math.min(nestedConditions.length, MAX_VISIBLE);
  const hiddenCount = nestedConditions.length - visibleCount;

  return (
    <div
      // Single click only selects (React Flow's own click handling already
      // toggles `selected`, which drives the selection outline below) —
      // double click opens the miller. Previously a single click immediately
      // opened the miller dialog, so there was no way to just select a
      // node (to see its selection border, delete it, etc.) without also
      // having the edit dialog pop up and steal focus (reported directly).
      // stopPropagation is required: xyflow's own canvas-level
      // onNodeDoubleClick (wired in FlowCanvas.tsx to toggle the right-side
      // properties panel open/closed) fires on any double click inside a
      // node unless something stops it bubbling up — without this, double-
      // clicking a condition card opened the miller AND the properties
      // panel simultaneously (reported directly).
      onDoubleClick={
        opensConditionMiller
          ? (event) => {
              event.stopPropagation();
              requestNodeEdit('condition', id);
            }
          : undefined
      }
      // See node-colors.ts's SELECTED_NODE_STYLE doc comment — an inline
      // style, not a Tailwind ring-* class, is what actually renders a
      // selection indicator reliably.
      style={selected ? SELECTED_NODE_STYLE : undefined}
      className={cn(
        'group relative rounded-lg border-2 px-4 py-3',
        COLORS.border,
        COLORS.bg,
        hasNested ? 'min-w-[220px]' : 'min-w-[180px]',
        'transition-all duration-200',
        isActive && NODE_STATE_CLASSES.active,
        isDisabled && 'border-dashed opacity-50 grayscale',
        hasErrors && NODE_STATE_CLASSES.error,
        opensConditionMiller && 'cursor-pointer',
        isUnconfigured && !isDisabled && 'border-dashed',
        getTraceStateClass(traceState)
      )}
    >
      {roleLabel && <BlockRoleBadge label={roleLabel} />}
      {hasErrors && (
        <div
          className={cn(
            'absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full shadow-sm',
            NODE_STATE_CLASSES.errorBadge
          )}
          title={errorMessages.join('\n')}
        >
          <AlertCircle className="h-3 w-3" />
        </div>
      )}
      {isDisabled && !hasErrors && (
        <div
          className={cn(
            'absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full shadow-sm',
            NODE_STATE_CLASSES.disabledBadge
          )}
        >
          <Ban className="h-3 w-3" />
        </div>
      )}

      <Handle type="target" position={Position.Left} className={cn('w-3! h-3!', COLORS.handle)} />

      <div className="mb-1 flex items-center gap-2">
        <div className={cn('rounded p-1', COLORS.chip)}>
          <HeaderIcon className={cn('h-4 w-4', COLORS.text)} />
        </div>
        <span className={cn('font-semibold text-sm', COLORS.text)}>
          {data.alias ||
            (isUnconfigured
              ? isIfElseBlock
                ? t('nodes:conditions.clickToConfigureIf')
                : isGroupCondition
                  ? data.condition === 'and'
                    ? t('nodes:conditions.clickToConfigureAnd')
                    : data.condition === 'or'
                      ? t('nodes:conditions.clickToConfigureOr')
                      : t('nodes:conditions.clickToConfigureNot')
                  : t('nodes:conditions.clickToConfigure')
              : primaryTarget?.label ||
                (dottedDomain && (DOMAIN_GROUP_LABELS[dottedDomain] ?? prettify(dottedDomain))) ||
                getConditionLabel(data.condition))}
        </span>
        {stepNumber && (
          <div
            className={cn(
              'ml-auto flex h-5 w-5 items-center justify-center rounded-full font-bold text-xs',
              COLORS.badge
            )}
          >
            {stepNumber}
          </div>
        )}
      </div>

      {!hasNested && !isUnconfigured && (
        <div className={cn('space-y-0.5 text-xs', COLORS.text)}>
          {primaryEntityId ? (
            // Single line: device/area name is already the
            // title above, so this line is just the phrase itself
            // ("On"/"Off"/"Cooling"/raw state) — reads as "Hallway Light" /
            // "On" rather than the generic "State" + raw entity_id + "= on"
            // (or, for a dotted condition, the raw "climate.is_cooling"
            // repeated as both title and this line).
            <TruncatedTooltip content={primaryPhrase || getConditionLabel(data.condition)}>
              <button
                type="button"
                className="nodrag truncate text-left font-medium hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  openMoreInfo(primaryEntityId);
                }}
              >
                {primaryPhrase || getConditionLabel(data.condition)}
              </button>
            </TruncatedTooltip>
          ) : isDottedCondition ? (
            // Dotted condition with no single entity to resolve (targets an
            // area/device/label, or several entities at once) — the phrase
            // derived from the condition's own type suffix is still far
            // better than the raw "domain.is_*" string, just not clickable
            // since there's no one entity for HA's more-info dialog.
            <>
              <div className="font-medium">{dottedPhrase || getConditionLabel(data.condition)}</div>
              {dottedTargetCount > 1 && (
                <div className="truncate opacity-75">
                  {t('nodes:conditions.entitiesSelected', { count: dottedTargetCount })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="font-medium">{getConditionLabel(data.condition)}</div>
              {data.entity_id &&
                (Array.isArray(data.entity_id) ? (
                  <TruncatedTooltip content={data.entity_id.join(', ')}>
                    <div className="truncate opacity-75">{data.entity_id.join(', ')}</div>
                  </TruncatedTooltip>
                ) : (
                  <TruncatedTooltip content={data.entity_id}>
                    <button
                      type="button"
                      className="nodrag truncate text-left opacity-75 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        openMoreInfo(data.entity_id as string);
                      }}
                    >
                      {data.entity_id}
                    </button>
                  </TruncatedTooltip>
                ))}
              {data.state && (
                <div className="opacity-75">
                  {'= '}
                  {data.state}
                </div>
              )}
            </>
          )}
          {data.condition === 'numeric_state' && (
            <NumericStateInlineEditor
              above={typeof data.above === 'number' ? data.above : undefined}
              below={typeof data.below === 'number' ? data.below : undefined}
              onChange={(patch) => updateNodeData(id, patch)}
            />
          )}
          {(conditionThresholdShape === 'flat' || conditionThresholdShape === 'typed') && (
            <DottedThresholdInlineEditor
              shape={conditionThresholdShape}
              threshold={
                conditionOptions.threshold as number | string | TypedThreshold | undefined
              }
              unit={getThresholdUnit(data.condition)}
              min={getThresholdRange(data.condition)?.min}
              max={getThresholdRange(data.condition)?.max}
              onChange={setConditionThreshold}
            />
          )}
          {data.after && (
            <div className="opacity-75">
              {'after: '}
              {typeof data.after === 'string' ? data.after : String(data.after)}
            </div>
          )}
          {data.before && (
            <div className="opacity-75">
              {'before: '}
              {typeof data.before === 'string' ? data.before : String(data.before)}
            </div>
          )}
          {data.zone && (
            <div className="opacity-75">
              {'zone: '}
              {data.zone}
            </div>
          )}
          {data.attribute && (
            <div className="opacity-75">
              {'attr: '}
              {data.attribute}
            </div>
          )}
          {data.for && (
            <div className="opacity-75">
              {'for: '}
              {typeof data.for === 'string'
                ? data.for
                : `${data.for.hours || 0}h ${data.for.minutes || 0}m ${data.for.seconds || 0}s`}
            </div>
          )}
          {data.template && (
            <TruncatedTooltip content={data.template}>
              <div className="truncate font-mono text-[10px] opacity-75">
                {data.template.slice(0, 30)}
                {'...'}
              </div>
            </TruncatedTooltip>
          )}
          {data.value_template && (
            <TruncatedTooltip content={data.value_template}>
              <div className="truncate font-mono text-[10px] opacity-75">
                {data.value_template.slice(0, 30)}
                {'...'}
              </div>
            </TruncatedTooltip>
          )}
          {data.id !== undefined && data.id !== null && (
            <div className="opacity-75">
              {'id: '}
              {Array.isArray(data.id) ? (data.id as string[]).join(', ') : String(data.id)}
            </div>
          )}
          {/* isGroup's empty case ("0 Nested Conditions") is no longer reachable here —
              an empty and/or/not group is now `isUnconfigured` (see hasNoNestedConditions
              above) and shows the dashed-border "Click to configure and/or/not" placeholder
              instead, matching every other compound block's unconfigured state. */}
        </div>
      )}

      {hasNested && (
        <div className="mt-2 space-y-1">
          {nestedConditions.slice(0, visibleCount).map((cond, idx) => (
            <div key={idx}>
              {idx > 0 && (
                <div className="flex items-center gap-1 py-0.5">
                  <div className="h-px flex-1 bg-condition/20" />
                  <span className="rounded bg-condition-subtle px-1.5 font-bold text-[10px] text-condition">
                    {separator}
                  </span>
                  <div className="h-px flex-1 bg-condition/20" />
                </div>
              )}
              <div className="rounded border border-condition/30 bg-card px-2 py-1">
                <TruncatedTooltip content={getNestedConditionTitle(cond, resolveEntityTarget, getConditionLabel)}>
                  <div className="truncate font-semibold text-[11px] text-condition">
                    {getNestedConditionTitle(cond, resolveEntityTarget, getConditionLabel)}
                  </div>
                </TruncatedTooltip>
                <TruncatedTooltip content={getConditionSummary(cond, getConditionLabel)}>
                  <div className="truncate text-[10px] text-condition/70">
                    {getConditionSummary(cond, getConditionLabel)}
                  </div>
                </TruncatedTooltip>
              </div>
            </div>
          ))}
          {hiddenCount > 0 && !expanded && (
            <button
              type="button"
              className="nodrag w-full rounded border border-condition/30 bg-card px-2 py-0.5 text-center text-[10px] text-condition/70 hover:bg-condition/10"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              {`+${hiddenCount} `}
              {t('nodes:conditions.more')}
            </button>
          )}
          {expanded && nestedConditions.length > MAX_VISIBLE && (
            <button
              type="button"
              className="nodrag w-full rounded border border-condition/30 bg-card px-2 py-0.5 text-center text-[10px] text-condition/70 hover:bg-condition/10"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              {t('nodes:conditions.collapse')}
            </button>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: showFalseHandle ? '30%' : '50%' }}
        className="w-3! h-3! bg-success! border-success!"
      />
      {showFalseHandle && (
        <Handle
          type="source"
          position={Position.Right}
          id="false"
          style={{ top: '70%' }}
          className="w-3! h-3! bg-destructive! border-destructive!"
        />
      )}

      {/* If/Else deliberately shows no edge labels at all — unlike every
          other hasFalseEdge case (a plain condition someone manually wired a
          false edge onto, or Repeat While's loop-continues/loop-ends pair),
          where hover-only "Yes"/"No" is a useful lightweight hint. If/Else's
          two branch boxes now say "Click to configure then"/"...else"
          themselves (and, once configured, show what they actually do), so
          a redundant edge label would just be clutter. */}
      {showFalseHandle && !isIfElseBlock && (
        <div className="absolute top-[30%] right-[-40px] -translate-y-1/2 transform rounded border border-success/30 bg-card px-1 py-0.5 font-medium text-[10px] text-success opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          {t('nodes:conditions.yes')}
        </div>
      )}
      {showFalseHandle && !isIfElseBlock && (
        <div className="absolute top-[70%] right-[-36px] -translate-y-1/2 transform rounded border border-destructive/30 bg-card px-1 py-0.5 font-medium text-[10px] text-destructive opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          {t('nodes:conditions.no')}
        </div>
      )}
    </div>
  );
});
