import type { FlowNode } from '@circuitry/shared';

/**
 * The parser's count loop (`repeat: count: N`, action-block-parser.ts):
 * `set_variables(_repeat_counter_X = 0)` -> body -> `set_variables(X + 1)`
 * -> `condition: template "{{ _repeat_counter_X < N }}"`, whose TRUE edge
 * loops back. That test, and only that test, makes a true-handle loop-back
 * a count loop: any other condition whose true edge loops back is a loop
 * the user drew, "do this, and while the test holds, do it again" (bug
 * #259), and reading it as a count loop lost its body.
 */
const COUNTER_TEST = /(_repeat_counter_[A-Za-z0-9_]+)\s*<\s*\d+/;

/** The counter a count loop's test condition reads, or undefined for any other node. */
export function counterVariableOf(node: FlowNode | undefined): string | undefined {
  if (node?.type !== 'condition') return undefined;
  const data = node.data as Record<string, unknown>;
  if (data.condition !== 'template' || typeof data.value_template !== 'string') return undefined;
  return data.value_template.match(COUNTER_TEST)?.[1];
}
