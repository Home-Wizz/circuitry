import { Handle, type NodeProps, Position } from '@xyflow/react';
import { AlertCircle, Ban, Zap } from 'lucide-react';
import { memo } from 'react';
import { DottedThresholdInlineEditor } from '@/components/nodes/DottedThresholdInlineEditor';
import { NumericStateInlineEditor } from '@/components/nodes/NumericStateInlineEditor';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { useMoreInfo } from '@/hooks/useMoreInfo';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { useTriggerCardDisplay } from '@/hooks/useTriggerCardDisplay';
import { getDomainIcon } from '@/lib/domain-icons';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import {
  getThresholdRange,
  getThresholdUnit,
  getTriggerThresholdShape,
  triggerAllowsAnyThreshold,
  type TypedThreshold,
} from '@/lib/nativeThreshold';
import { cn } from '@/lib/utils';
import type { TriggerNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

const COLORS = NODE_COLORS.trigger;

interface TriggerNodeProps extends NodeProps {
  data: TriggerNodeData;
}

export const TriggerNode = memo(function TriggerNode({ id, data, selected }: TriggerNodeProps) {
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const openMoreInfo = useMoreInfo();
  const { getTriggerDisplayInfo } = useTriggerCardDisplay();
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const displayInfo = getTriggerDisplayInfo(data);
  const Icon = getDomainIcon(displayInfo.iconDomain, Zap);

  // Inline threshold editing directly on the canvas card for HA's
  // purpose-specific (dotted) triggers — e.g. "Illuminance crossed
  // threshold" or "Light brightness changed" — mirroring the numeric_state
  // Above/Below editor above. Only rendered when a threshold field actually
  // exists (shape !== 'none') and every bound in play is a plain number
  // (DottedThresholdInlineEditor itself returns null for entity-ref bounds).
  const thresholdShape =
    typeof data.trigger === 'string' ? getTriggerThresholdShape(data.trigger) : 'none';
  const triggerOptions = (data.options as Record<string, unknown> | undefined) ?? {};
  const setThreshold = (next: number | TypedThreshold) =>
    updateNodeData(id, { options: { ...triggerOptions, threshold: next } });

  return (
    <div
      style={selected ? SELECTED_NODE_STYLE : undefined}
      className={cn(
        'relative min-w-[180px] max-w-[300px] rounded-lg border-2 px-4 py-3',
        COLORS.border,
        COLORS.bg,
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
      <div className="mb-1 flex items-center gap-2">
        <div className={cn('rounded p-1', COLORS.chip)}>
          <Icon className={cn('h-4 w-4', COLORS.text)} />
        </div>
        <span className={cn('font-semibold text-sm', COLORS.text)}>{displayInfo.title}</span>
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

      <div className={cn('space-y-0.5 text-xs', COLORS.text)}>
        {displayInfo.subtitleEntityId ? (
          <TruncatedTooltip content={displayInfo.subtitle}>
            <button
              type="button"
              className="nodrag line-clamp-2 truncate whitespace-pre-line text-left font-medium hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                openMoreInfo(displayInfo.subtitleEntityId as string);
              }}
            >
              {displayInfo.subtitle}
            </button>
          </TruncatedTooltip>
        ) : (
          <TruncatedTooltip content={displayInfo.subtitle}>
            <div className="line-clamp-2 truncate whitespace-pre-line font-medium">{displayInfo.subtitle}</div>
          </TruncatedTooltip>
        )}
        {displayInfo.detail != null && displayInfo.detail !== '' && (
          <TruncatedTooltip content={String(displayInfo.detail)}>
            <div className="truncate opacity-75">{String(displayInfo.detail)}</div>
          </TruncatedTooltip>
        )}
        {data.trigger === 'numeric_state' && (
          <NumericStateInlineEditor
            above={typeof data.above === 'number' ? data.above : undefined}
            below={typeof data.below === 'number' ? data.below : undefined}
            onChange={(patch) => updateNodeData(id, patch)}
          />
        )}
        {(thresholdShape === 'flat' || thresholdShape === 'typed') &&
          typeof data.trigger === 'string' && (
            <DottedThresholdInlineEditor
              shape={thresholdShape}
              threshold={triggerOptions.threshold as number | string | TypedThreshold | undefined}
              unit={getThresholdUnit(data.trigger)}
              min={getThresholdRange(data.trigger)?.min}
              max={getThresholdRange(data.trigger)?.max}
              allowAny={triggerAllowsAnyThreshold(data.trigger)}
              onChange={setThreshold}
            />
          )}
      </div>

      <Handle type="source" position={Position.Right} className={cn('w-3! h-3!', COLORS.handle)} />
    </div>
  );
});
