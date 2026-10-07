import { Handle, type NodeProps, Position } from '@xyflow/react';
import { ListOrdered } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { compoundTypes } from '@/config/nodeTypeCatalog';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass, NODE_COLORS } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import type { SequenceStartNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { NodeStatusBadge } from './NodeStatusBadge';
import { StepCard } from './StepCard';

// Structural marker, same visual family as the Join ("All") node — neither
// contributes a service call of its own, both exist to make a graph shape
// explicit rather than implicit.
const COLORS = NODE_COLORS.join;

interface SequenceStartNodeProps extends NodeProps {
  data: SequenceStartNodeData;
}

/**
 * Opening marker of a "Grouping actions" block — see block-factories.ts's
 * createSequenceBlock and shared/schemas/nodes.ts's SequenceStartNodeSchema
 * doc comment. Everything chained after this node up to its matching
 * SequenceEndNode transpiles to one named `sequence:` action step. A frame
 * (`_frame`, from an imported named choose or parallel block) shows NAME:
 * its alias is that block's own.
 */
export const SequenceStartNode = memo(function SequenceStartNode({
  id,
  data,
  selected,
}: SequenceStartNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;
  // Single source of truth for compound-block icons — see nodeTypeCatalog.ts.
  const BlockIcon = compoundTypes.find((c) => c.key === 'sequence')?.icon ?? ListOrdered;

  return (
    <StepCard
      tone="join"
      icon={BlockIcon}
      iconKey="sequence"
      kind={t(data._frame ? 'nodes:sequenceFields.framePill' : 'nodes:sequenceFields.startPill')}
      sentence={data.alias || t('nodes:types.sequence_start')}
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
            type="target"
            position={Position.Left}
            className={cn('w-3! h-3!', COLORS.handle)}
          />
          <Handle
            type="source"
            position={Position.Right}
            className={cn('w-3! h-3!', COLORS.handle)}
          />
        </>
      }
    />
  );
});
