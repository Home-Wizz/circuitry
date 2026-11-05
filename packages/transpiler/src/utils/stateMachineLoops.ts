/**
 * The state machine's loop bookkeeping (#157): HA stops a `repeat:
 * while/until` after 10,000 rounds and never stops a `repeat: count`. The
 * state machine runs the whole automation in its own dispatch loop, so it
 * keeps each drawn loop's rounds itself:
 *
 * - every dispatch round records the state that ran before (`prev_node`);
 * - a loop's head state counts its rounds (`loop_rounds_N`): one more when
 *   the state before it was inside the loop, 1 when the loop was entered;
 * - a while loop stops the run when its test passes on a round past
 *   10,000, an until loop (and a loop drawn by hand) when a round past
 *   10,000 would start, as HA's repeat does; a count loop never;
 * - the dispatch loop itself runs in chunks of 9,999 rounds, so HA's limit
 *   on it is never what stops a run.
 *
 * The aliases mark the steps for the readers (the decompiler skips them;
 * the state-machine gate holds them to their exact form).
 */
export const LOOP_ROUNDS_ALIAS = 'Loop rounds';
export const LOOP_LIMIT_ALIAS = 'Loop limit';
export const RUN_ALIAS = 'State Machine Run';
/** HA's REPEAT_TERMINATE_ITERATIONS. */
export const HA_REPEAT_LIMIT = 10000;
/** Dispatch rounds per chunk: under HA's limit. */
export const RUN_CHUNK = 9999;

/** The variable a loop's rounds are kept in. */
export function loopRoundsVar(index: number): string {
  return `loop_rounds_${index}`;
}

/** Counts a round at a loop's head: `region` is the states inside the
 * loop (arriving from one of them, the loop goes round again). */
export function loopRoundsStep(index: number, region: string[]): Record<string, unknown> {
  const name = loopRoundsVar(index);
  return {
    alias: LOOP_ROUNDS_ALIAS,
    if: [
      {
        condition: 'template',
        value_template: `{{ prev_node in ${JSON.stringify(region)} }}`,
      },
    ],
    then: [{ variables: { [name]: `{{ ${name} + 1 }}` } }],
    else: [{ variables: { [name]: 1 } }],
  };
}

/** Stops the run on a round past HA's limit. */
export function loopLimitStep(index: number): Record<string, unknown> {
  return {
    alias: LOOP_LIMIT_ALIAS,
    if: [
      {
        condition: 'template',
        value_template: `{{ ${loopRoundsVar(index)} > ${HA_REPEAT_LIMIT} }}`,
      },
    ],
    then: [
      {
        stop: `A loop ran ${HA_REPEAT_LIMIT} rounds; Home Assistant stops a loop there`,
        error: true,
      },
    ],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `steps` with `check` put before each move to one of `targets`
 * (`variables: { current_node: <target> }`), at any depth (#292: a while
 * loop whose round is on its test's "no" side checks its limit where a
 * round goes into the body, not on the side that leaves -- which also
 * takes a test that can't be checked out of the loop, as HA does). */
export function beforeMovesInto(steps: unknown[], targets: string[], check: unknown): unknown[] {
  const into = (value: unknown): unknown => {
    if (Array.isArray(value)) return beforeMovesInto(value, targets, check);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, into(inner)]));
  };
  return steps.flatMap((step) => {
    const moves =
      isRecord(step) &&
      isRecord(step.variables) &&
      typeof step.variables.current_node === 'string' &&
      targets.includes(step.variables.current_node);
    return moves ? [check, step] : [into(step)];
  });
}

/** Whether a step is loop bookkeeping (by its alias and shape). */
export function isLoopBookkeeping(step: unknown): boolean {
  return (
    isRecord(step) &&
    (step.alias === LOOP_ROUNDS_ALIAS || step.alias === LOOP_LIMIT_ALIAS) &&
    'if' in step
  );
}

/** The steps from the first that isn't loop bookkeeping. */
function afterBookkeeping(steps: unknown[]): unknown[] {
  const first = steps.findIndex((s) => !isLoopBookkeeping(s));
  return first === -1 ? [] : steps.slice(first);
}

/** Whether a step only moves to a state (`variables: { current_node }`). */
function isMove(step: unknown): boolean {
  return (
    isRecord(step) &&
    Object.keys(step).length === 1 &&
    isRecord(step.variables) &&
    Object.keys(step.variables).length === 1 &&
    typeof step.variables.current_node === 'string'
  );
}

/** `value` without a loop limit just before a move, at any depth (#292). */
function withoutLimitsBeforeMoves(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .filter(
        (step, i) =>
          !(
            isLoopBookkeeping(step) &&
            isRecord(step) &&
            step.alias === LOOP_LIMIT_ALIAS &&
            isMove(value[i + 1])
          )
      )
      .map(withoutLimitsBeforeMoves);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, withoutLimitsBeforeMoves(inner)])
  );
}

/** A state's steps without its loop bookkeeping: the steps at its start,
 * those at the start of its condition's yes side and "no" side (#339), and
 * (#292) a limit just before a move into a loop's body. */
export function withoutLoopBookkeeping(sequence: unknown[]): unknown[] {
  const steps = afterBookkeeping(sequence).map((step) =>
    isRecord(step) && 'if' in step && Array.isArray(step.then)
      ? {
          ...step,
          then: afterBookkeeping(step.then),
          // #344: a limit opening the "no" side (#339's round that fans out).
          ...(Array.isArray(step.else) ? { else: afterBookkeeping(step.else) } : {}),
        }
      : step
  );
  return withoutLimitsBeforeMoves(steps) as unknown[];
}
