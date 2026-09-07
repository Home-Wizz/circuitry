import { Handle, type NodeProps, Position } from '@xyflow/react';
import { AlertCircle, Ban, Hourglass } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { useTriggerCardDisplay } from '@/hooks/useTriggerCardDisplay';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import type { WaitNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

const COLORS = NODE_COLORS.wait;
const MAX_VISIBLE_TRIGGERS = 3;

interface WaitNodeProps extends NodeProps {
  data: WaitNodeData;
}

export const WaitNode = memo(function WaitNode({ id, data, selected }: WaitNodeProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const { getTriggerDisplayInfo } = useTriggerCardDisplay();
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const waitTriggers = data.wait_for_trigger ?? [];
  const visibleWaitTriggers = waitTriggers.slice(0, MAX_VISIBLE_TRIGGERS);
  const hiddenWaitTriggerCount = waitTriggers.length - visibleWaitTriggers.length;

  return (
    <div
      style={selected ? SELECTED_NODE_STYLE : undefined}
      className={cn(
        'relative min-w-[140px] rounded-lg border-2 px-4 py-3',
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
      <Handle type="target" position={Position.Left} className={cn('w-3! h-3!', COLORS.handle)} />

      <div className="mb-1 flex items-center gap-2">
        <div className={cn('rounded p-1', COLORS.chip)}>
          <Hourglass className={cn('h-4 w-4', COLORS.text)} />
        </div>
        <span className={cn('font-semibold text-sm', COLORS.text)}>
          {data.alias || t('nodes:types.wait')}
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

      <div className={cn('space-y-0.5 text-xs', COLORS.text)}>
        {data.wait_template && (
          <TruncatedTooltip content={data.wait_template}>
            <div className="truncate font-mono text-[10px] opacity-75">
              {data.wait_template.slice(0, 30)}
              {'...'}
            </div>
          </TruncatedTooltip>
        )}
      </div>

      {waitTriggers.length > 0 && (
        <div className="mt-2 space-y-1">
          {visibleWaitTriggers.map((trigger, idx) => {
            const info = getTriggerDisplayInfo(trigger);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: wait_for_trigger entries have no stable id of their own (see TriggerNodeData) — index is the only available key, matching ConditionNode.tsx's identical nested-condition list pattern.
                key={idx}
                className="rounded border border-wait/30 bg-card px-2 py-1"
              >
                <TruncatedTooltip content={info.title}>
                  <div className="truncate font-semibold text-[11px] text-wait">{info.title}</div>
                </TruncatedTooltip>
                {info.subtitle && (
                  <TruncatedTooltip content={info.subtitle}>
                    <div className="truncate text-[10px] text-wait/70">{info.subtitle}</div>
                  </TruncatedTooltip>
                )}
              </div>
            );
          })}
          {hiddenWaitTriggerCount > 0 && (
            <div className="truncate text-[10px] opacity-75">
              {t('nodes:wait.nMoreTriggers', { count: hiddenWaitTriggerCount })}
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className={cn('w-3! h-3!', COLORS.handle)} />
    </div>
  );
});
