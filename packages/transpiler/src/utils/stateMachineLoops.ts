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

/** A state's steps without its loop bookkeeping: the steps at its start,
 * and those at the start of its condition's yes side. */
export function withoutLoopBookkeeping(sequence: unknown[]): unknown[] {
  return afterBookkeeping(sequence).map((step) =>
    isRecord(step) && 'if' in step && Array.isArray(step.then)
      ? { ...step, then: afterBookkeeping(step.then) }
      : step
  );
}
