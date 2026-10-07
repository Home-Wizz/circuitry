import type { JoinNode } from '@circuitry/shared';
import { useIncomingPathCount } from '@/hooks/useIncomingPathCount';
import { JoinModeChoice } from './JoinModeChoice';

interface JoinFieldsProps {
  node: JoinNode;
  onChange: (key: string, value: unknown) => void;
}

/**
 * Join ("All") node field component: the same choice as the card's pill
 * (JoinModeChoice). Only 'all' is selectable today; 'any' stays disabled
 * rather than silently behaving like 'all' (see docs/flow-parity-design.md
 * §3).
 */
export function JoinFields({ node, onChange }: JoinFieldsProps) {
  const pathCount = useIncomingPathCount(node.id);
  return (
    <JoinModeChoice
      mode={node.data.mode ?? 'all'}
      pathCount={pathCount}
      onChange={(mode) => onChange('mode', mode)}
    />
  );
}
