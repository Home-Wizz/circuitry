import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { buildForwardCurvePath, getForwardCurveCenter } from '@/lib/edge-paths';
import { EdgeEndpointDots } from './EdgeEndpointDots';

// Follows HA's theme via CSS vars (see lib/ha-theme.ts), no JS color branching needed.
const EDGE_COLOR = 'hsl(var(--muted-foreground))';
const LABEL_BG = 'hsl(var(--muted))';
const LABEL_TEXT = 'hsl(var(--muted-foreground))';
const LABEL_BORDER = 'hsl(var(--border))';

/** A Choose card's labelled edge: its "Otherwise" line, or the "None
 * matched" path Circuitry draws when there is none (dashed). */
function ChooseLabelledEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  labelKey,
  dashed,
}: Pick<EdgeProps, 'sourceX' | 'sourceY' | 'targetX' | 'targetY'> & {
  labelKey: 'conditions.defaultLabel' | 'conditions.fallThroughLabel';
  dashed: boolean;
}) {
  const { t } = useTranslation('nodes');

  // Pronounced "S" curve, same helper every other edge type uses now — see
  // lib/edge-paths.ts's doc comment.
  const edgePath = buildForwardCurvePath(sourceX, sourceY, targetX, targetY);
  const [labelX, labelY] = getForwardCurveCenter(sourceX, sourceY, targetX, targetY);

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: EDGE_COLOR,
          strokeWidth: 2,
          ...(dashed ? { strokeDasharray: '7 6' } : {}),
        }}
      />
      <EdgeEndpointDots
        sourceX={sourceX}
        sourceY={sourceY}
        targetX={targetX}
        targetY={targetY}
        color={EDGE_COLOR}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'none',
          }}
          className="nodrag nopan"
        >
          <span
            style={{
              display: 'inline-block',
              padding: '2px 7px',
              fontSize: '11px',
              fontWeight: 500,
              lineHeight: '16px',
              color: LABEL_TEXT,
              background: LABEL_BG,
              border: `1px ${dashed ? 'dashed' : 'solid'} ${LABEL_BORDER}`,
              borderRadius: '10px',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {t(labelKey)}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export function ChooseDefaultEdge(props: EdgeProps) {
  return <ChooseLabelledEdge {...props} labelKey="conditions.defaultLabel" dashed={false} />;
}

/** Where a Choose carries on when none of its options passes and no
 * "Otherwise" line is drawn (decision D1, rule 1): drawn by the canvas from
 * the transpiler's reading, not an edge of the graph (the maintainer,
 * 2026-10-25). */
export function ChooseFallThroughEdge(props: EdgeProps) {
  return <ChooseLabelledEdge {...props} labelKey="conditions.fallThroughLabel" dashed />;
}
