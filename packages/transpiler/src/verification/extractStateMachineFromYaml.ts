import {
  BRANCH_ALIAS,
  BRANCH_RUN_ALIAS,
  branchNames,
  isBranchMachineName,
  MAIN_NAMES,
  renameMachineVariables,
  usesMachineNames,
} from '../utils/branchMachine';
import { isNoStepsStop } from '../utils/stateMachineEntry';
import { RUN_ALIAS } from '../utils/stateMachineLoops';
import type { BProgram, BStep, MachineState } from './behaviorProgram';
import { type BoolExpr, boolExprEquivalent, parseConditionExpr } from './boolean';
import { normalizeTrigger, parseActionSequence } from './extractFromYaml';

/** The loop bookkeeping a state carries (#157): steps at its start, and at
 * the start of its condition's yes side. Taken out before the state is
 * read; the gate compares it with what the graph's loops need. */
export interface LoopSteps {
  head: unknown[];
  inThen: unknown[];
  /** #339: limits opening the "no" side. */
  inElse?: unknown[];
  /** #292: limits put just before a move into a loop's body, by target. */
  beforeMoves?: Record<string, unknown[]>;
}

/**
 * Extracts the same per-node "state transition table" shape as
 * extractStateMachineFromGraph.ts, but read directly from the CANDIDATE
 * YAML's own parsed config -- a fresh walk of the actual `choose:`
 * dispatcher HA will execute, using only `parseActionSequence`'s
 * already-independent, HA-grammar-only action-list parser (the same one
 * extractFromYaml.ts uses for NativeStrategy verification). This file adds
 * no new trust in StateMachineStrategy's own construction code: it never
 * imports from state-machine.ts, and only *recognizes* the dispatcher
 * shape state-machine.ts's class doc comment documents (a `variables:`
 * step seeding `current_node`, a `repeat: { until: ..., sequence: [{
 * choose: [...] }] }` loop) by pattern, not by trusting that shape is
 * correct.
 */

export type YamlTransition =
  | { kind: 'single'; target: string }
  | { kind: 'malformed'; reason: string };

export interface YamlLeafState {
  kind: 'leaf';
  content: BProgram;
  transition: YamlTransition;
}

export interface YamlConditionState {
  kind: 'condition';
  cond: BoolExpr;
  trueContent: BProgram;
  trueTransition: YamlTransition;
  falseContent: BProgram;
  falseTransition: YamlTransition;
  /** Bug #63: an until test's error guard (see parseState). */
  errorContent?: BProgram;
  errorTransition?: YamlTransition;
}

export type YamlStateSpec = (
  | YamlLeafState
  | YamlConditionState
  | { kind: 'malformed'; reason: string }
) & {
  loopSteps?: LoopSteps;
};

export interface YamlParallelEntrySpec {
  content: BProgram;
  transition: YamlTransition;
}

export type YamlEntrySpec =
  | { kind: 'single'; target: string }
  | { kind: 'byTriggerIdx'; ifElifTargets: Map<number, string>; elseTarget: string }
  | { kind: 'malformed'; reason: string };

export interface StateMachineYamlExtraction {
  isEmpty: boolean;
  malformed?: string;
  triggers: Record<string, unknown>[];
  states: Map<string, YamlStateSpec>;
  parallelEntries: Map<string, YamlParallelEntrySpec>;
  entry: YamlEntrySpec;
  /** Whether the dispatcher runs in the chunked run loop (#157). */
  runLoop?: boolean;
  /** The loop round variables set at the start (#157). */
  loopVars?: string[];
  /** Whether the stop for a trigger with no steps is there (#195). */
  noStepsStop?: boolean;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

/** Strips a trailing `{ action: { variables: { current_node: "X" } } }`
 * step (and ONLY that exact shape -- a single-key `variables` call whose
 * only variable is `current_node`, set to a string) off the end of a
 * parsed dispatch-state program, returning the remaining content and the
 * transition target. Anything else in that trailing position is reported
 * as a malformed transition rather than silently treated as "no
 * transition" -- a missing/corrupted current_node assignment is exactly
 * the kind of real bug this file exists to catch. */
function stripTrailingTransition(program: BProgram): {
  content: BProgram;
  transition: YamlTransition;
} {
  if (program.length === 0) {
    return {
      content: program,
      transition: {
        kind: 'malformed',
        reason: 'no steps at all (expected a current_node transition)',
      },
    };
  }
  const last = program[program.length - 1];
  if (last.k === 'action') {
    const callKeys = Object.keys(last.call);
    if (callKeys.length === 1 && callKeys[0] === 'variables') {
      const vars = last.call.variables;
      if (vars && typeof vars === 'object' && !Array.isArray(vars)) {
        const varKeys = Object.keys(vars as Record<string, unknown>);
        if (varKeys.length === 1 && varKeys[0] === 'current_node') {
          const target = (vars as Record<string, unknown>).current_node;
          if (typeof target === 'string') {
            return { content: program.slice(0, -1), transition: { kind: 'single', target } };
          }
        }
      }
    }
  }
  return {
    content: program,
    transition: {
      kind: 'malformed',
      reason: `last step is not a plain current_node transition: ${JSON.stringify(last)}`,
    },
  };
}

/** Extracts the node/state id a choose-case dispatches for, from its own
 * `conditions: [{ condition: 'template', value_template: '{{ current_node
 * == "X" }}' }]` gate -- the ONLY thing every dispatch case's `conditions`
 * is ever built from (generateActionBlock/generateConditionBlock/etc./
 * generateParallelEntryBlocks all emit exactly this shape). */
function extractDispatchId(caseObj: Record<string, unknown>): string | null {
  const conditions = asArray(caseObj.conditions);
  for (const c of conditions) {
    if (!c || typeof c !== 'object') continue;
    const cond = c as Record<string, unknown>;
    if (cond.condition !== 'template' || typeof cond.value_template !== 'string') continue;
    const match = cond.value_template.match(/current_node\s*==\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return null;
}

/** The error guard in an until test's else (bug #63), if that's what it is. */
function errorGuard(ifStep: Extract<BStep, { k: 'if' }>): Extract<BStep, { k: 'if' }> | null {
  if (ifStep.else.length !== 1 || ifStep.else[0].k !== 'if') return null;
  const guard = ifStep.else[0] as Extract<BStep, { k: 'if' }>;
  return boolExprEquivalent(guard.cond, { op: 'not', arg: ifStep.cond }).equivalent ? guard : null;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A loop bookkeeping step, by its alias (state-machine.ts writes
 * `Loop rounds` and `Loop limit`; their exact form is the gate's to check). */
function isLoopStep(step: unknown): boolean {
  return isMapping(step) && (step.alias === 'Loop rounds' || step.alias === 'Loop limit');
}

/** A state's steps without its loop bookkeeping, and the bookkeeping. */
function splitLoopSteps(sequence: unknown[]): { rest: unknown[]; loopSteps: LoopSteps } {
  let i = 0;
  while (i < sequence.length && isLoopStep(sequence[i])) i++;
  const head = sequence.slice(0, i);
  const rest = sequence.slice(i);
  const inThen: unknown[] = [];
  const inElse: unknown[] = [];
  const ifSteps = rest.filter((s) => isMapping(s) && Array.isArray(s.if) && Array.isArray(s.then));
  const leading = (side: unknown[]) => {
    let k = 0;
    while (k < side.length && isLoopStep(side[k])) k++;
    return k;
  };
  const out = rest.map((step) => {
    if (ifSteps.length !== 1 || step !== ifSteps[0] || !isMapping(step)) return step;
    const then = step.then as unknown[];
    const k = leading(then);
    inThen.push(...then.slice(0, k));
    // #339: a `Loop limit` opening the "no" side (one that fans out into
    // a loop's body).
    const otherwise = Array.isArray(step.else) ? (step.else as unknown[]) : [];
    const m = leading(otherwise);
    inElse.push(...otherwise.slice(0, m));
    return k === 0 && m === 0
      ? step
      : { ...step, then: then.slice(k), ...(m > 0 ? { else: otherwise.slice(m) } : {}) };
  });
  // #292: a `Loop limit` just before a move (`current_node: <target>`), at
  // any depth -- where a while whose round is on its test's "no" side
  // checks it.
  const beforeMoves: Record<string, unknown[]> = {};
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const kept: unknown[] = [];
      for (let j = 0; j < value.length; j++) {
        const next = value[j + 1];
        if (
          isMapping(value[j]) &&
          (value[j] as Record<string, unknown>).alias === 'Loop limit' &&
          isPlainTransition(next) &&
          isMapping(next) &&
          isMapping(next.variables)
        ) {
          const target = String(next.variables.current_node);
          beforeMoves[target] = [...(beforeMoves[target] ?? []), value[j]];
          continue;
        }
        kept.push(strip(value[j]));
      }
      return kept;
    }
    if (!isMapping(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, strip(inner)]));
  };
  const stripped = strip(out) as unknown[];
  const sortedMoves = Object.fromEntries(
    Object.keys(beforeMoves)
      .sort()
      .map((key) => [key, beforeMoves[key]])
  );
  return {
    rest: stripped,
    loopSteps: {
      head,
      inThen,
      ...(inElse.length > 0 ? { inElse } : {}),
      ...(Object.keys(beforeMoves).length > 0 ? { beforeMoves: sortedMoves } : {}),
    },
  };
}

/** A step that only sets `current_node` to a name: a state's transition. */
function isPlainTransition(step: unknown): boolean {
  if (!isMapping(step) || Object.keys(step).length !== 1 || !isMapping(step.variables))
    return false;
  const vars = step.variables;
  return Object.keys(vars).length === 1 && typeof vars.current_node === 'string';
}

function parseState(raw: unknown[]): YamlStateSpec {
  const { rest, loopSteps } = splitLoopSteps(raw);
  return { ...parseStateSteps(rest), loopSteps };
}

function parseStateSteps(sequence: unknown[]): YamlStateSpec {
  // A state that ends by setting where to go next: that step off first,
  // then the rest read. Read together, a state whose steps end in an `if`
  // (a branch beside where the flow carries on, #267) had the transition
  // folded into the if's sides, and wasn't read as a transition at all.
  const last = sequence.at(-1);
  if (sequence.length > 1 && isPlainTransition(last)) {
    const { transition } = stripTrailingTransition(parseActionSequence([last]));
    return { kind: 'leaf', content: parseActionSequence(sequence.slice(0, -1)), transition };
  }
  const program = parseActionSequence(sequence);

  if (program.length === 1 && program[0].k === 'if') {
    const ifStep = program[0] as Extract<BStep, { k: 'if' }>;
    // The one `if:` step that runs, as written: each side read as the
    // leaf state's steps are, its transition off first (#336: a side whose
    // steps end in an `if` -- a fan-out branch that does nothing, written
    // inline -- had the transition folded into that if's sides).
    const ifRawSteps = sequence.filter(
      (s) =>
        s &&
        typeof s === 'object' &&
        Array.isArray((s as Record<string, unknown>).if) &&
        (s as Record<string, unknown>).enabled !== false
    ) as Record<string, unknown>[];
    const side = (raw: unknown, parsed: BProgram) => {
      const steps = Array.isArray(raw) ? raw : [];
      const last = steps.at(-1);
      if (ifRawSteps.length === 1 && steps.length > 1 && isPlainTransition(last)) {
        const { transition } = stripTrailingTransition(parseActionSequence([last]));
        return { content: parseActionSequence(steps.slice(0, -1)), transition };
      }
      return stripTrailingTransition(parsed);
    };
    const { content: trueContent, transition: trueTransition } = side(
      ifRawSteps[0]?.then,
      ifStep.then
    );
    // Bug #63: an until test's else may be an error guard -- only an `if:`
    // on the test's negation, then (really false) / else (the test couldn't
    // be evaluated). Recognized by its meaning: the guard's condition must
    // be equivalent to NOT the state's own.
    const guard = errorGuard(ifStep);
    const { content: falseContent, transition: falseTransition } = guard
      ? stripTrailingTransition(guard.then)
      : side(ifRawSteps[0]?.else, ifStep.else);
    // Re-derive the BoolExpr directly from the raw `if:` array here (rather
    // than trusting ifStep.cond, which parseActionSequence already computed
    // via the exact same parseConditionExpr this line calls) -- both are
    // the same value in practice, but re-deriving it from the untouched raw
    // step keeps this file's condition handling legible on its own terms
    // rather than reaching back into a BStep field that was only an
    // intermediate of a different parse path.
    // The one `if:` step that runs: a disabled one before it
    // isn't in `program` but was the first `if:` a lookup found.
    const ifRaws = sequence.filter(
      (s) =>
        s &&
        typeof s === 'object' &&
        Array.isArray((s as Record<string, unknown>).if) &&
        (s as Record<string, unknown>).enabled !== false
    ) as Record<string, unknown>[];
    const cond = ifRaws.length === 1 ? parseConditionExpr(ifRaws[0].if) : ifStep.cond;
    if (guard) {
      const { content: errorContent, transition: errorTransition } = stripTrailingTransition(
        guard.else
      );
      return {
        kind: 'condition',
        cond,
        trueContent,
        trueTransition,
        falseContent,
        falseTransition,
        errorContent,
        errorTransition,
      };
    }
    return { kind: 'condition', cond, trueContent, trueTransition, falseContent, falseTransition };
  }

  const { content, transition } = stripTrailingTransition(program);
  return { kind: 'leaf', content, transition };
}

/**
 * Locates the initial `variables: { current_node: <expr> } }` step and the
 * `repeat: { sequence: [{ choose: [...] }] }` dispatcher inside the
 * automation/script's own actions/sequence list, by structural pattern
 * (not by assuming a fixed index) -- both are searched for anywhere in the
 * top-level list, matching how FlowTranspiler's own metadata injection and
 * any future ordering change would still leave this file able to find
 * them.
 */
function findEntryExpression(steps: unknown[]): string | null {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const vars = (step as Record<string, unknown>).variables;
    if (
      vars &&
      typeof vars === 'object' &&
      typeof (vars as Record<string, unknown>).current_node === 'string'
    ) {
      return (vars as Record<string, unknown>).current_node as string;
    }
  }
  return null;
}

interface DispatcherBlocks {
  choose: unknown[];
  defaultBlock: unknown;
  /** Whether the dispatcher runs in the chunked run loop (#157). */
  runLoop: boolean;
  /** What's wrong with the loops around the dispatcher, if anything. */
  malformed?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The run loop's fixed bookkeeping (#157), read from state-machine.ts's
 * generate(): exactly these steps, whatever the graph. With a loop in the
 * graph the dispatcher runs in chunks of 9,999 rounds, so HA's 10,000-round
 * limit never stops the dispatch loop, and each round records the state
 * that ran before (each drawn loop counts its own rounds from it). Held to
 * its exact form: a round that records the wrong state, or a chunk past
 * HA's limit, still runs the same actions until a loop runs long. */
type Names = typeof MAIN_NAMES | ReturnType<typeof branchNames>;
const runReset = (n: Names) => ({ variables: { [n.rounds]: 0 } });
const runUntil = (n: Names) => `{{ ${n.node} == "END" or ${n.rounds} >= 9999 }}`;
const runRound = (n: Names) => ({
  variables: {
    [n.prev]: `{{ ${n.this} }}`,
    [n.this]: `{{ ${n.node} }}`,
    [n.rounds]: `{{ ${n.rounds} + 1 }}`,
  },
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function dispatchIn(steps: unknown[]): Record<string, unknown> | null {
  const found = steps.find((s) => isRecord(s) && Array.isArray(s.choose));
  return (found as Record<string, unknown> | undefined) ?? null;
}

function findChooseBlocks(
  steps: unknown[],
  /** The run loop's alias and the machine's names: the main one's, or a
   * branch machine's (#284). */
  runAlias: string = RUN_ALIAS,
  names: Names = MAIN_NAMES
): DispatcherBlocks | null {
  for (const step of steps) {
    if (!isRecord(step) || !isRecord(step.repeat)) continue;
    const loopSteps = asArray(step.repeat.sequence);
    const direct = dispatchIn(loopSteps);
    if (direct) {
      return { choose: direct.choose as unknown[], defaultBlock: direct.default, runLoop: false };
    }
    // With a loop in the graph the dispatcher sits one level down, in the
    // run loop (#157).
    const run = loopSteps.find((s) => isRecord(s) && isRecord(s.repeat));
    if (!isRecord(run) || !isRecord(run.repeat)) continue;
    const runSteps = asArray(run.repeat.sequence);
    const dispatch = dispatchIn(runSteps);
    if (!dispatch) continue;
    const exact =
      loopSteps.length === 2 &&
      same(loopSteps[0], runReset(names)) &&
      loopSteps[1] === run &&
      run.alias === runAlias &&
      Object.keys(run).sort().join() === 'alias,repeat' &&
      run.repeat.until === runUntil(names) &&
      Object.keys(run.repeat).sort().join() === 'sequence,until' &&
      runSteps.length === 2 &&
      same(runSteps[0], runRound(names)) &&
      runSteps[1] === dispatch;
    return {
      choose: dispatch.choose as unknown[],
      defaultBlock: dispatch.default,
      runLoop: true,
      ...(exact
        ? {}
        : {
            malformed: `the run loop around the dispatcher (#157) isn't the fixed form (reset run_rounds, then repeat in chunks of 9,999 rounds, recording the state before each): ${JSON.stringify(loopSteps).slice(0, 300)}`,
          }),
    };
  }
  return null;
}

/** state-machine.ts's own dispatcher `default:` branch (the choose
 * block's sibling, not a per-node "default" case) is fixed, graph-
 * independent boilerplate -- read directly from source (generate()'s
 * `actionSequence` literal): a `system_log.write` warning plus a
 * `current_node: END` transition, always exactly these two steps in this
 * order, regardless of what the user drew. It's therefore recognized here
 * by exact expected shape (not derived from the graph, which has no
 * concept of it at all) -- the same "never trust the strategy's own
 * construction code, but here there is no graph truth to independently
 * re-derive it from" situation as a fixed constant. */
function isExpectedDefaultBlock(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [logStep, endStep] = value;
  if (!logStep || typeof logStep !== 'object') return false;
  const log = logStep as Record<string, unknown>;
  // `action` since bug #280; saves before it say `service`.
  if ((log.action ?? log.service) !== 'system_log.write') return false;
  const data = log.data;
  if (!data || typeof data !== 'object') return false;
  const logData = data as Record<string, unknown>;
  if (logData.level !== 'warning') return false;
  if (typeof logData.message !== 'string' || !logData.message.includes('Unknown state'))
    return false;
  if (!endStep || typeof endStep !== 'object') return false;
  const vars = (endStep as Record<string, unknown>).variables;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return false;
  const varsObj = vars as Record<string, unknown>;
  return Object.keys(varsObj).length === 1 && varsObj.current_node === 'END';
}

/**
 * Parses the entry expression string into a YamlEntrySpec. A single literal
 * node id (no Jinja) is `{kind:'single'}`. Otherwise it must be the exact
 * if/elif/else chain generateEntryNodeExpression builds (read directly
 * from source): `{% if trigger.idx == "N" %}TARGET{% elif ... %}TARGET
 * {% else %}TARGET{% endif %}`. The else clause names no index: HA takes
 * it for every trigger the chain doesn't name, so this returns it
 * separately and the caller, which has the graph's own index set, gives
 * it to each of those (bug #195).
 */
function parseEntryExpression(expr: string): YamlEntrySpec {
  if (!expr.includes('{%')) {
    return { kind: 'single', target: expr.trim() };
  }
  const ifElifTargets = new Map<number, string>();
  const re = /\{%\s*(?:if|elif)\s+trigger\.idx\s*==\s*"(\d+)"\s*%\}([^{]*)/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(expr)) !== null) {
    // The first clause naming an index is the one HA takes.
    if (!ifElifTargets.has(Number(m[1]))) ifElifTargets.set(Number(m[1]), m[2].trim());
  }
  const elseMatch = expr.match(/\{%\s*else\s*%\}([^{]*)/);
  if (!elseMatch) {
    return {
      kind: 'malformed',
      reason: `templated entry expression has no {% else %} clause: ${expr}`,
    };
  }
  if (ifElifTargets.size === 0) {
    return {
      kind: 'malformed',
      reason: `templated entry expression has no if/elif clause: ${expr}`,
    };
  }
  return { kind: 'byTriggerIdx', ifElifTargets, elseTarget: elseMatch[1].trim() };
}

/**
 * A state as the shared comparison takes it (behaviorProgram.ts's
 * MachineState); with `withLoopSteps`, its loop bookkeeping too (a branch
 * machine's, compared there; the main dispatcher's is compared on its own).
 */
export function machineStateFromYaml(
  id: string,
  state: YamlStateSpec,
  withLoopSteps = false
): MachineState {
  const kept = withLoopSteps
    ? { loopSteps: JSON.stringify(state.loopSteps ?? { head: [], inThen: [] }) }
    : {};
  if (state.kind === 'malformed') return { id, ...kept, kind: 'malformed', reason: state.reason };
  if (state.kind === 'leaf') {
    return { id, ...kept, kind: 'leaf', content: state.content, next: state.transition };
  }
  return {
    id,
    ...kept,
    kind: 'condition',
    cond: state.cond,
    then: state.trueContent,
    thenNext: state.trueTransition,
    else: state.falseContent,
    elseNext: state.falseTransition,
    ...(state.errorTransition
      ? { error: { content: state.errorContent ?? [], next: state.errorTransition } }
      : {}),
  };
}

/**
 * #284: a branch machine at the start of `steps` (utils/branchMachine.ts's
 * fixed form: its start, then its loop, recognized by the loop's alias and
 * a variable named as a branch machine's), read as the main dispatcher is:
 * the steps after it in `rest`. Its states are read under the main
 * machine's names, once it is clear it uses only its own; anything off the
 * fixed form is a malformed machine, which never compares equal. Null when
 * `steps` doesn't start with one.
 */
export function readBranchMachine(steps: unknown[]): { step: BStep; rest: unknown[] } | null {
  const [init, loop] = steps;
  if (!isRecord(init) || !isRecord(init.variables)) return null;
  if (!isRecord(loop) || loop.alias !== BRANCH_ALIAS) return null;
  const name = Object.keys(init.variables).find(isBranchMachineName);
  if (name === undefined) return null;
  const rest = steps.slice(2);
  const n = branchNames(name);
  const malformed = (reason: string) => ({
    step: { k: 'machine' as const, name, entry: '', states: [], malformed: reason },
    rest,
  });
  const entry = init.variables[n.node];
  const start = { [n.node]: entry, [n.prev]: '', [n.this]: '', [n.rounds]: 0 };
  if (
    Object.keys(init).join() !== 'variables' ||
    typeof entry !== 'string' ||
    !same(init.variables, start)
  ) {
    return malformed(`its start isn't the fixed form: ${JSON.stringify(init).slice(0, 300)}`);
  }
  const repeat = loop.repeat;
  if (
    Object.keys(loop).sort().join() !== 'alias,repeat' ||
    !isRecord(repeat) ||
    Object.keys(repeat).sort().join() !== 'sequence,until' ||
    repeat.until !== `{{ ${n.node} == "END" }}`
  ) {
    return malformed(`its loop isn't the fixed form: ${JSON.stringify(loop).slice(0, 300)}`);
  }
  const dispatcher = findChooseBlocks([loop], BRANCH_RUN_ALIAS, n);
  if (dispatcher === null || !dispatcher.runLoop) {
    return malformed('its states are not in a run loop of their own');
  }
  if (dispatcher.malformed) return malformed(dispatcher.malformed);
  // HA writes a branch's `variables:` up to where the name already is, so
  // a branch machine using the main machine's names moves the main one.
  if (usesMachineNames([init, loop], MAIN_NAMES)) {
    return malformed("it uses the main machine's variables");
  }
  const cases = renameMachineVariables(dispatcher.choose, n, MAIN_NAMES) as unknown[];
  const fallback = renameMachineVariables(dispatcher.defaultBlock, n, MAIN_NAMES);
  if (!isExpectedDefaultBlock(fallback)) {
    return malformed(`its default isn't the fixed log line and END: ${JSON.stringify(fallback)}`);
  }
  const states: MachineState[] = [];
  for (const rawCase of cases) {
    if (!isRecord(rawCase)) continue;
    const id = extractDispatchId(rawCase);
    if (id === null) continue;
    // HA runs the first case that matches: a second for the same state never runs.
    if (states.some((s) => s.id === id)) return malformed(`two states for "${id}"`);
    states.push(machineStateFromYaml(id, parseState(asArray(rawCase.sequence)), true));
  }
  states.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { step: { k: 'machine', name, entry, states }, rest };
}

export function extractStateMachineFromYamlConfig(
  config: Record<string, unknown>
): StateMachineYamlExtraction {
  const rawTriggers = asArray(config.triggers ?? config.trigger) as Record<string, unknown>[];
  const triggers = rawTriggers.map(normalizeTrigger);

  const stepsRaw = config.actions ?? config.action ?? config.sequence;
  const steps = asArray(stepsRaw);

  if (steps.length === 0) {
    return {
      isEmpty: true,
      triggers,
      states: new Map(),
      parallelEntries: new Map(),
      entry: { kind: 'single', target: 'END' },
    };
  }

  const entryExpr = findEntryExpression(steps);
  const dispatcher = findChooseBlocks(steps);
  if (entryExpr === null || dispatcher === null) {
    return {
      isEmpty: false,
      malformed: `expected a state-machine dispatcher (a current_node variables step and a repeat/choose loop) but could not find one in: ${JSON.stringify(steps).slice(0, 300)}`,
      triggers,
      states: new Map(),
      parallelEntries: new Map(),
      entry: { kind: 'malformed', reason: 'dispatcher not found' },
    };
  }
  const chooseBlocks = dispatcher.choose;
  const init = steps.find(
    (s): s is Record<string, unknown> =>
      isRecord(s) && isRecord(s.variables) && 'current_node' in s.variables
  );
  const initVars = init && isRecord(init.variables) ? init.variables : {};
  const runInit =
    initVars.prev_node === '' && initVars.this_node === '' && initVars.run_rounds === 0;
  const loopVars = Object.keys(initVars).filter((k) => k.startsWith('loop_rounds_'));
  const passProblem =
    dispatcher.malformed ??
    (dispatcher.runLoop && !runInit
      ? 'the run loop (#157) is there but prev_node, this_node and run_rounds are not set with current_node'
      : undefined) ??
    (loopVars.some((k) => initVars[k] !== 0)
      ? 'a loop round variable (#157) is not set to 0 with current_node'
      : undefined);
  if (passProblem) {
    return {
      isEmpty: false,
      malformed: passProblem,
      triggers,
      states: new Map(),
      parallelEntries: new Map(),
      entry: { kind: 'malformed', reason: 'run loop' },
    };
  }
  if (!isExpectedDefaultBlock(dispatcher.defaultBlock)) {
    return {
      isEmpty: false,
      malformed: `dispatcher's fixed default-branch safety net (system_log.write warning + current_node: END) is missing or corrupted: ${JSON.stringify(dispatcher.defaultBlock)}`,
      triggers,
      states: new Map(),
      parallelEntries: new Map(),
      entry: { kind: 'malformed', reason: 'default branch corrupted' },
    };
  }

  const states = new Map<string, YamlStateSpec>();
  const parallelEntries = new Map<string, YamlParallelEntrySpec>();

  for (const rawCase of chooseBlocks) {
    if (!rawCase || typeof rawCase !== 'object') continue;
    const caseObj = rawCase as Record<string, unknown>;
    const dispatchId = extractDispatchId(caseObj);
    if (dispatchId === null) continue; // not a recognizable dispatch case -- ignored rather than failing the whole extraction, matching this file's "recognize the documented shape, don't assume it's the only thing present" stance.
    const sequence = asArray(caseObj.sequence);

    if (dispatchId.startsWith('__parallel_trigger_')) {
      const program = parseActionSequence(sequence);
      const { content, transition } = stripTrailingTransition(program);
      parallelEntries.set(dispatchId, { content, transition });
      continue;
    }

    states.set(dispatchId, parseState(sequence));
  }

  const entry = parseEntryExpression(entryExpr);

  return {
    isEmpty: false,
    triggers,
    states,
    parallelEntries,
    entry,
    runLoop: dispatcher.runLoop,
    loopVars,
    noStepsStop: steps.some(isNoStepsStop),
  };
}
