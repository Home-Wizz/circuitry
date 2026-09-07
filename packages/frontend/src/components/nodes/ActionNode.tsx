import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { TFunction } from 'i18next';
import { AlertCircle, Ban, GitCompareArrows, ListTree, OctagonX, Play, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BlockRoleBadge } from '@/components/nodes/BlockRoleBadge';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { compoundTypes } from '@/config/nodeTypeCatalog';
import { useMoreInfo } from '@/hooks/useMoreInfo';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getActionRoleLabel } from '@/lib/block-role-label';
import { getDomainIcon } from '@/lib/domain-icons';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import { cn, prettify, singleEntityIdFrom } from '@/lib/utils';
import type { ActionNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

const ACTION_COLORS = NODE_COLORS.action;
// stop-action reuses the "wait" token, repeat-action reuses "delay" — same
// visual family already established for those semantics elsewhere.
const STOP_COLORS = NODE_COLORS.wait;
const REPEAT_COLORS = NODE_COLORS.delay;

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
  t: TFunction<readonly ['nodes']>
): string | null {
  if (isStopAction || !target) return null;
  const entityId = target.entity_id;
  if (Array.isArray(entityId)) {
    return t('nodes:actions.entitiesSelected', { count: entityId.length });
  }
  return entityId ?? null;
}

export const ActionNode = memo(function ActionNode({ id, data, selected }: ActionNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const requestNodeEdit = useFlowStore((s) => s.requestNodeEdit);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const openMoreInfo = useMoreInfo();
  const { resolveEntityTarget } = useNodeCardDisplay();
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

  // A device-specific action (device_id/domain/type, no service) — see
  // useDeviceAutomation.ts's DeviceAction/actionNodeData.ts's 'deviceAction'
  // case. Distinguished from a plain service call so the card shows a real
  // label (the device action's `type`, e.g. "identify") instead of falling
  // all the way through to the generic "Action" placeholder.
  const isDeviceActionData =
    !isStopAction &&
    typeof data.service !== 'string' &&
    typeof data.device_id === 'string' &&
    typeof data.domain === 'string' &&
    typeof data.type === 'string';
  const deviceActionType = isDeviceActionData ? (data.type as string) : undefined;
  const deviceActionDomain = isDeviceActionData ? (data.domain as string) : undefined;

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
  const isRepeatAction =
    repeatData !== null && (repeatData.count !== undefined || isForEachRepeat);
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
  const targetDisplay = getTargetDisplay(isStopAction, data.target, t);

  // Device-name-plus-plain-language-phrase card resolution: a single target entity resolves to its
  // device/area/home name for the title, with a plain-language action
  // phrase (HA's own service-action translations, same ones ActionFields.tsx
  // uses for the action picker) as the subtitle — instead of the raw
  // entity_id / domain.service technical strings. Multi-entity targets (or
  // targetless services like scripts/scenes) keep the previous, more
  // technical display since there's no single device to name.
  const target = targetEntityId ? resolveEntityTarget(targetEntityId) : null;
  const friendlyActionName = serviceName
    ? t(`nodes:serviceActions.${serviceName}`, { defaultValue: prettify(serviceName) })
    : undefined;
  // Plain-language phrase for the common on/off case — "Turned on"/"Turned off"
  // reads naturally after the device-name title above ("Hallway Light" /
  // "Turned on"), matching TriggerNode.tsx's cardPhrases.turnedOn/turnedOff
  // for the equivalent trigger card. Any other service keeps the plain
  // service-action translation (e.g. "Set temperature") since there's no
  // universal past-tense phrasing for it.
  const actionPhrase =
    serviceName === 'turn_on'
      ? t('nodes:actions.cardPhrases.turnedOn')
      : serviceName === 'turn_off'
        ? t('nodes:actions.cardPhrases.turnedOff')
        : friendlyActionName;

  if (isStopAction) {
    return (
      <div
        // See node-colors.ts's SELECTED_NODE_STYLE doc comment.
        style={selected ? SELECTED_NODE_STYLE : undefined}
        className={cn(
          'relative min-w-[180px] rounded-lg border-2 px-4 py-3',
          STOP_COLORS.border,
          STOP_COLORS.bg,
          'transition-all duration-200',
          isActive && NODE_STATE_CLASSES.active,
          isDisabled && 'border-dashed opacity-50 grayscale',
          hasErrors && NODE_STATE_CLASSES.error,
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
        <Handle
          type="target"
          position={Position.Left}
          className={cn('w-3! h-3!', STOP_COLORS.handle)}
        />
        <div className="mb-1 flex items-center gap-2">
          <div className={cn('rounded p-1', STOP_COLORS.chip)}>
            <OctagonX className={cn('h-4 w-4', STOP_COLORS.text)} />
          </div>
          <span className={cn('font-semibold text-sm', STOP_COLORS.text)}>
            {data.alias || t('nodes:types.stop')}
          </span>
          {stepNumber && (
            <div
              className={cn(
                'ml-auto flex h-5 w-5 items-center justify-center rounded-full font-bold text-xs',
                STOP_COLORS.badge
              )}
            >
              {stepNumber}
            </div>
          )}
        </div>
        <div className={cn('text-xs', STOP_COLORS.text)}>
          <div className="font-medium opacity-70">
            {isStopError ? t('nodes:actions.stopError') : t('nodes:actions.stopExecution')}
          </div>
          {stopMessage && (
            <TruncatedTooltip content={stopMessage}>
              <div className="truncate opacity-75 italic">{stopMessage}</div>
            </TruncatedTooltip>
          )}
        </div>
      </div>
    );
  }

  if (isRepeatAction) {
    return (
      <div
        style={selected ? SELECTED_NODE_STYLE : undefined}
        className={cn(
          'relative min-w-[180px] rounded-lg border-2 px-4 py-3',
          REPEAT_COLORS.border,
          REPEAT_COLORS.bg,
          'transition-all duration-200',
          isActive && NODE_STATE_CLASSES.active,
          isDisabled && 'border-dashed opacity-50 grayscale',
          hasErrors && NODE_STATE_CLASSES.error,
          getTraceStateClass(traceState)
        )}
      >
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
        <Handle
          type="target"
          position={Position.Left}
          className={cn('w-3! h-3!', REPEAT_COLORS.handle)}
        />
        <div className="mb-1 flex items-center gap-2">
          <div className={cn('rounded p-1', REPEAT_COLORS.chip)}>
            {isForEachRepeat ? (
              // 'for_each' has no compoundTypes entry (repeat_while/until/count
              // only) — ListTree is this variant's own dedicated icon.
              <ListTree className={cn('h-4 w-4', REPEAT_COLORS.text)} />
            ) : (
              <RepeatBlockIcon className={cn('h-4 w-4', REPEAT_COLORS.text)} />
            )}
          </div>
          <span className={cn('font-semibold text-sm', REPEAT_COLORS.text)}>
            {data.alias ||
              (isForEachRepeat ? t('nodes:actions.repeatForEachLabel') : t('nodes:actions.repeatCountTitle'))}
          </span>
          {stepNumber && (
            <div
              className={cn(
                'ml-auto flex h-5 w-5 items-center justify-center rounded-full font-bold text-xs',
                REPEAT_COLORS.badge
              )}
            >
              {stepNumber}
            </div>
          )}
        </div>
        {/* Inline count editor directly on the card, matching DelayNode.tsx's
            inline duration editor — no need to open the property panel just
            to change how many times a repeat_count block runs. */}
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
              value={typeof repeatCount === 'number' || typeof repeatCount === 'string' ? repeatCount : ''}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = Number.parseInt(raw, 10);
                const nextCount = raw === '' ? 1 : Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
                updateNodeData(id, { repeat: { ...repeatData, count: nextCount } });
              }}
              className={cn('h-6 w-14 rounded border bg-background px-1.5 text-xs', REPEAT_COLORS.text)}
            />
            <span className={cn('text-xs opacity-70', REPEAT_COLORS.text)}>
              {t('nodes:actions.repeatCountInlineSuffix')}
            </span>
          </div>
        )}
        {isForEachRepeat && forEachCount !== undefined && (
          <div className={cn('text-xs font-medium opacity-70', REPEAT_COLORS.text)}>
            {t('nodes:actions.repeatForEachItems', { count: forEachCount })}
          </div>
        )}
        {repeatSeqLength > 0 && (
          <div className={cn('text-xs font-medium opacity-70', REPEAT_COLORS.text)}>
            {t('nodes:actions.repeatActions', { count: repeatSeqLength })}
          </div>
        )}
        <Handle
          type="source"
          position={Position.Right}
          className={cn('w-3! h-3!', REPEAT_COLORS.handle)}
        />
      </div>
    );
  }

  const ActionTargetIcon = getDomainIcon(target?.domain ?? domain ?? deviceActionDomain, Play);

  return (
    <div
      // Single click only selects (React Flow's own click handling already
      // toggles `selected`, which drives the selection outline below) —
      // double click opens the miller. Same fix as ConditionNode.tsx's
      // identical onClick → onDoubleClick change; see that file's comment.
      // stopPropagation is required so this doesn't ALSO trigger xyflow's
      // canvas-level onNodeDoubleClick (which toggles the right-side
      // properties panel) — see ConditionNode.tsx's matching comment.
      onDoubleClick={
        opensActionMiller
          ? (event) => {
              event.stopPropagation();
              requestNodeEdit('action', id);
            }
          : undefined
      }
      // See node-colors.ts's SELECTED_NODE_STYLE doc comment.
      style={selected ? SELECTED_NODE_STYLE : undefined}
      className={cn(
        'relative min-w-[180px] rounded-lg border-2 px-4 py-3',
        ACTION_COLORS.border,
        ACTION_COLORS.bg,
        'transition-all duration-200',
        isActive && NODE_STATE_CLASSES.active,
        isDisabled && 'border-dashed opacity-50 grayscale',
        hasErrors && NODE_STATE_CLASSES.error,
        opensActionMiller && 'cursor-pointer',
        isActionUnconfigured && !isDisabled && 'border-dashed',
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
      <Handle
        type="target"
        position={Position.Left}
        className={cn('w-3! h-3!', ACTION_COLORS.handle)}
      />

      <div className="mb-1 flex items-center gap-2">
        <div className={cn('rounded p-1', ACTION_COLORS.chip)}>
          {data._blockKey === 'parallel' ? (
            <ParallelBlockIcon className={cn('h-4 w-4', ACTION_COLORS.text)} />
          ) : (
            <ActionTargetIcon className={cn('h-4 w-4', ACTION_COLORS.text)} />
          )}
        </div>
        <span className={cn('font-semibold text-sm', ACTION_COLORS.text)}>
          {data.alias ||
            target?.label ||
            (isEventAction ? data.event : serviceName) ||
            (deviceActionType ? prettify(deviceActionType) : undefined) ||
            (isActionUnconfigured
              ? data._blockKey === 'if_else'
                ? data._ifElseBranch === 'else'
                  ? t('nodes:actions.clickToConfigureElse')
                  : t('nodes:actions.clickToConfigureThen')
                : t('nodes:actions.clickToConfigure')
              : undefined) ||
            t('nodes:types.action')}
        </span>
        {stepNumber && (
          <div
            className={cn(
              'ml-auto flex h-5 w-5 items-center justify-center rounded-full font-bold text-xs',
              ACTION_COLORS.badge
            )}
          >
            {stepNumber}
          </div>
        )}
      </div>

      <div className={cn('space-y-0.5 text-xs', ACTION_COLORS.text)}>
        {isActionUnconfigured ? null : isEventAction ? (
          <div className="font-medium">
            <span className="opacity-60">{t('nodes:actions.fireEvent')}</span>
          </div>
        ) : targetEntityId ? (
          <TruncatedTooltip content={actionPhrase}>
            <button
              type="button"
              className="nodrag truncate text-left font-medium hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                openMoreInfo(targetEntityId);
              }}
            >
              {actionPhrase}
            </button>
          </TruncatedTooltip>
        ) : isDeviceActionData ? (
          <div className="font-medium">
            <span className="opacity-60">
              {deviceActionDomain}
              {'.'}
            </span>
            {deviceActionType}
          </div>
        ) : (
          <>
            <div className="font-medium">
              <span className="opacity-60">
                {domain}
                {'.'}
              </span>
              {serviceName}
            </div>
            {targetDisplay && (
              <TruncatedTooltip content={targetDisplay}>
                <div className="truncate opacity-75">{targetDisplay}</div>
              </TruncatedTooltip>
            )}
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className={cn('w-3! h-3!', ACTION_COLORS.handle)}
      />
    </div>
  );
});
