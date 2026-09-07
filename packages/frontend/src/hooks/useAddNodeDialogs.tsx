import { useState } from 'react';
import { AndConditionDialog } from '@/components/canvas/AndConditionDialog';
import { ThenActionDialog } from '@/components/canvas/ThenActionDialog';
import { WhenTriggerDialog } from '@/components/canvas/WhenTriggerDialog';
import { getAllConditionFieldNames } from '@/config/conditionFields';
import { useAddNodeAtCenter } from '@/hooks/useAddNodeAtCenter';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import { createCompoundBlock } from '@/lib/block-factories';
import { useFlowStore } from '@/store/flow-store';

/**
 * Owns the three Miller-column "Add" dialogs (WhenTriggerDialog/
 * AndConditionDialog/ThenActionDialog) — open state, the shared resolved
 * entity list, and the commit-to-canvas wiring — as a single reusable unit.
 *
 * Originally extracted out of a since-removed floating "+Add" canvas toolbar
 * (which used to own all of this itself) so NodePalette.tsx's own Trigger/
 * Condition/Action buttons could open the *same* dialogs instead of dropping
 * an empty node. NodePalette.tsx now calls this once and is this hook's only
 * call site — kept as its own module rather than folded back into
 * NodePalette.tsx since ConditionNode.tsx/ActionNode.tsx's "click an
 * already-placed bubble to configure it" flow also reaches into it (via the
 * `openAndForNode`/`openThenForNode` doc comment below), not just the
 * sidebar's own buttons.
 *
 * Also owns several cross-dialog "pending" flows, where picking something in
 * one dialog needs to feed a *different* dialog (or a specific existing
 * node) rather than committing directly:
 *
 *  - `openThenForWait()` — NodePalette's Wait node-type button used to drop
 *    a blank wait node directly (`addNodeAtCenter('wait', ...)`), skipping
 *    the "Wait for..." picker entirely — the exact bug reported by the
 *    user. Now it opens the THEN dialog with its columns pre-seeded
 *    straight to the waitForOptions column (see ThenActionDialog's
 *    `startAtWaitFor` prop), so clicking Wait always lands the user on the
 *    6-option list instead of an unconfigurable blank node.
 *  - `openWhenForWaitTrigger()` — ThenActionDialog's "Wait for..." block's
 *    "Trigger" option opens the WHEN dialog to build the actual trigger,
 *    instead of adding a wait node with an empty wait_for_trigger. Same
 *    pattern: WhenTriggerDialog just calls onCommit with trigger data; this
 *    hook notices the pending flag and wraps that data into a wait node's
 *    `wait_for_trigger` array instead of adding a standalone trigger node.
 *  - `openAndForNode(nodeId)` / `openThenForNode(nodeId)` — the "click an
 *    already-placed bubble to configure it" flow: every compound block (If/
 *    Else, Choose, Repeat While/Until, Parallel) is added to the canvas
 *    immediately with placeholder data, per user request, rather than
 *    pre-opening a miller before the block even exists. Clicking a specific
 *    entry condition/action node's card (see ConditionNode.tsx/
 *    ActionNode.tsx, dispatched via flow-store.ts's `nodeEditRequest`) calls
 *    one of these instead, which opens the AND/THEN dialog exactly as
 *    normal except onCommit calls `updateNodeData(nodeId, data)` on the
 *    existing node in place instead of creating a new one.
 */
export function useAddNodeDialogs() {
  const [whenOpen, setWhenOpen] = useState(false);
  const [andOpen, setAndOpen] = useState(false);
  const [thenOpen, setThenOpen] = useState(false);
  const [thenStartAtWaitFor, setThenStartAtWaitFor] = useState(false);
  const [pendingWaitForTrigger, setPendingWaitForTrigger] = useState(false);
  const [pendingEditConditionNodeId, setPendingEditConditionNodeId] = useState<string | null>(null);
  const [pendingEditActionNodeId, setPendingEditActionNodeId] = useState<string | null>(null);
  const { addNodeAtCenter, addCompoundAtCenter } = useAddNodeAtCenter();
  const selectNode = useFlowStore((s) => s.selectNode);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const updateNodeTypeAndData = useFlowStore((s) => s.updateNodeTypeAndData);
  const addCompound = useFlowStore((s) => s.addCompound);
  const removeNode = useFlowStore((s) => s.removeNode);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const entities = useResolvedEntities();

  const dialogs = (
    <>
      <WhenTriggerDialog
        open={whenOpen}
        onOpenChange={(open) => {
          setWhenOpen(open);
          if (!open && pendingWaitForTrigger) {
            // Canceling out of the wait-for-trigger detour (see
            // onOpenWhenForWaitTrigger below) without picking a trigger —
            // also drop pendingEditActionNodeId here, not just
            // pendingWaitForTrigger. Leaving it set would misdirect the
            // *next* unrelated ThenActionDialog commit (e.g. the sidebar's
            // plain "+Action" button, which calls openThen() and never
            // touches pendingEditActionNodeId itself) into editing this
            // placeholder instead of adding a new node.
            setPendingWaitForTrigger(false);
            setPendingEditActionNodeId(null);
          }
        }}
        entities={entities}
        onCommit={(data) => {
          if (pendingWaitForTrigger) {
            setPendingWaitForTrigger(false);
            const waitData = { wait_for_trigger: [data], timeout: '00:01:00' };
            if (pendingEditActionNodeId) {
              // Same bug as ThenActionDialog's onCommit/onCommitCompound —
              // "Wait for a trigger" is a *second* dialog hop (THEN -> this
              // WHEN dialog, see onOpenWhenForWaitTrigger), so
              // pendingEditActionNodeId survives the hop but this commit
              // path never checked it, unconditionally spawning a new node
              // instead of configuring the then/else placeholder in place —
              // reported directly by the user: "if i select wait for a
              // delay that works as expected but the problem now is only
              // for wait for a trigger" (delay stays within
              // ThenActionDialog's own onCommit, which was already fixed;
              // trigger detours through here, which wasn't).
              const nodeId = pendingEditActionNodeId;
              setPendingEditActionNodeId(null);
              updateNodeTypeAndData(nodeId, 'wait', { ...waitData, _placeholder: false });
              selectNode(nodeId);
              return;
            }
            const id = addNodeAtCenter('wait', waitData);
            selectNode(id);
            return;
          }
          const id = addNodeAtCenter('trigger', data);
          selectNode(id);
        }}
      />

      <AndConditionDialog
        open={andOpen}
        onOpenChange={(open) => {
          setAndOpen(open);
          if (!open) {
            setPendingEditConditionNodeId(null);
          }
        }}
        entities={entities}
        onCommit={(data) => {
          if (pendingEditConditionNodeId) {
            const nodeId = pendingEditConditionNodeId;
            setPendingEditConditionNodeId(null);
            const existingNode = nodes.find((n) => n.id === nodeId);
            const existingGroup =
              existingNode?.type === 'condition' &&
              (existingNode.data.condition === 'and' ||
                existingNode.data.condition === 'or' ||
                existingNode.data.condition === 'not')
                ? existingNode.data
                : undefined;
            if (existingGroup) {
              // Picking a condition for an already-typed and/or/not group
              // must add it as a new nested sub-condition, not replace the
              // group's own condition/conditions — this dialog is reused
              // both to fill an empty group and to add to a populated one
              // (see ConditionNode.tsx's opensConditionMiller doc comment),
              // but this commit handler previously always overwrote the
              // whole node with whatever was picked, silently turning the
              // group into a plain single condition the instant anything was
              // picked for it — the "And"/"Or"/"Not" role badge, dashed
              // "click to configure" border, and nested-conditions structure
              // all vanished, leaving a card indistinguishable from a
              // standalone condition (reported directly via screenshot:
              // "Click to configure and" → picking one entity produced a
              // plain "Guest Bedroom / Awning is closed" card with no And
              // badge at all).
              const existingConditions = Array.isArray(existingGroup.conditions)
                ? existingGroup.conditions
                : [];
              updateNodeData(nodeId, { conditions: [...existingConditions, data] });
              selectNode(nodeId);
              return;
            }
            // _placeholder: false clears block-factories.ts's condNode
            // marker so the card switches from "click to configure" to
            // showing the real condition — updateNodeData merges rather
            // than replaces, so this has to be explicit or it'd linger.
            //
            // Clearing every known condition field to undefined *first*
            // (before spreading in `data`) is equally required when this is
            // a *re*configure rather than a first-time configure: without
            // it, whatever the node was previously (e.g. a purpose-specific
            // condition with an inline threshold, which sets
            // `options.threshold`) survives the shallow merge underneath
            // the newly-picked type. Reported directly: reconfiguring an
            // If/Else condition to "Time" saved fine on the surface but
            // failed at Home Assistant's own config validation with "extra
            // keys not allowed @ ...['options']" — the stale `options`
            // object from the condition's previous configuration was still
            // there, and `time` conditions don't have an `options` key at
            // all. Mirrors ConditionFields.tsx's handleConditionTypeChange,
            // which has the identical fix for the property panel's own
            // condition-type dropdown.
            const clearedFields = Object.fromEntries(
              getAllConditionFieldNames().map((name) => [name, undefined])
            );
            updateNodeData(nodeId, { ...clearedFields, ...data, _placeholder: false });
            selectNode(nodeId);
            return;
          }
          const id = addNodeAtCenter('condition', data);
          selectNode(id);
        }}
      />

      <ThenActionDialog
        open={thenOpen}
        onOpenChange={(open) => {
          setThenOpen(open);
          if (!open) {
            setThenStartAtWaitFor(false);
            setPendingEditActionNodeId(null);
          }
        }}
        entities={entities}
        startAtWaitFor={thenStartAtWaitFor}
        onCommit={(type, data) => {
          if (pendingEditActionNodeId) {
            const nodeId = pendingEditActionNodeId;
            setPendingEditActionNodeId(null);
            if (type === 'action') {
              // Same _placeholder: false clearing as AndConditionDialog's
              // onCommit above — see that comment.
              updateNodeData(nodeId, { ...data, _placeholder: false });
              selectNode(nodeId);
              return;
            }
            // A Blocks pick that resolves to a different node `type`
            // (delay/wait/set_variables/...) — was previously left
            // unhandled here and fell through to a normal new-node add,
            // which spawned a disconnected orphan node while the branch
            // placeholder ("Click to configure then/else") stayed
            // unconfigured (reported directly by the user, with a
            // screenshot of an orphaned Wait for/Delay node next to a
            // still-unconfigured If/Else). updateNodeTypeAndData morphs the
            // placeholder node itself into the new type in place — same id,
            // same position, same edges — merging the new data over the old
            // (so _blockKey/_ifElseBranch/_parallelBranch survive the type
            // change exactly the way they already survive a same-type edit
            // above).
            updateNodeTypeAndData(nodeId, type, { ...data, _placeholder: false });
            selectNode(nodeId);
            return;
          }
          const id = addNodeAtCenter(type, data);
          selectNode(id);
        }}
        onCommitCompound={(key) => {
          if (pendingEditActionNodeId) {
            const nodeId = pendingEditActionNodeId;
            setPendingEditActionNodeId(null);
            // Same bug as onCommit above, for a Blocks pick that resolves to
            // a *compound* block (If/Else, Choose, a Repeat variant,
            // Parallel, Sequence) instead of a single node — there's no
            // single node to morph into here, so instead: add the compound
            // block's whole subgraph, re-wire whatever edges already touched
            // the placeholder onto the new block, then remove the
            // now-obsolete placeholder node.
            const placeholderPosition = nodes.find((n) => n.id === nodeId)?.position ?? {
              x: 0,
              y: 0,
            };
            const block = createCompoundBlock(key, placeholderPosition.x, placeholderPosition.y);

            // Clone (rather than in-place retarget) every edge that touched
            // the placeholder, once per entry/exit node — a single sequential
            // retarget would only rewire the *last* entry when a block has
            // more than one (e.g. Parallel's two branches), silently leaving
            // the others unwired. This also fixes the case a plain retarget
            // can't: outgoing edges. If/Else's branches are dead ends with no
            // outgoing edge, but repeat_while/repeat_until's body placeholder
            // has its own structural loop-back edge back to the condition —
            // without re-sourcing that edge from the new block's exit
            // node(s), removeNode below would silently delete it and break
            // the loop. In practice there's exactly one incoming and (for
            // repeat_while/until) one outgoing edge, but this doesn't assume
            // that.
            const incoming = edges.filter((e) => e.target === nodeId);
            const outgoing = edges.filter((e) => e.source === nodeId);
            let seq = 0;
            const rewiredEdges = [
              ...incoming.flatMap((e) =>
                block.entryNodeIds.map((entryNodeId) => ({
                  ...e,
                  id: `e-rewire-${e.id}-${entryNodeId}-${++seq}`,
                  target: entryNodeId,
                }))
              ),
              ...outgoing.flatMap((e) =>
                block.exitNodeIds.map((exitNodeId) => ({
                  ...e,
                  id: `e-rewire-${e.id}-${exitNodeId}-${++seq}`,
                  source: exitNodeId,
                  // The old edge's sourceHandle belonged to the placeholder
                  // (a plain action node has none) — drop it rather than
                  // carry it onto the new exit node, which may have handles
                  // of its own (e.g. a condition node's true/false).
                  sourceHandle: undefined,
                }))
              ),
            ];

            addCompound(block.nodes, [...block.edges, ...rewiredEdges]);
            removeNode(nodeId);
            return;
          }
          addCompoundAtCenter(key);
        }}
        onOpenWhenForWaitTrigger={() => {
          setThenOpen(false);
          setPendingWaitForTrigger(true);
          setWhenOpen(true);
        }}
      />
    </>
  );

  return {
    openWhen: () => setWhenOpen(true),
    openAnd: () => setAndOpen(true),
    openThen: () => setThenOpen(true),
    openThenForWait: () => {
      setThenStartAtWaitFor(true);
      setThenOpen(true);
    },
    openAndForNode: (nodeId: string) => {
      setPendingEditConditionNodeId(nodeId);
      setAndOpen(true);
    },
    openThenForNode: (nodeId: string) => {
      setPendingEditActionNodeId(nodeId);
      setThenOpen(true);
    },
    dialogs,
  };
}
