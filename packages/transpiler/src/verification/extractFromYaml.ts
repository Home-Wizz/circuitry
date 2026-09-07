import type { BProgram, BStep } from './behaviorProgram';
import { normalizeActionData } from './behaviorProgram';
import { yamlStepToCompiled } from './compiledAction';
import { parseConditionExpr } from './boolean';

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

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isBareConditionGate(step: Record<string, unknown>): boolean {
  if (!('condition' in step)) return false;
  return !ACTION_TYPE_KEYS.some((key) => key in step && key !== 'variables');
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

  // "Grouping actions" -- purely a naming/UI aid, inline its body directly
  // (see extractFromGraph.ts's identical treatment of sequence_start/end).
  if (Array.isArray(step.sequence) && !('choose' in step) && !('if' in step) && !('repeat' in step) && !('parallel' in step)) {
    return [...parseActionSequence(step.sequence), ...parseActionSequence(tail)];
  }

  if (Array.isArray(step.parallel)) {
    const branches = step.parallel.map((branch) => parseActionSequence(asArray(branch)));
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

  if (Array.isArray(step.if)) {
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

  // Leaf action step.
  const bstep: BStep = { k: 'action', call: normalizeActionData(yamlStepToCompiled(step)) };
  return [bstep, ...parseActionSequence(tail)];
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
    if (value === undefined || value === '') continue;
    if (value === null && key !== 'from' && key !== 'to') continue;
    cleaned[key] = value;
  }
  if (typeof cleaned.context_user_id === 'string' && cleaned.context_user_id) {
    const { context_user_id, ...rest } = cleaned;
    return { ...rest, context: { user_id: context_user_id } };
  }
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
export function extractFromYamlConfig(config: Record<string, unknown>): YamlExtraction {
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

  const variables = { ...(config.variables as Record<string, unknown> | undefined) };
  delete variables._circuitry_metadata;
  delete variables._flode_metadata;
  delete variables._cafe_metadata;

  return {
    triggers,
    program,
    scriptFields: config.fields as Record<string, unknown> | undefined,
    isScriptMode,
    mode: (config.mode as string | undefined) ?? 'single',
    max: config.max,
    maxExceeded: config.max_exceeded,
    initialState: config.initial_state,
    trace: config.trace,
    userVariables: variables,
    triggerVariables: config.trigger_variables as Record<string, unknown> | undefined,
  };
}
