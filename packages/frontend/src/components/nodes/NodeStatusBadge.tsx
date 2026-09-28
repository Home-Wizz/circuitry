import { AlertCircle, AlertTriangle, Ban } from 'lucide-react';
import { NODE_STATE_CLASSES } from '@/lib/node-colors';
import { cn } from '@/lib/utils';

const BADGE =
  'absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full shadow-sm';

interface NodeStatusBadgeProps {
  errorMessages: string[];
  /** Warnings (bug #65): Home Assistant accepts these, so saving goes ahead. */
  warningMessages?: string[];
  isDisabled: boolean;
}

/**
 * The corner badge on a node card, one at a time: an error (it blocks
 * saving), else disabled, else a warning. Every node type shows it the
 * same way; warnings used to show only on condition nodes, and a trigger
 * or step with a blank Home Assistant accepts (the trigger/action audit
 * after bug #65) would otherwise show nothing on the canvas.
 */
export function NodeStatusBadge({
  errorMessages,
  warningMessages = [],
  isDisabled,
}: NodeStatusBadgeProps) {
  if (errorMessages.length > 0) {
    return (
      <div className={cn(BADGE, NODE_STATE_CLASSES.errorBadge)} title={errorMessages.join('\n')}>
        <AlertCircle className="h-3 w-3" />
      </div>
    );
  }
  if (isDisabled) {
    return (
      <div className={cn(BADGE, NODE_STATE_CLASSES.disabledBadge)}>
        <Ban className="h-3 w-3" />
      </div>
    );
  }
  if (warningMessages.length > 0) {
    return (
      <div
        className={cn(BADGE, NODE_STATE_CLASSES.warningBadge)}
        title={warningMessages.join('\n')}
      >
        <AlertTriangle className="h-3 w-3" />
      </div>
    );
  }
  return null;
}
