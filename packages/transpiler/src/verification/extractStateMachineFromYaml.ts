import type { BProgram, BStep } from './behaviorProgram';
import { type BoolExpr, parseConditionExpr } from './boolean';
import { normalizeTrigger, parseActionSequence } from './extractFromYaml';

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
}

export type YamlStateSpec = YamlLeafState | YamlConditionState | { kind: 'malformed'; reason: string };

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
function stripTrailingTransition(program: BProgram): { content: BProgram; transition: YamlTransition } {
  if (program.length === 0) {
    return { content: program, transition: { kind: 'malformed', reason: 'no steps at all (expected a current_node transition)' } };
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
    transition: { kind: 'malformed', reason: `last step is not a plain current_node transition: ${JSON.stringify(last)}` },
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

function parseState(sequence: unknown[]): YamlStateSpec {
  const program = parseActionSequence(sequence);

  if (program.length === 1 && program[0].k === 'if') {
    const ifStep = program[0] as Extract<BStep, { k: 'if' }>;
    const { content: trueContent, transition: trueTransition } = stripTrailingTransition(ifStep.then);
    const { content: falseContent, transition: falseTransition } = stripTrailingTransition(ifStep.else);
    // Re-derive the BoolExpr directly from the raw `if:` array here (rather
    // than trusting ifStep.cond, which parseActionSequence already computed
    // via the exact same parseConditionExpr this line calls) -- both are
    // the same value in practice, but re-deriving it from the untouched raw
    // step keeps this file's condition handling legible on its own terms
    // rather than reaching back into a BStep field that was only an
    // intermediate of a different parse path.
    const ifRaw = sequence.find(
      (s) => s && typeof s === 'object' && Array.isArray((s as Record<string, unknown>).if)
    ) as Record<string, unknown> | undefined;
    const cond = ifRaw ? parseConditionExpr(ifRaw.if) : ifStep.cond;
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
    if (vars && typeof vars === 'object' && typeof (vars as Record<string, unknown>).current_node === 'string') {
      return (vars as Record<string, unknown>).current_node as string;
    }
  }
  return null;
}

interface DispatcherBlocks {
  choose: unknown[];
  defaultBlock: unknown;
}

function findChooseBlocks(steps: unknown[]): DispatcherBlocks | null {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const repeat = (step as Record<string, unknown>).repeat;
    if (!repeat || typeof repeat !== 'object') continue;
    for (const inner of asArray((repeat as Record<string, unknown>).sequence)) {
      if (inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>).choose)) {
        const innerObj = inner as Record<string, unknown>;
        return { choose: innerObj.choose as unknown[], defaultBlock: innerObj.default };
      }
    }
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
  if (log.service !== 'system_log.write') return false;
  const data = log.data;
  if (!data || typeof data !== 'object') return false;
  const logData = data as Record<string, unknown>;
  if (logData.level !== 'warning') return false;
  if (typeof logData.message !== 'string' || !logData.message.includes('Unknown state')) return false;
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
 * {% else %}TARGET{% endif %}`. That template deliberately never restates
 * the else-clause's own trigger index (it's whichever index isn't covered
 * by an if/elif) -- so this returns the else target separately, and the
 * caller (which has the graph's own real index set) resolves which index
 * it belongs to, rather than this file guessing.
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
    ifElifTargets.set(Number(m[1]), m[2].trim());
  }
  const elseMatch = expr.match(/\{%\s*else\s*%\}([^{]*)/);
  if (!elseMatch) {
    return { kind: 'malformed', reason: `templated entry expression has no {% else %} clause: ${expr}` };
  }
  if (ifElifTargets.size === 0) {
    return { kind: 'malformed', reason: `templated entry expression has no if/elif clause: ${expr}` };
  }
  return { kind: 'byTriggerIdx', ifElifTargets, elseTarget: elseMatch[1].trim() };
}

export function extractStateMachineFromYamlConfig(config: Record<string, unknown>): StateMachineYamlExtraction {
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

  return { isEmpty: false, triggers, states, parallelEntries, entry };
}
