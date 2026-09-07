import { useEdgeGroupDrag } from '@/hooks/useEdgeGroupDrag';

export interface EdgeDragHitPathProps {
  /** Same `d` the edge's own visible <BaseEdge> path uses — this traces an invisible, wider copy of it purely to catch the drag gesture. */
  path: string;
  sourceId: string;
  targetId: string;
}

/**
 * Invisible, wide (24px) copy of an edge's path whose only job is to catch
 * the click-and-hold-to-drag gesture (see hooks/useEdgeGroupDrag.ts) — a
 * plain SVG `<path>` has almost no hit area on its own, and `<BaseEdge>`'s
 * own built-in interaction path isn't exposed for attaching extra handlers
 * to. Rendered as a sibling of `<BaseEdge>` (same pattern as
 * EdgeEndpointDots), used by both DeletableEdge.tsx and LoopBackEdge.tsx —
 * per CLAUDE.md's DRY rule, every edge type gets the same drag feel from one
 * implementation.
 *
 * Left un-styled beyond `cursor: grab` — it never blocks the normal
 * click-to-select interaction (a plain click, i.e. mousedown+mouseup with no
 * real movement, is a no-op here; see useEdgeGroupDrag's DRAG_THRESHOLD_PX),
 * so the existing select-then-delete-via-toolbar flow keeps working
 * untouched.
 */
export function EdgeDragHitPath({ path, sourceId, targetId }: EdgeDragHitPathProps) {
  const onMouseDown = useEdgeGroupDrag(sourceId, targetId);

  return (
    <path
      d={path}
      fill="none"
      stroke="transparent"
      strokeWidth={24}
      style={{ cursor: 'grab', pointerEvents: 'stroke' }}
      onMouseDown={onMouseDown}
    />
  );
}
