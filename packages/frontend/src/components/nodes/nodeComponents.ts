import type { NodeTypes } from '@xyflow/react';
import { ActionNode } from './ActionNode';
import { ConditionNode } from './ConditionNode';
import { DelayNode } from './DelayNode';
import { JoinNode } from './JoinNode';
import { SequenceEndNode } from './SequenceEndNode';
import { SequenceStartNode } from './SequenceStartNode';
import { SetVariablesNode } from './SetVariablesNode';
import { StartNode } from './StartNode';
import { TriggerNode } from './TriggerNode';
import { WaitNode } from './WaitNode';

/** Each node type's card component, for the canvas and the side panel's header. */
export const NODE_COMPONENTS: NodeTypes = {
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
