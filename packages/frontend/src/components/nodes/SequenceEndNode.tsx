import { Handle, type NodeProps, Position } from '@xyflow/react';
import { ListOrdered } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { compoundTypes } from '@/config/nodeTypeCatalog';
import { NODE_COLORS } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import { StepCard } from './StepCard';

const COLORS = NODE_COLORS.join;
// Single source of truth for compound-block icons — see nodeTypeCatalog.ts.
const BlockIcon = compoundTypes.find((c) => c.key === 'sequence')?.icon ?? ListOrdered;

/**
 * Closing marker of a "Grouping actions" block — matches a SequenceStartNode
 * placed earlier in the chain (see that component's doc comment). Carries no
 * fields of its own; it exists purely to draw the group's boundary on the
 * canvas, so it has no error/disabled/step-number decoration the way other
 * node cards do — there's nothing on it that can be individually wrong,
 * disabled, or executed as a distinct step. Still shows a selection ring
 * like every other node card, since it remains a selectable/deletable node.
 */
export const SequenceEndNode = memo(function SequenceEndNode({ selected }: NodeProps) {
  const { t } = useTranslation(['nodes']);

  return (
    <StepCard
      tone="join"
      icon={BlockIcon}
      iconKey="sequence"
      sentence={t('nodes:sequenceFields.endPill')}
      selected={selected}
      className="min-w-[140px] border-dashed"
      edge={
        <>
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
