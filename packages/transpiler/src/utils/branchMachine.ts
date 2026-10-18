/**
 * A fan-out branch written as a state machine of its own (#284): the main
 * dispatcher's form, run inside
 * one branch of a `parallel:`, on variables of its own.
 *
 * HA writes a `variables:` step inside a parallel branch up to the scope
 * that already has the name, else the top level (helpers/script_variables.py,
 * HA 2026.10), so a branch machine needs names no other machine uses; its
 * `repeat` reads them back from the full scope, as the main one reads
 * `current_node`. The names are derived from the branch's steps, so the
 * same drawing always gives the same YAML.
 *
 * Fixed form, held to exactly by the state-machine YAML reader:
 *
 * ```yaml
 * - variables: { NAME: <first state>, NAME_prev: "", NAME_this: "", NAME_rounds: 0 }
 * - alias: Branch State Machine
 *   repeat:
 *     until: '{{ NAME == "END" }}'
 *     sequence:
 *       - variables: { NAME_rounds: 0 }
 *       - alias: Branch State Machine Run
 *         repeat:
 *           until: '{{ NAME == "END" or NAME_rounds >= 9999 }}'
 *           sequence:
 *             - variables: { NAME_prev: "{{ NAME_this }}", NAME_this: "{{ NAME }}", NAME_rounds: "{{ NAME_rounds + 1 }}" }
 *             - choose: [...one case per state...]
 *               default: [...the main dispatcher's log line, NAME: END...]
 * ```
 *
 * Every machine in a branch has a loop (that is why it is one), so it
 * always runs in chunks under HA's 10,000-round limit, as the main one
 * does with a loop (#157).
 */
import { fnv1aHex } from './fanOutHash';
import { RUN_CHUNK } from './stateMachineLoops';

export const BRANCH_ALIAS = 'Branch State Machine';
export const BRANCH_RUN_ALIAS = 'Branch State Machine Run';
const NAME = /^branch_[0-9a-f]{8}$/;

/** The variable names of the machine for the branch whose steps are
 * `region` and which starts at `entry`. */
export function branchMachineName(region: Iterable<string>, entry: string): string {
  return `branch_${fnv1aHex(JSON.stringify([entry, [...region].sort()]))}`;
}

export function isBranchMachineName(name: string): boolean {
  return NAME.test(name);
}

/** The main machine's names, which a branch machine's states are written
 * with first and then renamed from. */
export const MAIN_NAMES = {
  node: 'current_node',
  prev: 'prev_node',
  this: 'this_node',
  rounds: 'run_rounds',
} as const;

export function branchNames(name: string): Record<keyof typeof MAIN_NAMES, string> {
  return { node: name, prev: `${name}_prev`, this: `${name}_this`, rounds: `${name}_rounds` };
}

/** The two steps of a branch machine: its start, and its run loop round
 * `dispatch` (a `choose:` with its `default:`). */
export function branchMachineSteps(
  name: string,
  entry: string,
  dispatch: Record<string, unknown>
): Record<string, unknown>[] {
  const n = branchNames(name);
  return [
    { variables: { [n.node]: entry, [n.prev]: '', [n.this]: '', [n.rounds]: 0 } },
    {
      alias: BRANCH_ALIAS,
      repeat: {
        until: `{{ ${n.node} == "END" }}`,
        sequence: [
          { variables: { [n.rounds]: 0 } },
          {
            alias: BRANCH_RUN_ALIAS,
            repeat: {
              until: `{{ ${n.node} == "END" or ${n.rounds} >= ${RUN_CHUNK} }}`,
              sequence: [
                {
                  variables: {
                    [n.prev]: `{{ ${n.this} }}`,
                    [n.this]: `{{ ${n.node} }}`,
                    [n.rounds]: `{{ ${n.rounds} + 1 }}`,
                  },
                },
                dispatch,
              ],
            },
          },
        ],
      },
    },
  ];
}

type MachineNames = Record<keyof typeof MAIN_NAMES, string>;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `value` (a machine's states) with the variable names `from` replaced by
 * `to` where the machine itself uses them, and nowhere else: as
 * `variables:` keys (a move to another state), in a state's own gate
 * (`{{ NODE == "id" }}`) and in a loop's round count (`{{ PREV in [...] }}`,
 * utils/stateMachineLoops.ts). The steps the user drew are left exactly as
 * drawn, a word like `current_node` in a message included; a branch
 * machine inside keeps its own names.
 */
export function renameMachineVariables(
  value: unknown,
  from: MachineNames,
  to: MachineNames
): unknown {
  const keys = new Map(
    (Object.keys(from) as (keyof typeof MAIN_NAMES)[]).map((k) => [from[k], to[k]] as const)
  );
  const gate = new RegExp(`^\\{\\{ ${escapeRegex(from.node)} == "[^"]*" \\}\\}$`);
  const rounds = new RegExp(`^\\{\\{ ${escapeRegex(from.prev)} in \\[.*\\] \\}\\}$`);
  const renameText = (text: string): string => {
    if (gate.test(text)) return text.replace(from.node, to.node);
    if (rounds.test(text)) return text.replace(from.prev, to.prev);
    return text;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return renameText(v);
    if (Array.isArray(v)) return sameOr(v, v.map(walk));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) {
        if (k === 'variables' && inner && typeof inner === 'object' && !Array.isArray(inner)) {
          const vars: Record<string, unknown> = {};
          for (const [name, assigned] of Object.entries(inner)) {
            vars[keys.get(name) ?? name] = walk(assigned);
          }
          out[k] = sameOr(inner, vars);
        } else out[k] = walk(inner);
      }
      return sameOr(v, out);
    }
    return v;
  };
  return walk(value);
}

/**
 * `original` when `copy` has the same keys and the very same values (a
 * walk that changed nothing in it), else `copy`: the steps the user drew
 * stay the objects they were, so the YAML writes a step shared between a
 * machine and the dispatcher once (an anchor), as before.
 */
function sameOr<T>(original: T, copy: T): T {
  if (Array.isArray(original) && Array.isArray(copy)) {
    return original.length === copy.length && original.every((v, i) => v === copy[i])
      ? original
      : copy;
  }
  const a = original as Record<string, unknown>;
  const b = copy as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && a[k] === b[k])
    ? original
    : copy;
}

/** Whether `value` uses the names `names` where a machine does (see
 * renameMachineVariables): the state-machine reader holds a branch
 * machine to using only its own. */
export function usesMachineNames(value: unknown, names: MachineNames): boolean {
  const elsewhere = { node: '\u0000n', prev: '\u0000p', this: '\u0000t', rounds: '\u0000r' };
  return JSON.stringify(renameMachineVariables(value, names, elsewhere)) !== JSON.stringify(value);
}

/** `value` (a branch machine's states, under the main machine's names)
 * with every move to a state outside `region` made a move to END: the
 * branch ends there, and the enclosing run goes on where its branches
 * meet. */
export function endOutside(value: unknown, region: Set<string>): unknown {
  if (Array.isArray(value))
    return sameOr(
      value,
      value.map((v) => endOutside(v, region))
    );
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'variables' && v && typeof v === 'object' && !Array.isArray(v)) {
      const vars = { ...(v as Record<string, unknown>) };
      const next = vars[MAIN_NAMES.node];
      if (typeof next === 'string' && next !== 'END' && !region.has(next))
        vars[MAIN_NAMES.node] = 'END';
      out[k] = sameOr(v, vars);
    } else out[k] = endOutside(v, region);
  }
  return sameOr(value, out);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A branch machine making up the whole of `steps` (its start and its loop,
 * as branchMachineSteps writes them): its first state and its states'
 * dispatch cases, under the main machine's names. Null for anything else.
 * For the decompiler, which rebuilds the branch from those states; the
 * gate reads the form exactly.
 */
export function branchMachineIn(
  steps: unknown[]
): { name: string; entry: string; cases: unknown[] } | null {
  if (steps.length !== 2) return null;
  const [init, loop] = steps;
  if (!isRecord(init) || !isRecord(init.variables) || !isRecord(loop)) return null;
  if (loop.alias !== BRANCH_ALIAS || !isRecord(loop.repeat)) return null;
  const name = Object.keys(init.variables).find(isBranchMachineName);
  const entry = name === undefined ? undefined : init.variables[name];
  if (name === undefined || typeof entry !== 'string') return null;
  const outer = loop.repeat.sequence;
  const run = Array.isArray(outer) ? outer[1] : undefined;
  if (!isRecord(run) || run.alias !== BRANCH_RUN_ALIAS || !isRecord(run.repeat)) return null;
  const inner = run.repeat.sequence;
  const dispatch = Array.isArray(inner) ? inner[1] : undefined;
  if (!isRecord(dispatch) || !Array.isArray(dispatch.choose)) return null;
  const cases = renameMachineVariables(dispatch.choose, branchNames(name), MAIN_NAMES);
  return { name, entry, cases: cases as unknown[] };
}
