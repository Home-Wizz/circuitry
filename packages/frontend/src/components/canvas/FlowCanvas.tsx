import type { Edge, Node, OnBeforeDelete, OnConnectEnd } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  Controls,
  type EdgeTypes,
  MarkerType,
  MiniMap,
  type NodeTypes,
  type OnSelectionChangeParams,
  Panel,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { Eye, EyeOff } from 'lucide-react';
import { type DragEvent, type MouseEvent as ReactMouseEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CanvasContextMenu, type ContextMenuTarget } from '@/components/canvas/CanvasContextMenu';
import { type CanvasExtent, CanvasScrollbars } from '@/components/canvas/CanvasScrollbars';
import { QuickAddMenu, type QuickAddPosition } from '@/components/canvas/QuickAddMenu';
import {
  ChooseChainEdge,
  ChooseDefaultEdge,
  DeletableEdge,
  HintEdge,
  LoopBackEdge,
} from '@/components/edges';
import {
  ActionNode,
  ConditionNode,
  DelayNode,
  JoinNode,
  SequenceEndNode,
  SequenceStartNode,
  SetVariablesNode,
  StartNode,
  TriggerNode,
  WaitNode,
} from '@/components/nodes';
import type { NodeTypeConfig } from '@/components/panels/NodePalette';
import { NodeToolbar } from '@/components/toolbar/NodeToolbar';
import { Button } from '@/components/ui/button';
import { useDarkMode } from '@/hooks/useDarkMode';
import { type CompoundBlockKey, createCompoundBlock } from '@/lib/block-factories';
import { buildQuickAddConnections, type QuickAddDirection } from '@/lib/quick-add';
import { cn, generateNodeId } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { isMacOS } from '@/utils/useAgentPlatform';

interface QuickAddState {
  screenPosition: QuickAddPosition;
  flowPosition: { x: number; y: number };
  fromNodeId: string;
  fromHandleId: string | null;
  direction: QuickAddDirection;
}

// New node types should be added here as needed!
const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
  delay: DelayNode,
  wait: WaitNode,
  set_variables: SetVariablesNode,
  start: StartNode,
  join: JoinNode,
  sequence_start: SequenceStartNode,
  sequence_end: SequenceEndNode,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
  hint: HintEdge,
  'choose-chain': ChooseChainEdge,
  'choose-default': ChooseDefaultEdge,
  'loop-back': LoopBackEdge,
};

export function FlowCanvas() {
  const { t } = useTranslation(['common', 'debug']);
  const isDarkMode = useDarkMode();
  const {
    flowId,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
    notifyNodeDoubleClicked,
    addNode,
    addCompound,
    setNodes,
    selectedNodeId,
    isSimulating,
    executionPath,
    isShowingTrace,
    traceExecutionPath,
    canDeleteEdge,
  } = useFlowStore();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getNodesBounds } = useReactFlow();
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTarget | null>(null);
  const closeContextMenu = useCallback(() => setContextMenuTarget(null), []);
  // Minimap visibility toggle — per user request, collapsible since it's
  // permanent screen real estate that's only useful once a flow has enough
  // nodes to need an overview. Defaults closed per explicit user request.
  const [minimapOpen, setMinimapOpen] = useState(false);

  // Right-click menu (Copy/Cut/Paste/Delete) — see CanvasContextMenu.tsx. A
  // right-click on a node that isn't already part of a multi-selection
  // collapses selection to just that node first (matching what a plain
  // left-click does), so the menu's Copy/Cut/Delete act on what was
  // actually clicked rather than a stale earlier selection; right-clicking
  // a node that's already selected leaves an existing multi-selection
  // intact for bulk actions.
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault();
      if (!node.selected) {
        setNodes(nodes.map((n) => ({ ...n, selected: n.id === node.id })));
        // Keep selectedNodeId (drives edge highlighting + the property
        // panel) in sync — setNodes alone updates each node's own
        // `.selected` flag but doesn't go through onSelectionChange below.
        selectNode(node.id);
      }
      setContextMenuTarget({
        kind: 'node',
        screenX: event.clientX,
        screenY: event.clientY,
        nodeId: node.id,
      });
    },
    [nodes, setNodes, selectNode]
  );

  // xyflow's dedicated double-click event — separate from both a single
  // click and a click-and-drag reposition (onSelectionChange below fires for
  // those, since dragging a node also selects it). App.tsx watches
  // notifyNodeDoubleClicked's counter to toggle the properties panel
  // open/closed: double-click opens it, a repeat double-click closes it —
  // per explicit user request. A plain single click no longer opens the
  // panel by itself; an earlier single-click-opens behavior also fired on
  // every drag-to-reposition, which was reported as unwanted.
  const onNodeDoubleClick = useCallback(() => {
    notifyNodeDoubleClicked();
  }, [notifyNodeDoubleClicked]);

  const onEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    setContextMenuTarget({ kind: 'edge', screenX: event.clientX, screenY: event.clientY, edge });
  }, []);

  const onPaneContextMenu = useCallback((event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenuTarget({ kind: 'pane', screenX: event.clientX, screenY: event.clientY });
  }, []);

  // Bounds panning to where the flow's own nodes actually are, instead of
  // xyflow's default infinite pan — per user request ("the UI allows for
  // endless scrolling — the scrolling should be limited to where there
  // is stuff on the canvas"). `CONTENT_MARGIN` keeps a comfortable buffer
  // around the content rather than clamping right at the last node's edge;
  // `DEFAULT_EXTENT` covers the brand-new/empty-flow case where there are no
  // nodes to measure yet. Shared with <CanvasScrollbars> below so the
  // scrollbar thumbs and the actual pan limit always agree on where "the
  // edge" is — see that component's doc comment.
  // Left/top pan boundary, frozen per tab instead of tracking live node
  // bounds — see the hard-stop comment on `contentExtent` below for why.
  // Reset whenever the active tab changes (`flowId`); allowed to grow
  // further out (never shrink) when the node *count* changes, so importing/
  // pasting/undo-redoing content that's genuinely further out than the
  // current wall doesn't strand it unreachable — but a plain drag (which
  // changes positions, not the count) never moves the wall.
  const leftTopWallRef = useRef<{
    flowId: string;
    nodeCount: number;
    minX: number;
    minY: number;
  } | null>(null);

  const contentExtent = useMemo((): CanvasExtent => {
    const CONTENT_MARGIN = 400;
    const DEFAULT_EXTENT: CanvasExtent = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    if (nodes.length === 0) return DEFAULT_EXTENT;
    const bounds = getNodesBounds(nodes);
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || bounds.width === 0) {
      return DEFAULT_EXTENT;
    }

    const liveMinX = bounds.x - CONTENT_MARGIN;
    const liveMinY = bounds.y - CONTENT_MARGIN;
    const prevWall = leftTopWallRef.current;
    // `&&`-narrowed (rather than through a derived boolean) so TS can prove
    // `prevWall` is non-null in the branches that read its fields below.
    const wall: { flowId: string; nodeCount: number; minX: number; minY: number } =
      prevWall && prevWall.flowId === flowId
        ? prevWall.nodeCount === nodes.length
          ? prevWall
          : {
              flowId,
              nodeCount: nodes.length,
              minX: Math.min(prevWall.minX, liveMinX),
              minY: Math.min(prevWall.minY, liveMinY),
            }
        : { flowId, nodeCount: nodes.length, minX: liveMinX, minY: liveMinY };
    leftTopWallRef.current = wall;

    return {
      // Hard stop: minX/minY come from `wall`, which only ever moves when
      // the flow's node *count* changes (a node/block was actually added
      // somewhere further out), never from merely dragging or auto-panning
      // toward the edge while dragging — previously both were recomputed
      // from live node bounds on every render, so dragging a node further
      // left kept pushing the wall out just ahead of the drag and it never
      // actually stopped ("I am allowed to infinitely move nodes to the
      // left expanding the canvas", reported directly). maxX/maxY are
      // intentionally still live, so the canvas keeps growing to fit new or
      // moved content to the right/below — flows read left-to-right, and
      // expansion should only happen rightward, never leftward, per that
      // same report.
      minX: wall.minX,
      minY: wall.minY,
      maxX: bounds.x + bounds.width + CONTENT_MARGIN,
      maxY: bounds.y + bounds.height + CONTENT_MARGIN,
    };
  }, [nodes, getNodesBounds, flowId]);

  const translateExtent = useMemo(
    (): [[number, number], [number, number]] => [
      [contentExtent.minX, contentExtent.minY],
      [contentExtent.maxX, contentExtent.maxY],
    ],
    [contentExtent]
  );

  // Initial framing is handled entirely by the `fitView`/`fitViewOptions`
  // props on <ReactFlow> below — it fits the viewport to whatever nodes
  // actually exist. There used to also be a `setViewport` effect here
  // forcing a fixed {x:0, y:0, zoom:0.75} on every mount, which ran *after*
  // fitView and stomped its result — pinning the camera to the canvas
  // origin regardless of where the flow's nodes actually were. That's why
  // nodes far from the origin (which is any flow that isn't brand new,
  // since node positions accumulate as you build) rendered off-screen,
  // requiring a manual zoom/pan to find them.

  // Dropping a dragged connection on empty canvas offers a quick-add menu
  // instead of just discarding it — see QuickAddMenu.tsx.
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      // A real (or attempted, near-a-handle) connection was involved —
      // xyflow already handled it, nothing for us to do.
      if (connectionState.toNode || !connectionState.fromHandle || !connectionState.fromNode) {
        return;
      }
      // Released outside the canvas entirely (e.g. over the node palette).
      const targetEl = event.target as Element | null;
      if (!targetEl?.closest?.('.react-flow__pane')) return;

      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point) return;

      const flowPosition = screenToFlowPosition({ x: point.clientX, y: point.clientY });

      setQuickAdd({
        screenPosition: { screenX: point.clientX, screenY: point.clientY },
        flowPosition,
        fromNodeId: connectionState.fromHandle.nodeId,
        fromHandleId: connectionState.fromHandle.id ?? null,
        direction: connectionState.fromHandle.type === 'source' ? 'forward' : 'backward',
      });
    },
    [screenToFlowPosition]
  );

  const closeQuickAdd = useCallback(() => setQuickAdd(null), []);

  const handleQuickAddSimple = useCallback(
    (config: NodeTypeConfig) => {
      if (!quickAdd) return;
      const nodeWidth = 180;
      const nodeHeight = 80;
      const newNode = {
        id: generateNodeId(config.type),
        type: config.type,
        position: {
          x: quickAdd.flowPosition.x - nodeWidth / 2,
          y: quickAdd.flowPosition.y - nodeHeight / 2,
        },
        data: { ...config.defaultData },
      };
      addNode(newNode);
      for (const connection of buildQuickAddConnections(
        quickAdd.direction,
        quickAdd.fromNodeId,
        quickAdd.fromHandleId,
        [newNode.id]
      )) {
        onConnect(connection);
      }
      setQuickAdd(null);
    },
    [quickAdd, addNode, onConnect]
  );

  const handleQuickAddCompound = useCallback(
    (key: CompoundBlockKey) => {
      if (!quickAdd) return;
      const block = createCompoundBlock(key, quickAdd.flowPosition.x, quickAdd.flowPosition.y);
      addCompound(block.nodes, block.edges);
      for (const connection of buildQuickAddConnections(
        quickAdd.direction,
        quickAdd.fromNodeId,
        quickAdd.fromHandleId,
        block.entryNodeIds
      )) {
        onConnect(connection);
      }
      setQuickAdd(null);
    },
    [quickAdd, addCompound, onConnect]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 1) {
        selectNode(selectedNodes[0].id);
      } else {
        selectNode(null);
      }
    },
    [selectNode]
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Prevent deletion of edges that would leave a condition node with no outgoing connections
  const onBeforeDelete = useCallback<OnBeforeDelete>(
    async ({ nodes: nodesToDelete, edges: edgesToDelete }) => {
      const allowedEdges = edgesToDelete.filter((edge) => canDeleteEdge(edge.id));
      return { nodes: nodesToDelete, edges: allowedEdges };
    },
    [canDeleteEdge]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const dropPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Handle compound blocks (choose, if_else, repeat_while, etc.)
      const compoundData = event.dataTransfer.getData('application/reactflow-compound');
      if (compoundData) {
        try {
          const { key } = JSON.parse(compoundData) as { key: CompoundBlockKey };
          const block = createCompoundBlock(key, dropPosition.x, dropPosition.y);
          addCompound(block.nodes, block.edges);
        } catch (err) {
          console.error('Failed to parse dropped compound block data:', err);
        }
        return;
      }

      // Handle simple nodes
      const data = event.dataTransfer.getData('application/reactflow');
      if (!data) return;

      try {
        const { type, defaultData } = JSON.parse(data);

        // Center the node at the cursor position by offsetting by half node dimensions
        const nodeWidth = 180; // Approximate node width
        const nodeHeight = 80; // Approximate node height

        const position = {
          x: dropPosition.x - nodeWidth / 2,
          y: dropPosition.y - nodeHeight / 2,
        };

        const newNode = {
          id: generateNodeId(type),
          type,
          position,
          data: { ...defaultData },
        };

        addNode(newNode);
      } catch (err) {
        console.error('Failed to parse dropped node data:', err);
      }
    },
    [screenToFlowPosition, addNode, addCompound]
  );

  // Style edges based on simulation state, trace state, and selected node
  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      // Check if this edge is part of the execution path during simulation
      const sourceIdx = executionPath.indexOf(edge.source);
      const targetIdx = executionPath.indexOf(edge.target);

      const isActiveInSimulation =
        isSimulating &&
        executionPath.length >= 2 &&
        sourceIdx !== -1 &&
        targetIdx !== -1 &&
        targetIdx === sourceIdx + 1;

      // Check if this edge is part of the trace execution path
      const traceSourceIdx = traceExecutionPath.indexOf(edge.source);
      const traceTargetIdx = traceExecutionPath.indexOf(edge.target);

      const isActiveInTrace =
        isShowingTrace &&
        traceExecutionPath.length >= 2 &&
        traceSourceIdx !== -1 &&
        traceTargetIdx !== -1 &&
        traceTargetIdx === traceSourceIdx + 1;

      // Check if this edge is connected to the selected node
      const isConnectedToSelected =
        selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);

      // Invisible semantic flow edges — trigger→case1 in trigger-based choose blocks.
      // Topology/serializer needs them; hint edges already show the visual connection.
      if (edge.type === 'choose-entry') {
        return {
          ...edge,
          style: { opacity: 0, pointerEvents: 'none' as const },
          markerEnd: undefined,
        };
      }

      // choose-chain — invisible, topology only (fan-out hint edges replace it visually)
      if (edge.type === 'choose-chain') {
        return {
          ...edge,
          style: { opacity: 0, pointerEvents: 'none' as const },
          markerEnd: undefined,
        };
      }

      // choose-default — subtle dashed "Sonst/Otherwise" edge, rendered by ChooseDefaultEdge
      if (edge.type === 'choose-default') {
        return {
          ...edge,
          style: {},
          markerEnd: undefined,
        };
      }

      // Visual-only hint edges (trigger routing)
      if (edge.type === 'hint') {
        return {
          ...edge,
          style: { strokeWidth: 2, stroke: isDarkMode ? '#94a3b8' : '#64748b' },
          markerEnd: { type: MarkerType.ArrowClosed, color: isDarkMode ? '#94a3b8' : '#64748b' },
        };
      }

      // Loop-back edges — dashed style, handled by LoopBackEdge component
      if (edge.type === 'loop-back') {
        return { ...edge };
      }

      // Determine edge styling based on state (priority: simulation > trace > selection)
      let edgeStyle = { strokeWidth: 2, stroke: isDarkMode ? '#94a3b8' : '#64748b' };
      let markerEnd = { type: MarkerType.ArrowClosed, color: isDarkMode ? '#94a3b8' : '#64748b' };

      if (isActiveInSimulation) {
        // Simulation takes precedence - green for active path
        edgeStyle = { stroke: '#22c55e', strokeWidth: 3 };
        markerEnd = { type: MarkerType.ArrowClosed, color: '#22c55e' };
      } else if (isActiveInTrace) {
        // Trace visualization - orange for trace path
        edgeStyle = { stroke: '#f59e0b', strokeWidth: 3 };
        markerEnd = { type: MarkerType.ArrowClosed, color: '#f59e0b' };
      } else if (isConnectedToSelected) {
        // Blue highlighting for connected edges
        edgeStyle = { stroke: '#3b82f6', strokeWidth: 3 };
        markerEnd = { type: MarkerType.ArrowClosed, color: '#3b82f6' };
      }

      return {
        ...edge,
        type: 'deletable',
        animated: isActiveInSimulation || isActiveInTrace,
        style: edgeStyle,
        markerEnd,
      };
    });
  }, [
    edges,
    isSimulating,
    executionPath,
    isShowingTrace,
    traceExecutionPath,
    selectedNodeId,
    isDarkMode,
  ]);

  return (
    <div className="relative h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        colorMode={isDarkMode ? 'dark' : 'light'}
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onBeforeDelete={onBeforeDelete}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
        panOnScroll={isMacOS()}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'deletable',
          style: { strokeWidth: 2, stroke: isDarkMode ? '#94a3b8' : '#64748b' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDarkMode ? '#94a3b8' : '#64748b',
          },
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.75 }}
        maxZoom={2}
        minZoom={0.3}
        translateExtent={translateExtent}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={null}
        className={cn('canvas-modern-bg', isDarkMode ? 'dark' : undefined)}
        proOptions={{ hideAttribution: true }}
      >
        {/* Two-tier grid (fine dots + a coarser line grid every 6th cell),
            the same layering technique tldraw/Figma-style canvases use for a
            grid that reads as "structured" up close and "textured" zoomed
            out, rather than one flat repeating dot pattern — per user
            request to modernize the canvas background. A radial vignette
            (canvas-modern-bg, index.css) sits underneath both so the canvas
            reads as a soft-lit surface instead of a flat fill. */}
        <Background
          id="canvas-bg-lines"
          variant={BackgroundVariant.Lines}
          gap={120}
          lineWidth={1}
          color={isDarkMode ? 'rgba(148, 163, 184, 0.12)' : 'rgba(100, 116, 139, 0.10)'}
        />
        <Background
          id="canvas-bg-dots"
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.4}
          color={isDarkMode ? 'rgba(148, 163, 184, 0.55)' : 'rgba(100, 116, 139, 0.4)'}
        />
        {/* The floating "+Add" toolbar that used to live here (CanvasAddMenu)
            was removed per explicit user request — it was always a second,
            redundant way to reach the same When/And/Then dialogs the
            sidebar's own Trigger/Condition/Action buttons already open (see
            NodePalette.tsx). Its former spot at the top of the sidebar now
            hosts the Open Automation button instead. */}
        <Controls />
        {/* Collapsible per user request — the minimap is only really useful
            once a flow has enough nodes to need an overview, but it always
            took up the same corner of screen space. The toggle button lives
            in the same corner (stacks above the minimap itself when open,
            via ReactFlow's own Panel stacking for a shared position) so it's
            still discoverable when collapsed. */}
        <Panel position="bottom-right" className="!m-0">
          <Button
            variant="outline"
            size="icon"
            className="mb-2 h-8 w-8 bg-background/90"
            onClick={() => setMinimapOpen((open) => !open)}
            title={minimapOpen ? t('buttons.hideMinimap') : t('buttons.showMinimap')}
          >
            {minimapOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </Panel>
        {minimapOpen && (
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            // ReactFlow's MiniMap defaults to its own fixed light-gray
            // background/mask regardless of app theme (no CSS var or
            // Tailwind class hook — it's plain inline SVG attributes), so
            // without this it stayed a flat white/light box even in dark
            // mode. `--card` mirrors the same theme sync as the rest of the
            // chrome (see useHaThemeSync.ts) so this follows suit too.
            bgColor="hsl(var(--card))"
            maskColor={isDarkMode ? 'rgba(0, 0, 0, 0.6)' : 'rgba(240, 240, 240, 0.6)'}
            nodeClassName={(node) => {
              switch (node.type) {
                case 'trigger':
                  return 'fill-amber-50 stroke-amber-400';
                case 'condition':
                  return 'fill-blue-50 stroke-blue-400';
                case 'action':
                  return 'fill-green-50 stroke-green-400';
                case 'delay':
                  return 'fill-purple-50 stroke-purple-400';
                case 'wait':
                  return 'fill-orange-50 stroke-orange-400';
                case 'set_variables':
                  return 'fill-cyan-50 stroke-cyan-400';
                case 'start':
                  return 'fill-emerald-50 stroke-emerald-500';
                case 'join':
                case 'sequence_start':
                case 'sequence_end':
                  return 'fill-indigo-50 stroke-indigo-400';
                default:
                  return 'fill-slate-100 stroke-slate-400';
              }
            }}
          />
        )}

        <NodeToolbar />

        {isSimulating && (
          <Panel
            position="top-left"
            className="rounded-lg border border-green-300 bg-green-100 px-4 py-2 dark:border-green-700 dark:bg-green-950"
          >
            <div className="flex items-center gap-2 font-medium text-green-800 text-sm dark:text-green-200">
              <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              {t('debug:simulation.simulatingExecution')}
            </div>
          </Panel>
        )}

        {isShowingTrace && !isSimulating && (
          <Panel
            position="top-left"
            className="rounded-lg border border-orange-300 bg-orange-100 px-4 py-2 dark:border-orange-700 dark:bg-orange-950"
          >
            <div className="flex items-center gap-2 font-medium text-orange-800 text-sm dark:text-orange-200">
              <div className="h-2 w-2 rounded-full bg-orange-500" />
              {t('debug:simulation.showingTraceExecution', { steps: traceExecutionPath.length })}
            </div>
          </Panel>
        )}
      </ReactFlow>

      <CanvasScrollbars wrapperRef={reactFlowWrapper} extent={contentExtent} />

      <CanvasContextMenu target={contextMenuTarget} onClose={closeContextMenu} />

      <QuickAddMenu
        position={quickAdd?.screenPosition ?? null}
        direction={quickAdd?.direction ?? 'forward'}
        onSelectSimple={handleQuickAddSimple}
        onSelectCompound={handleQuickAddCompound}
        onClose={closeQuickAdd}
      />
    </div>
  );
}
