import { useReactFlow } from '@xyflow/react';
import type React from 'react';
import { useCallback, useRef } from 'react';
import { useFlowStore } from '@/store/flow-store';

/** Below this many screen px of movement, a mousedown-then-up on a line is treated as a plain click (selection), not a drag — so a slightly-shaky click doesn't nudge nodes by a couple pixels. */
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  startClientX: number;
  startClientY: number;
  sourceStart: { x: number; y: number };
  targetStart: { x: number; y: number };
  dragging: boolean;
}

/**
 * Click-and-hold on a connecting line to drag its two endpoint nodes
 * together, as a pair — per the user's explicit request ("click and hold
 * should allow us to drag/move that entire element around", scoped to just
 * the two connected nodes, not the whole compound block). Returns an
 * `onMouseDown` handler to attach to an edge's invisible hit-path.
 *
 * Shared by DeletableEdge.tsx and LoopBackEdge.tsx rather than each
 * implementing its own pointer tracking, per CLAUDE.md's DRY rule — every
 * edge type gets the same drag feel.
 *
 * Reads/writes node positions through the zustand store's own `moveNodes`
 * (not xyflow's imperative `useReactFlow().setNodes`), since `<ReactFlow
 * nodes={...}>` is controlled from that store in FlowCanvas.tsx — writing
 * through the internal xyflow store directly would be immediately
 * overwritten by the next render's controlled `nodes` prop. `useReactFlow()`
 * is only used here for `screenToFlowPosition`, a pure read-only coordinate
 * conversion.
 */
export function useEdgeGroupDrag(sourceId: string, targetId: string) {
  const { screenToFlowPosition } = useReactFlow();
  const moveNodes = useFlowStore((s) => s.moveNodes);
  const setUnsavedChanges = useFlowStore((s) => s.setUnsavedChanges);
  const dragRef = useRef<DragState | null>(null);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return; // left button (or primary touch-emulated) only

      const { nodes } = useFlowStore.getState();
      const sourceNode = nodes.find((n) => n.id === sourceId);
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!sourceNode || !targetNode) return;

      event.stopPropagation();

      dragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        sourceStart: { ...sourceNode.position },
        targetStart: { ...targetNode.position },
        dragging: false,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const state = dragRef.current;
        if (!state) return;

        const dxClient = moveEvent.clientX - state.startClientX;
        const dyClient = moveEvent.clientY - state.startClientY;
        if (!state.dragging && Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD_PX) return;
        state.dragging = true;

        // Project both the start and current point through the same
        // screen->flow conversion (rather than dividing the client delta by
        // zoom) so panning mid-drag can't skew the result.
        const flowStart = screenToFlowPosition({ x: state.startClientX, y: state.startClientY });
        const flowNow = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const dx = flowNow.x - flowStart.x;
        const dy = flowNow.y - flowStart.y;

        moveNodes([
          { id: sourceId, position: { x: state.sourceStart.x + dx, y: state.sourceStart.y + dy } },
          { id: targetId, position: { x: state.targetStart.x + dx, y: state.targetStart.y + dy } },
        ]);
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (dragRef.current?.dragging) setUnsavedChanges(true);
        dragRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [sourceId, targetId, screenToFlowPosition, moveNodes, setUnsavedChanges]
  );

  return onMouseDown;
}
