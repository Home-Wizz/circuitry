import type { FlowNode } from '@circuitry/shared';
import { NODE_COMPONENTS } from '@/components/nodes/nodeComponents';
import { StepCardPreview } from '@/components/nodes/StepCard';

/**
 * The selected step's own card, as the canvas shows it, at the top of the
 * side panel: the same sentence and pills (still editable), without handles
 * or badges.
 */
export function StepPreview({ node }: { node: FlowNode }) {
  const Card = node.type ? NODE_COMPONENTS[node.type] : undefined;
  if (!Card || !node.type) return null;
  return (
    <div data-testid="step-preview">
      <StepCardPreview.Provider value>
        <Card
          id={node.id}
          type={node.type}
          data={node.data}
          selected={false}
          dragging={false}
          draggable={false}
          selectable={false}
          deletable={false}
          isConnectable={false}
          zIndex={0}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </StepCardPreview.Provider>
    </div>
  );
}
