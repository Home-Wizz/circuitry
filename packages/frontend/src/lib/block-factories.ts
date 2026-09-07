import type { Edge, Node } from '@xyflow/react';
import { generateNodeId } from '@/lib/utils';
import type { ActionNodeData, ConditionNodeData, FlowNodeData } from '@/store/flow-store';

export type CompoundBlock = {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  /**
   * Node id(s) that a connection dragged *into* this block should wire to —
   * the block's actual first-executed step(s). Not necessarily `nodes[0]`:
   * `repeat_while`'s entry is its while-condition, not its loop body, and
   * `parallel` has two independent branches that both need wiring, not one.
   */
  entryNodeIds: string[];
  /**
   * Node id(s) that a connection leaving *this block* should originate
   * from — the plain, unconditional "falls through to whatever's next"
   * point(s). Used by useAddNodeDialogs.tsx's onCommitCompound when this
   * block is picked from a Blocks list to replace an existing placeholder
   * that already had an outgoing edge (most notably repeat_while/until's
   * own body, which has a structural loop-back edge to its condition) — so
   * that edge gets re-sourced from this block's real exit point(s) instead
   * of silently dropped when the placeholder is removed.
   *
   * Left empty for blocks whose "exit" isn't a plain node-to-node edge:
   * `choose`/`parallel` have no scaffolded terminal action (the user wires
   * further steps into cases/branches by hand), and `repeat_while`/
   * `repeat_until`'s real exit is a specific *handle* on their condition
   * node (the loop-false branch), not a bare node id — outgoing edges onto
   * one of those get dropped rather than mis-wired.
   */
  exitNodeIds: string[];
};

export type CompoundBlockKey =
  | 'choose'
  | 'if_else'
  | 'repeat_while'
  | 'repeat_until'
  | 'repeat_count'
  | 'parallel'
  | 'sequence';

let _edgeSeq = 0;
function eid(source: string, target: string, tag: string): string {
  return `e-${source}-${target}-${tag}-${++_edgeSeq}`;
}

function condNode(
  id: string,
  x: number,
  y: number,
  extra?: Partial<ConditionNodeData>
): Node<FlowNodeData> {
  return {
    id,
    type: 'condition',
    position: { x, y },
    // `_placeholder: true` marks this as a blank compound-block entry node
    // rather than a real configured condition — ConditionNode.tsx uses it
    // (not a guess like "does entity_id look set?", which breaks for
    // entity-less condition types like template/time/sun) to decide whether
    // to show the "click to configure" placeholder or the real condition
    // summary. Cleared to `false` by useAddNodeDialogs.tsx's
    // pendingEditConditionNodeId commit once the user actually configures
    // it. Stripped from generated YAML in native.ts alongside `_blockKey`.
    data: { condition: 'state', entity_id: '', _placeholder: true, ...extra } as ConditionNodeData,
  };
}

function actionNode(
  id: string,
  x: number,
  y: number,
  extra?: Partial<ActionNodeData>
): Node<FlowNodeData> {
  return {
    id,
    type: 'action',
    position: { x, y },
    // See condNode's doc comment above — same `_placeholder` marker, read by
    // ActionNode.tsx and cleared by useAddNodeDialogs.tsx's
    // pendingEditActionNodeId commit.
    data: { service: '', _placeholder: true, ...extra } as ActionNodeData,
  };
}

export function createChooseBlock(baseX: number, baseY: number): CompoundBlock {
  const c1 = generateNodeId('condition');
  const c2 = generateNodeId('condition');

  return {
    nodes: [
      condNode(c1, baseX, baseY, { _chooseCase: 1, _chooseCaseTotal: 2, _blockKey: 'choose' }),
      condNode(c2, baseX, baseY + 130, {
        _chooseCase: 2,
        _chooseCaseTotal: 2,
        _blockKey: 'choose',
      }),
    ],
    edges: [
      {
        id: eid(c1, c2, 'chain'),
        source: c1,
        target: c2,
        sourceHandle: 'false',
        type: 'choose-chain',
      },
    ],
    entryNodeIds: [c1],
    // No scaffolded terminal action per case — the user wires further steps
    // into each case's true-branch by hand, so there's no well-defined exit
    // to hand off an inherited outgoing edge to.
    exitNodeIds: [],
  };
}

export function createIfElseBlock(baseX: number, baseY: number): CompoundBlock {
  const cond = generateNodeId('condition');
  const ifBranch = generateNodeId('action');
  const elseBranch = generateNodeId('action');

  return {
    nodes: [
      condNode(cond, baseX, baseY, { _blockKey: 'if_else' }),
      // Unlike Repeat/Parallel (reverted to add-first-then-configure per
      // task #72's precedent, since their body/branches are open-ended),
      // If/Else has exactly two well-defined outcomes by definition — so
      // both placeholder branches are scaffolded immediately, pre-wired via
      // the true/false handles, instead of leaving the user to discover and
      // drag out both connections themselves. `_ifElseBranch` lets
      // ActionNode.tsx show "Click to configure then"/"...else" instead of
      // the generic "Click to configure action" placeholder — see its
      // `opensActionMiller` branch.
      actionNode(ifBranch, baseX + 260, baseY - 70, {
        _blockKey: 'if_else',
        _ifElseBranch: 'then',
      }),
      actionNode(elseBranch, baseX + 260, baseY + 70, {
        _blockKey: 'if_else',
        _ifElseBranch: 'else',
      }),
    ],
    edges: [
      { id: eid(cond, ifBranch, 'if'), source: cond, target: ifBranch, sourceHandle: 'true' },
      { id: eid(cond, elseBranch, 'else'), source: cond, target: elseBranch, sourceHandle: 'false' },
    ],
    entryNodeIds: [cond],
    // Both branches are dead-end leaves — either is a legitimate place for
    // an inherited outgoing edge to re-originate from.
    exitNodeIds: [ifBranch, elseBranch],
  };
}

export function createRepeatWhileBlock(baseX: number, baseY: number): CompoundBlock {
  const cond = generateNodeId('condition');
  const body = generateNodeId('action');

  return {
    nodes: [
      actionNode(body, baseX, baseY, { _blockKey: 'repeat_while' }),
      condNode(cond, baseX + 300, baseY, { _blockKey: 'repeat_while' }),
    ],
    edges: [
      { id: eid(cond, body, 'true'), source: cond, target: body, sourceHandle: 'true' },
      { id: eid(body, cond, 'loop'), source: body, target: cond, type: 'loop-back' },
    ],
    // The while-condition runs first, not the loop body.
    entryNodeIds: [cond],
    // The real exit is the condition's *false* handle, not a bare node id —
    // not representable by this plain node-to-node mechanism, so left empty
    // (see the CompoundBlock.exitNodeIds doc comment).
    exitNodeIds: [],
  };
}

export function createRepeatUntilBlock(baseX: number, baseY: number): CompoundBlock {
  const body = generateNodeId('action');
  const cond = generateNodeId('condition');

  return {
    nodes: [
      actionNode(body, baseX, baseY, { _blockKey: 'repeat_until' }),
      condNode(cond, baseX + 300, baseY, { _blockKey: 'repeat_until' }),
    ],
    edges: [
      // Body runs first, then flows forward into the until-condition — the
      // mirror image of repeat_while's cond-first wiring below. Matches the
      // exact shape YamlParser.ts already reverse-engineers from a native
      // `repeat: { until: [...], sequence: [...] }` block (see its
      // "── repeat.until ──" case), so hand-built and imported until-loops
      // produce identical graphs.
      { id: eid(body, cond, 'forward'), source: body, target: cond },
      // Back-edge: condition false (not yet satisfied) loops back to the body.
      {
        id: eid(cond, body, 'loop'),
        source: cond,
        target: body,
        sourceHandle: 'false',
        type: 'loop-back',
      },
    ],
    // The loop body runs first; the until-condition is checked after each pass.
    entryNodeIds: [body],
    // Same reasoning as repeat_while above — the real exit is a handle on
    // the condition node, not a bare node id.
    exitNodeIds: [],
  };
}

export function createRepeatCountBlock(baseX: number, baseY: number): CompoundBlock {
  const id = generateNodeId('action');
  return {
    nodes: [
      {
        id,
        type: 'action',
        position: { x: baseX, y: baseY },
        data: { repeat: { count: 3, sequence: [] }, _blockKey: 'repeat_count' } as ActionNodeData,
      },
    ],
    edges: [],
    entryNodeIds: [id],
    // A single node carrying the whole repeat inline — it's both the entry
    // and the exit.
    exitNodeIds: [id],
  };
}

export function createParallelBlock(baseX: number, baseY: number): CompoundBlock {
  const b1 = generateNodeId('action');
  const b2 = generateNodeId('action');

  return {
    nodes: [
      actionNode(b1, baseX, baseY - 65, { _blockKey: 'parallel', _parallelBranch: 1 }),
      actionNode(b2, baseX, baseY + 65, { _blockKey: 'parallel', _parallelBranch: 2 }),
    ],
    edges: [],
    // Both branches run concurrently — a connection into this block wires to both.
    entryNodeIds: [b1, b2],
    // No scaffolded convergence/join — branches don't automatically
    // reconnect, so there's no single well-defined exit to inherit an
    // outgoing edge onto.
    exitNodeIds: [],
  };
}

export function createSequenceBlock(baseX: number, baseY: number): CompoundBlock {
  const start = generateNodeId('sequence_start');
  const end = generateNodeId('sequence_end');

  return {
    nodes: [
      { id: start, type: 'sequence_start', position: { x: baseX, y: baseY }, data: {} },
      { id: end, type: 'sequence_end', position: { x: baseX + 300, y: baseY }, data: {} },
    ],
    edges: [{ id: eid(start, end, 'seq'), source: start, target: end }],
    entryNodeIds: [start],
    // Its End marker is the well-defined single exit point.
    exitNodeIds: [end],
  };
}

export function createCompoundBlock(
  key: CompoundBlockKey,
  baseX: number,
  baseY: number
): CompoundBlock {
  switch (key) {
    case 'choose':
      return createChooseBlock(baseX, baseY);
    case 'if_else':
      return createIfElseBlock(baseX, baseY);
    case 'repeat_while':
      return createRepeatWhileBlock(baseX, baseY);
    case 'repeat_until':
      return createRepeatUntilBlock(baseX, baseY);
    case 'repeat_count':
      return createRepeatCountBlock(baseX, baseY);
    case 'parallel':
      return createParallelBlock(baseX, baseY);
    case 'sequence':
      return createSequenceBlock(baseX, baseY);
  }
}
