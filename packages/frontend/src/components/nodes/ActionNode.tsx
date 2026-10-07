import { isOpaqueStepData } from '@circuitry/shared';
import type { NodeProps } from '@xyflow/react';
import type { TFunction } from 'i18next';
import { GitCompareArrows, ListTree, Lock, OctagonX, Play, RotateCcw } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { compoundTypes } from '@/config/nodeTypeCatalog';
import { useMoreInfo } from '@/hooks/useMoreInfo';
import { useEditableTargets, useWholeArea } from '@/hooks/useStepTargets';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getActionRoleLabel } from '@/lib/block-role-label';
import { getDomainIcon, iconKeyFor } from '@/lib/domain-icons';
import { stepIconKey } from '@/lib/emojiIcons';
import { getTraceStateClass } from '@/lib/node-colors';
import { opaqueStepKind, opaqueStepSummary, opaqueStepYaml } from '@/lib/opaqueStep';
import { prettify, singleEntityIdFrom } from '@/lib/utils';
import type { ActionNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { actionVerb } from './cardWording';
import { phraseAfterName, StepFrame } from './StepCard';
import { ValuePills } from './ValuePills';
import { CardTargetLine, CardTitle, titleIsTarget } from './TargetPill';

// A Stop has the "wait" colour and a repeat the "delay" one, as elsewhere;
// a step Circuitry keeps as written (bug #57) the neutral "join" one.

interface ActionNodeProps extends NodeProps {
  data: ActionNodeData;
}

/**
 * "Target entity" summary line for the card — a single entity_id, or an
 * "N entities selected" count for multi-target actions. Extracted to a
 * named helper (rather than an inline IIFE) per CLAUDE.md's no-IIFE rule.
 */
function getTargetDisplay(
  isStopAction: boolean,
  target: ActionNodeData['target'],
  t: TFunction<readonly ['nodes']>,
  entityNames: (entityIds: readonly string[]) => string
): string | null {
  if (isStopAction || !target) return null;
  const entityId = target.entity_id;
  if (Array.isArray(entityId)) {
    return t('nodes:actions.entitiesSelected', { count: entityId.length });
  }
  return entityId ? entityNames([entityId]) : null;
}

/**
 * A device-specific action (device_id/domain/type, no service) -- see
 * useDeviceAutomation.ts's DeviceAction/actionNodeData.ts's 'deviceAction'
 * case. Told apart from a plain service call so the card shows a real
 * label (the device action's `type`, e.g. "identify") instead of falling
 * all the way through to the generic "Action" placeholder.
 */
function deviceActionOf(
  data: Readonly<Record<string, unknown>>
): { deviceId: string; domain: string; type: string } | undefined {
  const { service, device_id: deviceId, domain, type } = data;
  return typeof service !== 'string' &&
    typeof deviceId === 'string' &&
    typeof domain === 'string' &&
    typeof type === 'string'
    ? { deviceId, domain, type }
    : undefined;
}

/** An action's verb ("Turn on", a device action's type, else its service),
 * and what it does after "Then" ("turn on"). */
function actionWords(
  t: TFunction<readonly ['nodes']>,
  language: string,
  named: string | undefined,
  deviceActionType: string | undefined,
  serviceName: string | undefined
): { verb: string | undefined; doing: string } {
  const verb = named ?? (deviceActionType ? prettify(deviceActionType) : undefined);
  return {
    verb,
    doing: phraseAfterName(verb || serviceName || t('nodes:types.action'), language),
  };
}

/** What an action acts on and how, around its verb: "turn on [Kitchen
 * light] at [40 %]"; German puts the verb last ("[Küchenlicht] auf [40 %]
 * einschalten"). */
function aroundVerb(doing: string, language: string, what: ReactNode, rest: ReactNode) {
  if (!language.startsWith('de')) {
    return (
      <>
        {`${doing} `}
        {what}
        {rest}
      </>
    );
  }
  return (
    <>
      {what}
      {rest}
      {` ${doing.charAt(0).toLowerCase()}${doing.slice(1)}`}
    </>
  );
}

/** An action's target by name, when the card can't edit it: a click opens
 * HA's more-info for one entity. */
function NamedTarget({
  name,
  display,
  entityId,
}: {
  /** Its entity's name, when it names one. */
  name: string | undefined;
  /** What it names, in words ("Kitchen light", "2 entities"). */
  display: string;
  /** The one entity it names, for HA's more-info. */
  entityId: string | undefined;
}) {
  const openMoreInfo = useMoreInfo();
  return (
    <TruncatedTooltip content={display}>
      <button
        type="button"
        className="nodrag max-w-full truncate text-left font-semibold hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          if (entityId) openMoreInfo(entityId);
        }}
      >
        {name ?? display}
      </button>
    </TruncatedTooltip>
  );
}

export const ActionNode = memo(function ActionNode({ id, data, selected }: ActionNodeProps) {
  const { t, i18n } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const requestNodeEdit = useFlowStore((s) => s.requestNodeEdit);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  // Its entities, edited on the card (TargetPill.tsx).
  const pillProps = {
    nodeId: id,
    nodeType: 'action',
    data,
    targets: useEditableTargets('action', data),
  };
  const { resolveEntityTarget, resolveDeviceTarget, entityNames } = useNodeCardDisplay();
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const roleLabel = getActionRoleLabel(
    data._blockKey as string | undefined,
    data._ifElseBranch,
    data._parallelBranch,
    t
  );

  const isStopAction = typeof data.stop === 'string';
  const stopMessage = isStopAction ? (data.stop as string) : undefined;
  const isStopError = isStopAction && data.error === true;

  // Parse service into domain and service name, handle undefined
  let domain: string | undefined;
  let serviceName: string | undefined;
  if (!isStopAction && typeof data.service === 'string' && data.service.includes('.')) {
    [domain, serviceName] = data.service.split('.');
  }

  const isEventAction = !isStopAction && typeof data.event === 'string' && data.event.trim() !== '';

  // A device-specific action (deviceActionOf): its type labels the card, its
  // device is named on it (never its id or integration).
  const deviceAction = isStopAction ? undefined : deviceActionOf(data);
  const deviceActionType = deviceAction?.type;
  const deviceActionDomain = deviceAction?.domain;
  const deviceActionName = resolveDeviceTarget(deviceAction?.deviceId, deviceActionDomain)?.label;

  // Parallel branches, Repeat While/Until's body action, and If/Else's two
  // branches are all added to the canvas immediately with a blank
  // placeholder action ({service:''}) rather than pre-seeded via the miller —
  // per user request (If/Else's branches specifically per block-factories.ts's
  // createIfElseBlock doc comment). Clicking this card opens the THEN miller
  // to configure (or reconfigure) it in place instead, via flow-store.ts's
  // nodeEditRequest — see useAddNodeDialogs.tsx's openThenForNode doc comment
  // for the full flow.
  const opensActionMiller =
    !isStopAction &&
    (data._blockKey === 'parallel' ||
      data._blockKey === 'repeat_while' ||
      data._blockKey === 'repeat_until' ||
      data._blockKey === 'if_else');
  // block-factories.ts's actionNode marks every blank branch/body action
  // with `_placeholder: true`, cleared once the user actually configures it
  // (see useAddNodeDialogs.tsx). Deliberately not inferred from
  // `!data.service` — that missed genuinely-configured device actions and
  // fire-event actions, which don't set `service` at all, so those stayed
  // stuck showing "click to configure" even after being configured.
  const isActionUnconfigured = opensActionMiller && data._placeholder === true;

  const repeatData =
    !isStopAction && data.repeat !== null && typeof data.repeat === 'object'
      ? (data.repeat as Record<string, unknown>)
      : null;
  const isForEachRepeat = repeatData !== null && repeatData.for_each !== undefined;
  const isRepeatAction = repeatData !== null && (repeatData.count !== undefined || isForEachRepeat);
  // Single source of truth: config/nodeTypeCatalog.ts's compoundTypes
  // (repeat_while → Repeat, repeat_until → RefreshCcw, repeat_count →
  // RotateCw). RotateCcw is a defensive fallback only, never the catalog.
  const RepeatBlockIcon = compoundTypes.find((c) => c.key === data._blockKey)?.icon ?? RotateCcw;
  // Same catalog lookup for the 'parallel' compound block's icon.
  const ParallelBlockIcon =
    compoundTypes.find((c) => c.key === 'parallel')?.icon ?? GitCompareArrows;
  const repeatCount = isRepeatAction ? repeatData.count : undefined;
  const forEachCount =
    isForEachRepeat && Array.isArray(repeatData.for_each) ? repeatData.for_each.length : undefined;
  const repeatSeqLength = isRepeatAction
    ? Array.isArray(repeatData.sequence)
      ? repeatData.sequence.length
      : 0
    : 0;

  // Single target entity_id, clickable for HA's more-info dialog — HA stores
  // entity_id as an array even for one selected entity, so this unwraps that
  // (see singleEntityIdFrom's doc comment); true multi-entity targets show a
  // count instead (targetDisplay below).
  const targetEntityId =
    !isStopAction && data.target ? singleEntityIdFrom(data.target.entity_id) : undefined;

  // Get target entity display
  const targetDisplay = getTargetDisplay(isStopAction, data.target, t, entityNames);

  // Device-name-plus-plain-language-phrase card resolution: a single target entity resolves to its
  // device/area/home name for the title, with a plain-language action
  // phrase (HA's own service-action translations, same ones ActionFields.tsx
  // uses for the action picker) as the subtitle — instead of the raw
  // entity_id / domain.service technical strings. Multi-entity targets (or
  // targetless services like scripts/scenes) keep the previous, more
  // technical display since there's no single device to name.
  const target = targetEntityId ? resolveEntityTarget(targetEntityId) : null;
  const friendlyActionName = actionVerb(t, data.service);
  const thenKind = t('nodes:picker.kinds.then');
  const frameState = {
    nodeId: id,
    selected: selected ?? false,
    isActive,
    isDisabled,
    hasErrors,
    errorMessages,
    warningMessages,
    traceClass: getTraceStateClass(traceState),
    roleLabel,
    stepNumber,
  };

  if (isOpaqueStepData(data)) {
    // A step Circuitry doesn't know, kept exactly as written (bug #57):
    // shown locked, with its YAML. It can be moved, rewired or deleted.
    const kind = opaqueStepKind(data);
    const summary = opaqueStepSummary(data);
    return (
      <StepFrame
        {...frameState}
        tone="join"
        icon={Lock}
        iconKey="kept"
        sentence={data.alias || (kind ? prettify(kind) : t('nodes:actions.opaqueStepTitle'))}
        hasSourceHandle
      >
        <div>{t('nodes:actions.opaqueStepKept')}</div>
        {summary && (
          <TruncatedTooltip content={opaqueStepYaml(data)}>
            <div className="max-w-[220px] truncate font-mono">{summary}</div>
          </TruncatedTooltip>
        )}
      </StepFrame>
    );
  }

  if (isStopAction) {
    return (
      <StepFrame
        {...frameState}
        tone="wait"
        icon={OctagonX}
        iconKey="stop"
        lead={thenKind}
        sentence={data.alias || t('nodes:cardWords.stop')}
        hasSourceHandle={false}
      >
        <div>{isStopError ? t('nodes:actions.stopError') : t('nodes:actions.stopExecution')}</div>
        {stopMessage && (
          <TruncatedTooltip content={stopMessage}>
            <div className="truncate italic">{stopMessage}</div>
          </TruncatedTooltip>
        )}
      </StepFrame>
    );
  }

  if (isRepeatAction) {
    return (
      <StepFrame
        {...frameState}
        tone="delay"
        // 'for_each' has no compoundTypes entry (repeat_while/until/count
        // only): ListTree is its own icon.
        icon={isForEachRepeat ? ListTree : RepeatBlockIcon}
        iconKey={
          isForEachRepeat
            ? 'repeat_for_each'
            : stepIconKey(data._blockKey as string | undefined, 'repeat_count')
        }
        lead={thenKind}
        sentence={
          data.alias ||
          phraseAfterName(
            isForEachRepeat
              ? t('nodes:actions.repeatForEachLabel')
              : t('nodes:actions.repeatCountTitle'),
            i18n.language
          )
        }
        hasSourceHandle
      >
        {/* The count is edited on the card, as a delay's duration is. */}
        {!isForEachRepeat && repeatCount !== undefined && (
          <div
            className="nodrag flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="number"
              min={1}
              value={
                typeof repeatCount === 'number' || typeof repeatCount === 'string'
                  ? repeatCount
                  : ''
              }
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = Number.parseInt(raw, 10);
                const nextCount = raw === '' ? 1 : Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
                updateNodeData(id, { repeat: { ...repeatData, count: nextCount } });
              }}
              className="h-6 w-14 rounded border bg-background px-1.5 text-foreground text-xs"
            />
            <span>{t('nodes:actions.repeatCountInlineSuffix')}</span>
          </div>
        )}
        {isForEachRepeat && forEachCount !== undefined && (
          <div>{t('nodes:actions.repeatForEachItems', { count: forEachCount })}</div>
        )}
        {repeatSeqLength > 0 && (
          <div>{t('nodes:actions.repeatActions', { count: repeatSeqLength })}</div>
        )}
      </StepFrame>
    );
  }

  const ActionTargetIcon = getDomainIcon(
    iconKeyFor(target?.deviceClass, target?.domain, domain, deviceActionDomain),
    Play
  );

  const { verb, doing } = actionWords(
    t,
    i18n.language,
    isEventAction ? t('nodes:actions.cardPhrases.fireEvent') : friendlyActionName,
    deviceActionType,
    serviceName
  );
  const unconfiguredText =
    data._blockKey === 'if_else'
      ? data._ifElseBranch === 'else'
        ? t('nodes:actions.clickToConfigureElse')
        : t('nodes:actions.clickToConfigureThen')
      : t('nodes:actions.clickToConfigure');
  // The card's sentence: "Turn on [Hallway light]" when the step names one
  // entity, else what it does, its entities as a pill below.
  const titleIsPill = !data.alias && titleIsTarget(data, pillProps.targets);
  // "Turn on anything in Hallway": a whole area as its target.
  const wholeArea = useWholeArea(isStopAction ? undefined : data.target);
  // Its settings ("with [Brightness 40 %]"), for a service call.
  const values = serviceName ? <ValuePills nodeId={id} data={data} tone="action" /> : null;
  // What it acts on and how, around its verb: "turn on [Kitchen light] at
  // [40 %]"; German puts the verb last ("[Küchenlicht] auf [40 %]
  // einschalten").
  const act = (what: ReactNode, rest: ReactNode = null) =>
    aroundVerb(doing, i18n.language, what, rest);
  // Its target by name, when the card can't edit it (a device or area with
  // it, a template, a service HA doesn't describe).
  const namedTarget =
    pillProps.targets || !targetDisplay ? null : (
      <NamedTarget name={target?.label} display={targetDisplay} entityId={targetEntityId} />
    );
  const sentence = isActionUnconfigured ? (
    unconfiguredText
  ) : data.alias ? (
    data.alias
  ) : titleIsPill && target ? (
    act(<CardTitle {...pillProps} tone="action" title={target.label} />, values)
  ) : wholeArea ? (
    act(t('nodes:cardWords.everythingIn', { name: wholeArea.place }), values)
  ) : pillProps.targets ? (
    act(<CardTargetLine {...pillProps} tone="action" inline />, values)
  ) : isEventAction ? (
    act(<span className="font-semibold text-action">{data.event}</span>)
  ) : namedTarget ? (
    act(namedTarget, values)
  ) : (
    <>
      {doing}
      {values}
    </>
  );

  return (
    <StepFrame
      {...frameState}
      tone="action"
      icon={data._blockKey === 'parallel' ? ParallelBlockIcon : ActionTargetIcon}
      iconKey={
        data._blockKey === 'parallel'
          ? 'parallel'
          : stepIconKey(target?.deviceClass, target?.domain, domain, deviceActionDomain, 'action')
      }
      lead={thenKind}
      place={wholeArea?.place ?? target?.area}
      sentence={sentence}
      hasSourceHandle
      isUnconfigured={isActionUnconfigured}
      className={opensActionMiller ? 'cursor-pointer' : undefined}
      // Single click only selects; a double click opens the picker (stopped
      // so xyflow's own double click, the properties panel, doesn't fire).
      onDoubleClick={
        opensActionMiller
          ? (event) => {
              event.stopPropagation();
              requestNodeEdit('action', id);
            }
          : undefined
      }
    >
      {!isActionUnconfigured && data.alias && verb && (
        <div>
          {verb}
          {values}
        </div>
      )}
      {!isActionUnconfigured && !titleIsPill && (
        <>
          {deviceActionName && <div className="truncate">{deviceActionName}</div>}
          {data.alias && namedTarget}
          {data.alias && <CardTargetLine {...pillProps} tone="action" />}
        </>
      )}
    </StepFrame>
  );
});
