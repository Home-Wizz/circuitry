import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { useDarkMode } from '@/hooks/useDarkMode';
import {
  buildLoopArcPath,
  buildLoopBackCurvePath,
  buildLoopDetourPath,
  buildLoopSelfPath,
  LOOP_SELF_DISTANCE_THRESHOLD,
  WIDE_ARC_MIN_DX,
} from '@/lib/edge-paths';
import { EdgeDragHitPath } from './EdgeDragHitPath';
import { EdgeEndpointDots } from './EdgeEndpointDots';

// Follows HA's theme via --muted-foreground (see lib/ha-theme.ts), no JS color branching needed.
const EDGE_COLOR = 'hsl(var(--muted-foreground))';

/**
 * The dashed line that closes a Repeat While/Until block's body back into
 * its condition (see block-factories.ts). Right-click (Copy/Cut/Paste/
 * Delete) is handled centrally by FlowCanvas.tsx's onEdgeContextMenu +
 * CanvasContextMenu.tsx — Delete/Copy/Cut on *this* edge type operate on the
 * entire loop structure, not just the line (see lib/loop-structure.ts).
 * Click-and-hold-drag moves just this line's own two endpoints, same as any
 * other edge — see EdgeDragHitPath's doc comment.
 */
export function LoopBackEdge({ source, target, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const isDarkMode = useDarkMode();

  // Always a smooth curve, never the old rectangular "route around the
  // top" polyline — per explicit user request, matching the reference
  // canvas the user pointed to, which never draws a loop-back as a boxy
  // detour regardless of how far
  // apart the two nodes sit. Which curve depends on which axis the pair is
  // spread across: a condition/body dragged into a column (more vertical
  // than horizontal distance) reads best as buildLoopBackCurvePath's
  // diagonal "S"; a pair left side by side (level or more horizontal than
  // vertical distance) needs buildLoopArcPath's arch instead — a straight-
  // line "S" formula with level endpoints barely lifts off the row at all
  // and visually cuts back through it.
  //
  // When the pair is genuinely level (handle Y within LEVEL_THRESHOLD of
  // each other — the same tolerance DeletableEdge.tsx's backward-edge branch
  // uses, since two different node card heights at the same nominal row can
  // still land a few px apart), skip the arc/curve math and draw a straight
  // line — per explicit user request: nodes sitting side-by-side
  // horizontally should connect with a straight line, not any kind of
  // curve, and only get a curve once the pair is actually moved vertically
  // apart.
  //
  // That straight line only reads as a loop, though, when there's a second,
  // *forward*-direction edge between roughly the same two points drawing the
  // complementary "up and over" arc on top of it — true for Repeat While
  // (block-factories.ts's createRepeatWhileBlock: the entry condition sits
  // physically right of its own body, so the logical forward edge cond->body
  // is itself a backward-in-x edge, and DeletableEdge.tsx's own
  // backward+level branch already routes *that* one through
  // buildLoopDetourPath — this straight line is deliberately the bottom rail
  // underneath it). Repeat Until's loop-back (createRepeatUntilBlock) has no
  // such partner: its forward edge (body->cond) runs left-to-right through
  // both nodes' plain default handles, so it's a normal forward S-curve, not
  // a detour — meaning if *this* edge is also backward+level (cond's
  // 'false' handle, further right than cond itself, back to body's default
  // left handle) and just draws a straight line, there's no arc anywhere and
  // the pair reads as two flat lines instead of a loop. So: only a level
  // *forward* loop-back (source left of target, as in Repeat While) draws
  // literally straight; a level *backward* one (as in Repeat Until) routes
  // through the same up-and-over detour DeletableEdge.tsx uses, so the loop
  // shape is complete on its own.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const LEVEL_THRESHOLD = 24;
  const isLevel = Math.abs(dy) < LEVEL_THRESHOLD;
  const isBackward = targetX < sourceX;
  // Only a genuinely wide, deliberate horizontal drag earns the dome — see
  // WIDE_ARC_MIN_DX's doc comment for why comparing raw dx against dy here
  // misreads a plainly vertical pair as wide the moment handle-side geometry
  // (not layout intent) pushes dx past dy.
  const isWideEnoughForArc = Math.abs(dx) >= WIDE_ARC_MIN_DX;
  // Takes priority over every case above — a pair whose node cards sit
  // nearly on top of each other (e.g. a Repeat block's condition dragged, or
  // auto-laid-out on import, to almost the same spot as its body) makes the
  // level/S-curve/arc formulas above degenerate into a squashed pinch rather
  // than a readable loop, since they all pull their control points as a
  // fraction of dx/dy — see buildLoopSelfPath's doc comment.
  const isCompactPair = Math.hypot(dx, dy) < LOOP_SELF_DISTANCE_THRESHOLD;

  const edgePath = isCompactPair
    ? buildLoopSelfPath(sourceX, sourceY, targetX, targetY)
    : isLevel
      ? isBackward
        ? buildLoopDetourPath(sourceX, sourceY, targetX, targetY)
        : `M ${sourceX},${sourceY} L ${targetX},${targetY}`
      : isWideEnoughForArc
        ? buildLoopArcPath(sourceX, sourceY, targetX, targetY)
        : buildLoopBackCurvePath(sourceX, sourceY, targetX, targetY);

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: EDGE_COLOR,
          strokeWidth: 2,
          strokeDasharray: '6 4',
        }}
        markerEnd={`url(#loop-back-arrow-${isDarkMode ? 'dark' : 'light'})`}
      />
      <EdgeDragHitPath path={edgePath} sourceId={source} targetId={target} />
      <EdgeEndpointDots sourceX={sourceX} sourceY={sourceY} targetX={targetX} targetY={targetY} color={EDGE_COLOR} />
    </>
  );
}

export function LoopBackEdgeMarkers({ isDarkMode }: { isDarkMode: boolean }) {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
      <defs>
        <marker
          id={`loop-back-arrow-${isDarkMode ? 'dark' : 'light'}`}
          markerWidth="10"
          markerHeight="10"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L6,3 z" fill={EDGE_COLOR} />
        </marker>
      </defs>
    </svg>
  );
}
