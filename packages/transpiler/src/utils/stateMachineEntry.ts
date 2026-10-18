/**
 * The state machine's stop for a trigger with nothing joined to it (bug
 * #195). Such a trigger starts at END, and the dispatch loop is a
 * `repeat: until`, which runs once before it tests: the dispatcher found
 * no state called END and ran its default (a "Unknown state" log line).
 * A condition step before the loop ends the run there instead, as the
 * canvas does (a trigger with nothing after it does nothing). Written only
 * when a trigger starts at END. The alias marks it for the readers (the
 * decompiler and the state-machine gate accept exactly this step).
 */
export const NO_STEPS_ALIAS = 'Trigger with no steps';

/** The stop, as written before the dispatch loop. */
export function noStepsStop(): Record<string, unknown> {
  return {
    alias: NO_STEPS_ALIAS,
    condition: 'template',
    value_template: '{{ current_node != "END" }}',
  };
}

/** Whether a step is exactly the stop. */
export function isNoStepsStop(step: unknown): boolean {
  if (typeof step !== 'object' || step === null || Array.isArray(step)) return false;
  const expected = noStepsStop();
  const keys = Object.keys(step);
  return (
    keys.length === Object.keys(expected).length &&
    keys.every((key) => (step as Record<string, unknown>)[key] === expected[key])
  );
}
