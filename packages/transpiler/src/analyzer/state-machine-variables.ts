import type { FlowGraph } from '@circuitry/shared';

/**
 * The variables the state machine keeps its own state in (#160): where it
 * is (`current_node`, `flow_context`), the state that ran before and its
 * round counts (`prev_node`, `this_node`, `run_rounds`, `loop_rounds_N`,
 * #157), and #129's `pass_nodes`. HA's variables are one set for the whole
 * run, so a flow that sets one of them, or reads one in a template, would
 * move the machine or read its bookkeeping.
 */
const NAMES =
  /\b(current_node|flow_context|prev_node|this_node|run_rounds|pass_nodes|loop_rounds_\d+)\b/;
const isName = (name: string) => new RegExp(`^${NAMES.source}$`).test(name);

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
