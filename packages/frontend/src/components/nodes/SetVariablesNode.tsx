import type { NodeProps } from '@xyflow/react';
import { Variable } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass } from '@/lib/node-colors';
import type { SetVariablesNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { StepFrame } from './StepCard';

interface SetVariablesNodeProps extends NodeProps {
  data: SetVariablesNodeData;
}

export const SetVariablesNode = memo(function SetVariablesNode({
  id,
  data,
  selected,
}: SetVariablesNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const variableCount = Object.keys(data.variables || {}).length;

  return (
    <StepFrame
      nodeId={id}
      tone="variables"
      icon={Variable}
      iconKey="set_variables"
      lead={t('nodes:picker.kinds.then')}
      sentence={data.alias || t('nodes:cardWords.setVariables')}
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
      <div className="font-medium opacity-75">
        {t('nodes:variables.variableCount', { count: variableCount })}
      </div>
    </StepFrame>
  );
});
