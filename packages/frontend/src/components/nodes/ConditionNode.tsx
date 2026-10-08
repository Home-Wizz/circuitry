import { Handle, type NodeProps, Position, useEdges } from '@xyflow/react';
import { Ban } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DOMAIN_GROUP_LABELS } from '@/components/panels/node-fields/TriggerTypePicker';
import { BlockRoleBadge } from '@/components/nodes/BlockRoleBadge';
import { AndChip, StopsHereBadge } from '@/components/nodes/ConventionMarkers';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { compoundTypes, nodeTypes } from '@/config/nodeTypeCatalog';
import { getDomainIcon, iconKeyFor } from '@/lib/domain-icons';
import { useConventionMarkers } from '@/hooks/useConventionMarkers';
import { useMoreInfo } from '@/hooks/useMoreInfo';
import { useEditableTargets, useWholeArea } from '@/hooks/useStepTargets';
import { type EntityTargetDisplay, useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useTriggerIdNames } from '@/hooks/useTriggerIdNames';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getConditionRoleLabel } from '@/lib/block-role-label';
import { stepIconKey } from '@/lib/emojiIcons';
import { getTraceStateClass, NODE_COLORS } from '@/lib/node-colors';
import { cn, prettify, singleEntityIdFrom } from '@/lib/utils';
import type { ConditionNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { NodeStatusBadge } from './NodeStatusBadge';
import { ForPill } from './ForPill';
import { TemplateLine } from './TemplateLine';
import { ConditionStatePill } from './StatePill';
import { ThresholdPill } from './ThresholdPill';
import {
  conditionPhraseAfterName,
  conditionStatePhrase,
  dottedConditionIsState,
  dottedConditionParts,
} from './cardWording';
import { phraseAfterName, StepCard } from './StepCard';
import { CardTargetLine, CardTitle, titleIsTarget } from './TargetPill';

/** Where a pill goes in a translated phrase ("is {{state}}"). */
const PILL_MARK = '\u0001';

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
    return Array.isArray(cond.target?.entity_id)
      ? cond.target.entity_id[0]
      : cond.target?.entity_id;
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

function getConditionSummary(
  cond: ConditionNodeData,
  labelOf: (type: string) => string,
  entityNames: (entityIds: readonly string[]) => string
): string {
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
      return cond.zone ? entityNames([cond.zone]) : labelOf('zone');
    case 'template':
      // In words, never the code (it can name entities by id).
      return labelOf('template');
    case 'time':
      return cond.after
        ? `after ${cond.after}`
        : cond.before
          ? `before ${cond.before}`
          : labelOf('time');
    case 'sun':
      return labelOf('sun');
    case 'device':
      return cond.type ? prettify(cond.type) : labelOf('device');
    case 'trigger':
      return labelOf('trigger');
    case 'or':
    case 'and':
    case 'not': {
      const subs = cond.conditions ?? [];
      if (subs.length === 0) return labelOf(cond.condition);
      const labels = subs.map((c) => {
        const e = getConditionPrimaryEntityId(c);
        return e ? entityNames([e]) : labelOf(c.condition);
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
      return labelOf(cond.condition);
    }
  }
}

/** A condition's Yes / No output, named beside its dot: a small pill in
 * green or red, solid so the wire behind it doesn't show through. */
function BranchTag({ yes, label }: { yes: boolean; label: string }) {
  return (
    <div
      data-testid={yes ? 'branch-yes' : 'branch-no'}
      className={cn(
        'absolute -translate-y-1/2 transform rounded-full px-2 font-semibold text-[10px] leading-4',
        yes
          ? 'top-[30%] right-[-42px] bg-[color-mix(in_srgb,hsl(var(--success))_18%,hsl(var(--card)))] text-success'
          : 'top-[70%] right-[-38px] bg-[color-mix(in_srgb,hsl(var(--destructive))_16%,hsl(var(--card)))] text-destructive'
      )}
    >
      {label}
    </div>
  );
}

export const ConditionNode = memo(function ConditionNode({
  id,
  data,
  selected,
}: ConditionNodeProps) {
  const { t, i18n } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const requestNodeEdit = useFlowStore((s) => s.requestNodeEdit);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const openMoreInfo = useMoreInfo();
  const editableTargets = useEditableTargets('condition', data);
  const { resolveEntityTarget, entityNames } = useNodeCardDisplay();
  const triggerIdNames = useTriggerIdNames();
  const traceState = useTraceNodeState(id);
  const markers = useConventionMarkers(id);
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
  // A type it has no label for is named from the type, never shown as is
  // ("door.is_open" -> "Open").
  const getConditionLabel = (type: string) =>
    conditionTypeLabels[type] ?? dottedConditionParts(type).phrase ?? prettify(type);

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
  const statePhrase = conditionStatePhrase(t, data.state, stateTarget?.deviceClass);

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
  const { domain: dottedDomain, phrase: dottedPhrase } = dottedConditionParts(data.condition);
  // Most of these are boolean-style ("is_on", "is_closed", "is_cooling") —
  // stripping the "is_" prefix reads more naturally as a phrase under the
  // device name ("Thermostat" / "Cooling") than "Is cooling" would. A few
  // (all_completed, not_playing, is_hvac_mode) don't have that prefix or
  // need a value from `data.options` this card doesn't show — prettify
  // alone is still far better than the raw dotted string for those.
  const singleDottedEntityId = isDottedCondition
    ? singleEntityIdFrom(data.target?.entity_id)
    : undefined;

  const primaryEntityId = singleStateEntityId ?? singleDottedEntityId;
  const primaryTarget = primaryEntityId ? resolveEntityTarget(primaryEntityId) : null;
  const primaryPhrase = singleStateEntityId ? statePhrase : dottedPhrase;
  const dottedTargetCount = isDottedCondition
    ? Array.isArray(data.target?.entity_id)
      ? data.target.entity_id.length
      : data.target?.entity_id
        ? 1
        : 0
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
    isPlainCondition && primaryTarget?.domain
      ? getDomainIcon(
          iconKeyFor(primaryTarget.deviceClass, dottedDomain, primaryTarget.domain),
          BlockIcon
        )
      : BlockIcon;

  const isGroup = isGroupCondition;
  const nestedConditions = isGroup && Array.isArray(data.conditions) ? data.conditions : [];
  const hasNested = nestedConditions.length > 0;
  const separator = getConditionLabel(data.condition);

  const visibleCount = expanded
    ? nestedConditions.length
    : Math.min(nestedConditions.length, MAX_VISIBLE);
  const hiddenCount = nestedConditions.length - visibleCount;

  // Its entities, edited on the card (TargetPill.tsx); a placeholder is
  // configured through its picker instead.
  const pillProps = {
    nodeId: id,
    nodeType: 'condition',
    data,
    targets: isUnconfigured ? null : editableTargets,
  };

  const title =
    data.alias ||
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
        getConditionLabel(data.condition));
  // The card's sentence: "[Hallway light] is on" when its title is its
  // entity, else its own name with what it tests on the lines below.
  const titleIsPill =
    !data.alias && primaryEntityId !== undefined && titleIsTarget(data, pillProps.targets);
  const sentencePhrase = primaryPhrase
    ? conditionPhraseAfterName(
        t,
        i18n.language,
        primaryPhrase,
        Boolean(singleStateEntityId) || dottedConditionIsState(data.condition)
      )
    : undefined;
  // Several entities: "[2 entities] are on" (all of them must be; a State
  // condition matching any of them keeps its lines below).
  const countPhrase =
    singleStateEntityId === undefined && !isGroupCondition && !data._blockKey
      ? data.condition === 'state' && data.match !== 'any' && statePhrase
        ? t('nodes:conditions.cardPhrases.areState', {
            state: phraseAfterName(statePhrase, i18n.language),
          })
        : isDottedCondition && dottedPhrase
          ? dottedConditionIsState(data.condition)
            ? t('nodes:conditions.cardPhrases.areState', {
                state: phraseAfterName(dottedPhrase, i18n.language),
              })
            : phraseAfterName(dottedPhrase, i18n.language)
          : undefined
      : undefined;
  const countIsPill =
    !data.alias && !titleIsPill && pillProps.targets !== null && countPhrase !== undefined;
  // A State condition's state is a pill too ("[Hallway light] is [on]",
  // "[lights · 2] are [on]", "any of [lights · 2] is [on]").
  const isStateCondition = data.condition === 'state' && !isUnconfigured;
  const stateCountIsPill =
    isStateCondition && !data.alias && !titleIsPill && pillProps.targets !== null;
  const statePill = (key: 'isState' | 'areState') => {
    const [before = '', after = ''] = t(`nodes:conditions.cardPhrases.${key}`, {
      state: PILL_MARK,
    }).split(PILL_MARK);
    return (
      <>
        {` ${before}`}
        <ConditionStatePill nodeId={id} data={data} phrase={statePhrase} tone="condition" />
        {after}
      </>
    );
  };
  // "Anything in Kitchen is on": a whole area as its target.
  const wholeArea = useWholeArea(isDottedCondition && isPlainCondition ? data.target : undefined);
  const areaSentence = !data.alias && !isUnconfigured && wholeArea !== undefined;
  const areaPhrase = dottedPhrase
    ? conditionPhraseAfterName(
        t,
        i18n.language,
        dottedPhrase,
        dottedConditionIsState(data.condition)
      )
    : undefined;
  // Its threshold and how long it must hold, as pills.
  const holds = (
    <>
      <ThresholdPill
        nodeId={id}
        data={data}
        kind="condition"
        tone="condition"
        enabled={isPlainCondition}
      />
      <ForPill nodeId={id} data={data} kind="condition" tone="condition" />
    </>
  );

  return (
    <StepCard
      settingsFor={id}
      tone="condition"
      icon={HeaderIcon}
      iconKey={
        isPlainCondition
          ? stepIconKey(
              primaryTarget?.deviceClass,
              dottedDomain,
              primaryTarget?.domain,
              data.condition,
              'condition'
            )
          : stepIconKey(data._blockKey as string | undefined, 'condition')
      }
      lead={t('nodes:picker.kinds.and')}
      place={wholeArea?.place ?? primaryTarget?.area}
      sentence={
        areaSentence && wholeArea ? (
          <>
            {phraseAfterName(wholeArea.label, i18n.language)}
            {areaPhrase && ` ${areaPhrase}`}
            {holds}
          </>
        ) : titleIsPill && isStateCondition ? (
          <>
            <CardTitle {...pillProps} tone="condition" title={title} />
            {statePill('isState')}
            {holds}
          </>
        ) : titleIsPill ? (
          <>
            <CardTitle {...pillProps} tone="condition" title={title} />
            {sentencePhrase && ` ${sentencePhrase}`}
            {holds}
          </>
        ) : stateCountIsPill ? (
          data.match === 'any' ? (
            <>
              {`${t('nodes:conditions.cardPhrases.anyOf')} `}
              <CardTargetLine {...pillProps} tone="condition" inline />
              {statePill('isState')}
              {holds}
            </>
          ) : (
            <>
              <CardTargetLine {...pillProps} tone="condition" inline />
              {statePill('areState')}
              {holds}
            </>
          )
        ) : countIsPill ? (
          <>
            <CardTargetLine {...pillProps} tone="condition" inline />
            {` ${countPhrase}`}
            {holds}
          </>
        ) : (
          <>
            {title}
            {!isUnconfigured && holds}
          </>
        )
      }
      stepNumber={stepNumber}
      selected={selected}
      isActive={isActive}
      isDisabled={isDisabled}
      hasErrors={hasErrors}
      isUnconfigured={isUnconfigured}
      traceClass={getTraceStateClass(traceState)}
      className={cn(hasNested && 'min-w-[220px]', opensConditionMiller && 'cursor-pointer')}
      // Single click only selects; a double click opens the picker. The
      // event is stopped so xyflow's own double click (which toggles the
      // properties panel) doesn't fire as well.
      onDoubleClick={
        opensConditionMiller
          ? (event) => {
              event.stopPropagation();
              requestNodeEdit('condition', id);
            }
          : undefined
      }
      edge={
        <>
          {roleLabel && <BlockRoleBadge label={roleLabel} />}
          {markers.listHead && <AndChip />}
          <NodeStatusBadge
            errorMessages={errorMessages}
            warningMessages={warningMessages}
            isDisabled={isDisabled}
          />
          <Handle
            type="target"
            position={Position.Left}
            className={cn('w-3! h-3!', COLORS.handle)}
          />
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

          {markers.stopsAt.includes('true') && (
            <StopsHereBadge top={showFalseHandle ? '30%' : '50%'} />
          )}
          {markers.stopsAt.includes('false') && <StopsHereBadge top="70%" />}

          {/* If/Else deliberately shows no edge labels at all — unlike every
              other hasFalseEdge case (a plain condition someone manually wired a
              false edge onto, or Repeat While's loop-continues/loop-ends pair),
              where an always-shown "Yes"/"No" (a touch screen has no hover) tells the
              two outputs apart. If/Else's
              two branch boxes now say "Click to configure then"/"...else"
              themselves (and, once configured, show what they actually do), so
              a redundant edge label would just be clutter. */}
          {showFalseHandle && !isIfElseBlock && <BranchTag yes label={t('nodes:conditions.yes')} />}
          {showFalseHandle && !isIfElseBlock && (
            <BranchTag yes={false} label={t('nodes:conditions.no')} />
          )}
        </>
      }
    >
      {!hasNested && !isUnconfigured && (
        <>
          {!countIsPill && <CardTargetLine {...pillProps} tone="condition" />}
          {titleIsPill || countIsPill || areaSentence ? null : primaryEntityId ? (
            <TruncatedTooltip content={primaryPhrase || getConditionLabel(data.condition)}>
              <div className="truncate">{primaryPhrase || getConditionLabel(data.condition)}</div>
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
                  <TruncatedTooltip content={entityNames(data.entity_id)}>
                    <div className="truncate opacity-75">{entityNames(data.entity_id)}</div>
                  </TruncatedTooltip>
                ) : (
                  <TruncatedTooltip content={entityNames([data.entity_id])}>
                    <button
                      type="button"
                      className="nodrag truncate text-left opacity-75 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        openMoreInfo(data.entity_id as string);
                      }}
                    >
                      {entityNames([data.entity_id])}
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
              {entityNames([data.zone])}
            </div>
          )}
          {data.attribute && (
            <div className="opacity-75">
              {'attr: '}
              {prettify(data.attribute)}
            </div>
          )}
          {data.template && <TemplateLine template={data.template} />}
          {data.value_template && <TemplateLine template={data.value_template} />}
          {/* The triggers it means, as their cards read, not their ids
              (HA 2026.10 writes ids like `generated-a1B2`). */}
          {data.id !== undefined && data.id !== null && (
            <div className="opacity-75" data-testid="triggered-by-names">
              {triggerIdNames(data.id).join(', ')}
            </div>
          )}
          {/* isGroup's empty case ("0 Nested Conditions") is no longer reachable here —
          an empty and/or/not group is now `isUnconfigured` (see hasNoNestedConditions
          above) and shows the dashed-border "Click to configure and/or/not" placeholder
          instead, matching every other compound block's unconfigured state. */}
        </>
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
                <TruncatedTooltip
                  content={getNestedConditionTitle(cond, resolveEntityTarget, getConditionLabel)}
                >
                  <div className="truncate font-semibold text-[11px] text-condition">
                    {getNestedConditionTitle(cond, resolveEntityTarget, getConditionLabel)}
                  </div>
                </TruncatedTooltip>
                <TruncatedTooltip
                  content={getConditionSummary(cond, getConditionLabel, entityNames)}
                >
                  <div className="truncate text-[10px] text-condition/70">
                    {getConditionSummary(cond, getConditionLabel, entityNames)}
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
    </StepCard>
  );
});
