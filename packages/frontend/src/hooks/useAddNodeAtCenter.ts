import { type Node, useReactFlow, useStoreApi } from '@xyflow/react';
import { useCallback } from 'react';
import type { CompoundBlockKey } from '@/lib/block-factories';
import { createCompoundBlock } from '@/lib/block-factories';
import { generateNodeId } from '@/lib/utils';
import { type FlowNodeData, useFlowStore } from '@/store/flow-store';

/** Steps nothing can lead into. */
const NO_WAY_IN: ReadonlySet<string> = new Set(['trigger', 'start']);
const GAP_X = 80;
const STEP_Y = 120;
/** A card before it's measured: StepCard is at least 200 px wide. */
const CARD = { width: 200, height: 80 };

/** A card's size: measured once drawn, else the smallest a card is (bug
 * #252: every card was taken as 180 wide, so one beside a wider card
 * landed on it). */
const sizeOf = (n: Node<FlowNodeData>): { width: number; height: number } => ({
  width: n.measured?.width ?? n.width ?? CARD.width,
  height: n.measured?.height ?? n.height ?? CARD.height,
});

/** The first spot at or below `at` where something of `size` (a card, or a
 * whole block) covers no card: moved down until it's free, which it is
 * past the lowest card (it gave up after 20 tries and covered one). */
function freeSpot(
  at: { x: number; y: number },
  nodes: Node<FlowNodeData>[],
  except?: string,
  size: { width: number; height: number } = CARD
): { x: number; y: number } {
  const others = nodes.filter((n) => n.id !== except).map((n) => ({ ...n.position, ...sizeOf(n) }));
  const taken = (y: number) =>
    others.some(
      (n) =>
        n.x < at.x + size.width &&
        n.x + n.width > at.x &&
        n.y < y + size.height &&
        n.y + n.height > y
    );
  const lowest = Math.max(at.y, ...others.map((n) => n.y + n.height));
  let y = at.y;
  while (taken(y) && y <= lowest) y += STEP_Y;
  return { x: at.x, y };
}

/** Where a card's right edge is, measured or not. */
const rightOf = (n: Node<FlowNodeData>): number => n.position.x + sizeOf(n).width;

/** Just to the right of a card, moved down past any card already there. */
function besideOf(from: Node<FlowNodeData>, nodes: Node<FlowNodeData>[]): { x: number; y: number } {
  return freeSpot({ x: rightOf(from) + GAP_X, y: from.position.y }, nodes, from.id);
}

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
  const { screenToFlowPosition, getViewport, setCenter } = useReactFlow();
  const flowStore = useStoreApi();

  // The card a new step joins after: exactly one selected, not a condition
  // (yes or no would be a guess), and nothing after it yet (a second way
  // out would split the path). Anything else: the step is added on its own.
  const joinAfter = useCallback((): Node<FlowNodeData> | undefined => {
    const selected = nodes.filter((n) => n.selected);
    const from = selected.length === 1 ? selected[0] : undefined;
    if (!from || from.type === 'condition') return undefined;
    if (edges.some((e) => e.source === from.id)) return undefined;
    return from;
  }, [nodes, edges]);

  const getViewportCenterFlowPosition = useCallback((): { x: number; y: number } => {
    // The canvas's own element, as the canvas library keeps it: inside HA
    // the editor is in a shadow root, which document.querySelector can't
    // see into, so the card landed in the middle of the window (bug #210).
    const paneEl = flowStore.getState().domNode;
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
  }, [screenToFlowPosition, getViewport, flowStore]);

  // A step placed beside the card it follows can land past the edge of the
  // view: the view then moves to it, at the same zoom.
  const bringIntoView = useCallback(
    (at: { x: number; y: number }) => {
      const paneEl = flowStore.getState().domNode;
      if (!paneEl) return;
      const rect = paneEl.getBoundingClientRect();
      const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top });
      const bottomRight = screenToFlowPosition({ x: rect.right, y: rect.bottom });
      const inside =
        at.x >= topLeft.x &&
        at.y >= topLeft.y &&
        at.x + CARD.width <= bottomRight.x &&
        at.y + CARD.height <= bottomRight.y;
      if (!inside) {
        setCenter(at.x + CARD.width / 2, at.y + CARD.height / 2, {
          zoom: getViewport().zoom,
          duration: 300,
        });
      }
    },
    [flowStore, screenToFlowPosition, setCenter, getViewport]
  );

  const addNodeAtCenter = useCallback(
    (type: string, defaultData: Record<string, unknown>): string => {
      const id = generateNodeId(type);
      // Joined after the single selected card, as a block is, and placed
      // just to its right (bug #227: a plain card landed in the middle of
      // the view, unjoined, 40 px lower each time). A trigger has no way in.
      const from = NO_WAY_IN.has(type) ? undefined : joinAfter();
      if (from) {
        const at = besideOf(from, nodes);
        addNode({ id, type, position: at, data: { ...defaultData } });
        onConnect({ source: from.id, sourceHandle: null, target: id, targetHandle: null });
        bringIntoView(at);
        return id;
      }
      const center = getViewportCenterFlowPosition();
      const stagger = (nodes.length % 6) * 40;
      // Not on top of a card already there (two triggers added in a row
      // landed 40 px apart, one covering the other).
      const at = freeSpot({ x: center.x - 90 + stagger, y: center.y - 40 + stagger }, nodes);
      addNode({ id, type, position: at, data: { ...defaultData } });
      return id;
    },
    [addNode, onConnect, nodes, joinAfter, getViewportCenterFlowPosition, bringIntoView]
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
      const block = createCompoundBlock(key, 0, 0);
      const from = joinAfter();
      const xs = block.nodes.map((n) => n.position.x);
      const ys = block.nodes.map((n) => n.position.y);
      const blockMinX = Math.min(...xs);
      const blockMaxX = Math.max(...xs) + CARD.width;
      const blockMinY = Math.min(...ys);
      const blockMaxY = Math.max(...ys) + CARD.height;
      // Joined: the block's first step just to the right of the card it
      // follows, as a plain card is (bug #227); otherwise centred in view.
      // Either way moved down until the whole block covers no card.
      const entry = block.nodes.find((n) => n.id === block.entryNodeIds[0]);
      const wanted =
        from && entry
          ? {
              x: rightOf(from) + GAP_X - (entry.position.x - blockMinX),
              y: from.position.y - (entry.position.y - blockMinY),
            }
          : {
              x: center.x - (blockMaxX - blockMinX) / 2 + stagger,
              y: center.y - (blockMaxY - blockMinY) / 2 + stagger,
            };
      const topLeft = freeSpot(wanted, nodes, from?.id, {
        width: blockMaxX - blockMinX,
        height: blockMaxY - blockMinY,
      });
      const offsetX = topLeft.x - blockMinX;
      const offsetY = topLeft.y - blockMinY;
      for (const node of block.nodes) {
        node.position = { x: node.position.x + offsetX, y: node.position.y + offsetY };
      }
      addCompound(block.nodes, block.edges);
      if (from && entry) bringIntoView({ x: entry.position.x, y: entry.position.y });

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
      if (from) {
        for (const entryNodeId of block.entryNodeIds) {
          onConnect({
            source: from.id,
            sourceHandle: null,
            target: entryNodeId,
            targetHandle: null,
          });
        }
      }

      return block;
    },
    [addCompound, onConnect, nodes, joinAfter, getViewportCenterFlowPosition, bringIntoView]
  );

  return { addNodeAtCenter, addCompoundAtCenter };
}
