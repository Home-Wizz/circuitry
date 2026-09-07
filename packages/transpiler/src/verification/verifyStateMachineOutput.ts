import type { FlowGraph } from '@circuitry/shared';
import { load as yamlLoad } from 'js-yaml';
import type { BProgram } from './behaviorProgram';
import { programsEquivalent } from './behaviorProgram';
import { boolExprEquivalent } from './boolean';
import { compareTriggerSets } from './verifyNativeOutput';
import {
  extractStateMachineFromGraph,
  type EntrySpec,
  type LeafState,
  type ParallelEntrySpec,
  type StateSpec,
  type Transition,
} from './extractStateMachineFromGraph';
import {
  extractStateMachineFromYamlConfig,
  type YamlEntrySpec,
  type YamlParallelEntrySpec,
  type YamlStateSpec,
  type YamlTransition,
} from './extractStateMachineFromYaml';

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * StateMachineStrategy's counterpart to verifyNativeOutput.ts. Same
 * governing principle: StateMachineStrategy's own shape-recognition code
 * (generateNodeBlock's per-type dispatch, buildFanOutContinuation/
 * buildFanOutFromTargets, findLoopBackConvergence,
 * filterIndependentFanOutTargets, generateParallelEntryBlocks,
 * generateEntryNodeExpression, buildNativeCondition) is never trusted
 * blindly -- every candidate conversion is compared, behaviorally, against
 * the graph the user actually drew, before being accepted.
 *
 * The comparison itself is necessarily shaped differently from
 * verifyNativeOutput's, because StateMachineStrategy's own execution model
 * is different in kind, not just in shape: NativeStrategy renders one
 * single-pass if/then/else/parallel/repeat tree that either runs top to
 * bottom in one automation run, or (a real `repeat:`) loops entirely within
 * one run. StateMachineStrategy instead compiles the graph into a
 * dispatcher -- one `current_node` variable (the "program counter") plus
 * one choose-case per graph node, looping via HA's own `repeat: { until:
 * ... }` until a node's own transition sets `current_node` to "END" -- so
 * a cycle, cross-link, or converging path in the graph is not a special
 * case here at all, it's just two states (or a back-edge) whose transition
 * happens to name the same next-state id. Comparing this against the graph
 * therefore isn't "build one BProgram for each side and diff them" the way
 * NativeStrategy's gate does -- it's "build the same per-node transition
 * table independently from each side, then compare it state by state":
 * same node-id set, same action/condition content per state (still via
 * behaviorProgram.ts's BProgram/BoolExpr machinery, reused because THAT
 * part -- what does an individual action/delay/wait/condition step MEAN --
 * is identical between the two strategies), and same transition target(s)
 * per state.
 *
 * Deliberately biased toward false positives over false negatives, same as
 * verifyNativeOutput.ts: an unnecessary failure here costs nothing but a
 * loud error telling the maintainer this specific automation's state-machine
 * conversion couldn't be verified; missing a real mismatch would mean a
 * silently-wrong automation gets saved. Unlike NativeStrategy, there is no
 * further fallback strategy after state-machine (StateMachineStrategy.
 * canHandle() is unconditionally true) -- see FlowTranspiler.ts's own
 * wiring decision for what happens when this reports invalid.
 */
export function verifyStateMachineOutput(originalFlow: FlowGraph, candidateYaml: string): VerifyResult {
  let config: unknown;
  try {
    config = yamlLoad(candidateYaml);
  } catch (error) {
    return { valid: false, reason: `candidate YAML failed to parse: ${(error as Error).message}` };
  }
  if (!config || typeof config !== 'object') {
    return { valid: false, reason: 'candidate YAML did not parse to an object' };
  }

  let graph: ReturnType<typeof extractStateMachineFromGraph>;
  let yaml: ReturnType<typeof extractStateMachineFromYamlConfig>;
  try {
    graph = extractStateMachineFromGraph(originalFlow);
    yaml = extractStateMachineFromYamlConfig(config as Record<string, unknown>);
  } catch (error) {
    return { valid: false, reason: `state-machine behavior extraction threw: ${(error as Error).message}` };
  }

  if (graph.isEmpty !== yaml.isEmpty) {
    return {
      valid: false,
      reason: `empty-flow mismatch: graph has ${graph.isEmpty ? 'no' : 'a'} valid entry point, candidate YAML has ${yaml.isEmpty ? 'no' : 'a'} valid entry point`,
    };
  }

  // Checked before either early-return below: state-machine.ts's own
  // triggerRouting.size === 0 early-return path (isEmpty) still emits the
  // real `triggers:` list alongside an empty `actions: []`, so a dropped
  // or corrupted trigger is a real bug in that shape too. Found
  // completely unverified via the adversarial verification-gate mutation
  // fuzzer, 2026-09-07 -- silently removing a trigger from a
  // state-machine candidate's YAML was previously always accepted as
  // equivalent, since this whole comparison did not exist. Reuses
  // verifyNativeOutput.ts's own compareTriggerSets (a direct encoding of
  // "triggers have no meaningful order," not a NativeStrategy-specific
  // rule, so sharing it here carries none of the "shared blind spot" risk
  // that file's own doc comment warns about).
  const triggerDiff = compareTriggerSets(graph.triggers, yaml.triggers);
  if (triggerDiff) return { valid: false, reason: triggerDiff };

  if (graph.isEmpty) return { valid: true };
  if (yaml.malformed) return { valid: false, reason: yaml.malformed };

  const entryDiff = compareEntry(graph.entry, yaml.entry);
  if (entryDiff) return { valid: false, reason: entryDiff };

  const parallelDiff = compareParallelEntries(graph.parallelEntries, yaml.parallelEntries);
  if (parallelDiff) return { valid: false, reason: parallelDiff };

  const statesDiff = compareStates(graph.states, yaml.states);
  if (statesDiff) return { valid: false, reason: statesDiff };

  return { valid: true };
}

function compareEntry(g: EntrySpec, y: YamlEntrySpec): string | null {
  if (y.kind === 'malformed') return `entry expression: ${y.reason}`;

  if (g.kind === 'single') {
    if (y.kind !== 'single') {
      return `entry: expected a single fixed entry target ("${g.target}"), candidate YAML routes by trigger.idx instead`;
    }
    if (g.target !== y.target) return `entry target changed: ${g.target} -> ${y.target}`;
    return null;
  }

  // g.kind === 'byTriggerIdx'
  if (y.kind !== 'byTriggerIdx') {
    return `entry: expected trigger.idx-routed entry (multiple triggers with different targets), candidate YAML has a single fixed target "${y.target}"`;
  }

  const missingFromIfElif: Array<[number, string]> = [];
  for (const [idx, target] of g.targets) {
    if (y.ifElifTargets.has(idx)) {
      const yTarget = y.ifElifTargets.get(idx)!;
      if (yTarget !== target) return `entry trigger.idx ${idx} target changed: ${target} -> ${yTarget}`;
    } else {
      missingFromIfElif.push([idx, target]);
    }
  }
  for (const idx of y.ifElifTargets.keys()) {
    if (!g.targets.has(idx)) {
      return `entry template references trigger.idx ${idx}, which the graph has no trigger entry for`;
    }
  }
  // generateEntryNodeExpression's {% else %} clause deliberately never
  // restates its own trigger.idx (it's simply "whichever index isn't
  // covered by an if/elif") -- so exactly one graph-side idx must be the
  // one left uncovered above, and its target must match the else clause.
  if (missingFromIfElif.length !== 1) {
    return (
      `entry: expected exactly one trigger.idx to be covered only by the template's {% else %} clause, ` +
      `found ${missingFromIfElif.length} (${JSON.stringify(missingFromIfElif)})`
    );
  }
  const [, elseExpectedTarget] = missingFromIfElif[0];
  if (elseExpectedTarget !== y.elseTarget) {
    return `entry {% else %} target changed: ${elseExpectedTarget} -> ${y.elseTarget}`;
  }
  return null;
}

function compareParallelEntries(
  g: Map<string, ParallelEntrySpec>,
  y: Map<string, YamlParallelEntrySpec>
): string | null {
  for (const id of g.keys()) {
    if (!y.has(id)) return `parallel entry "${id}" is missing from the candidate YAML's dispatcher`;
  }
  for (const id of y.keys()) {
    if (!g.has(id)) return `candidate YAML dispatcher has an unexpected parallel entry "${id}"`;
  }

  for (const [id, gSpec] of g) {
    const ySpec = y.get(id)!;
    if (ySpec.transition.kind === 'malformed') return `parallel entry "${id}": ${ySpec.transition.reason}`;
    if (ySpec.transition.target !== gSpec.convergence) {
      return `parallel entry "${id}" convergence target changed: ${gSpec.convergence} -> ${ySpec.transition.target}`;
    }
    const progDiff = programsEquivalent(gSpec.program, ySpec.content, `parallelEntries["${id}"]`);
    if (!progDiff.equal) return progDiff.reason ?? `parallel entry "${id}" content mismatch`;
  }
  return null;
}

function transitionTarget(t: Transition): string {
  return t.kind === 'single' ? t.target : t.convergence;
}

function compareTransitionTarget(label: string, g: Transition, y: YamlTransition): string | null {
  if (y.kind === 'malformed') return `${label}: ${y.reason}`;
  const expected = transitionTarget(g);
  if (expected !== y.target) return `${label}: transition target changed: ${expected} -> ${y.target}`;
  return null;
}

function leafExpectedContent(state: LeafState): BProgram {
  const own = state.ownStep ? [state.ownStep] : [];
  const fanout = state.transition.kind === 'fanout' ? state.transition.program : [];
  return [...own, ...fanout];
}

function conditionBranchExpectedContent(t: Transition): BProgram {
  return t.kind === 'fanout' ? t.program : [];
}

function compareStates(g: Map<string, StateSpec>, y: Map<string, YamlStateSpec>): string | null {
  for (const id of g.keys()) {
    if (!y.has(id)) return `state "${id}" is missing from the candidate YAML's dispatcher`;
  }
  for (const id of y.keys()) {
    if (!g.has(id)) return `candidate YAML dispatcher has an unexpected state "${id}"`;
  }

  for (const [id, gState] of g) {
    const yState = y.get(id)!;
    if (yState.kind === 'malformed') return `state "${id}": ${yState.reason}`;
    if (gState.kind !== yState.kind) {
      return `state "${id}" kind changed: ${gState.kind} -> ${yState.kind}`;
    }

    if (gState.kind === 'condition' && yState.kind === 'condition') {
      const condDiff = boolExprEquivalent(gState.cond, yState.cond);
      if (!condDiff.equivalent) return `state "${id}".cond: ${condDiff.reason}`;

      let diff = compareTransitionTarget(`state "${id}".true`, gState.trueTransition, yState.trueTransition);
      if (diff) return diff;
      diff = compareTransitionTarget(`state "${id}".false`, gState.falseTransition, yState.falseTransition);
      if (diff) return diff;

      const trueProgDiff = programsEquivalent(
        conditionBranchExpectedContent(gState.trueTransition),
        yState.trueContent,
        `state "${id}".then`
      );
      if (!trueProgDiff.equal) return trueProgDiff.reason ?? `state "${id}".then content mismatch`;

      const falseProgDiff = programsEquivalent(
        conditionBranchExpectedContent(gState.falseTransition),
        yState.falseContent,
        `state "${id}".else`
      );
      if (!falseProgDiff.equal) return falseProgDiff.reason ?? `state "${id}".else content mismatch`;
      continue;
    }

    if (gState.kind === 'leaf' && yState.kind === 'leaf') {
      const diff = compareTransitionTarget(`state "${id}"`, gState.transition, yState.transition);
      if (diff) return diff;

      const progDiff = programsEquivalent(leafExpectedContent(gState), yState.content, `state "${id}"`);
      if (!progDiff.equal) return progDiff.reason ?? `state "${id}" content mismatch`;
      continue;
    }
  }
  return null;
}
