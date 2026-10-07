import { haBoolean, haCoerceAutomation, TRIGGER_KEYS_KEEPING_NULL } from '@circuitry/shared';
import type { BProgram, BStep } from './behaviorProgram';
import { normalizeActionData } from './behaviorProgram';
import { yamlStepToCompiled } from './compiledAction';
import { isConditionShorthand, parseConditionExpr } from './boolean';

/**
 * Extracts a canonical BProgram directly from a parsed Home Assistant
 * automation/script config (the plain JS object produced by loading the
 * candidate YAML string -- NOT a re-decompile back into a FlowGraph via
 * YamlParser). Walking the config's own `actions`/`sequence` tree directly
 * means this file only ever needs to understand HA's documented execution
 * grammar (if/then/else, choose/default, parallel, repeat, sequence,
 * inline condition-as-gate) -- it has no dependency on YamlParser's own
 * shape-recognition heuristics (which exist to solve a different problem:
 * reconstructing canvas node positions/ids, not behavior), so a bug there
 * can't hide a real behavioral difference from this comparison either.
 *
 * See extractFromGraph.ts's doc comment for why sharing `parseConditionExpr`
 * with that file is safe (it's a direct encoding of HA's own and/or/not
 * semantics, not a NativeStrategy shaping heuristic).
 */

export interface YamlExtraction {
  triggers: Record<string, unknown>[];
  program: BProgram;
  scriptFields?: Record<string, unknown>;
  isScriptMode: boolean;
  mode: string;
  max?: unknown;
  maxExceeded?: unknown;
  initialState?: unknown;
  trace?: unknown;
  userVariables: Record<string, unknown>;
  triggerVariables?: Record<string, unknown>;
}

const ACTION_TYPE_KEYS = [
  'service',
  'action',
  'event',
  'stop',
  'delay',
  'wait_template',
  'wait_for_trigger',
  'repeat',
  'choose',
  'if',
  'parallel',
  'sequence',
  'variables',
];

/** Steps that hold other steps. */
const BLOCK_KEYS = ['if', 'choose', 'parallel', 'repeat', 'sequence'];

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isBareConditionGate(step: Record<string, unknown>): boolean {
  // HA's shorthand `and:`/`or:`/`not:` as a step is a condition step too.
  if (isConditionShorthand(step)) return true;
  if (!('condition' in step)) return false;
  return !ACTION_TYPE_KEYS.some((key) => key in step && key !== 'variables');
}

/**
 * A `repeat: count` the canvas can't hold as a loop -- anything but a whole
 * number of 1 or more: HA runs the body no times for 0 or less, rounds a
 * non-integer down and renders a template. The graph keeps such a block
 * as an opaque step (bug #73), so it's compared exactly as written, like a
 * leaf step. The gate's own copy of the parser's rule
 * (isUnexpandableCountRepeat), kept separate like the gate's other rules.
 */
function isCountKeptAsWritten(step: Record<string, unknown>): boolean {
  const repeat = step.repeat;
  if (!repeat || typeof repeat !== 'object' || Array.isArray(repeat)) return false;
  const r = repeat as Record<string, unknown>;
  if (!('count' in r) || 'while' in r || 'until' in r || 'for_each' in r) return false;
  const count = r.count;
  if (typeof count === 'number') return !Number.isInteger(count) || count < 1;
  if (typeof count === 'string') return !/^\s*\d+\s*$/.test(count) || Number(count) < 1;
  return true;
}

/**
 * A `parallel:` with one branch that sets `wait` (a wait step anywhere in
 * it): HA keeps `wait` to that branch, so it isn't the branch's steps in
 * line, and the graph keeps such a block as an opaque step (bug #81). It's
 * compared exactly as written, like a leaf step. The gate's own copy of
 * the parser's rule (isWaitScopedParallel).
 */
function isParallelKeptAsWritten(step: Record<string, unknown>): boolean {
  const branches = step.parallel;
  return Array.isArray(branches) && branches.length === 1 && containsWaitStep(branches[0]);
}

/** Keys HA's parallel branch container takes (_SCRIPT_SEQUENCE_SCHEMA). */
const PARALLEL_CONTAINER_KEYS = [
  'sequence',
  'alias',
  'enabled',
  'continue_on_error',
  'note',
  'metadata',
];

/**
 * The steps a `parallel:` branch runs, as HA reads it (bug #94): a list is
 * the branch; a mapping with `sequence:` (and only a container's keys) is
 * a branch container, which runs its `sequence` unless its `enabled` is a
 * false boolean, ignoring its `continue_on_error` and an `enabled`
 * template (script.py, _async_prep_parallel_scripts); any other mapping is
 * the branch's one step. The gate's own copy of the parser's rule
 * (parallelBranchContainer). It read a container as a `sequence:` step
 * with those keys, the same mistake the parser and both strategies made.
 */
function parallelBranchSteps(branch: unknown): unknown[] {
  if (Array.isArray(branch)) return branch;
  if (!branch || typeof branch !== 'object' || !('sequence' in branch)) return [branch];
  const container = branch as Record<string, unknown>;
  if (!Object.keys(container).every((key) => PARALLEL_CONTAINER_KEYS.includes(key)))
    return [branch];
  return haBoolean(container.enabled) === false ? [] : asArray(container.sequence);
}

/**
 * A `choose:` with no options, or with an always-true option (`conditions:
 * []`) followed by another option or a default: nothing after the
 * always-true option ever runs, and the graph keeps such a block as an
 * opaque step (bug #98), so it's compared exactly as written; and one with
 * an option that isn't a mapping, which HA refuses (#146). The gate's own
 * copy of the parser's rule (isStepKeptAsWritten).
 */
function isChooseKeptAsWritten(step: Record<string, unknown>): boolean {
  if (!('choose' in step) || step.choose === undefined || step.choose === null) return false;
  const options = asArray(step.choose);
  if (options.length === 0) return true;
  // An option that isn't a mapping (#146).
  if (
    !options.every((option) => !!option && typeof option === 'object' && !Array.isArray(option))
  ) {
    return true;
  }
  const always = options.findIndex((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return false;
    return asArray((option as Record<string, unknown>).conditions).length === 0;
  });
  return always !== -1 && (always < options.length - 1 || asArray(step.default).length > 0);
}

/**
 * An `if:` with no conditions (an empty list, or `null`, which HA reads as
 * one): the graph keeps it as an opaque step (#145), so it's compared
 * exactly as written. The gate's own copy of the parser's rule
 * (isStepKeptAsWritten).
 */
function isIfKeptAsWritten(step: Record<string, unknown>): boolean {
  return 'if' in step && step.if !== undefined && asArray(step.if).length === 0;
}

function containsWaitStep(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsWaitStep);
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    'wait_template' in obj || 'wait_for_trigger' in obj || Object.values(obj).some(containsWaitStep)
  );
}

function normalizeCount(value: unknown): string {
  return value === undefined ? '' : String(value);
}

/**
 * Parses one action-sequence array into a BProgram, threading each step's
 * "rest of the sequence" continuation into whatever branch(es) that step
 * creates -- this is how a `choose:`/`if:`/bare-condition-gate step's
 * trailing continuation ends up correctly appended inside each of its
 * branches (mirroring exactly how HA itself keeps executing the rest of
 * the surrounding sequence once a branch completes) instead of being
 * dropped or duplicated.
 */
export function parseActionSequence(steps: unknown[]): BProgram {
  if (steps.length === 0) return [];
  const [head, ...tail] = steps;
  if (!head || typeof head !== 'object') return parseActionSequence(tail);
  const step = head as Record<string, unknown>;

  // Phase 5 (2026-09-26): HA skips a step marked `enabled: false` -- any
  // kind, a whole if/choose/parallel/repeat block included -- so it
  // contributes nothing. Before this a disabled BLOCK was read as if it
  // ran, on both sides of every comparison, so output that dropped the
  // flag from a block passed the gate.
  if (step.enabled === false) return parseActionSequence(tail);

  // A block whose `enabled:` is a template runs or not as HA renders it
  // when it gets there, so there's no structure to compare: it is compared
  // exactly as written, like a leaf step (bug #70; the graph keeps such a
  // block as an opaque step).
  if (typeof step.enabled === 'string' && BLOCK_KEYS.some((key) => key in step)) {
    return [leafStep(step), ...parseActionSequence(tail)];
  }
  // A block that catches its own steps' errors (`continue_on_error: true`)
  // is kept as written too (bug #88; the graph can't hold it on a block),
  // so it's compared exactly as written, like a leaf step.
  if (step.continue_on_error === true && BLOCK_KEYS.some((key) => key in step)) {
    return [leafStep(step), ...parseActionSequence(tail)];
  }
  if (
    isCountKeptAsWritten(step) ||
    isParallelKeptAsWritten(step) ||
    isChooseKeptAsWritten(step) ||
    isIfKeptAsWritten(step)
  ) {
    return [leafStep(step), ...parseActionSequence(tail)];
  }

  // "Grouping actions" -- purely a naming/UI aid, inline its body directly
  // (see extractFromGraph.ts's identical treatment of sequence_start/end).
  // One step where a list goes is a list of one (HA's ensure_list), for
  // `sequence:`, `parallel:` and a branch alike; they used to be read only
  // as lists, and one step became an unknown leaf (a checker gap the
  // hard-case corpus showed, 2026-09-27).
  if (
    step.sequence !== undefined &&
    step.sequence !== null &&
    !('choose' in step) &&
    !('if' in step) &&
    !('repeat' in step) &&
    !('parallel' in step)
  ) {
    return [...parseActionSequence(asArray(step.sequence)), ...parseActionSequence(tail)];
  }

  if (step.parallel !== undefined && step.parallel !== null) {
    const branches = asArray(step.parallel).map((branch) =>
      parseActionSequence(parallelBranchSteps(branch))
    );
    const rest = parseActionSequence(tail);
    return [{ k: 'parallel', branches }, ...rest];
  }

  if (step.repeat && typeof step.repeat === 'object') {
    const repeat = step.repeat as Record<string, unknown>;
    const body = parseActionSequence(asArray(repeat.sequence));
    const rest = parseActionSequence(tail);
    if (repeat.while !== undefined) {
      return [{ k: 'repeat', mode: 'while', test: parseConditionExpr(repeat.while), body }, ...rest];
    }
    if (repeat.until !== undefined) {
      return [{ k: 'repeat', mode: 'until', test: parseConditionExpr(repeat.until), body }, ...rest];
    }
    return [{ k: 'repeat', mode: 'count', count: normalizeCount(repeat.count), body }, ...rest];
  }

  if (step.if !== undefined && step.if !== null) {
    const cond = parseConditionExpr(step.if);
    const rest = parseActionSequence(tail);
    const thenProgram = [...parseActionSequence(asArray(step.then)), ...rest];
    const elseProgram = [...parseActionSequence(asArray(step.else)), ...rest];
    return [{ k: 'if', cond, then: thenProgram, else: elseProgram }];
  }

  if (step.choose !== undefined) {
    const cases = asArray(step.choose) as Array<{ conditions: unknown; sequence: unknown }>;
    const defaultSeq = asArray(step.default);
    const rest = parseActionSequence(tail);
    return [desugarChoose(cases, 0, defaultSeq, rest)];
  }

  if (isBareConditionGate(step)) {
    // HA's "Stop the automation based on a condition" shorthand -- a bare
    // condition object appearing directly as an action step gates
    // everything remaining in this same sequence, exactly like a root
    // `conditions:` block gates the whole `actions:` sequence. Both cases
    // reduce to the exact same 'if' shape here, so leading-condition
    // promotion vs. a mid-sequence bare condition never need separate
    // handling.
    const rest = parseActionSequence(tail);
    return [{ k: 'if', cond: parseConditionExpr(step), then: rest, else: [] }];
  }

  return [leafStep(step), ...parseActionSequence(tail)];
}

/** A leaf action step, compared exactly as written. */
function leafStep(step: Record<string, unknown>): BStep {
  // One trigger where a wait takes a list is a list of one (HA's
  // ensure_list; a checker gap the hard-case corpus showed, 2026-09-27).
  const listed =
    step.wait_for_trigger !== undefined &&
    step.wait_for_trigger !== null &&
    !Array.isArray(step.wait_for_trigger)
      ? { ...step, wait_for_trigger: [step.wait_for_trigger] }
      : step;
  return { k: 'action', call: normalizeActionData(yamlStepToCompiled(listed)) };
}

function desugarChoose(
  cases: Array<{ conditions: unknown; sequence: unknown }>,
  index: number,
  defaultSeq: unknown[],
  rest: BProgram
): BStep {
  if (index >= cases.length) {
    return { k: 'if', cond: { op: 'const', value: true }, then: [...parseActionSequence(defaultSeq), ...rest], else: [] };
  }
  const c = cases[index];
  const cond = parseConditionExpr(c.conditions);
  const thenProgram = [...parseActionSequence(asArray(c.sequence)), ...rest];
  if (index === cases.length - 1) {
    const elseProgram = [...parseActionSequence(defaultSeq), ...rest];
    return { k: 'if', cond, then: thenProgram, else: elseProgram };
  }
  return { k: 'if', cond, then: thenProgram, else: [desugarChoose(cases, index + 1, defaultSeq, rest)] };
}

export function normalizeTrigger(trigger: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(trigger)) {
    if (key.startsWith('_')) continue;
    if (value === undefined) continue; // "" kept (bug #72)
    if (value === null && !TRIGGER_KEYS_KEEPING_NULL.has(key)) continue;
    cleaned[key] = value;
  }
  if (typeof cleaned.context_user_id === 'string' && cleaned.context_user_id) {
    const { context_user_id, ...rest } = cleaned;
    return { ...rest, context: { user_id: context_user_id } };
  }
  // A blank editing field (no user): not an HA key, never written (the
  // strategies' fold drops it too). Kept apart now that "" isn't dropped
  // wholesale (bug #72).
  delete cleaned.context_user_id;
  return cleaned;
}

/**
 * Parses the top-level automation/script config object -- the direct
 * result of `yaml.load()`-ing the candidate YAML string, with
 * `_circuitry_metadata` already excluded from `variables` by the caller.
 * Root `conditions:`/`condition:` becomes an 'if' step wrapping the whole
 * action program with an empty else (see parseActionSequence's identical
 * treatment of a bare mid-sequence condition step -- both reduce to the
 * same shape).
 */
export function extractFromYamlConfig(written: Record<string, unknown>): YamlExtraction {
  // Values HA coerces read as HA reads them (#144): an `enabled: 0` step is
  // disabled, a `continue_on_error: "yes"` block catches errors.
  const config = haCoerceAutomation(written);
  const isScriptMode = !('triggers' in config) && !('trigger' in config);
  const rawTriggers = asArray(config.triggers ?? config.trigger) as Record<string, unknown>[];
  const triggers = rawTriggers.map(normalizeTrigger);

  const actionsRaw = asArray(config.actions ?? config.action ?? config.sequence);
  let program = parseActionSequence(actionsRaw);

  const rootConditions = config.conditions ?? config.condition;
  if (rootConditions !== undefined) {
    const cond = parseConditionExpr(rootConditions);
    program = [{ k: 'if', cond, then: program, else: [] }];
  }

  return {
    triggers,
    program,
    isScriptMode,
    ...extractYamlSettings(config),
  };
}

/** The candidate YAML's automation-level settings, in the same shape as
 * extractFromGraph.ts's FlowSettings, so either verifier can compare them
 * with verifyNativeOutput's compareMetadata. */
export function extractYamlSettings(
  config: Record<string, unknown>
): Pick<
  YamlExtraction,
  | 'scriptFields'
  | 'mode'
  | 'max'
  | 'maxExceeded'
  | 'initialState'
  | 'trace'
  | 'userVariables'
  | 'triggerVariables'
> {
  const variables = { ...(config.variables as Record<string, unknown> | undefined) };
  delete variables._circuitry_metadata;
  delete variables._flode_metadata;
  delete variables._cafe_metadata;
  return {
    scriptFields: config.fields as Record<string, unknown> | undefined,
    mode: (config.mode as string | undefined) ?? 'single',
    max: config.max,
    maxExceeded: config.max_exceeded,
    initialState: config.initial_state,
    trace: config.trace,
    userVariables: variables,
    triggerVariables: config.trigger_variables as Record<string, unknown> | undefined,
  };
}
