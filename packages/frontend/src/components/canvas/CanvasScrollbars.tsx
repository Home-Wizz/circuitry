import { useReactFlow, useViewport } from '@xyflow/react';
import { type RefObject, useEffect, useRef, useState } from 'react';

/** Bounding box (in flow coordinates) the canvas's panning is allowed to
 * reach — see FlowCanvas.tsx's `contentExtent`, computed from the actual
 * node positions plus a margin, and shared between the `translateExtent`
 * prop that bounds panning and this component's scrollbar math so the two
 * always agree on where "the edge" is. */
export interface CanvasExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface CanvasScrollbarsProps {
  wrapperRef: RefObject<HTMLDivElement | null>;
  extent: CanvasExtent;
}

const SCROLLBAR_SIZE = 10;
const MIN_THUMB_SIZE = 32;

interface DragState {
  axis: 'x' | 'y';
  startClient: number;
  startViewport: number;
}

/**
 * Custom scrollbars for the canvas, per user request ("the UI allows for
 * endless scrolling — the scrolling should be limited... we should also
 * have scroll bars"). xyflow has no built-in scrollbar UI — panning is just
 * free-form drag with no visual indicator of where you are relative to the
 * flow's content — so this is a thin screen-space overlay, positioned as a
 * sibling of `<ReactFlow>` (not a child, so it isn't subject to the canvas's
 * own pan/zoom transform), driven by `useViewport()`'s reactive x/y/zoom.
 *
 * Deliberately not a real `overflow: scroll` element: there's nothing to
 * scroll in the DOM sense (the canvas is one giant SVG/transform, not a
 * tall/wide document), so the track/thumb geometry is computed by hand from
 * the viewport transform and the shared `extent`, and dragging the thumb
 * calls `setViewport` directly rather than relying on native scroll events.
 */
export function CanvasScrollbars({ wrapperRef, extent }: CanvasScrollbarsProps) {
  const { x, y, zoom } = useViewport();
  const { setViewport } = useReactFlow();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragState = useRef<DragState | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [wrapperRef]);

  if (size.width === 0 || size.height === 0) return null;

  // The flow-space rectangle currently visible in the viewport, derived from
  // the pan/zoom transform: screenX = flowX * zoom + viewport.x.
  const visibleMinX = -x / zoom;
  const visibleMaxX = (size.width - x) / zoom;
  const visibleMinY = -y / zoom;
  const visibleMaxY = (size.height - y) / zoom;

  // Extend the scrollable range to include the current visible window so the
  // thumb never clips even when zoomed out past the content's own bounds.
  const totalMinX = Math.min(extent.minX, visibleMinX);
  const totalMaxX = Math.max(extent.maxX, visibleMaxX);
  const totalMinY = Math.min(extent.minY, visibleMinY);
  const totalMaxY = Math.max(extent.maxY, visibleMaxY);

  const rangeX = Math.max(totalMaxX - totalMinX, 1);
  const rangeY = Math.max(totalMaxY - totalMinY, 1);

  const trackWidth = Math.max(size.width - SCROLLBAR_SIZE, 0);
  const trackHeight = Math.max(size.height - SCROLLBAR_SIZE, 0);

  const thumbWidth = Math.min(
    trackWidth,
    Math.max(MIN_THUMB_SIZE, ((visibleMaxX - visibleMinX) / rangeX) * trackWidth)
  );
  const thumbHeight = Math.min(
    trackHeight,
    Math.max(MIN_THUMB_SIZE, ((visibleMaxY - visibleMinY) / rangeY) * trackHeight)
  );

  const thumbLeft = Math.min(
    Math.max(trackWidth - thumbWidth, 0),
    Math.max(0, ((visibleMinX - totalMinX) / rangeX) * trackWidth)
  );
  const thumbTop = Math.min(
    Math.max(trackHeight - thumbHeight, 0),
    Math.max(0, ((visibleMinY - totalMinY) / rangeY) * trackHeight)
  );

  const beginDrag = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { axis, startClient: axis === 'x' ? e.clientX : e.clientY, startViewport: axis === 'x' ? x : y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onDrag = (e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const range = drag.axis === 'x' ? rangeX : rangeY;
    const trackSize = drag.axis === 'x' ? trackWidth : trackHeight;
    if (trackSize <= 0) return;
    const clientPos = drag.axis === 'x' ? e.clientX : e.clientY;
    const deltaFlow = ((clientPos - drag.startClient) / trackSize) * range;
    const nextValue = drag.startViewport - deltaFlow * zoom;
    setViewport(drag.axis === 'x' ? { x: nextValue, y, zoom } : { x, y: nextValue, zoom }, { duration: 0 });
  };

  const endDrag = () => {
    dragState.current = null;
  };

  return (
    <>
      <div
        className="nodrag nopan pointer-events-none absolute right-3 bottom-0.5 left-0.5 z-10 rounded-full bg-muted/40"
        style={{ height: SCROLLBAR_SIZE }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: custom scrollbar thumb, mirrors ResizablePanel.tsx's resize handle */}
        <div
          className="pointer-events-auto absolute top-0 h-full cursor-grab rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground/60 active:cursor-grabbing"
          style={{ width: thumbWidth, left: thumbLeft }}
          onPointerDown={beginDrag('x')}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
        />
      </div>
      <div
        className="nodrag nopan pointer-events-none absolute top-0.5 right-0.5 bottom-3 z-10 rounded-full bg-muted/40"
        style={{ width: SCROLLBAR_SIZE }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: custom scrollbar thumb, mirrors ResizablePanel.tsx's resize handle */}
        <div
          className="pointer-events-auto absolute left-0 cursor-grab rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground/60 active:cursor-grabbing"
          style={{ height: thumbHeight, top: thumbTop, width: SCROLLBAR_SIZE }}
          onPointerDown={beginDrag('y')}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
        />
      </div>
    </>
  );
}
