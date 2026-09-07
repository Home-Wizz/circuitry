import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import type { CompoundBlockKey } from '@/lib/block-factories';
import { createCompoundBlock } from '@/lib/block-factories';
import { generateNodeId } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

/**
 * Places a new node/compound block at the current viewport's center (with a
 * small stagger so repeated adds don't stack exactly on top of each other),
 * instead of a fixed flow coordinate that would land off-screen once the
 * user pans/zooms away from the origin.
 *
 * Extracted from NodePalette.tsx's click-to-add handlers into its own hook so
 * every other place a node/compound block gets dropped onto the canvas
 * (ThenActionDialog.tsx, useAddNodeDialogs.tsx) shares the same
 * viewport-center math and stagger logic instead of re-deriving it.
 */
export function useAddNodeAtCenter() {
  const addNode = useFlowStore((s) => s.addNode);
  const addCompound = useFlowStore((s) => s.addCompound);
  const onConnect = useFlowStore((s) => s.onConnect);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  const getViewportCenterFlowPosition = useCallback((): { x: number; y: number } => {
    const paneEl = document.querySelector('.react-flow__pane');
    if (paneEl) {
      const rect = paneEl.getBoundingClientRect();
      return screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
    // Fallback if the pane isn't in the DOM yet for some reason.
    const { x, y, zoom } = getViewport();
    return {
      x: (window.innerWidth / 2 - x) / zoom,
      y: (window.innerHeight / 2 - y) / zoom,
    };
  }, [screenToFlowPosition, getViewport]);

  const addNodeAtCenter = useCallback(
    (type: string, defaultData: Record<string, unknown>): string => {
      const center = getViewportCenterFlowPosition();
      const stagger = (nodes.length % 6) * 40;
      const id = generateNodeId(type);
      addNode({
        id,
        type,
        position: { x: center.x - 90 + stagger, y: center.y - 40 + stagger },
        data: { ...defaultData },
      });
      return id;
    },
    [addNode, nodes.length, getViewportCenterFlowPosition]
  );

  const addCompoundAtCenter = useCallback(
    (key: CompoundBlockKey) => {
      const center = getViewportCenterFlowPosition();
      const stagger = (nodes.length % 6) * 40;
      // Build at the origin first so the block's actual footprint can be
      // measured — compound blocks (If/Else, Repeat, Sequence, ...) spread
      // their branch/exit nodes well to the right of their first node (see
      // block-factories.ts's `baseX + 260`/`+ 300` offsets), so anchoring
      // just that first node at the viewport center left the rest of a wide
      // block hanging off the right edge of the visible canvas (reported
      // directly: new nodes should "appear within the viewing canvas...
      // not... to the right edge"). Centering the block's whole bounding
      // box instead fixes that regardless of how wide a given block type
      // is, without hardcoding per-type widths here.
      const NODE_WIDTH = 180;
      const NODE_HEIGHT = 80;
      const block = createCompoundBlock(key, 0, 0);
      const xs = block.nodes.map((n) => n.position.x);
      const ys = block.nodes.map((n) => n.position.y);
      const blockMinX = Math.min(...xs);
      const blockMaxX = Math.max(...xs) + NODE_WIDTH;
      const blockMinY = Math.min(...ys);
      const blockMaxY = Math.max(...ys) + NODE_HEIGHT;
      const offsetX = center.x - (blockMinX + blockMaxX) / 2 + stagger;
      const offsetY = center.y - (blockMinY + blockMaxY) / 2 + stagger;
      for (const node of block.nodes) {
        node.position = { x: node.position.x + offsetX, y: node.position.y + offsetY };
      }
      addCompound(block.nodes, block.edges);

      // Auto-wire from the single selected node, mirroring what the canvas
      // "+" quick-add does via block.entryNodeIds (FlowCanvas.tsx's
      // handleQuickAddCompound) — this sidebar path used to always drop the
      // block fully disconnected, which is what let a user accidentally
      // recreate a broken multi-target-trigger topology by hand (dragging a
      // second edge from the trigger onto Case 2 directly, since nothing
      // guided them to connect only to the block's entry point). Only wired
      // up when exactly one node is selected *and* that node has no existing
      // outgoing edge yet — auto-wiring from a condition node would require
      // guessing true vs false, and auto-wiring from a node that already has
      // an output would create the exact diverging-path corruption this is
      // meant to prevent. Ambiguous cases are left blank, same as before.
      const selectedNodes = nodes.filter((n) => n.selected);
      const fromNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
      const fromNodeHasOutgoingEdge = fromNode
        ? edges.some((e) => e.source === fromNode.id)
        : false;
      if (fromNode && fromNode.type !== 'condition' && !fromNodeHasOutgoingEdge) {
        for (const entryNodeId of block.entryNodeIds) {
          onConnect({
            source: fromNode.id,
            sourceHandle: null,
            target: entryNodeId,
            targetHandle: null,
          });
        }
      }

      return block;
    },
    [addCompound, onConnect, nodes, edges, getViewportCenterFlowPosition]
  );

  return { addNodeAtCenter, addCompoundAtCenter };
}
