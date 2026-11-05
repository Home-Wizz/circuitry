import type { ChooseFallThrough } from '@circuitry/transpiler';
import type { Edge, Node } from '@xyflow/react';
import { ACTION_BLOCKS } from '@/lib/actionBlocks';
import { generateNodeId } from '@/lib/utils';
import type { FlowNodeData } from '@/store/flow-store';

/** The id prefix of the "None matched" paths the canvas draws: not edges
 * of the graph, so never saved, deleted or selected. */
export const FALL_THROUGH_EDGE_PREFIX = 'fallthrough-';

/** The canvas edges for a graph's Choose fall-throughs (decision D1, rule
 * 1): from each Choose's last option, by its "no" side, to where the run
 * carries on when none of its options passes. */
export function fallThroughEdges(fallThroughs: ChooseFallThrough[]): Edge[] {
  return fallThroughs.map((f) => ({
    id: `${FALL_THROUGH_EDGE_PREFIX}${f.from}-${f.to}`,
    source: f.from,
    sourceHandle: 'false',
    target: f.to,
    type: 'choose-fallthrough',
    selectable: false,
    deletable: false,
    focusable: false,
  }));
}

/** A Stop card on `lastOption`'s "no" side: the "Otherwise" line a Choose
 * that gates nothing lacks (the save warning's "Add a Stop"). The Stop's
 * data is the Blocks picker's own. */
export function stopOnNoSide(lastOption: Node<FlowNodeData>): {
  node: Node<FlowNodeData>;
  edge: Edge;
} {
  const stop = ACTION_BLOCKS.find((b) => b.key === 'stop');
  const data = stop?.commit.kind === 'node' ? stop.commit.data : { stop: '' };
  const id = generateNodeId('action');
  return {
    node: {
      id,
      type: 'action',
      position: { x: lastOption.position.x + 280, y: lastOption.position.y + 140 },
      data: data as FlowNodeData,
    },
    edge: {
      id: `e-${lastOption.id}-${id}`,
      source: lastOption.id,
      sourceHandle: 'false',
      target: id,
    },
  };
}
