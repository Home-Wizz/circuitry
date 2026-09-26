/**
 * Parses Circuitry's internal state-machine-format YAML (a `current_node`-
 * dispatch `repeat`+`choose` loop -- see StateMachineStrategy's own doc
 * comment for why this shape exists) back into a FlowGraph. Extracted from
 * YamlParser.ts (the 2026-09-25 file-decomposition
 * work) as a pure move -- no logic changed,
 * only relocated.
 */
import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowNode,
  WaitNode,
} from '@circuitry/shared';
import { HAConditionSchema, HATriggerSchema } from '@circuitry/shared';
import { findBackEdges } from '../analyzer/topology';
import { fanOutHash } from '../utils/fanOutHash';
import { generateNodeId } from '../utils/generateIds';
import { parseActions } from './action-block-parser';
import { resolveConditionType } from './action-type-guards';
import { createEdge, parseTriggers, unfoldEventContextUserId } from './parser-shared';

/**
 * Detect if automation is in state-machine format
 * State-machine format has:
 * - A variables action with current_node and flow_context
 * - A repeat loop with choose blocks
 */
export function detectStateMachineFormat(content: Record<string, unknown>): boolean {
  const actions = (content.actions || content.action) as unknown[];
  if (!Array.isArray(actions)) return false;

  let hasCurrentNodeVar = false;
  let hasRepeatChoose = false;

  for (const action of actions) {
    const actionObj = action as Record<string, unknown>;

    // Check for variables with current_node
    if (actionObj.variables) {
      const vars = actionObj.variables as Record<string, unknown>;
      if ('current_node' in vars && 'flow_context' in vars) {
        hasCurrentNodeVar = true;
      }
    }

    // Check for repeat with choose
    if (actionObj.repeat) {
      const repeat = actionObj.repeat as Record<string, unknown>;
      const sequence = repeat.sequence as unknown[];
      if (Array.isArray(sequence)) {
        for (const seqItem of sequence) {
          const seqObj = seqItem as Record<string, unknown>;
          if (Array.isArray(seqObj.choose)) {
            hasRepeatChoose = true;
            break;
          }
        }
      }
    }
  }

  return hasCurrentNodeVar && hasRepeatChoose;
}

/**
 * Parse state-machine format automation into nodes and edges
 *
 * State-machine format structure:
 * - Triggers are parsed normally
 * - Actions contain: variables (current_node init) + repeat/choose blocks
 * - Each choose block represents a node:
 *   - condition: {{ current_node == "node-id" }}
 *   - sequence: [node action, variables: { current_node: "next-node" }]
 */
export function parseStateMachineStructure(
  content: Record<string, unknown>,
  warnings: string[],
  metadataNodeIds: string[],
  fanOuts?: Record<string, { targets: string[]; hash: string }>,
  markers?: Record<string, Record<string, unknown>>
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Find the entry node and parse the state machine
  const actions = (content.actions || content.action) as unknown[];
  if (!Array.isArray(actions)) {
    warnings.push('No actions found in automation');
    return { nodes, edges };
  }

  const { entryNodeId, nodeInfoMap } = collectStates(actions);

  // In state-machine strategy, action/condition/delay/wait node IDs are extracted
  // directly from the Jinja2 templates in the YAML choose blocks. Only trigger
  // node IDs need to be allocated via getNextNodeId, so we filter out IDs that
  // are already claimed by the choose blocks to avoid assigning them to triggers.
  const stateMachineNodeIds = new Set(nodeInfoMap.keys());
  const triggerMetadataIds = metadataNodeIds.filter((id) => !stateMachineNodeIds.has(id));
  let triggerIdIndex = 0;
  let nodeIdIndex = 0;

  const getNextNodeId = (type: string): string => {
    if (triggerIdIndex < triggerMetadataIds.length) {
      return triggerMetadataIds[triggerIdIndex++];
    }
    return generateNodeId(type, nodeIdIndex++);
  };

  // Parse triggers
  const triggerData = content.triggers || content.trigger;
  if (!triggerData) {
    warnings.push('No triggers found in automation');
    return { nodes, edges };
  }
  const triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
  const triggerNodes = parseTriggers(
    triggers as Record<string, unknown>[],
    warnings,
    getNextNodeId
  );
  nodes.push(...triggerNodes);

  // Phase 5 (2026-09-26): ids for nodes rebuilt from a state's inline
  // fan-out (see wireThrough below). Derived from the state they hang off
  // and their order, not a timestamp, so decompiling the recompiled YAML
  // yields the same ids again and a round trip settles. When one equals a
  // state id, that state is this same node's dead rendering from the
  // previous save (see below).
  const usedIds = new Set<string>(stateMachineNodeIds);
  const scopedIdFactory = (scope: string) => {
    let n = 0;
    return (type: string): string => `${scope}__${type}_${n++}`;
  };
  let ownStepIndex = 0;
  const freshNodeId = (type: string): string => {
    let id: string;
    do {
      id = generateNodeId(type, 100000 + ownStepIndex++);
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  /** A synthetic `__parallel_trigger_N` state exists only to fan a trigger
   * out; its branches hang off the trigger(s) routed to it, not a node. */
  const isParallelTriggerState = (id: string): boolean => id.startsWith('__parallel_trigger_');

  // Create edges
  // Connect triggers to entry node(s). A trigger routed to a synthetic
  // parallel-trigger state is recorded as that state's source instead.
  const parallelTriggerSources = new Map<string, string[]>();
  const routeTrigger = (triggerId: string, targetNodeId: string): void => {
    if (isParallelTriggerState(targetNodeId) && nodeInfoMap.has(targetNodeId)) {
      const list = parallelTriggerSources.get(targetNodeId) ?? [];
      list.push(triggerId);
      parallelTriggerSources.set(targetNodeId, list);
      return;
    }
    edges.push(createEdge(triggerId, targetNodeId));
  };
  if (entryNodeId) {
    // Check if entryNodeId is a Jinja2 template for trigger routing
    const triggerRouting = parseEntryNodeTemplate(entryNodeId);

    if (triggerRouting && triggerRouting.size > 0) {
      // Different triggers route to different nodes
      for (let i = 0; i < triggerNodes.length; i++) {
        const targetNodeId = triggerRouting.get(i);
        if (targetNodeId) routeTrigger(triggerNodes[i].id, targetNodeId);
      }
    } else {
      // All triggers route to same node (simple case)
      for (const trigger of triggerNodes) routeTrigger(trigger.id, entryNodeId);
    }
  }

  /**
   * Wires `fromIds` to `target` through a state's inline fan-out steps,
   * if any. Those parallel blocks are StateMachineStrategy's native
   * rendering of the branches (NativeStrategy's walker), and they are what
   * HA actually runs -- the branch nodes' own states are never dispatched
   * to -- so they're parsed as native YAML into fresh nodes. The dead
   * states are dropped below. `handle` is the condition branch the steps
   * hang off, if any.
   */
  // Nodes rebuilt from inline fan-outs, shared by content: the state
  // machine can render the same branches inline in several states (an
  // AND-list member repeats its head's else, for one). Rebuilding each copy
  // separately would duplicate those branches in the graph.
  const rebuiltNodes: FlowNode[] = [];
  const rebuiltEdges: FlowEdge[] = [];
  const rebuiltByContent = new Map<string, string[]>();
  const wireThrough = (
    fromIds: string[],
    steps: unknown[],
    target: string | null,
    handle?: 'true' | 'false'
  ): { nodes: FlowNode[]; edges: FlowEdge[] } => {
    const entryEdges = (entries: string[]): FlowEdge[] =>
      fromIds.flatMap((from) => entries.map((to) => createEdge(from, to, handle)));
    if (steps.length === 0) {
      return { nodes: [], edges: target && target !== 'END' ? entryEdges([target]) : [] };
    }
    const key = `${fanOutHash(steps)}|${target ?? 'END'}`;
    const shared = rebuiltByContent.get(key);
    if (shared) return { nodes: [], edges: entryEdges(shared) };
    const onlyFrom = fromIds.length === 1 ? fromIds[0] : null;
    const result = parseActions(steps as never, {
      warnings,
      previousNodeIds: fromIds,
      getNextNodeId: scopedIdFactory(`${fromIds[0]}_${handle ?? 'then'}`),
      conditionNodeIds: new Set(handle === 'true' && onlyFrom ? [onlyFrom] : []),
      falsePathConditionIds: new Set(handle === 'false' && onlyFrom ? [onlyFrom] : []),
    });
    const fromSet = new Set(fromIds);
    const entries = [
      ...new Set(result.edges.filter((e) => fromSet.has(e.source)).map((e) => e.target)),
    ];
    rebuiltNodes.push(...result.nodes);
    rebuiltEdges.push(...result.edges.filter((e) => !fromSet.has(e.source)));
    if (target && target !== 'END') {
      for (const id of result.terminalNodeIds) {
        const sourceHandle = result.falsePathTerminalNodeIds.includes(id)
          ? 'false'
          : result.truePathConditionTerminalIds.includes(id)
            ? 'true'
            : undefined;
        rebuiltEdges.push(createEdge(id, target, sourceHandle));
      }
    }
    rebuiltByContent.set(key, entries);
    return { nodes: [], edges: entryEdges(entries) };
  };

  // Create edges between nodes based on transitions. A condition's
  // true-target edge always carries sourceHandle 'true' (even when its
  // false branch goes to END -- validateGraphStructure requires a handle on
  // every edge out of a condition; a real user automation once failed
  // import over exactly this). Each state's wiring is built first and kept
  // aside: a state whose id is also an id rebuilt from some inline fan-out
  // is that node's dead rendering, so neither it nor its wiring is used.
  /**
   * When `_circuitry_metadata.fan_outs` recorded this fan-out and its steps
   * are unchanged (same fingerprint): the original edges to the recorded
   * targets -- whose own states then carry the branches -- instead of new
   * nodes rebuilt from the inline copy. See StateMachineStrategy's
   * recordFanOut.
   */
  const recordedFanOut = (
    key: string,
    fromIds: string[],
    steps: unknown[],
    handle?: 'true' | 'false'
  ): { nodes: FlowNode[]; edges: FlowEdge[] } | null => {
    const record = fanOuts?.[key];
    if (!record || steps.length === 0 || record.hash !== fanOutHash(steps)) return null;
    if (!record.targets.every((t) => nodeInfoMap.has(t))) return null;
    const out: FlowEdge[] = [];
    for (const from of fromIds)
      for (const t of record.targets) out.push(createEdge(from, t, handle));
    return { nodes: [], edges: out };
  };
  const wiring = new Map<string, { nodes: FlowNode[]; edges: FlowEdge[] }>();
  for (const [nodeId, info] of nodeInfoMap) {
    if (info.nodeType === 'condition') {
      const t =
        recordedFanOut(`${nodeId}:true`, [nodeId], info.thenExtras, 'true') ??
        wireThrough([nodeId], info.thenExtras, info.trueTarget, 'true');
      const f =
        recordedFanOut(`${nodeId}:false`, [nodeId], info.elseExtras, 'false') ??
        wireThrough([nodeId], info.elseExtras, info.falseTarget, 'false');
      wiring.set(nodeId, { nodes: [...t.nodes, ...f.nodes], edges: [...t.edges, ...f.edges] });
      continue;
    }
    const fromIds = isParallelTriggerState(nodeId)
      ? (parallelTriggerSources.get(nodeId) ?? [])
      : [nodeId];
    if (fromIds.length === 0) continue;
    wiring.set(
      nodeId,
      recordedFanOut(nodeId, fromIds, info.extras) ??
        wireThrough(fromIds, info.extras, info.trueTarget)
    );
  }
  const inlineIds = new Set<string>(rebuiltNodes.map((n) => n.id));
  nodes.push(...rebuiltNodes);
  edges.push(...rebuiltEdges);
  for (const [nodeId, w] of wiring) {
    if (inlineIds.has(nodeId)) continue;
    nodes.push(...w.nodes);
    edges.push(...w.edges);
  }

  // Create nodes from parsed info
  for (const [nodeId, info] of nodeInfoMap) {
    if (info.nodeType !== 'condition' && isParallelTriggerState(nodeId)) continue;
    if (inlineIds.has(nodeId)) continue;
    if (info.nodeType === 'condition') {
      nodes.push({
        id: nodeId,
        type: 'condition',
        position: { x: 0, y: 0 },
        data: info.data as ConditionNode['data'],
      });
      continue;
    }
    // Phase 5 (2026-09-26): a leaf state's own step goes through the same
    // parser native YAML does, so every step kind comes back as the node it
    // was saved from -- set_variables, stop, device/event actions, opaque
    // repeats, etc. The old per-kind switch knew only service calls, delays
    // and waits; anything else (and every pass-through state: Join,
    // sequence markers) became an empty action node, recompiled as `- {}`,
    // which HA rejects.
    if (info.ownStep) {
      let used = false;
      const single = parseActions([info.ownStep] as never, {
        warnings,
        previousNodeIds: [],
        getNextNodeId: (type: string) => {
          if (used) return freshNodeId(type);
          used = true;
          return nodeId;
        },
      });
      if (
        single.nodes.length === 1 &&
        single.nodes[0].id === nodeId &&
        single.nodes[0].type !== 'condition'
      ) {
        nodes.push(single.nodes[0]);
        continue;
      }
      warnings.push(
        `State "${nodeId}": its step could not be rebuilt as one node; kept as an action`
      );
    } else {
      // No step of its own: a pass-through -- a Join or a sequence group's
      // start/end marker. Node ids are generated as `<type>_...`, so a
      // marker keeps its kind (NativeStrategy renders a marker pair as a
      // `sequence:` group); anything else becomes a Join. All three pass
      // control straight on.
      // (A node rebuilt from an inline fan-out is named
      // `<state>_<branch>__<type>_<n>`: its type follows the last `__`.)
      nodes.push(passThroughNode(nodeId, markers));
      continue;
    }
    switch (info.nodeType) {
      case 'action':
        nodes.push({
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: info.data as ActionNode['data'],
        });
        break;
      case 'delay':
        nodes.push({
          id: nodeId,
          type: 'delay',
          position: { x: 0, y: 0 },
          data: info.data as DelayNode['data'],
        });
        break;
      case 'wait':
        nodes.push({
          id: nodeId,
          type: 'wait',
          position: { x: 0, y: 0 },
          data: info.data as WaitNode['data'],
        });
        break;
    }
  }

  // Drop what can't run: a fan-out's branch nodes also get dispatch states
  // of their own, but nothing ever sets current_node to them (the inline
  // rendering above is what runs). Every node the compiler saw was
  // reachable from a trigger, so anything unreachable here is one of those.
  pruneUnreachable(
    nodes,
    edges,
    triggerNodes.map((t) => t.id)
  );

  // Only nodes built from a dispatch state (not ones rebuilt from an inline
  // fan-out, even when a dead state shares their id).
  const fromStates = new Set([...stateMachineNodeIds].filter((id) => !inlineIds.has(id)));
  restoreCountLoopReentry(nodes, edges);
  if (markers) {
    // Saved by a Circuitry that records them: restore exactly.
    for (const n of nodes) {
      if (n.type === 'condition' && fromStates.has(n.id) && markers[n.id])
        Object.assign(n.data, markers[n.id]);
    }
  } else {
    restoreConstructMarkers(nodes, edges, fromStates);
  }
  dropInheritedAndMemberElse(nodes, edges, fromStates);

  return { nodes, edges };
}

/** The entry state (from the initial `current_node`) and every dispatch
 * state, keyed by node id. */
function collectStates(actions: unknown[]): {
  entryNodeId: string | null;
  nodeInfoMap: Map<string, ParsedStateBlock>;
} {
  let entryNodeId: string | null = null;
  const nodeInfoMap = new Map<string, ParsedStateBlock>();

  for (const action of actions) {
    const actionObj = action as Record<string, unknown>;

    // Find entry node from initial variables
    if (actionObj.variables) {
      const vars = actionObj.variables as Record<string, unknown>;
      if (typeof vars.current_node === 'string' && vars.current_node !== 'END') {
        entryNodeId = vars.current_node;
      }
    }

    // Parse repeat/choose structure
    if (actionObj.repeat) {
      const repeat = actionObj.repeat as Record<string, unknown>;
      const sequence = repeat.sequence as unknown[];

      if (Array.isArray(sequence)) {
        for (const seqItem of sequence) {
          const seqObj = seqItem as Record<string, unknown>;

          if (Array.isArray(seqObj.choose)) {
            for (const chooseBlock of seqObj.choose) {
              const nodeInfo = parseStateMachineChooseBlock(chooseBlock as Record<string, unknown>);
              if (nodeInfo) {
                nodeInfoMap.set(nodeInfo.nodeId, nodeInfo);
              }
            }
          }
        }
      }
    }
  }
  return { entryNodeId, nodeInfoMap };
}

/** A state with no step of its own: see the call site. */
function passThroughNode(
  nodeId: string,
  markers: Record<string, Record<string, unknown>> | undefined
): FlowNode {
  const recorded = markers?.[nodeId];
  if (recorded?.type) {
    const { type, ...data } = recorded;
    return { id: nodeId, type, position: { x: 0, y: 0 }, data } as FlowNode;
  }
  const typePart = nodeId.includes('__') ? nodeId.slice(nodeId.lastIndexOf('__') + 2) : nodeId;
  const markerType = typePart.startsWith('sequence_start_')
    ? 'sequence_start'
    : typePart.startsWith('sequence_end_')
      ? 'sequence_end'
      : null;
  return markerType
    ? ({ id: nodeId, type: markerType, position: { x: 0, y: 0 }, data: {} } as FlowNode)
    : ({
        id: nodeId,
        type: 'join',
        position: { x: 0, y: 0 },
        data: { mode: 'all' },
      } as FlowNode);
}

/** Keeps only nodes (and edges between them) reachable from `roots`. */
function pruneUnreachable(nodes: FlowNode[], edges: FlowEdge[], roots: string[]): void {
  const reachable = new Set<string>(roots);
  const queue = [...reachable];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.source === id && !reachable.has(e.target)) {
        reachable.add(e.target);
        queue.push(e.target);
      }
    }
  }
  const liveNodes = nodes.filter((n) => reachable.has(n.id));
  const liveEdges = edges.filter((e) => reachable.has(e.source) && reachable.has(e.target));
  nodes.length = 0;
  nodes.push(...liveNodes);
  edges.length = 0;
  edges.push(...liveEdges);
}

/**
 * Phase 5 (2026-09-26): the state machine sends a count loop's "run again"
 * straight to the body (bug #23), but the graph convention -- what the
 * parser builds and NativeStrategy and both verifiers recognize as
 * `repeat: count` -- loops back to the loop's init node (`counter = 0`),
 * whose successors are that body. Put the edge back where the convention
 * has it: from a count test (`{{ _repeat_counter_X < N }}`) whose true
 * targets are exactly the successors of the node that sets X to 0.
 */
function restoreCountLoopReentry(nodes: FlowNode[], edges: FlowEdge[]): void {
  for (const test of nodes) {
    if (test.type !== 'condition') continue;
    const match = String((test.data as Record<string, unknown>).value_template ?? '').match(
      /\{\{\s*(_repeat_counter_\w+)\s*<\s*[^}]+\}\}/
    );
    if (!match) continue;
    const counter = match[1];
    const init = nodes.find((n) => {
      if (n.type !== 'set_variables') return false;
      const vars = (n.data as Record<string, unknown>).variables as
        | Record<string, unknown>
        | undefined;
      return vars !== undefined && Number(vars[counter]) === 0 && String(vars[counter]) === '0';
    });
    if (!init) continue;
    const trueEdges = edges.filter((e) => e.source === test.id && e.sourceHandle === 'true');
    const initNext = new Set(edges.filter((e) => e.source === init.id).map((e) => e.target));
    const trueTargets = new Set(trueEdges.map((e) => e.target));
    if (trueTargets.size === 0 || trueTargets.size !== initNext.size) continue;
    if (![...trueTargets].every((t) => initNext.has(t))) continue;
    for (const e of trueEdges) edges.splice(edges.indexOf(e), 1);
    edges.push(createEdge(test.id, init.id, 'true'));
  }
}

/**
 * Phase 5 (2026-09-26): the inverse of bug #27. State-machine YAML writes
 * an AND-list member's false branch out explicitly (the list head's else);
 * the graph convention leaves it off (the member shares the head's). A
 * decompiled member keeps its false edge only if it goes somewhere other
 * than the head's else. Needs the markers first: a member is a condition
 * with no `_blockKey` whose one way in is the single true edge of a
 * condition.
 */
function dropInheritedAndMemberElse(
  nodes: FlowNode[],
  edges: FlowEdge[],
  stateIds: Set<string>
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const backEdgeIds = findBackEdges({ id: '', name: '', nodes, edges, version: 1 } as never);
  const falseOf = (id: string): string[] =>
    edges
      .filter((e) => e.source === id && e.sourceHandle === 'false')
      .map((e) => e.target)
      .sort();
  const parentOf = (n: FlowNode): FlowNode | null => {
    if (n.type !== 'condition' || typeof (n.data as Record<string, unknown>)._blockKey === 'string')
      return null;
    const incoming = edges.filter((e) => e.target === n.id && !backEdgeIds.has(e.id));
    if (incoming.length !== 1 || incoming[0].sourceHandle !== 'true') return null;
    const parent = byId.get(incoming[0].source);
    if (parent?.type !== 'condition') return null;
    if (edges.filter((e) => e.source === parent.id && e.sourceHandle === 'true').length !== 1)
      return null;
    return parent;
  };
  // Decide on the unmodified edges first, then remove.
  const toDrop: string[] = [];
  for (const n of nodes) {
    if (!stateIds.has(n.id)) continue;
    const parent = parentOf(n);
    if (!parent) continue;
    const own = falseOf(n.id);
    if (own.length > 0 && JSON.stringify(own) === JSON.stringify(falseOf(parent.id)))
      toDrop.push(n.id);
  }
  for (const id of toDrop) {
    for (const e of edges.filter((x) => x.source === id && x.sourceHandle === 'false'))
      edges.splice(edges.indexOf(e), 1);
  }
}

/**
 * Phase 5 (2026-09-26): gives decompiled conditions back the `_blockKey`
 * construct markers the canvas and the parser put on them. The state
 * machine's YAML carries no internal fields, so a decompiled graph had
 * none -- and several of the graph's conventions depend on them: a missing
 * false edge on an unmarked condition reads as "2nd member of an AND list,
 * shares the parent's else" (bug #27), a false back-edge from an unmarked
 * condition reads as that condition's own until loop (bug #22), and loops
 * sharing an entry are only told apart through `repeat_until` (bug #28).
 * The state machine's YAML is explicit about every transition, so after
 * decompiling:
 * - a condition whose FALSE edge is a back-edge, and that isn't itself a
 *   loop's re-entry point, is an until test: `repeat_until`;
 * - a condition that some other back-edge returns to is a while head:
 *   `repeat_while`;
 * - a condition whose false branch ends the flow but that is shaped like
 *   an AND-list member (reached only by a condition's single true edge)
 *   is an if head (`if_else`) when that parent's false branch goes
 *   somewhere -- its transitions were written out, so "ends here" must not
 *   turn into "inherit the parent's else". Real AND-list members come back
 *   with their false edge written out (bug #27) and stay unmarked.
 * Count-loop tests (`{{ _repeat_counter_... < N }}`) are left unmarked, as
 * the parser leaves them. Only conditions rebuilt from dispatch states are
 * touched.
 */
function restoreConstructMarkers(
  nodes: FlowNode[],
  edges: FlowEdge[],
  stateIds: Set<string>
): void {
  const backEdgeIds = findBackEdges({ id: '', name: '', nodes, edges, version: 1 } as never);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isCountTest = (n: FlowNode): boolean =>
    String((n.data as Record<string, unknown>).value_template ?? '').includes('_repeat_counter_');
  const backTargets = new Set<string>();
  const untilTests = new Set<string>();
  for (const e of edges) {
    if (!backEdgeIds.has(e.id)) continue;
    backTargets.add(e.target);
  }
  // A node some non-condition loops back to is a while head (only a while
  // body's last step loops back from an action). A condition's false
  // back-edge onto one is that while body's last if exiting back to the
  // head, not an until loop of its own (an until whose body opens with a
  // loop starts with a Join anchor instead -- bugs #24/#28). Item 4,
  // 2026-09-26.
  const whileHeadsByStep = new Set<string>();
  for (const e of edges) {
    if (backEdgeIds.has(e.id) && byId.get(e.source)?.type !== 'condition') {
      whileHeadsByStep.add(e.target);
    }
  }
  for (const e of edges) {
    if (!backEdgeIds.has(e.id) || e.sourceHandle !== 'false') continue;
    if (whileHeadsByStep.has(e.target) && byId.get(e.target)?.type === 'condition') continue;
    const source = byId.get(e.source);
    if (source?.type === 'condition' && !backTargets.has(source.id) && !isCountTest(source)) {
      untilTests.add(source.id);
    }
  }
  // Item 4 (2026-09-26): `until: [A, B]` comes back as A -true-> B with
  // BOTH loop-back false edges written out (the state machine renders a
  // member's inherited else explicitly). B is a list member, not a second
  // until loop on the same body: an until test whose one way in is the
  // single true edge of another until test (or member) looping back to the
  // same node. Unmarked, dropInheritedAndMemberElse then removes its false
  // edge, restoring the list convention.
  const loopBackTarget = (id: string): string | undefined =>
    edges.find((e) => e.source === id && e.sourceHandle === 'false' && backEdgeIds.has(e.id))
      ?.target;
  const untilMembers = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of untilTests) {
      if (untilMembers.has(id)) continue;
      const incoming = edges.filter((e) => e.target === id && !backEdgeIds.has(e.id));
      if (incoming.length !== 1 || incoming[0].sourceHandle !== 'true') continue;
      const parentId = incoming[0].source;
      if (!untilTests.has(parentId)) continue;
      if (edges.filter((e) => e.source === parentId && e.sourceHandle === 'true').length !== 1)
        continue;
      if (loopBackTarget(parentId) !== loopBackTarget(id)) continue;
      untilMembers.add(id);
      changed = true;
    }
  }
  for (const id of untilMembers) untilTests.delete(id);
  const whileHeads = new Set<string>();
  for (const e of edges) {
    if (!backEdgeIds.has(e.id)) continue;
    if (e.sourceHandle === 'false' && (untilTests.has(e.source) || untilMembers.has(e.source)))
      continue;
    const source = byId.get(e.source);
    if (source?.type === 'condition' && isCountTest(source)) continue; // a count loop's re-entry
    const target = byId.get(e.target);
    if (target?.type === 'condition' && !isCountTest(target)) whileHeads.add(target.id);
  }
  const falseTargets = (id: string): string[] =>
    edges.filter((e) => e.source === id && e.sourceHandle === 'false').map((e) => e.target);
  for (const n of nodes) {
    // Only conditions rebuilt from dispatch states. Nodes parsed from a
    // state's inline fan-out came through the native parser, which already
    // marks them (and deliberately leaves AND-list members unmarked).
    if (n.type !== 'condition' || isCountTest(n) || !stateIds.has(n.id)) continue;
    const data = n.data as Record<string, unknown>;
    if (typeof data._blockKey === 'string') continue;
    if (untilTests.has(n.id)) {
      data._blockKey = 'repeat_until';
      continue;
    }
    if (whileHeads.has(n.id)) {
      data._blockKey = 'repeat_while';
      continue;
    }
    // An if that ends a while body: its false edge loops back to the while
    // head. Unmarked, the fold rule would read it as the next member of
    // the while's own condition list (it is reached by the head's true
    // edge and has no forward false edge). The rest of that if's own
    // condition list loops back to the same head from a single true edge
    // and stays unmarked (a member). Item 4, 2026-09-26.
    const exitTarget = loopBackTarget(n.id);
    if (exitTarget !== undefined && whileHeadsByStep.has(exitTarget)) {
      const incoming = edges.filter((e) => e.target === n.id && !backEdgeIds.has(e.id));
      const parentId = incoming.length === 1 ? incoming[0].source : undefined;
      const isMember =
        incoming.length === 1 &&
        incoming[0].sourceHandle === 'true' &&
        parentId !== undefined &&
        parentId !== exitTarget &&
        byId.get(parentId)?.type === 'condition' &&
        loopBackTarget(parentId) === exitTarget &&
        edges.filter((e) => e.source === parentId && e.sourceHandle === 'true').length === 1;
      if (!isMember) data._blockKey = 'if_else';
      continue;
    }
    // A condition whose false branch ends the flow, shaped like the 2nd
    // member of an AND list (its one way in is the single true edge of a
    // condition), would inherit that parent's else (bug #27) -- wrong
    // unless the parent's false branch ends the flow too, in which case
    // reading it as a list member means the same thing and keeps it in the
    // list (e.g. a `while: [A, B]`). Mark it as an if head only then.
    if (falseTargets(n.id).length > 0) continue;
    const incoming = edges.filter((e) => e.target === n.id && !backEdgeIds.has(e.id));
    if (incoming.length !== 1 || incoming[0].sourceHandle !== 'true') continue;
    const parent = byId.get(incoming[0].source);
    if (parent?.type !== 'condition') continue;
    if (falseTargets(parent.id).length > 0) data._blockKey = 'if_else';
  }
}

/**
 * Parse Jinja2 entry node template to extract trigger-to-node routing
 *
 * Template format: {% if trigger.idx == "0" %}action_0{% elif trigger.idx == "1" %}action_1{% else %}action_2{% endif %}
 * Note: trigger.idx is a string in HA, so comparisons use quoted values
 * Returns a Map where key = trigger index, value = target node ID
 */
export function parseEntryNodeTemplate(entryNodeId: string): Map<number, string> | null {
  // Check if it's a Jinja2 template
  if (!entryNodeId.includes('{%') || !entryNodeId.includes('trigger.idx')) {
    return null;
  }

  const routing = new Map<number, string>();

  // Match {% if trigger.idx == "N" %}nodeId or {% elif trigger.idx == "N" %}nodeId
  // trigger.idx is a string in HA, so index is quoted; node IDs are NOT quoted
  const ifPattern =
    /{%\s*(?:if|elif)\s+trigger\.idx\s*==\s*["'](\d+)["']\s*%}\s*([^{%]+?)(?={%|$)/g;
  const matches = entryNodeId.matchAll(ifPattern);

  for (const match of matches) {
    const triggerIdx = parseInt(match[1], 10);
    const nodeId = match[2].trim();
    routing.set(triggerIdx, nodeId);
  }

  // Match {% else %}nodeId for the default case (last trigger if not explicitly matched)
  const elseMatch = entryNodeId.match(/{%\s*else\s*%}\s*([^{%]+?)(?={%|$)/);
  if (elseMatch && routing.size > 0) {
    // The else branch is for the last trigger index not explicitly matched
    // Find the highest trigger index and add 1
    const maxIdx = Math.max(...routing.keys());
    routing.set(maxIdx + 1, elseMatch[1].trim());
  }

  return routing.size > 0 ? routing : null;
}

/**
 * Parse a single choose block from state-machine format
 */
export interface ParsedStateBlock {
  nodeId: string;
  nodeType: 'action' | 'condition' | 'delay' | 'wait';
  data: Record<string, unknown>;
  trueTarget: string | null;
  falseTarget: string | null;
  /** Phase 5: the state's own step (a leaf state's first step, when it
   * isn't a `parallel:` fan-out), exactly as written. */
  ownStep?: Record<string, unknown>;
  /** Phase 5: steps between the own step and the `current_node` transition
   * -- StateMachineStrategy's inline rendering of a fan-out (parallel
   * blocks). For a condition state, per branch. */
  extras: unknown[];
  thenExtras: unknown[];
  elseExtras: unknown[];
}

/** `{ variables: { current_node: X } }` and nothing else. */
function isTransitionStep(step: unknown): boolean {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
  const s = step as Record<string, unknown>;
  if (Object.keys(s).length !== 1 || !s.variables || typeof s.variables !== 'object') return false;
  const vars = s.variables as Record<string, unknown>;
  return Object.keys(vars).length === 1 && typeof vars.current_node === 'string';
}

export function parseStateMachineChooseBlock(
  chooseBlock: Record<string, unknown>
): ParsedStateBlock | null {
  const conditions = chooseBlock.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return null;
  }

  // Extract node ID from condition: {{ current_node == "node-id" }}
  const firstCondition = conditions[0] as Record<string, unknown>;
  const valueTemplate = firstCondition.value_template as string;
  if (!valueTemplate) return null;

  const match = valueTemplate.match(/current_node\s*==\s*["']([^"']+)["']/);
  if (!match) return null;

  const nodeId = match[1];
  const sequence = chooseBlock.sequence;
  if (!Array.isArray(sequence) || sequence.length === 0) {
    return null;
  }

  // Parse sequence to determine node type and data
  let nodeType: 'action' | 'condition' | 'delay' | 'wait' = 'action';
  const data: Record<string, unknown> = {};
  let trueTarget: string | null = null;
  let falseTarget: string | null = null;

  for (const item of sequence) {
    const seqItem = item as Record<string, unknown>;

    // Check for a native if/then/else condition block — this is what
    // StateMachineStrategy's generateConditionBlock (state-machine.ts)
    // emits for every condition node: a real HA condition object under
    // `if:`, with each branch's `then:`/`else:` sequence assigning
    // `current_node` a plain string. (Older saved automations may still
    // have the previous, now-removed shape — a single `variables:
    // {current_node: "{% if %}...{% endif %}"}` entry with the branch
    // baked into a Jinja ternary — handled by the `seqItem.variables`
    // case below for backward compatibility with already-saved YAML.)
    if (Array.isArray(seqItem.if) && seqItem.if.length > 0) {
      nodeType = 'condition';

      const rawCondition = seqItem.if[0] as Record<string, unknown>;
      const conditionType = resolveConditionType(rawCondition?.condition as string, 'template');
      try {
        const parsed = HAConditionSchema.parse({ ...rawCondition, condition: conditionType });
        Object.assign(data, parsed);
      } catch {
        data.condition = 'template';
        data.value_template = JSON.stringify(rawCondition);
      }
      if (seqItem.alias) data.alias = seqItem.alias;

      // Each branch's sequence contains exactly one `variables: {current_node: "id"}`
      // entry (see generateConditionBlock) — find it and read the target back out.
      const extractTransitionTarget = (branch: unknown): string | null => {
        if (!Array.isArray(branch)) return null;
        for (const branchItem of branch) {
          const bi = branchItem as Record<string, unknown>;
          const vars = bi.variables as Record<string, unknown> | undefined;
          if (vars && typeof vars.current_node === 'string') {
            return vars.current_node === 'END' ? null : vars.current_node;
          }
        }
        return null;
      };
      trueTarget = extractTransitionTarget(seqItem.then);
      falseTarget = extractTransitionTarget(seqItem.else);
    }
    // Check for variables action (sets next node / edge)
    else if (seqItem.variables) {
      const vars = seqItem.variables as Record<string, unknown>;
      const currentNodeValue = vars.current_node;

      if (typeof currentNodeValue === 'string') {
        // Check if it's a Jinja conditional (condition node)
        if (currentNodeValue.includes('{%') && currentNodeValue.includes('%}')) {
          nodeType = 'condition';

          // Extract true and false targets
          const trueMatch = currentNodeValue.match(/{%\s*if[^%]*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);
          const falseMatch = currentNodeValue.match(/{%\s*else\s*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);

          trueTarget = trueMatch ? trueMatch[1] : null;
          falseTarget = falseMatch ? falseMatch[1] : null;

          // Extract condition expression from Jinja template
          const conditionMatch = currentNodeValue.match(/{%\s*if\s+(.+?)\s*%}/);
          if (conditionMatch) {
            const conditionExpr = conditionMatch[1];
            Object.assign(data, parseJinjaCondition(conditionExpr));
          }
        } else {
          // Simple transition
          trueTarget = currentNodeValue === 'END' ? null : currentNodeValue;
        }
      }
    }
    // Check for delay action
    else if (seqItem.delay !== undefined) {
      nodeType = 'delay';
      data.delay = seqItem.delay;
      if (seqItem.alias) data.alias = seqItem.alias;
    }
    // Check for wait action (either form — see generateWaitBlock in
    // state-machine.ts, which emits wait_template for a template-based
    // wait or wait_for_trigger for a trigger-based one; only the former
    // was handled here, so a "Wait for [x]" node built the wait_for_trigger
    // way always fell through to the generic service-call/action case
    // below and lost its wait semantics on reopen).
    else if (seqItem.wait_template !== undefined || seqItem.wait_for_trigger !== undefined) {
      nodeType = 'wait';
      if (typeof seqItem.wait_template === 'string') {
        data.wait_template = seqItem.wait_template;
      } else if (Array.isArray(seqItem.wait_for_trigger)) {
        // Validate/normalize each trigger the same way the native-strategy
        // wait parser does (isWaitAction branch above), rather than
        // trusting the raw YAML shape.
        const parsedTriggers = [];
        for (const trigger of seqItem.wait_for_trigger) {
          const result = HATriggerSchema.safeParse(trigger);
          if (result.success) parsedTriggers.push(unfoldEventContextUserId(result.data));
        }
        data.wait_for_trigger = parsedTriggers;
      }
      if (seqItem.timeout) data.timeout = seqItem.timeout;
      if (seqItem.continue_on_timeout !== undefined) {
        data.continue_on_timeout = seqItem.continue_on_timeout;
      }
      if (seqItem.alias) data.alias = seqItem.alias;
    }
    // Check for service call action
    else if (seqItem.service || seqItem.action) {
      nodeType = 'action';
      data.service = seqItem.service || seqItem.action;
      if (seqItem.target) data.target = seqItem.target;
      if (seqItem.data) data.data = seqItem.data;
      if (seqItem.alias) data.alias = seqItem.alias;
    }
  }

  // Phase 5 (2026-09-26): split the state's steps the way
  // StateMachineStrategy writes them -- [own step?, ...fan-out extras,
  // transition] for a leaf state, and [...extras, transition] inside each
  // branch of a condition state -- so the structure pass can rebuild the
  // own step with the same parser native YAML goes through, and the fan-out
  // edges from the inline parallel blocks.
  const branchExtras = (branch: unknown): unknown[] =>
    Array.isArray(branch) ? branch.filter((b) => !isTransitionStep(b)) : [];
  let ownStep: Record<string, unknown> | undefined;
  let extras: unknown[] = [];
  let thenExtras: unknown[] = [];
  let elseExtras: unknown[] = [];
  const ifItem = (sequence as Record<string, unknown>[]).find(
    (item) => item && typeof item === 'object' && Array.isArray(item.if)
  );
  if (nodeType === 'condition' && ifItem) {
    thenExtras = branchExtras(ifItem.then);
    elseExtras = branchExtras(ifItem.else);
  } else if (nodeType !== 'condition') {
    const items = (sequence as unknown[]).filter((item) => !isTransitionStep(item));
    const first = items[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && !('parallel' in first)) {
      ownStep = first;
      extras = items.slice(1);
    } else {
      extras = items;
    }
  }

  return {
    nodeId,
    nodeType,
    data,
    trueTarget,
    falseTarget,
    ownStep,
    extras,
    thenExtras,
    elseExtras,
  };
}

/**
 * Parse Jinja condition expression to extract condition data
 */
export function parseJinjaCondition(expr: string): Record<string, unknown> {
  // is_state('entity', 'state')
  const isStateMatch = expr.match(/is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  if (isStateMatch) {
    const entityId = isStateMatch[1];
    const state = isStateMatch[2];

    // Check for sun entity
    if (entityId === 'sun.sun') {
      if (state === 'above_horizon') {
        return { condition: 'sun', after: 'sunrise', before: 'sunset' };
      } else if (state === 'below_horizon') {
        return { condition: 'sun', after: 'sunset', before: 'sunrise' };
      }
    }

    return { condition: 'state', entity_id: entityId, state };
  }

  // states('entity') | float > number
  const numericMatch = expr.match(
    /states\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\|\s*float\s*([<>=]+)\s*(\d+(?:\.\d+)?)/
  );
  if (numericMatch) {
    const entityId = numericMatch[1];
    const operator = numericMatch[2];
    const value = parseFloat(numericMatch[3]);

    const result: Record<string, unknown> = {
      condition: 'numeric_state',
      entity_id: entityId,
    };
    if (operator.includes('>')) result.above = value;
    if (operator.includes('<')) result.below = value;
    return result;
  }

  // Fallback to template condition
  return { condition: 'template', value_template: `{{ ${expr} }}` };
}
