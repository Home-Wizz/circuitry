import { Handle, type NodeProps, Position } from '@xyflow/react';
import { ListOrdered } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { compoundTypes } from '@/config/nodeTypeCatalog';
import { NODE_COLORS, SELECTED_NODE_STYLE } from '@/lib/node-colors';
import { cn } from '@/lib/utils';

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
    <div
      style={selected ? SELECTED_NODE_STYLE : undefined}
      className={cn(
        'relative min-w-[140px] rounded-lg border-2 border-dashed px-4 py-2',
        COLORS.border,
        COLORS.bg,
        'transition-all duration-200'
      )}
    >
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
          {t('nodes:sequenceFields.endPill')}
        </span>
      </div>

      <Handle type="source" position={Position.Right} className={cn('w-3! h-3!', COLORS.handle)} />
    </div>
  );
});
