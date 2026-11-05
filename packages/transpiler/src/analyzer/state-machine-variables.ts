import type { FlowGraph } from '@circuitry/shared';

/**
 * The variables the state machine keeps its own state in (#160): where it
 * is (`current_node`, `flow_context`), the state that ran before and its
 * round counts (`prev_node`, `this_node`, `run_rounds`, `loop_rounds_N`,
 * #157), #129's `pass_nodes`, and a branch machine's (#284:
 * `branch_<8 hex>` and its `_prev`, `_this`, `_rounds`). HA's variables are
 * one set for the whole run, so a flow that sets one of them, or reads one
 * in a template, would move the machine or read its bookkeeping.
 */
const NAMES =
  /\b(current_node|flow_context|prev_node|this_node|run_rounds|pass_nodes|loop_rounds_\d+|branch_[0-9a-f]{8}(?:_prev|_this|_rounds)?)\b/;

/** Whether `name` is one of the state machine's own variables (the editor
 * warns before a response is stored under one). */
export function isStateMachineVariableName(name: string): boolean {
  return new RegExp(`^${NAMES.source}$`).test(name);
}
const isName = isStateMachineVariableName;

/** Whether `name` is a variable that says where a state machine is: the
 * machine's `current_node`, or a branch machine's (#284) `branch_<8 hex>`.
 * Setting one moves that machine on. */
export function isStateMachinePositionName(name: string): boolean {
  return name === 'current_node' || /^branch_[0-9a-f]{8}$/.test(name);
}

/** The machine's variable names `value` sets (as a `variables:` key) or
 * reads (in a template), anywhere in it. */
function namesIn(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    if (!value.includes('{{') && !value.includes('{%')) return;
    for (const match of value.matchAll(new RegExp(NAMES.source, 'g'))) found.add(match[0]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) namesIn(item, found);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    // A response stored under the name (an action's or a stop's
    // `response_variable`) sets it as a `variables:` step would.
    if (key === 'response_variable' && typeof item === 'string' && isName(item.trim()))
      found.add(item.trim());
    // A `variables:` step's names, and a script's `fields:` (variables too).
    if (
      (key === 'variables' || key === 'fields') &&
      item &&
      typeof item === 'object' &&
      !Array.isArray(item)
    ) {
      for (const name of Object.keys(item)) if (isName(name)) found.add(name);
    }
    namesIn(item, found);
  }
}

/** The state machine's own variable names the flow sets or reads, sorted
 * (none: it can be written as the state machine). */
export function stateMachineVariablesUsed(flow: FlowGraph): string[] {
  const found = new Set<string>();
  for (const node of flow.nodes) namesIn(node.data, found);
  const declared = [
    ...Object.keys(flow.userVariables ?? {}),
    ...Object.keys(flow.userTriggerVariables ?? {}),
  ];
  for (const name of declared) if (isName(name)) found.add(name);
  namesIn(flow.userVariables, found);
  namesIn(flow.userTriggerVariables, found);
  return [...found].sort();
}
