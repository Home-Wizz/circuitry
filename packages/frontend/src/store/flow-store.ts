import type {
  FlowEdge,
  FlowGraph,
  FlowMetadata,
  FlowNode,
  HAScriptField,
  NodeValidationError,
} from '@circuitry/shared';
import { validateNodeData } from '@circuitry/shared';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { t as i18t } from 'i18next';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import type { AutomationTrace } from '@/lib/ha-api';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { computeSourceHash, saveGraph } from '@/lib/graph-storage';
import { logger } from '@/lib/logger';
import { generateUUID } from '@/lib/utils';
import type { HomeAssistant } from '@/types/hass';
import { circuitryIndexedDBStorage } from '@/utils/indexeddb-storage';

/**
 * Node data types for React Flow
 */

export interface TriggerNodeData {
  alias?: string;
  trigger: string;
  entity_id?: string | string[];
  to?: string;
  from?: string;
  event_type?: string;
  [key: string]: unknown;
}

export interface ConditionNodeData {
  alias?: string;
  condition: string;
  entity_id?: string | string[];
  state?: string;
  template?: string;

  // Numeric state conditions
  above?: number;
  below?: number;

  // Time conditions
  after?: string;
  before?: string;
  weekday?: string | string[];

  // Zone conditions
  zone?: string;

  // Sun conditions
  after_offset?: string;
  before_offset?: string;

  // Device conditions
  device_id?: string;
  domain?: string;
  type?: string;
  subtype?: string;

  // Template conditions
  value_template?: string;

  // Generic conditions
  attribute?: string;
  for?: string | { hours?: number; minutes?: number; seconds?: number };

  // Nested conditions for and/or/not group types
  conditions?: ConditionNodeData[];

  // Purpose-specific conditions (HA 2025.12+ era, e.g. `condition:
  // light.is_on`) — see lib/conditionRecipes.ts's doc comment. Same
  // entity/device/area target shape ActionNodeData's `target` already uses.
  target?: {
    entity_id?: string | string[];
    area_id?: string | string[];
    device_id?: string | string[];
  };
  options?: Record<string, unknown>;

  [key: string]: unknown;
}

export interface ActionNodeData {
  alias?: string;
  service?: string;
  event?: string;
  event_data?: Record<string, unknown>;
  target?: {
    entity_id?: string | string[];
    area_id?: string | string[];
    device_id?: string | string[];
  };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DelayNodeData {
  alias?: string;
  delay: string | { hours?: number; minutes?: number; seconds?: number };
  [key: string]: unknown;
}

export interface WaitNodeData {
  alias?: string;
  wait_template?: string;
  wait_for_trigger?: TriggerNodeData[];
  timeout?: string;
  continue_on_timeout?: boolean;
  [key: string]: unknown;
}

export interface SetVariablesNodeData {
  alias?: string;
  variables: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A "Start block" — the entry point of a script-mode flow (no
 * trigger nodes). `fields` compiles to the HA script's `fields:` block
 * (typed input parameters other flows/dashboards/voice can pass in).
 */
export interface StartNodeData {
  alias?: string;
  fields?: Record<string, HAScriptField>;
  [key: string]: unknown;
}

/**
 * Explicit "All" join block — a visible convergence point for
 * parallel branches. Only 'all' is exposed today (waits for every incoming
 * branch); 'any' is reserved for a future approximation, see
 * docs/flow-parity-design.md.
 */
export interface JoinNodeData {
  alias?: string;
  mode?: 'all' | 'any';
  [key: string]: unknown;
}

/**
 * "Grouping actions" start marker — see block-factories.ts's
 * createSequenceBlock and native.ts's sequence-pattern detection. Its
 * matching SequenceEndNodeData close marker is found structurally, not via
 * an id reference stored here.
 */
export interface SequenceStartNodeData {
  alias?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/** Matching close marker for SequenceStartNodeData — see its doc comment. */
export interface SequenceEndNodeData {
  [key: string]: unknown;
}

export type FlowNodeData =
  | TriggerNodeData
  | ConditionNodeData
  | ActionNodeData
  | DelayNodeData
  | WaitNodeData
  | SetVariablesNodeData
  | StartNodeData
  | JoinNodeData
  | SequenceStartNodeData
  | SequenceEndNodeData;

/**
 * A snapshot of everything a background (non-active) tab needs to be
 * restored later — see the multi-tab doc comment above `tabOrder` below.
 * Deliberately mirrors the "document" subset of FlowState (not simulation/
 * trace/clipboard/selection, which are always ephemeral per-active-tab UI
 * state, reset fresh on every tab switch the same way they already reset on
 * every fromFlowGraph/reset call today).
 */
export interface FlowTabState {
  flowId: string;
  flowName: string;
  flowDescription: string;
  flowMetadata: FlowMetadata;
  userVariables: Record<string, unknown> | undefined;
  userTriggerVariables: Record<string, unknown> | undefined;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  automationId: string | null;
  hasUnsavedChanges: boolean;
  lastSaved: Date | null;
  originalSnapshot: string | null;
}

/**
 * Flow store state
 */
export interface FlowState {
  // Graph state
  flowId: string;
  flowName: string;
  flowDescription: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];

  // Automation metadata (mode, max, max_exceeded, etc.)
  flowMetadata: FlowMetadata;

  // User-defined root-level variables (preserved across import/export round-trips)
  userVariables: Record<string, unknown> | undefined;

  // User-defined trigger_variables (preserved across import/export round-trips)
  userTriggerVariables: Record<string, unknown> | undefined;

  // Multi-tab state — every field above this point (flowId through
  // userTriggerVariables) always describes the *active* tab, exactly as
  // before multi-tab support existed; every other consumer of this store
  // (38+ files) keeps working unchanged. `tabOrder` is the full left-to-right
  // list of open flowIds, including the active one; `backgroundTabs` holds a
  // full FlowTabState snapshot for every flowId in `tabOrder` *except* the
  // active one (never duplicates the active tab's data, so there's no stale
  // copy to keep in sync on every keystroke — see openInNewTab/switchTab/
  // closeTab below). TabBar.tsx is the only consumer that needs to read
  // these directly; everything else keeps treating the store as one
  // automation.
  tabOrder: string[];
  backgroundTabs: FlowTabState[];

  // Selection state
  selectedNodeId: string | null;

  // Bumped only by a double-click on a node (FlowCanvas.tsx's
  // onNodeDoubleClick, xyflow's own dedicated double-click event — distinct
  // from a single click or a click-and-drag reposition). App.tsx watches
  // this to toggle the properties panel open/closed: double-click opens it,
  // a repeat double-click closes it again — per explicit user request. A
  // single click still updates `selectedNodeId` as normal (so the panel
  // shows the right node's fields once opened) but no longer opens the
  // panel by itself, since an earlier single-click-opens behavior also fired
  // on every click-and-drag reposition, which was reported as unwanted. Not
  // tracked by undo/redo, same as selectedNodeId/nodeEditRequest below —
  // purely ephemeral UI signaling, not flow data.
  nodeDoubleClickSignal: number;

  // Transient "open the miller for this already-placed node" request — see
  // ConditionNode.tsx/ActionNode.tsx's click-to-configure handling for
  // Repeat While/Until's entry condition and Parallel's action branches.
  // Not tracked by undo/redo (see temporalSelector below, which doesn't
  // include it) — same treatment as selectedNodeId, purely ephemeral UI
  // state. Lives in the store (rather than being threaded down as a prop)
  // because ConditionNode/ActionNode are canvas node components with no
  // direct access to useAddNodeDialogs.tsx's imperative open functions,
  // which are only ever instantiated once, in NodePalette.tsx — a sibling,
  // not an ancestor, of the canvas. NodePalette watches this field and
  // dispatches to the right dialog.
  nodeEditRequest: { kind: 'condition' | 'action'; nodeId: string } | null;

  // Save state
  automationId: string | null;
  isSaving: boolean;
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
  originalSnapshot: string | null; // JSON snapshot of original state for comparison

  // Simulation state
  isSimulating: boolean;
  activeNodeId: string | null;
  executionPath: string[];

  // Trace state
  isShowingTrace: boolean;
  traceData: AutomationTrace | null;
  traceExecutionPath: string[];
  traceTimestamps: Record<string, string>;
  /** Node IDs whose trace step raised an exception. */
  traceNodeErrors: Record<string, string>;
  /** Node IDs the graph can reach but the trace never touched (condition blocked, branch not taken, ...). */
  traceSkippedNodeIds: string[];
  /** Trace steps that couldn't be mapped to a node (nested choose/repeat paths) — count only, never blocks rendering. */
  traceUnmappedStepCount: number;

  // Shared simulation/trace state
  simulationSpeed: number;

  // Toolbar state
  clipboard: string | null;
  pasteCount: number;

  // Actions
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange<Node<FlowNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (node: Node<FlowNodeData>) => void;
  addCompound: (nodes: Node<FlowNodeData>[], edges: Edge[]) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  /** Like updateNodeData, but also swaps the node's own `type` (e.g. an If/Else "Then" placeholder's `action` type becoming `delay`/`wait`/... once the user picks a Blocks entry that isn't a plain action) — updateNodeData alone can't do this since `type` lives outside `data` on the node object. `data` is still merged onto the existing data (not replaced), so structural markers like `_blockKey`/`_ifElseBranch`/`_parallelBranch` survive the type change same as updateNodeData already preserves them for a same-type edit. */
  updateNodeTypeAndData: (nodeId: string, type: string, data: Record<string, unknown>) => void;
  removeNode: (nodeId: string) => void;
  /** Bulk remove — e.g. deleting an entire Repeat While/Until loop structure via its loop-back line (see lib/loop-structure.ts). One history entry for the whole batch, unlike calling removeNode in a loop. */
  removeNodes: (nodeIds: string[]) => void;
  /** Single-edge removal, for the right-click context menu's Delete action on a regular (non-structural) connecting line. */
  removeEdge: (edgeId: string) => void;
  /** Batch node position update — powers click-and-hold-drag on a connecting line (see hooks/useEdgeGroupDrag.ts), called on every pointer-move frame during the drag. */
  moveNodes: (updates: Array<{ id: string; position: { x: number; y: number } }>) => void;

  selectNode: (nodeId: string | null) => void;
  /** Bumps nodeDoubleClickSignal — call from a node double-click, see its own doc comment. */
  notifyNodeDoubleClicked: () => void;
  requestNodeEdit: (kind: 'condition' | 'action', nodeId: string) => void;
  clearNodeEditRequest: () => void;

  setFlowName: (name: string) => void;
  setFlowDescription: (description: string) => void;
  setFlowMetadata: (metadata: Partial<FlowMetadata>) => void;
  /**
   * Sets the automation's top-level `variables:` block (flow.userVariables)
   * — distinct from the mid-sequence "Set variables" action node, this is
   * the automation-level block real HA automations commonly declare (values
   * computed once, available to every trigger/condition/action via
   * `{{ variable_name }}`). The transpiler already fully round-trips this
   * (native.ts's `automation.variables = flow.userVariables`,
   * YamlParser.ts's `extractUserVariables`) — only a UI to set it fresh
   * (rather than just preserve it from an imported YAML) was missing.
   */
  setUserVariables: (variables: Record<string, unknown> | undefined) => void;

  setClipboard: (data: string | null) => void;
  setPasteCount: (count: number) => void;

  // Save actions
  setAutomationId: (id: string | null) => void;
  setSaving: (saving: boolean) => void;
  setSaved: () => void;
  setUnsavedChanges: (hasChanges: boolean) => void;
  saveAutomation: (hassApi: HomeAssistant) => Promise<string>;
  updateAutomation: (hassApi: HomeAssistant) => Promise<void>;
  hasRealChanges: () => boolean; // Compare current state to original snapshot

  // Simulation
  startSimulation: () => void;
  stopSimulation: () => void;
  setActiveNode: (nodeId: string | null) => void;
  addToExecutionPath: (nodeId: string) => void;
  clearExecutionPath: () => void;

  // Trace
  showTrace: (traceData: AutomationTrace) => Promise<void>;
  hideTrace: () => void;
  clearTraceExecutionPath: () => void;

  // Shared simulation/trace actions
  setSimulationSpeed: (speed: number) => void;
  getExecutionStepNumber: (nodeId: string) => number | null;

  // Edge validation
  canDeleteEdge: (edgeId: string) => boolean;

  // Import/Export
  toFlowGraph: () => FlowGraph;
  fromFlowGraph: (graph: FlowGraph) => void;
  reset: () => void;

  // Multi-tab actions — see `tabOrder`'s doc comment above.
  /** Backgrounds the current tab and opens a fresh blank "Untitled Automation" as a new active tab, appended to the end of `tabOrder`. Callers that want to *load* an automation into the new tab (rather than leave it blank) call `fromFlowGraph`/`useLoadAutomation` right after — same two-step pattern `reset()` + `fromFlowGraph()` already uses for "current tab". */
  openInNewTab: () => void;
  /** Switches the active tab to `flowId` — backgrounds the current tab (snapshotting its live state into `backgroundTabs`) and restores the target tab's snapshot into the working state. No-ops if `flowId` is already active. Clears undo history, same as loading any other automation. */
  switchTab: (flowId: string) => void;
  /** Closes the tab for `flowId`, discarding its unsaved changes. If it was the active tab, activates a neighboring tab (preferring the one before it); if it was the only open tab, opens a fresh blank tab in its place. */
  closeTab: (flowId: string) => void;

  // Node validation
  nodeErrors: Map<string, NodeValidationError[]>;
  validateNode: (nodeId: string) => void;
  validateAllNodes: () => void;
  clearNodeErrors: (nodeId: string) => void;
  hasValidationErrors: () => boolean;
}

/**
 * Normalize trigger node data to use 'trigger' instead of legacy 'platform' field.
 * This ensures consistency across the codebase.
 */
function normalizeTriggerData(data: Record<string, unknown>): Record<string, unknown> {
  if ('platform' in data && !('trigger' in data)) {
    const { platform, ...rest } = data;
    return { ...rest, trigger: platform };
  }
  return data;
}

/**
 * Normalize node data based on node type.
 * Currently only normalizes trigger nodes.
 */
function normalizeNodeData(type: string, data: Record<string, unknown>): Record<string, unknown> {
  if (type === 'trigger') {
    return normalizeTriggerData(data);
  }
  return data;
}

/**
 * Builds the `originalSnapshot` string — a normalized JSON projection of
 * "everything that counts as real automation content" (name/description/
 * metadata/nodes/edges, deliberately excluding UI-only fields like
 * `selected`/`dragging` on nodes or `hasUnsavedChanges` itself) used by
 * `hasRealChanges()` to answer "does the live graph actually differ from
 * what's on disk/in HA" independent of `hasUnsavedChanges` (which — per
 * onNodesChange/onEdgesChange/setNodes/setEdges above — tracks "has
 * *anything* been touched since the last save," a coarser signal). Shared
 * by `fromFlowGraph` (sets the baseline on load/import) and
 * `saveAutomation`/`updateAutomation` (must refresh the baseline after a
 * successful save — previously only `fromFlowGraph` ever set this field, so
 * `hasRealChanges()` kept comparing against the *pre-edit* snapshot forever
 * after the first save in a tab session, permanently reporting "real
 * changes" even immediately after a successful save).
 */
function buildOriginalSnapshot(state: {
  flowName: string;
  flowDescription: string;
  flowMetadata: FlowMetadata;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}): string {
  return JSON.stringify({
    flowName: state.flowName,
    flowDescription: state.flowDescription,
    flowMetadata: state.flowMetadata,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    edges: state.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  });
}

/**
 * Finds nodes that share the same non-empty `data.id` (the exported HA step
 * `id:` — a separate field from the node's own graph id, see
 * `updateNodeData`). Two steps with the same id would either fail to load in
 * HA or make `trigger.id`/`choose:` routing ambiguous, and this can't be
 * caught by `validateNodeData`'s per-node schema check, which never sees the
 * rest of the graph.
 *
 * A `condition: trigger` node's `id` is deliberately excluded from this
 * scan — its `id` field is a REFERENCE to an existing trigger's id (that's
 * the entire point of `condition: trigger, id: X`: "did the trigger named X
 * fire"), not a new identity of its own. The trigger-id-routing pattern
 * (a WHEN trigger with `id: morning_open`, gated by a Choose case whose
 * condition is `condition: trigger, id: morning_open`) is the intended,
 * documented way to dispatch a Choose block off which trigger fired — but
 * before this fix, this function's blanket same-`data.id`-anywhere check
 * couldn't tell "two real steps accidentally sharing one id" apart from
 * "a condition correctly pointing at the trigger it's testing," and flagged
 * BOTH the trigger node and the referencing condition node as duplicates
 * every single time this pattern was used (reported directly: "Cannot
 * save: 4 node(s) have validation errors" on an automation with two
 * trigger-id-routed Choose cases — 2 trigger/condition id pairs × 2 nodes
 * each).
 */
function findDuplicateIdErrors(nodes: Node<FlowNodeData>[]): Map<string, NodeValidationError> {
  const idToNodeIds = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.type === 'condition' && node.data.condition === 'trigger') continue;
    const id = node.data.id;
    if (typeof id !== 'string' || id.trim() === '') continue;
    idToNodeIds.set(id, [...(idToNodeIds.get(id) ?? []), node.id]);
  }

  const errors = new Map<string, NodeValidationError>();
  for (const [, nodeIds] of idToNodeIds) {
    if (nodeIds.length < 2) continue;
    for (const nodeId of nodeIds) {
      errors.set(nodeId, { path: ['id'], message: 'errors:validation.node.duplicateId' });
    }
  }
  return errors;
}

const defaultFlowMetadata: FlowMetadata = {
  mode: 'single',
  initial_state: true,
};

const initialFlowId = generateUUID();

const initialState = {
  flowId: initialFlowId,
  flowName: 'Untitled Automation',
  flowDescription: '',
  flowMetadata: defaultFlowMetadata,
  userVariables: undefined,
  userTriggerVariables: undefined,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeDoubleClickSignal: 0,
  tabOrder: [initialFlowId] as string[],
  backgroundTabs: [] as FlowTabState[],
  nodeEditRequest: null,
  automationId: null,
  isSaving: false,
  lastSaved: null,
  hasUnsavedChanges: false,
  originalSnapshot: null,
  isSimulating: false,
  activeNodeId: null,
  executionPath: [],
  isShowingTrace: false,
  traceData: null,
  traceExecutionPath: [],
  traceTimestamps: {},
  traceNodeErrors: {},
  traceSkippedNodeIds: [],
  traceUnmappedStepCount: 0,
  simulationSpeed: 800,
  nodeErrors: new Map<string, NodeValidationError[]>(),
  clipboard: null,
  pasteCount: 0,
};

/**
 * Persisted state for the flow store
 * This is duplicated here to avoid circular dependencies
 */
export type PersistedFlowState = Pick<
  FlowState,
  | 'flowId'
  | 'flowName'
  | 'flowDescription'
  | 'flowMetadata'
  | 'nodes'
  | 'edges'
  | 'selectedNodeId'
  | 'automationId'
  | 'lastSaved'
  | 'originalSnapshot'
  | 'tabOrder'
  | 'backgroundTabs'
>;

// Partial state selector for persistence
const persistSelector = (state: FlowState): PersistedFlowState => ({
  flowId: state.flowId,
  flowName: state.flowName,
  flowDescription: state.flowDescription,
  flowMetadata: state.flowMetadata,
  nodes: state.nodes,
  edges: state.edges,
  selectedNodeId: state.selectedNodeId,
  automationId: state.automationId,
  lastSaved: state.lastSaved,
  originalSnapshot: state.originalSnapshot,
  // Background tabs' own nodes/edges/etc. are already frozen snapshots (see
  // FlowTabState's doc comment) — persisting them alongside the active tab's
  // live fields above is what makes reopening the browser tab restore every
  // open automation, not just whichever one was active.
  tabOrder: state.tabOrder,
  backgroundTabs: state.backgroundTabs,
});

/**
 * The subset of FlowState that undo/redo tracks — graph content only.
 * Selection, save/dirty bookkeeping, simulation/trace UI state, clipboard,
 * and derived validation errors are deliberately excluded so they don't
 * generate (or get reverted by) history entries.
 */
export type TemporalFlowState = Pick<
  FlowState,
  | 'nodes'
  | 'edges'
  | 'flowName'
  | 'flowDescription'
  | 'flowMetadata'
  | 'userVariables'
  | 'userTriggerVariables'
>;

const temporalSelector = (state: FlowState): TemporalFlowState => ({
  nodes: state.nodes,
  edges: state.edges,
  flowName: state.flowName,
  flowDescription: state.flowDescription,
  flowMetadata: state.flowMetadata,
  userVariables: state.userVariables,
  userTriggerVariables: state.userTriggerVariables,
});

let pendingHistoryCommit:
  | { timeoutId: ReturnType<typeof setTimeout>; burstStart: TemporalFlowState }
  | undefined;

/**
 * Cancels an in-flight debounced history commit (see `handleSet` below)
 * without flushing it. Called from `reset()`/`fromFlowGraph()` alongside
 * `temporal.getState().clear()` — clearing the past/future arrays alone
 * isn't enough, since a burst that was still debouncing when the graph got
 * replaced would otherwise fire *after* the clear and push a snapshot of the
 * *previous* automation into the *new* one's history.
 */
function cancelPendingHistoryCommit(): void {
  if (pendingHistoryCommit) {
    clearTimeout(pendingHistoryCommit.timeoutId);
    pendingHistoryCommit = undefined;
  }
}

/**
 * Swaps one flowId for another at the same position in `tabOrder` — used
 * whenever the *active* tab's own flowId changes in place (loading a
 * different automation into the current tab, or "New automation" in the
 * current tab), so the tab strip keeps the tab in the same slot instead of
 * it looking like a different tab opened.
 */
function replaceIdInTabOrder(tabOrder: string[], oldId: string, newId: string): string[] {
  return tabOrder.map((id) => (id === oldId ? newId : id));
}

/** Captures the fields multi-tab bookkeeping needs to restore a backgrounded tab later — see FlowTabState's doc comment. */
function snapshotAsTab(state: FlowState): FlowTabState {
  return {
    flowId: state.flowId,
    flowName: state.flowName,
    flowDescription: state.flowDescription,
    flowMetadata: state.flowMetadata,
    userVariables: state.userVariables,
    userTriggerVariables: state.userTriggerVariables,
    nodes: state.nodes,
    edges: state.edges,
    automationId: state.automationId,
    hasUnsavedChanges: state.hasUnsavedChanges,
    lastSaved: state.lastSaved,
    originalSnapshot: state.originalSnapshot,
  };
}

export const useFlowStore = create<FlowState>()(
  persist(
    temporal(
      (set, get) => ({
        ...initialState,

        // hasUnsavedChanges: true on both — every other bulk mutator in this
        // store (onNodesChange/onEdgesChange/removeNode/addNode/...) sets it;
        // these two didn't, so Paste/Duplicate/Align*/Disconnect (all of
        // which go through NodeActionContext's setNodes/setEdges, see
        // clipboardHelpers.ts/Align*Action.ts/DisconnectAction.ts) silently
        // added real unsaved graph changes without the Save button or the
        // tab-strip dirty indicator ever reflecting it.
        setNodes: (nodes) => set({ nodes, hasUnsavedChanges: true }),
        setEdges: (edges) => set({ edges, hasUnsavedChanges: true }),

        onNodesChange: (changes) =>
          set((state) => ({
            nodes: applyNodeChanges(changes, state.nodes),
            // A plain click-to-select dispatches a 'select'-type NodeChange
            // through this same handler — applyNodeChanges always returns a
            // new array reference even when the only thing that changed is
            // `.selected`, so without this filter, just clicking a node
            // (re)marks a freshly-saved automation as having unsaved
            // changes. Any OTHER change type (position/remove/add/replace/
            // dimensions) is a real edit and should still mark it dirty.
            hasUnsavedChanges: changes.some((c) => c.type !== 'select') || state.hasUnsavedChanges,
          })),

        onEdgesChange: (changes) =>
          set((state) => ({
            edges: applyEdgeChanges(changes, state.edges),
            // Same reasoning as onNodesChange above — don't let a plain edge
            // selection click mark the flow dirty.
            hasUnsavedChanges: changes.some((c) => c.type !== 'select') || state.hasUnsavedChanges,
          })),

        onConnect: (connection) =>
          set((state) => {
            // Historical note (Phase B item 6, removed 2026-09-06): this
            // handler used to reject a second, externally-drawn connection
            // into a Choose block's Case 2+ condition node (`_chooseCase >
            // 1`) or an If/Else block's pre-wired then/else action node
            // (`_ifElseBranch`) -- see block-factories.ts's
            // createChooseBlock/createIfElseBlock for those markers. The
            // justification at the time: such a connection makes the
            // target's source have multiple direct targets, which routes
            // through StateMachineStrategy.generateParallelEntryBlocks,
            // which (at the time the guard was written) stubbed any
            // fanned-out target that wasn't a plain action node with a
            // throwaway `system_log.write` placeholder -- a real, reported
            // corruption.
            //
            // Per the maintainer's own bar for canvas restrictions ("only if we know
            // with 100% certainty the connection wouldn't be possible in
            // native HA"), that bar is no longer met: the connection IS
            // representable in native HA (a second trigger, or any node,
            // routing straight into an existing Case/branch is ordinary
            // converging automation logic), and the corruption class this
            // guard existed to prevent has since been fixed at its root,
            // twice over:
            //   1. generateParallelEntryBlocks now inlines a non-action
            //      fan-out branch via NativeStrategy.buildActionsFromEntryPoint
            //      instead of stubbing it (Phase A).
            //   2. buildTriggerRouting now filters a trigger's own
            //      dominated fan-out targets the same way mid-flow fan-out
            //      already did, closing the specific degenerate-convergence
            //      case an empirical audit found this exact shape could
            //      still trigger (Phase B item 6,
            //      choose-ifelse-external-connection-audit.test.ts).
            // On top of both fixes, every save now passes through
            // StateMachineStrategy's own behavioral verification gate
            // (verifyStateMachineOutput, wired into FlowTranspiler.transpile()
            // as of Phase B item 4) -- which independently re-derives the
            // expected behavior from the graph and compares it against the
            // generated YAML for EVERY topology, not just these two
            // patterns, and fails the save loudly rather than silently
            // writing something wrong. That end-to-end net is strictly
            // better coverage than this narrow, connection-time guard ever
            // was, so the guard itself is removed rather than widened.
            return {
              edges: addEdge(
                {
                  ...connection,
                  id: `e-${connection.source}-${connection.target}-${Date.now()}`,
                  animated: false,
                },
                state.edges
              ),
              hasUnsavedChanges: true,
            };
          }),

        addNode: (node) => {
          // Normalize node data (e.g., convert platform to trigger for trigger nodes)
          const normalizedNode = node.type
            ? {
                ...node,
                data: normalizeNodeData(
                  node.type,
                  node.data as Record<string, unknown>
                ) as FlowNodeData,
              }
            : node;

          set((state) => ({
            nodes: [...state.nodes, normalizedNode],
            hasUnsavedChanges: true,
          }));
          // Validate the newly added node
          get().validateNode(node.id);
        },

        addCompound: (nodes, edges) => {
          const normalizedNodes = nodes.map((node) =>
            node.type
              ? {
                  ...node,
                  data: normalizeNodeData(
                    node.type,
                    node.data as Record<string, unknown>
                  ) as FlowNodeData,
                }
              : node
          );
          set((state) => ({
            nodes: [...state.nodes, ...normalizedNodes],
            edges: [...state.edges, ...edges],
            hasUnsavedChanges: true,
          }));
          for (const node of normalizedNodes) get().validateNode(node.id);
        },

        updateNodeData: (nodeId, data) => {
          set((state) => ({
            nodes: state.nodes.map((node) =>
              node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
            ),
            hasUnsavedChanges: true,
          }));
          if ('id' in data) {
            // A rename can resolve a duplicate on one node while creating a
            // new one on another — single-node validation can't see that.
            get().validateAllNodes();
          } else {
            get().validateNode(nodeId);
          }
        },

        updateNodeTypeAndData: (nodeId, type, data) => {
          set((state) => ({
            nodes: state.nodes.map((node) => {
              if (node.id !== nodeId) return node;
              // Only carry forward internal (`_`-prefixed) structural
              // markers (_blockKey/_ifElseBranch/_parallelBranch/...) plus
              // the generic alias/id fields across the type change —
              // everything else in the old data belonged to the OLD type
              // (e.g. an action placeholder's `service: ''`) and must NOT
              // survive the merge. native.ts's buildDelay/buildWait/
              // buildSetVariables (and their state-machine.ts equivalents)
              // all intentionally spread any *unrecognized* key straight
              // into the generated YAML step, to preserve real
              // custom-integration fields — so a leftover `service` field
              // here wouldn't be silently discarded, it'd leak into the
              // output as a bogus extra property and can fail HA's schema
              // validation on save.
              const oldData = node.data as Record<string, unknown>;
              const carryForward: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(oldData)) {
                if (key.startsWith('_') || key === 'alias' || key === 'id') {
                  carryForward[key] = value;
                }
              }
              return {
                ...node,
                type,
                data: normalizeNodeData(type, {
                  ...carryForward,
                  ...data,
                } as Record<string, unknown>) as FlowNodeData,
              };
            }),
            hasUnsavedChanges: true,
          }));
          get().validateNode(nodeId);
        },

        removeNode: (nodeId) =>
          set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== nodeId),
            edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
            selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
            hasUnsavedChanges: true,
          })),

        removeNodes: (nodeIds) =>
          set((state) => {
            const idSet = new Set(nodeIds);
            return {
              nodes: state.nodes.filter((n) => !idSet.has(n.id)),
              edges: state.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
              selectedNodeId:
                state.selectedNodeId && idSet.has(state.selectedNodeId)
                  ? null
                  : state.selectedNodeId,
              hasUnsavedChanges: true,
            };
          }),

        removeEdge: (edgeId) =>
          set((state) => ({
            edges: state.edges.filter((e) => e.id !== edgeId),
            hasUnsavedChanges: true,
          })),

        moveNodes: (updates) =>
          set((state) => {
            const byId = new Map(updates.map((u) => [u.id, u.position]));
            return {
              nodes: state.nodes.map((n) => {
                const position = byId.get(n.id);
                return position ? { ...n, position } : n;
              }),
              hasUnsavedChanges: true,
            };
          }),

        selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
        notifyNodeDoubleClicked: () =>
          set((state) => ({ nodeDoubleClickSignal: state.nodeDoubleClickSignal + 1 })),
        requestNodeEdit: (kind, nodeId) => set({ nodeEditRequest: { kind, nodeId } }),
        clearNodeEditRequest: () => set({ nodeEditRequest: null }),

        setClipboard: (data: string | null) => set({ clipboard: data }),
        setPasteCount: (count: number) => set({ pasteCount: count }),

        setFlowName: (name) => set({ flowName: name, hasUnsavedChanges: true }),
        setFlowDescription: (description) =>
          set({ flowDescription: description, hasUnsavedChanges: true }),
        setFlowMetadata: (metadata) =>
          set((state) => ({
            flowMetadata: { ...state.flowMetadata, ...metadata },
            hasUnsavedChanges: true,
          })),
        setUserVariables: (variables) =>
          set({
            userVariables:
              variables && Object.keys(variables).length > 0 ? variables : undefined,
            hasUnsavedChanges: true,
          }),

        // Save actions
        setAutomationId: (id) => set({ automationId: id }),
        setSaving: (saving) => set({ isSaving: saving }),
        setSaved: () => set({ lastSaved: new Date(), hasUnsavedChanges: false }),
        setUnsavedChanges: (hasChanges) => set({ hasUnsavedChanges: hasChanges }),
        hasRealChanges: () => {
          const state = get();
          if (!state.originalSnapshot) {
            // No original snapshot means it's a new flow - check if there are any nodes
            return state.nodes.length > 0;
          }
          // Create current snapshot and compare
          const currentSnapshot = buildOriginalSnapshot(state);
          return currentSnapshot !== state.originalSnapshot;
        },

        saveAutomation: async (hassApi: HomeAssistant) => {
          const state = get();
          const api = getHomeAssistantAPI(hassApi);

          set({ isSaving: true });

          try {
            // Validate all nodes first
            get().validateAllNodes();

            // Check for validation errors
            const currentState = get();
            if (currentState.nodeErrors.size > 0) {
              const errorCount = currentState.nodeErrors.size;
              throw new Error(
                `Cannot save: ${errorCount} node(s) have validation errors. Fix the highlighted nodes before saving.`
              );
            }

            // Convert flow to graph
            const graph = state.toFlowGraph();

            // Check for empty automation
            if (graph.nodes.length === 0) {
              throw new Error(i18t('errors:validation.emptyAutomation'));
            }

            // Check for minimum required nodes
            const triggers = graph.nodes.filter((n) => n.type === 'trigger');
            const actions = graph.nodes.filter((n) => n.type === 'action');

            if (triggers.length === 0) {
              throw new Error(i18t('errors:validation.noTrigger'));
            }

            if (actions.length === 0) {
              throw new Error(i18t('errors:validation.noAction'));
            }

            const { FlowTranspiler } = await import('@circuitry/transpiler');
            const transpiler = new FlowTranspiler();

            // Validate first
            const validation = transpiler.validate(graph);

            if (validation.errors.length > 0) {
              console.error('Circuitry: Validation errors:', validation.errors);
              throw new Error(
                `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
              );
            }

            // Transpile to automation config
            const result = transpiler.transpile(graph);
            if (!result.success || !result.output?.automation) {
              throw new Error('Failed to transpile flow to automation config');
            }

            // Create automation in Home Assistant
            const automationConfig = {
              alias: state.flowName,
              description: state.flowDescription || '',
              ...result.output.automation,
              variables: {
                ...(result.output.automation.variables || {}),
                _circuitry_metadata: {
                  version: 1,
                  strategy: 'native' as const,
                  nodes: graph.nodes.reduce(
                    (acc, node) => {
                      acc[node.id] = {
                        x: node.position.x,
                        y: node.position.y,
                      };
                      return acc;
                    },
                    {} as Record<string, { x: number; y: number }>
                  ),
                  graph_id: graph.id,
                  graph_version: 1,
                },
              },
            };

            const automationId = await api.createAutomation(automationConfig);

            // Option 1: persist the canonical graph alongside the automation
            // HA just saved natively. Best-effort -- see saveGraph's doc
            // comment; a failure here never blocks the save the user asked
            // for, it just means the next load falls back to decompiling
            // the YAML, exactly as it always has.
            try {
              await saveGraph(api, automationId, graph, computeSourceHash(automationConfig));
              // eslint-disable-next-line no-console -- deliberate diagnostic,
              // see the matching log in useLoadAutomation.ts.
              console.info('Circuitry: saved canonical graph for automation', automationId);
            } catch (graphStoreError) {
              console.warn(
                'Circuitry: failed to persist canonical graph (will fall back to YAML decompile on next load):',
                graphStoreError
              );
            }

            set({
              automationId,
              isSaving: false,
              lastSaved: new Date(),
              hasUnsavedChanges: false,
              // Re-baseline hasRealChanges() against what was just saved —
              // see buildOriginalSnapshot's doc comment. Without this, every
              // subsequent hasRealChanges() call in this tab session keeps
              // comparing against the *pre-edit* snapshot from load time,
              // permanently reporting real changes even right after a
              // successful save.
              originalSnapshot: buildOriginalSnapshot(get()),
            });

            return automationId;
          } catch (error) {
            set({ isSaving: false });
            throw error;
          }
        },

        updateAutomation: async (hassApi: HomeAssistant) => {
          const state = get();
          const api = getHomeAssistantAPI(hassApi);

          if (!state.automationId) {
            throw new Error('No automation ID set. Use saveAutomation() for new automations.');
          }

          set({ isSaving: true });

          try {
            // Validate all nodes first
            get().validateAllNodes();

            // Check for validation errors
            const currentState = get();
            if (currentState.nodeErrors.size > 0) {
              const errorCount = currentState.nodeErrors.size;
              throw new Error(
                `Cannot save: ${errorCount} node(s) have validation errors. Fix the highlighted nodes before saving.`
              );
            }

            // Convert flow to graph
            const graph = state.toFlowGraph();

            // Check for empty automation
            if (graph.nodes.length === 0) {
              throw new Error(i18t('errors:validation.emptyAutomation'));
            }

            // Check for minimum required nodes
            const triggers = graph.nodes.filter((n) => n.type === 'trigger');
            const actions = graph.nodes.filter((n) => n.type === 'action');

            if (triggers.length === 0) {
              throw new Error(i18t('errors:validation.noTrigger'));
            }

            if (actions.length === 0) {
              throw new Error(i18t('errors:validation.noAction'));
            }

            const { FlowTranspiler } = await import('@circuitry/transpiler');
            const transpiler = new FlowTranspiler();

            // Validate first
            const validation = transpiler.validate(graph);
            if (validation.errors.length > 0) {
              throw new Error(
                `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
              );
            }

            // Transpile to automation config
            const result = transpiler.transpile(graph);
            if (!result.success || !result.output?.automation) {
              throw new Error('Failed to transpile flow to automation config');
            }

            // Update automation in Home Assistant
            const automationConfig = {
              alias: state.flowName,
              description: state.flowDescription || '',
              ...result.output.automation,
              variables: {
                ...(result.output.automation.variables || {}),
                _circuitry_metadata: {
                  version: 1,
                  strategy: 'native' as const,
                  nodes: graph.nodes.reduce(
                    (acc, node) => {
                      acc[node.id] = {
                        x: node.position.x,
                        y: node.position.y,
                      };
                      return acc;
                    },
                    {} as Record<string, { x: number; y: number }>
                  ),
                  graph_id: graph.id,
                  graph_version: 1,
                },
              },
            };

            await api.updateAutomation(state.automationId, automationConfig);

            // Option 1: keep the canonical graph in sync with every save.
            // Best-effort, same rationale as saveAutomation above.
            try {
              await saveGraph(
                api,
                state.automationId,
                graph,
                computeSourceHash(automationConfig)
              );
              // eslint-disable-next-line no-console -- deliberate diagnostic,
              // see the matching log in useLoadAutomation.ts.
              console.info('Circuitry: saved canonical graph for automation', state.automationId);
            } catch (graphStoreError) {
              console.warn(
                'Circuitry: failed to persist canonical graph (will fall back to YAML decompile on next load):',
                graphStoreError
              );
            }

            set({
              isSaving: false,
              lastSaved: new Date(),
              hasUnsavedChanges: false,
              // See saveAutomation's identical set() above for why this is here.
              originalSnapshot: buildOriginalSnapshot(get()),
            });
          } catch (error) {
            set({ isSaving: false });
            throw error;
          }
        },

        startSimulation: () => set({ isSimulating: true, executionPath: [], activeNodeId: null }),
        stopSimulation: () => set({ isSimulating: false, activeNodeId: null }),
        setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),
        addToExecutionPath: (nodeId) =>
          set((state) => ({
            executionPath: [...state.executionPath, nodeId],
          })),
        clearExecutionPath: () => set({ executionPath: [] }),

        showTrace: async (traceData) => {
          const traceExecutionPath: string[] = [];
          const traceTimestamps: Record<string, string> = {};
          const traceNodeErrors: Record<string, string> = {};
          let traceUnmappedStepCount = 0;

          if (traceData?.trace) {
            const state = get();
            const graph = state.toFlowGraph();

            // Read-only structural analysis, not the YAML transpile pipeline —
            // gives execution order that respects the actual graph edges
            // instead of guessing from node Y-position (broke as soon as a
            // node was manually repositioned, or the layout wasn't top-down).
            const { analyzeTopology } = await import('@circuitry/transpiler');
            const { topologicalOrder } = analyzeTopology(graph);
            const orderedIds = topologicalOrder ?? state.nodes.map((n) => n.id);

            // Group node IDs by top-level type, preserving topological order
            // within each group — this is what HA's flat `action/N`/`trigger/N`
            // trace path indices are counted against.
            const nodesById = new Map(state.nodes.map((n) => [n.id, n]));
            const idsByType: Record<string, string[]> = {
              trigger: [],
              condition: [],
              action: [],
              wait: [],
              delay: [],
            };
            for (const id of orderedIds) {
              const nodeType = nodesById.get(id)?.type;
              if (nodeType && idsByType[nodeType]) {
                idsByType[nodeType].push(id);
              }
            }

            const sortedSteps = Object.entries(traceData.trace)
              .flatMap(([path, steps]) =>
                Array.isArray(steps) ? steps.map((step) => ({ ...step, path })) : []
              )
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            for (const step of sortedSteps) {
              const pathParts = step.path.split('/');

              // Nested paths (choose/repeat branches, e.g. `action/0/choose/1/sequence/0`)
              // aren't mapped — reconstructing that nesting without touching the
              // transpiler would just duplicate its topology logic. Counted, never crashes.
              if (pathParts.length !== 2) {
                traceUnmappedStepCount++;
                logger.debug(`[trace] Skipping unmappable step path: ${step.path}`);
                continue;
              }

              const [nodeType, indexStr] = pathParts;
              const nodeIndex = Number.parseInt(indexStr, 10);
              const nodeId = idsByType[nodeType]?.[nodeIndex];

              if (!nodeId) {
                traceUnmappedStepCount++;
                logger.debug(`[trace] No matching node for step path: ${step.path}`);
                continue;
              }

              if (!traceExecutionPath.includes(nodeId)) {
                traceExecutionPath.push(nodeId);
                traceTimestamps[nodeId] = step.timestamp;
              }

              const stepError =
                step.error ?? (step.result?.error ? 'Stopped with error' : undefined);
              if (stepError) {
                traceNodeErrors[nodeId] = stepError;
              }
            }
          }

          const traceSkippedNodeIds = get()
            .nodes.map((n) => n.id)
            .filter((id) => !traceExecutionPath.includes(id));

          set({
            isShowingTrace: true,
            traceData,
            traceExecutionPath,
            traceTimestamps,
            traceNodeErrors,
            traceSkippedNodeIds,
            traceUnmappedStepCount,
            activeNodeId: null,
          });
        },
        hideTrace: () =>
          set({
            isShowingTrace: false,
            traceData: null,
            traceExecutionPath: [],
            traceTimestamps: {},
            traceNodeErrors: {},
            traceSkippedNodeIds: [],
            traceUnmappedStepCount: 0,
            activeNodeId: null,
          }),
        clearTraceExecutionPath: () =>
          set({
            traceExecutionPath: [],
            traceTimestamps: {},
            traceNodeErrors: {},
            traceSkippedNodeIds: [],
          }),

        setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),
        getExecutionStepNumber: (nodeId) => {
          const state = get();
          // Check simulation execution path first
          if (state.isSimulating && state.executionPath.length > 0) {
            const stepIndex = state.executionPath.indexOf(nodeId);
            return stepIndex >= 0 ? stepIndex + 1 : null;
          }
          // Check trace execution path
          if (state.isShowingTrace && state.traceExecutionPath.length > 0) {
            const stepIndex = state.traceExecutionPath.indexOf(nodeId);
            return stepIndex >= 0 ? stepIndex + 1 : null;
          }
          return null;
        },

        canDeleteEdge: (edgeId: string) => {
          // Visual-only and structural edges are not deletable by the user
          if (
            edgeId.startsWith('hint-') ||
            edgeId.startsWith('choose-chain-') ||
            edgeId.startsWith('choose-hint-')
          )
            return false;
          const state = get();
          const edge = state.edges.find((e) => e.id === edgeId);
          if (
            edge?.type === 'hint' ||
            edge?.type === 'choose-chain' ||
            edge?.type === 'choose-hint' ||
            edge?.type === 'choose-default' ||
            edge?.type === 'choose-entry' ||
            edge?.type === 'loop-back'
          )
            return false;
          return true;
        },

        toFlowGraph: (): FlowGraph => {
          const state = get();
          const nodeIds = new Set(state.nodes.map((n) => n.id));

          return {
            id: state.flowId,
            name: state.flowName,
            description: state.flowDescription || undefined,
            nodes: state.nodes.map((n) => {
              // Ensure node has all required fields
              const nodeData = { ...n.data };

              // Add missing required fields for different node types
              if (n.type === 'trigger' && !nodeData.trigger) {
                console.warn(
                  `Circuitry: Trigger node ${n.id} missing trigger type, adding default 'state'`
                );
                nodeData.trigger = 'state';
              }

              if (
                n.type === 'action' &&
                !nodeData.service &&
                !nodeData.repeat &&
                !nodeData.event &&
                !('stop' in nodeData)
              ) {
                console.warn(
                  `Circuitry: Action node ${n.id} missing service, adding default 'light.turn_on'`
                );
                nodeData.service = 'light.turn_on';
              }

              return {
                id: n.id,
                type: n.type as FlowNode['type'],
                position: n.position,
                data: nodeData as FlowNode['data'],
              };
            }) as FlowNode[],
            // Filter out orphaned edges that reference deleted nodes
            edges: state.edges
              .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
              .map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle,
                label: typeof e.label === 'string' ? e.label : undefined,
                type: e.type as string | undefined,
              })) as FlowEdge[],
            metadata: state.flowMetadata,
            version: 1,
            userVariables: state.userVariables,
            userTriggerVariables: state.userTriggerVariables,
          };
        },

        fromFlowGraph: (graph) => {
          const nodes = graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            // Normalize node data when loading (e.g., convert platform to trigger)
            data: normalizeNodeData(n.type, n.data as Record<string, unknown>) as FlowNodeData,
          }));
          const edges = graph.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            label: e.label,
            type: e.type,
          }));
          const importedMetadata: FlowMetadata = {
            ...defaultFlowMetadata,
            ...graph.metadata,
          };
          // Create snapshot for comparison
          const originalSnapshot = buildOriginalSnapshot({
            flowName: graph.name,
            flowDescription: graph.description || '',
            flowMetadata: importedMetadata,
            nodes,
            edges,
          });
          set((state) => ({
            flowId: graph.id,
            flowName: graph.name,
            flowDescription: graph.description || '',
            flowMetadata: importedMetadata,
            userVariables: graph.userVariables,
            userTriggerVariables: graph.userTriggerVariables,
            nodes,
            edges,
            selectedNodeId: null,
            // Reset save state when importing
            automationId: null,
            hasUnsavedChanges: false,
            lastSaved: null,
            originalSnapshot,
            nodeErrors: new Map(),
            // Loading a different automation into the *active* tab changes
            // its flowId — keep the tab strip's ordering pointed at the new
            // id in the same slot (see replaceIdInTabOrder's doc comment).
            tabOrder: replaceIdInTabOrder(state.tabOrder, state.flowId, graph.id),
          }));
          // Validate all nodes after loading
          get().validateAllNodes();
          // A freshly loaded automation shouldn't offer undo back into
          // whatever was open before it.
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        reset: () => {
          const oldFlowId = get().flowId;
          const newFlowId = generateUUID();
          set((state) => ({
            ...initialState,
            flowId: newFlowId,
            flowMetadata: { ...defaultFlowMetadata },
            originalSnapshot: null,
            nodeErrors: new Map(),
            // Same in-place tab-strip slot swap as fromFlowGraph above —
            // "New automation" in the current tab shouldn't look like a
            // second tab opened, and must never clobber other open tabs'
            // entries the way blindly spreading `initialState.tabOrder`
            // (module-load-time, a single stale id) would.
            tabOrder: replaceIdInTabOrder(state.tabOrder, oldFlowId, newFlowId),
            backgroundTabs: state.backgroundTabs,
          }));
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        openInNewTab: () => {
          const state = get();
          const backgrounded = snapshotAsTab(state);
          const newFlowId = generateUUID();
          set({
            ...initialState,
            flowId: newFlowId,
            flowMetadata: { ...defaultFlowMetadata },
            originalSnapshot: null,
            nodeErrors: new Map(),
            backgroundTabs: [...state.backgroundTabs, backgrounded],
            tabOrder: [...state.tabOrder, newFlowId],
          });
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        switchTab: (flowId) => {
          const state = get();
          if (flowId === state.flowId) return;
          const target = state.backgroundTabs.find((t) => t.flowId === flowId);
          if (!target) return;
          const backgrounded = snapshotAsTab(state);
          set({
            flowId: target.flowId,
            flowName: target.flowName,
            flowDescription: target.flowDescription,
            flowMetadata: target.flowMetadata,
            userVariables: target.userVariables,
            userTriggerVariables: target.userTriggerVariables,
            nodes: target.nodes,
            edges: target.edges,
            automationId: target.automationId,
            hasUnsavedChanges: target.hasUnsavedChanges,
            lastSaved: target.lastSaved,
            originalSnapshot: target.originalSnapshot,
            selectedNodeId: null,
            nodeErrors: new Map(),
            backgroundTabs: [
              ...state.backgroundTabs.filter((t) => t.flowId !== flowId),
              backgrounded,
            ],
          });
          get().validateAllNodes();
          // Switching tabs reconstructs the target tab's working state fresh
          // rather than keeping a live store per tab (see tabOrder's doc
          // comment) — so, like loading any other automation, it doesn't
          // carry over undo history from whichever tab was active before.
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        closeTab: (flowId) => {
          const state = get();
          const closingIndex = state.tabOrder.indexOf(flowId);
          if (closingIndex === -1) return;
          const newTabOrder = state.tabOrder.filter((id) => id !== flowId);

          if (flowId !== state.flowId) {
            // Closing a background tab — just drop its snapshot, the active
            // tab's own working state is untouched.
            set({
              tabOrder: newTabOrder,
              backgroundTabs: state.backgroundTabs.filter((t) => t.flowId !== flowId),
            });
            return;
          }

          // Closing the active tab — activate a neighbor (preferring the
          // one before it, matching how browser tabs pick the next active
          // tab), or open a fresh blank tab if it was the only one open.
          if (newTabOrder.length === 0) {
            const newFlowId = generateUUID();
            set({
              ...initialState,
              flowId: newFlowId,
              flowMetadata: { ...defaultFlowMetadata },
              originalSnapshot: null,
              nodeErrors: new Map(),
              backgroundTabs: [],
              tabOrder: [newFlowId],
            });
            cancelPendingHistoryCommit();
            useFlowStore.temporal.getState().clear();
            return;
          }

          // Prefer the tab immediately before the one being closed (matches
          // browser-tab convention); if the first tab was closed, activate
          // what's now the new first tab instead.
          const neighborId = closingIndex > 0 ? state.tabOrder[closingIndex - 1] : newTabOrder[0];
          const target = state.backgroundTabs.find((t) => t.flowId === neighborId);
          if (!target) return;

          set({
            flowId: target.flowId,
            flowName: target.flowName,
            flowDescription: target.flowDescription,
            flowMetadata: target.flowMetadata,
            userVariables: target.userVariables,
            userTriggerVariables: target.userTriggerVariables,
            nodes: target.nodes,
            edges: target.edges,
            automationId: target.automationId,
            hasUnsavedChanges: target.hasUnsavedChanges,
            lastSaved: target.lastSaved,
            originalSnapshot: target.originalSnapshot,
            selectedNodeId: null,
            nodeErrors: new Map(),
            tabOrder: newTabOrder,
            backgroundTabs: state.backgroundTabs.filter((t) => t.flowId !== neighborId),
          });
          get().validateAllNodes();
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        // Node validation
        validateNode: (nodeId) => {
          const state = get();
          const node = state.nodes.find((n) => n.id === nodeId);
          if (!node || !node.type) return;

          const errors = validateNodeData(node.type, node.data as Record<string, unknown>);

          set((s) => {
            const newErrors = new Map(s.nodeErrors);
            if (errors.length > 0) {
              newErrors.set(nodeId, errors);
            } else {
              newErrors.delete(nodeId);
            }
            return { nodeErrors: newErrors };
          });
        },

        validateAllNodes: () => {
          const state = get();
          const newErrors = new Map<string, NodeValidationError[]>();

          for (const node of state.nodes) {
            if (!node.type) continue;
            const errors = validateNodeData(node.type, node.data as Record<string, unknown>);
            if (errors.length > 0) {
              newErrors.set(node.id, errors);
            }
          }

          const duplicateIdErrors = findDuplicateIdErrors(state.nodes);
          for (const [nodeId, error] of duplicateIdErrors) {
            newErrors.set(nodeId, [...(newErrors.get(nodeId) ?? []), error]);
          }

          set({ nodeErrors: newErrors });
        },

        clearNodeErrors: (nodeId) => {
          set((s) => {
            const newErrors = new Map(s.nodeErrors);
            newErrors.delete(nodeId);
            return { nodeErrors: newErrors };
          });
        },

        hasValidationErrors: () => {
          return get().nodeErrors.size > 0;
        },
      }),
      {
        partialize: temporalSelector,
        limit: 100,
        // Without this, zundo pushes a history entry on *every* set() call
        // regardless of whether the tracked (partialized) fields actually
        // changed — so UI-only actions like selectNode/setClipboard, which
        // never touch nodes/edges/flowName/etc., would still create no-op
        // undo steps. Shallow-compares the partialized fields; nodes/edges
        // get new array references on every real structural change, so this
        // only skips truly no-op sets.
        equality: shallow,
        // Coalesces bursts of rapid changes (every pointer-move frame of a
        // node drag, a run of keystrokes, an add-then-immediately-edit) into
        // ONE history entry spanning the whole burst, not just its last
        // step. A plain trailing-edge debounce would only keep the *last*
        // call's `pastState` — the state just before that final call —
        // silently discarding the earlier steps' undo information, so
        // undoing would only jump back one micro-step instead of to before
        // the burst started. This remembers the *first* call's `pastState`
        // for the duration of the burst and only actually commits 300ms
        // after it goes quiet. Only the trigger for committing a snapshot is
        // delayed; the live store state itself updates immediately.
        handleSet: (handleSet) => (pastStateArg: FlowState | ((state: FlowState) => FlowState)) => {
          // zundo's own .d.ts mistypes this parameter as `FlowState |
          // ((state: FlowState) => FlowState)` — an artifact of `Parameters<>`
          // only resolving the *last* overload of zustand's own overloaded
          // `setState`. Verified against zundo/dist/index.js's
          // `temporalHandleSet`: at runtime this is always
          // `options.partialize(get())`, i.e. our own `temporalSelector`
          // output — a genuine `TemporalFlowState`.
          const pastState = pastStateArg as unknown as TemporalFlowState;
          const burstStart = pendingHistoryCommit?.burstStart ?? pastState;
          cancelPendingHistoryCommit();
          const timeoutId = setTimeout(() => {
            pendingHistoryCommit = undefined;
            handleSet(burstStart);
          }, 300);
          pendingHistoryCommit = { timeoutId, burstStart };
        },
      }
    ),
    {
      name: 'circuitry-flow-storage',
      storage: circuitryIndexedDBStorage,
      partialize: persistSelector,
      // v1 -> v2: added tabOrder/backgroundTabs for multi-tab support.
      // No `migrate` needed — data persisted before this field existed
      // simply won't have it, so the fallback below fills in a single-tab
      // tabOrder (this browser's one previously-open automation) rather
      // than crashing on an undefined array.
      version: 2,
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Normalize node data after rehydration (e.g., convert platform to trigger)
          const normalizedNodes = state.nodes.map((n) => ({
            ...n,
            data: n.type
              ? (normalizeNodeData(n.type, n.data as Record<string, unknown>) as FlowNodeData)
              : n.data,
          }));

          // Update nodes if any were normalized
          const hasChanges = normalizedNodes.some(
            (n, i) => JSON.stringify(n.data) !== JSON.stringify(state.nodes[i].data)
          );
          if (hasChanges) {
            state.nodes = normalizedNodes;
          }

          // Pre-multi-tab persisted data has no tabOrder/backgroundTabs at
          // all — treat it as a single open tab (the one automation that
          // was already active) rather than an empty tab strip.
          if (!state.tabOrder || state.tabOrder.length === 0) {
            state.tabOrder = [state.flowId];
          }
          if (!state.backgroundTabs) {
            state.backgroundTabs = [];
          }

          // Validate all nodes after normalization
          state.validateAllNodes();
        }
      },
    }
  )
);
