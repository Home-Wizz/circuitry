import type { FlowGraph } from '@circuitry/shared';
import { load as yamlLoad } from 'js-yaml';
import { normalizeGraph } from '../analyzer/normalize';
import { findBackEdges } from '../analyzer/topology';
import { compareMachineStates, programsEquivalent } from './behaviorProgram';
import { extractGraphSettings, SharedLoopEntryError } from './extractFromGraph';
import { extractYamlSettings } from './extractFromYaml';
import {
  type EntrySpec,
  expectedLoopBookkeeping,
  extractStateMachineFromGraph,
  machineStateFromGraph,
  type ParallelEntrySpec,
  type StateSpec,
} from './extractStateMachineFromGraph';
import {
  extractStateMachineFromYamlConfig,
  machineStateFromYaml,
  type YamlEntrySpec,
  type YamlParallelEntrySpec,
  type YamlStateSpec,
} from './extractStateMachineFromYaml';
import { compareMetadata, compareTriggerSets } from './verifyNativeOutput';

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  /** #134: the graph has two loops sharing an entry, which the reading of
   * its parallel branches can't place. */
  sharedLoopEntry?: SharedLoopEntryError;
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
export function verifyStateMachineOutput(
  canvasFlow: FlowGraph,
  candidateYaml: string
): VerifyResult {
  // Decision D1 / bug #28: verify against the graph as the strategies read
  // it (a no-op for a graph FlowTranspiler already normalized).
  const originalFlow = normalizeGraph(canvasFlow);
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
    return {
      valid: false,
      reason: `state-machine behavior extraction threw: ${(error as Error).message}`,
      ...(error instanceof SharedLoopEntryError ? { sharedLoopEntry: error } : {}),
    };
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

  // Bug #20 (2026-09-26): mode, max, max_exceeded, initial_state, trace,
  // top-level variables and trigger_variables were never compared here, so
  // StateMachineStrategy silently dropping five of them passed the gate.
  // Same comparison verifyNativeOutput has always made. Checked before the
  // isEmpty early return below for the same reason as the triggers.
  const settingsDiff = compareMetadata(
    extractGraphSettings(originalFlow),
    extractYamlSettings(config as Record<string, unknown>)
  );
  if (settingsDiff) return { valid: false, reason: settingsDiff };

  if (graph.isEmpty) return { valid: true };
  if (yaml.malformed) return { valid: false, reason: yaml.malformed };
  // #157: a graph with a loop needs the run loop (so HA's 10,000-round
  // limit never stops the dispatch loop) and each drawn loop its own round
  // count; one without gets neither. Read from the graph itself, not from
  // the strategy.
  const hasLoops = findBackEdges(originalFlow).size > 0;
  if (hasLoops !== Boolean(yaml.runLoop)) {
    return {
      valid: false,
      reason: hasLoops
        ? 'the graph has a loop, but the dispatcher is not in the run loop: HA would stop it after 10,000 rounds (#157)'
        : 'the graph has no loop, but the dispatcher is in a run loop (#157)',
    };
  }
  const loopDiff = compareLoopBookkeeping(originalFlow, yaml);
  if (loopDiff) return { valid: false, reason: loopDiff };

  const entryDiff = compareEntry(graph.entry, yaml.entry);
  if (entryDiff) return { valid: false, reason: entryDiff };

  // A trigger with nothing joined starts at END and must stop before the
  // dispatch loop, or the loop's one round runs the default's log line
  // (bug #195); with no such trigger there is no stop.
  const needsStop =
    graph.entry.kind === 'byTriggerIdx' && [...graph.entry.targets.values()].includes('END');
  if (needsStop !== (yaml.noStepsStop ?? false)) {
    return {
      valid: false,
      reason: needsStop
        ? 'a trigger with nothing joined starts at END, but the stop before the dispatch loop is missing'
        : 'the stop for a trigger with no steps is there, but every trigger has steps',
    };
  }

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

  // HA runs the `{% else %}` route for every trigger.idx the if/elif
  // chain doesn't name, so each graph trigger is compared with the route
  // HA would take for it. (This used to expect exactly one trigger left to
  // the else and left out triggers with nothing joined, as the generator
  // did: bug #195.)
  for (const [idx, target] of g.targets) {
    const yTarget = y.ifElifTargets.get(idx) ?? y.elseTarget;
    if (yTarget !== target)
      return `entry trigger.idx ${idx} target changed: ${target} -> ${yTarget}`;
  }
  for (const idx of y.ifElifTargets.keys()) {
    if (!g.targets.has(idx)) {
      return `entry template references trigger.idx ${idx}, which the graph has no trigger entry for`;
    }
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
    if (ySpec.transition.kind === 'malformed')
      return `parallel entry "${id}": ${ySpec.transition.reason}`;
    if (ySpec.transition.target !== gSpec.convergence) {
      return `parallel entry "${id}" convergence target changed: ${gSpec.convergence} -> ${ySpec.transition.target}`;
    }
    const progDiff = programsEquivalent(gSpec.program, ySpec.content, `parallelEntries["${id}"]`);
    if (!progDiff.equal) return progDiff.reason ?? `parallel entry "${id}" content mismatch`;
  }
  return null;
}

/** #157: each drawn loop's round count, at its head, and its limit where
 * the graph puts it -- exactly the form state-machine.ts writes; nothing
 * anywhere else. A dropped or moved step still runs the same actions until
 * a loop runs long, so nothing short of the exact form passes. */
function compareLoopBookkeeping(
  flow: FlowGraph,
  yaml: ReturnType<typeof extractStateMachineFromYamlConfig>
): string | null {
  const expected = expectedLoopBookkeeping(flow);
  const wantVars = Array.from({ length: expected.loops }, (_, i) => `loop_rounds_${i + 1}`);
  if (JSON.stringify([...(yaml.loopVars ?? [])].sort()) !== JSON.stringify(wantVars.sort())) {
    return `the loop round variables set at the start (${(yaml.loopVars ?? []).join(', ') || 'none'}) aren't one per drawn loop (${expected.loops}) (#157)`;
  }
  for (const [id, state] of yaml.states) {
    const want = expected.states.get(id) ?? { head: [], inThen: [] };
    const got = state.loopSteps ?? { head: [], inThen: [] };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `state "${id}": its loop round count and limit aren't the ones its loops need (#157): ${JSON.stringify(got).slice(0, 300)}`;
    }
  }
  for (const id of expected.states.keys()) {
    if (!yaml.states.has(id)) return `state "${id}", a loop's head, is missing (#157)`;
  }
  return null;
}

/** The main dispatcher's states, compared as every branch machine's are
 * (behaviorProgram.ts's compareMachineStates); its loop bookkeeping is
 * compared on its own (compareLoopBookkeeping). */
function compareStates(g: Map<string, StateSpec>, y: Map<string, YamlStateSpec>): string | null {
  return compareMachineStates(
    [...g].map(([id, state]) => machineStateFromGraph(id, state)),
    [...y].map(([id, state]) => machineStateFromYaml(id, state))
  );
}
