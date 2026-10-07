import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Rocket } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass, NODE_COLORS } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import type { StartNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { NodeStatusBadge } from './NodeStatusBadge';
import { StepCard } from './StepCard';

const COLORS = NODE_COLORS.start;

interface StartNodeProps extends NodeProps {
  data: StartNodeData;
}

/**
 * The "Start" card — the entry point of a callable
 * script-mode flow (no trigger nodes). Metadata-only: contributes no HA
 * action step of its own, same treatment as a trigger node. Its `fields`
 * (if any) compile to the HA script's `fields:` block.
 */
export const StartNode = memo(function StartNode({ id, data, selected }: StartNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const fieldCount = data.fields ? Object.keys(data.fields).length : 0;

  return (
    <StepCard
      tone="start"
      icon={Rocket}
      iconKey="start"
      sentence={data.alias || t('nodes:types.start')}
      stepNumber={stepNumber}
      selected={selected}
      isActive={isActive}
      isDisabled={isDisabled}
      hasErrors={hasErrors}
      traceClass={getTraceStateClass(traceState)}
      edge={
        <>
          <NodeStatusBadge
            errorMessages={errorMessages}
            warningMessages={warningMessages}
            isDisabled={isDisabled}
          />
          <Handle
            type="source"
            position={Position.Right}
            className={cn('w-3! h-3!', COLORS.handle)}
          />
        </>
      }
    >
      {fieldCount > 0
        ? t('nodes:startFields.fieldCount', { count: fieldCount })
        : t('nodes:startFields.noFields')}
    </StepCard>
  );
});
