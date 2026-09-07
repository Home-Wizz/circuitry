import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import {
  buildForwardCurvePath,
  buildLoopArcPath,
  buildLoopBackCurvePath,
  buildLoopDetourPath,
  getForwardCurveCenter,
  getLoopArcCenter,
  getLoopBackCurveCenter,
  getLoopDetourCenter,
  WIDE_ARC_MIN_DX,
} from '@/lib/edge-paths';
import { useFlowStore } from '@/store/flow-store';
import { EdgeDragHitPath } from './EdgeDragHitPath';
import { EdgeEndpointDots } from './EdgeEndpointDots';

/**
 * Custom edge component that shows a delete button when selected. Uses
 * buildForwardCurvePath (lib/edge-paths.ts) for a pronounced "S" curve
 * rather than xyflow's own flatter default bezier. Right-click (Copy/Cut/
 * Paste/Delete) is handled centrally by FlowCanvas.tsx's onEdgeContextMenu +
 * CanvasContextMenu.tsx; click-and-hold-drag is handled here via
 * EdgeDragHitPath (see its own doc comment).
 */
export function DeletableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const removeEdge = useFlowStore((state) => state.removeEdge);
  const canDeleteEdge = useFlowStore((state) => state.canDeleteEdge);

  // Detect backward edges (target is to the left of source)
  const isBackwardEdge = targetX < sourceX;

  // Initialize edge path and label position variables
  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isBackwardEdge) {
    // A plain sequential edge whose target just happens to sit left of its
    // source (e.g. repeat_while/until's cond->body "true" edge —
    // block-factories.ts deliberately positions the entry condition to the
    // right of its own loop body for the S-loop layout). Sitting level on
    // the same row, this pair also has a LoopBackEdge dashed line closing
    // the loop the other direction between the very same two handles — a
    // straight line here would land exactly on top of it and the two
    // become indistinguishable, so the level case routes up and over
    // instead (buildLoopDetourPath) rather than drawing straight through.
    // `LEVEL_THRESHOLD` absorbs the few px of handle-Y jitter that comes
    // from source/target being different node types with slightly
    // different rendered heights (a condition vs. an action card), without
    // it reading as a real vertical offset.
    const LEVEL_THRESHOLD = 24;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    if (Math.abs(dy) < LEVEL_THRESHOLD) {
      edgePath = buildLoopDetourPath(sourceX, sourceY, targetX, targetY);
      [labelX, labelY] = getLoopDetourCenter(sourceX, sourceY, targetX, targetY);
    } else if (Math.abs(dx) < WIDE_ARC_MIN_DX) {
      // Same "S" LoopBackEdge.tsx uses for a condition/body dragged into a
      // column. Only a genuinely wide, deliberate horizontal drag (dx past
      // WIDE_ARC_MIN_DX) earns the arc below — see that constant's doc
      // comment for why raw dx isn't trustworthy on its own here
      // (source/target handles sit on opposite sides, so any
      // vertically-stacked pair carries a large dx from handle geometry
      // alone, not because the layout is actually wide).
      edgePath = buildLoopBackCurvePath(sourceX, sourceY, targetX, targetY);
      [labelX, labelY] = getLoopBackCurveCenter(sourceX, sourceY, targetX, targetY);
    } else {
      // Wide but with real vertical offset — LoopBackEdge.tsx's arch, not
      // the old boxy detour.
      edgePath = buildLoopArcPath(sourceX, sourceY, targetX, targetY);
      [labelX, labelY] = getLoopArcCenter(sourceX, sourceY, targetX, targetY);
    }
  } else {
    // Pronounced "S" curve for forward edges — see buildForwardCurvePath's
    // doc comment for why this isn't just xyflow's own getBezierPath.
    edgePath = buildForwardCurvePath(sourceX, sourceY, targetX, targetY);
    [labelX, labelY] = getForwardCurveCenter(sourceX, sourceY, targetX, targetY);
  }

  const canDelete = canDeleteEdge(id);

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!canDelete) return;
    // Go through the store, not React Flow's own imperative setEdges — this
    // component renders inside a fully-controlled <ReactFlow edges={...}>
    // (FlowCanvas.tsx), so the store's `edges` array is the real source of
    // truth. Calling the instance API only mutated React Flow's transient
    // internal state; the store's edges (what actually gets saved/
    // transpiled) never changed, and the next unrelated re-render (e.g.
    // clicking another node, which recomputes styledEdges from the
    // untouched store state) would silently resurrect the "deleted" edge.
    removeEdge(id);
  };

  // Compute selected style - primary-color highlight when selected
  const selectedStyle = selected
    ? {
        ...style,
        stroke: 'hsl(var(--primary))',
        strokeWidth: 3,
      }
    : (style ?? {});

  // For backward edges, we'll use the same style but add an arrow marker
  const finalStyle = selectedStyle;

  // Ensure we have a valid stroke color for the arrow
  const arrowStrokeColor =
    finalStyle &&
    typeof finalStyle === 'object' &&
    'stroke' in finalStyle &&
    typeof finalStyle.stroke === 'string'
      ? finalStyle.stroke
      : 'hsl(var(--muted-foreground))';

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={finalStyle} markerEnd={markerEnd} />

      <EdgeDragHitPath path={edgePath} sourceId={source} targetId={target} />

      <EdgeEndpointDots
        sourceX={sourceX}
        sourceY={sourceY}
        targetX={targetX}
        targetY={targetY}
        color={arrowStrokeColor}
      />

      {selected && canDelete && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <button
              onClick={handleDelete}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2"
              title="Delete connection"
              aria-label="Delete connection"
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
