import { BaseEdge, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { EdgeDragHitPath } from './EdgeDragHitPath';
import { EdgeEndpointDots } from './EdgeEndpointDots';

// Follows HA's theme via --muted-foreground (see lib/ha-theme.ts), matching
// LoopBackEdge.tsx/ChooseDefaultEdge.tsx's identical structural-edge color.
const EDGE_COLOR = 'hsl(var(--muted-foreground))';

/**
 * The line from one choose-block case's "false" output to the next case
 * (see block-factories.ts's createChooseBlock) — this is the transpiler's
 * real fall-through link, so it always exists in the data the moment a Case
 * 2+ card is on the canvas at all.
 *
 * Used to render fully invisible (`strokeWidth: 0, opacity: 0`) on the
 * theory that a separate "hint" edge from the block's entry node would show
 * the fan-out instead. That hint edge is only ever produced by
 * YamlParser.ts's import-reconstruction path, though — nothing in the
 * interactive canvas (block-factories.ts, FlowCanvas.tsx's quick-add,
 * flow-store.ts's onConnect) ever creates one. So for every Choose block
 * built or repaired by hand, this was the ONLY possible visual sign that
 * Case 2 belonged to Case 1's chain — and it was invisible. That's what
 * made Case 2 look permanently disconnected, and made a repair drag from
 * Case 1's false handle onto Case 2 appear to silently do nothing (the edge
 * already existed, so xyflow just no-oped the duplicate). Now drawn dashed
 * and muted, same visual language as LoopBackEdge's loop-closing line.
 */
export function ChooseChainEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{ stroke: EDGE_COLOR, strokeWidth: 2, strokeDasharray: '4 4' }}
      />
      <EdgeDragHitPath path={edgePath} sourceId={source} targetId={target} />
      <EdgeEndpointDots sourceX={sourceX} sourceY={sourceY} targetX={targetX} targetY={targetY} color={EDGE_COLOR} />
    </>
  );
}
