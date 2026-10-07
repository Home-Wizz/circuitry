import type { NodeProps } from '@xyflow/react';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass, NODE_COLORS } from '@/lib/node-colors';
import { buildSimpleDuration, parseSimpleDuration } from '@/lib/simpleDuration';
import { cn } from '@/lib/utils';
import type { DelayNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { DelayFields } from '@/components/panels/node-fields/DelayFields';
import { EditPill, PILL_TEXT } from './EditPill';
import { durationUnits, formatDuration } from './formatDuration';
import { StepFrame } from './StepCard';

const COLORS = NODE_COLORS.delay;

interface DelayNodeProps extends NodeProps {
  data: DelayNodeData;
}

export const DelayNode = memo(function DelayNode({ id, data, selected }: DelayNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  // Format delay for display (reuse shared util)
  const delayDisplay = formatDuration(data.delay, durationUnits(t));

  // Inline Sec/Min editing directly on the canvas card, matching a
  // reference flow editor's own delay card — only offered when the
  // current value cleanly reduces to a single amount+unit (see parseSimpleDuration's doc comment).
  // Every other delay (hours, minutes and seconds together, a template)
  // is a pill opening the property panel's own fields; for a simple one,
  // a selected card's "+ more" opens them (StepSettingsPill).
  const simpleDuration = parseSimpleDuration(data.delay);
  const fullEditor = () => (
    <DelayFields
      node={{ id, type: 'delay', position: { x: 0, y: 0 }, data }}
      onChange={(key, value) => updateNodeData(id, { [key]: value })}
    />
  );

  const setSimpleDuration = (next: { amount: number; unit: 'seconds' | 'minutes' }) => {
    updateNodeData(id, { delay: buildSimpleDuration(next) });
  };

  return (
    <StepFrame
      nodeId={id}
      tone="delay"
      icon={Clock}
      iconKey="delay"
      lead={t('nodes:picker.kinds.then')}
      sentence={data.alias || t('nodes:cardWords.delay')}
      stepNumber={stepNumber}
      selected={selected ?? false}
      isActive={isActive}
      isDisabled={isDisabled}
      hasErrors={hasErrors}
      errorMessages={errorMessages}
      warningMessages={warningMessages}
      traceClass={getTraceStateClass(traceState)}
      roleLabel={null}
      hasSourceHandle
    >
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
            className={cn('h-6 w-12 rounded border bg-background px-1.5 text-xs', COLORS.text)}
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
        <EditPill
          tone="delay"
          testId="delay-pill"
          ariaLabel={t('nodes:pill.editFor')}
          contentClassName="w-80"
          editor={fullEditor}
        >
          <span className={PILL_TEXT}>{delayDisplay}</span>
        </EditPill>
      )}
    </StepFrame>
  );
});
