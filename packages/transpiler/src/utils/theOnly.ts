/**
 * "Took only the first of several", the most repeated mistake so far
 * (#4, #10, #24, #41, #43, #48, #50, #52, #55). A graph lets a node have several edges with the same meaning, and
 * code that asks for "the" edge -- `edges.find(...)`, `[0]` -- silently
 * drops the rest. Code that needs one uses `theOnly`, which makes "there
 * can only be one" a claim the code checks: when it doesn't hold, it
 * throws a GraphClaimError, and FlowTranspiler turns that into a refusal
 * (or, for auto-selected native output, a fall back to the state machine)
 * instead of output built from a guess. Code that can take several
 * handles them all (`filter`). A scan test keeps raw `edges.find(` out of
 * the core folders (h1-edge-picks.test.ts).
 */
export class GraphClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphClaimError';
  }
}

/** The one item matching `predicate`, `undefined` when none does. Throws a
 * GraphClaimError when several do; `why` says what was expected. */
export function theOnly<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
  why: string
): T | undefined {
  const matches = items.filter(predicate);
  if (matches.length > 1) {
    throw new GraphClaimError(`expected at most one ${why}, found ${matches.length}`);
  }
  return matches[0];
}
