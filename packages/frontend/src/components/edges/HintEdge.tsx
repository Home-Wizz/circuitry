import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { buildForwardCurvePath } from '@/lib/edge-paths';
import { EdgeEndpointDots } from './EdgeEndpointDots';

/**
 * Visual-only edge indicating which trigger corresponds to which choose-condition.
 * Styled identically to normal flow edges via style/markerEnd passed from FlowCanvas.
 *
 * Uses buildForwardCurvePath (same as DeletableEdge's forward case) rather
 * than smoothstep or xyflow's own getBezierPath — smoothstep's right-angle
 * corners were the one boxy holdout among the canvas's otherwise-curvy
 * edges, and getBezierPath reads as too flat (see lib/edge-paths.ts's doc
 * comment on the curved-connector request); a pronounced "S" curve reads
 * as the same connector family as every other edge type.
 */
export function HintEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  const edgePath = buildForwardCurvePath(sourceX, sourceY, targetX, targetY);

  const color =
    style && typeof style === 'object' && 'stroke' in style && typeof style.stroke === 'string'
      ? style.stroke
      : 'hsl(var(--muted-foreground))';

  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeEndpointDots sourceX={sourceX} sourceY={sourceY} targetX={targetX} targetY={targetY} color={color} />
    </>
  );
}
