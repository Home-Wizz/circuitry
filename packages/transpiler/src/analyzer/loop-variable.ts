import type { FlowGraph } from '@circuitry/shared';

/**
 * HA's loop variable `repeat` (`repeat.index`, `repeat.first`,
 * `repeat.last`, `repeat.item`) exists only inside a `repeat:` block, and
 * refers to the innermost one. The state machine writes a loop drawn on the
 * canvas as states of its own dispatch loop, so there `repeat` is the
 * dispatch loop's own variable: a template in a loop's body or test that
 * reads it gets a different number (bug #79).
 */
const LOOP_VARIABLE = /\brepeat\s*(\.|\[)/;

/** A template anywhere in `value` (a step, a condition, a whole block)
 * that reads the loop variable. Only strings holding a template count. */
export function mentionsLoopVariable(value: unknown): boolean {
  if (typeof value === 'string') {
    return (value.includes('{{') || value.includes('{%')) && LOOP_VARIABLE.test(value);
  }
  if (Array.isArray(value)) return value.some(mentionsLoopVariable);
  if (value && typeof value === 'object') return Object.values(value).some(mentionsLoopVariable);
  return false;
}

/**
 * The nodes the state machine can't write faithfully because a template in
 * them reads the loop variable: every node but a repeat block kept whole
 * (an action node holding `repeat:`, written as a real HA repeat, where the
 * variable means what it says).
 */
export function nodesReadingLoopVariable(flow: FlowGraph): string[] {
  return flow.nodes
    .filter((node) => {
      const data = node.data as Record<string, unknown>;
      if (node.type === 'action' && data.repeat && typeof data.repeat === 'object') return false;
      return mentionsLoopVariable(data);
    })
    .map((node) => node.id);
}
