import type { FlowGraph, FlowNode } from '@circuitry/shared';
import { normalizeGraph } from '../analyzer/normalize';
import { graphActionToCompiled } from '../verification/compiledAction';
import { walkGraph } from './graph-walk';
import {
  createRuntime,
  type Inputs,
  type RunResult,
  StepLimit,
  StopSignal,
} from './sm-interpreter';

/**
 * The graph interpreter -- the graph run node by node
 * (`simulation/graph-walk.ts`, which states the rules), with
 * sm-interpreter.ts's leaf semantics: service calls,
 * conditions, variables, errors. Its trace is compared with running the
 * compiled YAML, so a strategy and its gate twin that misread a shape the
 * same way still disagree with it.
 */
export function runGraph(graph: FlowGraph, inputs: Inputs = {}, maxSteps = 5000): RunResult {
  const flow = normalizeGraph(graph, {
    meetings: false,
    copies: false,
    lines: false,
    stops: false,
  });
  // The triggers (for `trigger.id`) and user variables the compiled YAML
  // carries too.
  const runtime = createRuntime(
    {
      triggers: flow.nodes.filter((n) => n.type === 'trigger').map((n) => n.data),
      variables: flow.userVariables ?? {},
    },
    inputs,
    maxSteps
  );
  const conditionOf = (node: FlowNode): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(node.data as Record<string, unknown>).filter(([k]) => !k.startsWith('_'))
    );
  try {
    walkGraph(flow, Number((inputs as { triggerIdx?: number }).triggerIdx ?? 0), {
      tick: () => runtime.tick(),
      test: (node) => runtime.testConditions(conditionOf(node)),
      run: (node) => {
        // As written to YAML: without keys left undefined (a
        // `set_conversation_response` step has no `action`).
        const compiled = graphActionToCompiled(node);
        runtime.runStep(
          Object.fromEntries(Object.entries(compiled).filter(([, v]) => v !== undefined))
        );
      },
      isStop: (e) => e instanceof StopSignal,
    });
  } catch (e) {
    if (e instanceof StepLimit) return { trace: runtime.trace, finished: false };
    throw e;
  }
  return { trace: runtime.trace, finished: true };
}
