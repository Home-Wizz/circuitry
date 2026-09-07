import { Handle, type NodeProps, Position } from '@xyflow/react';
import { AlertCircle, Ban, Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import { buildSimpleDuration, parseSimpleDuration } from '@/lib/simpleDuration';
import { cn } from '@/lib/utils';
import type { DelayNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { formatDuration } from './formatDuration';

const COLORS = NODE_COLORS.delay;

interface DelayNodeProps extends NodeProps {
  data: DelayNodeData;
}

export const DelayNode = memo(function DelayNode({ id, data, selected }: DelayNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  // Format delay for display (reuse shared util)
  const delayDisplay = formatDuration(data.delay);

  // Inline Sec/Min editing directly on the canvas card, matching a
  // reference flow editor's own delay card — only offered when the
  // current value cleanly reduces to a single amount+unit (see parseSimpleDuration's doc comment); more
  // complex durations (hours, or minutes+seconds combined) still show as
  // plain text and are edited via the property panel as before.
  const simpleDuration = parseSimpleDuration(data.delay);

  const setSimpleDuration = (next: { amount: number; unit: 'seconds' | 'minutes' }) => {
    updateNodeData(id, { delay: buildSimpleDuration(next) });
  };

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
          <Clock className={cn('h-4 w-4', COLORS.text)} />
        </div>
        <span className={cn('font-semibold text-sm', COLORS.text)}>
          {data.alias || t('nodes:types.delay')}
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

      <div className={cn('text-xs', COLORS.text)}>
        {simpleDuration ? (
          <div
            className="nodrag flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="number"
              min={0}
              value={simpleDuration.amount}
              onChange={(e) => {
                const amount = Number(e.target.value);
                setSimpleDuration({
                  amount: Number.isNaN(amount) ? 0 : amount,
                  unit: simpleDuration.unit,
                });
              }}
              className={cn(
                'h-6 w-12 rounded border bg-background px-1.5 text-xs',
                COLORS.text
              )}
            />
            <div className="flex overflow-hidden rounded border">
              <button
                type="button"
                onClick={() => setSimpleDuration({ amount: simpleDuration.amount, unit: 'seconds' })}
                className={cn(
                  'px-1.5 py-0.5 font-medium',
                  simpleDuration.unit === 'seconds'
                    ? cn(COLORS.chip, COLORS.text)
                    : 'text-muted-foreground'
                )}
              >
                {t('nodes:durationField.short.seconds')}
              </button>
              <button
                type="button"
                onClick={() => setSimpleDuration({ amount: simpleDuration.amount, unit: 'minutes' })}
                className={cn(
                  'px-1.5 py-0.5 font-medium',
                  simpleDuration.unit === 'minutes'
                    ? cn(COLORS.chip, COLORS.text)
                    : 'text-muted-foreground'
                )}
              >
                {t('nodes:durationField.short.minutes')}
              </button>
            </div>
          </div>
        ) : (
          <div className="font-mono">{delayDisplay}</div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className={cn('w-3! h-3!', COLORS.handle)} />
    </div>
  );
});
