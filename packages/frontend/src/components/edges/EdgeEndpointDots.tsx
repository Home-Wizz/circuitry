/**
 * Small circular joint dots rendered at an edge's source/target connection
 * points — the finishing touch on the rounded, curvy connector look
 * requested for this canvas (see lib/edge-paths.ts's doc comment for the
 * rounded-detour half of that same request): every edge in the reference
 * screenshot the user attached has a filled dot where the line leaves a
 * card and a matching dot where it
 * arrives at the next one, so a curve reads as a deliberate connection
 * rather than just a stroke floating near two cards.
 *
 * Deliberately its own tiny component (used by every visible edge type —
 * DeletableEdge/LoopBackEdge/HintEdge/ChooseDefaultEdge) rather than copied
 * into each, per CLAUDE.md's DRY rule. Plain SVG `<circle>`s, not an
 * EdgeLabelRenderer overlay — these need to live in the same SVG coordinate
 * space as the edge's own `<path>`, and (unlike the delete button) are never
 * interactive, so no HTML/pointer-event overlay is needed.
 */
export interface EdgeEndpointDotsProps {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  /** Edge's own stroke color — dots always match the line they cap. */
  color: string;
  radius?: number;
}

export function EdgeEndpointDots({
  sourceX,
  sourceY,
  targetX,
  targetY,
  color,
  radius = 4,
}: EdgeEndpointDotsProps) {
  return (
    <g className="pointer-events-none" aria-hidden="true">
      <circle cx={sourceX} cy={sourceY} r={radius} fill={color} />
      <circle
        cx={targetX}
        cy={targetY}
        r={radius}
        fill="var(--background, white)"
        stroke={color}
        strokeWidth={1.75}
      />
    </g>
  );
}
