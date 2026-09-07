import { Handle, type NodeProps, Position } from '@xyflow/react';
import { AlertCircle, Ban } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { nodeTypes } from '@/config/nodeTypeCatalog';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass, NODE_COLORS, NODE_STATE_CLASSES, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import type { JoinNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

const COLORS = NODE_COLORS.join;

interface JoinNodeProps extends NodeProps {
  data: JoinNodeData;
}

/**
 * The "All" join card — an explicit, visible convergence point
 * for parallel branches, rendered as a compact pill (an "ALL"/"ANY"
 * block look) rather than relying on implicit graph-shape
 * inference. Metadata-only under the hood: HA's native `parallel:` action
 * (already emitted by the existing convergence-detection codegen) already
 * *is* All-join semantics, so this node contributes no YAML step of its own.
 */
export const JoinNode = memo(function JoinNode({ id, data, selected }: JoinNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;
  const mode = data.mode ?? 'all';
  // Looked up from the shared catalog rather than a second hardcoded icon
  // reference, so this card and the Add Node panel/sidebar never drift.
  const JoinIcon = nodeTypes.find((n) => n.type === 'join')?.icon ?? Ban;

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

      <div className="flex items-center gap-2">
        <div className={cn('rounded p-1', COLORS.chip)}>
          <JoinIcon className={cn('h-4 w-4', COLORS.text)} />
        </div>
        {/* Explicit "ALL" pill, not just an inferred graph shape */}
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-bold text-[10px] tracking-wide',
            COLORS.badge
          )}
        >
          {mode === 'all' ? t('nodes:joinFields.modeAll') : t('nodes:joinFields.modeAny')}
        </span>
        <span className={cn('font-semibold text-sm', COLORS.text)}>
          {data.alias || t('nodes:types.join')}
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
