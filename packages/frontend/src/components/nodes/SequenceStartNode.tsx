import { Handle, type NodeProps, Position } from '@xyflow/react';
import { AlertCircle, Ban, ListOrdered } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { compoundTypes } from '@/config/nodeTypeCatalog';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import type { SequenceStartNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

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
 * SequenceEndNode transpiles to one named `sequence:` action step.
 */
export const SequenceStartNode = memo(function SequenceStartNode({
  id,
  data,
  selected,
}: SequenceStartNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;
  // Single source of truth for compound-block icons — see nodeTypeCatalog.ts.
  const BlockIcon = compoundTypes.find((c) => c.key === 'sequence')?.icon ?? ListOrdered;

  return (
    <div
      style={selected ? SELECTED_NODE_STYLE : undefined}
      className={cn(
        'relative min-w-[160px] rounded-lg border-2 px-4 py-3',
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

      <div className="flex items-center gap-2">
        <div className={cn('rounded p-1', COLORS.chip)}>
          <BlockIcon className={cn('h-4 w-4', COLORS.text)} />
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-bold text-[10px] tracking-wide',
            COLORS.badge
          )}
        >
          {t('nodes:sequenceFields.startPill')}
        </span>
        <span className={cn('font-semibold text-sm', COLORS.text)}>
          {data.alias || t('nodes:types.sequence_start')}
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

      <Handle type="source" position={Position.Right} className={cn('w-3! h-3!', COLORS.handle)} />
    </div>
  );
});
