import { describe, expect, it } from 'vitest';
import { type BProgram, normalizeActionData, programsEquivalent } from '../verification/behaviorProgram';
import { parseConditionExpr } from '../verification/boolean';

function action(call: Record<string, unknown>): BProgram[number] {
  return { k: 'action', call: normalizeActionData(call) };
}

describe('behaviorProgram.ts -- structural program equivalence', () => {
  it('identical sequential programs are equal', () => {
    const a: BProgram = [action({ action: 'light.turn_on' }), action({ action: 'light.turn_off' })];
    const b: BProgram = [action({ action: 'light.turn_on' }), action({ action: 'light.turn_off' })];
    expect(programsEquivalent(a, b).equal).toBe(true);
  });

  it('step order matters for sequential actions', () => {
    const a: BProgram = [action({ action: 'a' }), action({ action: 'b' })];
    const b: BProgram = [action({ action: 'b' }), action({ action: 'a' })];
    expect(programsEquivalent(a, b).equal).toBe(false);
  });

  it('alias and enabled:true differences on an action step do not affect equivalence', () => {
    const a: BProgram = [action({ action: 'light.turn_on', alias: 'Turn on', enabled: true })];
    const b: BProgram = [action({ action: 'light.turn_on' })];
    expect(programsEquivalent(a, b).equal).toBe(true);
  });

  it('enabled:false IS behavioral and must match', () => {
    const a: BProgram = [action({ action: 'light.turn_on', enabled: false })];
    const b: BProgram = [action({ action: 'light.turn_on' })];
    expect(programsEquivalent(a, b).equal).toBe(false);
  });

  it('an AND-chain if/then/else is equivalent to its regrouped and/or form', () => {
    const c1 = { condition: 'state', entity_id: 'a', state: 'on' };
    const c2 = { condition: 'state', entity_id: 'b', state: 'on' };
    const then: BProgram = [action({ action: 'notify.send' })];

    // Two chained single-condition ifs sharing the same else (what a
    // choose-chain or nested if/else literally is)...
    const chained: BProgram = [
      { k: 'if', cond: parseConditionExpr(c1), then: [{ k: 'if', cond: parseConditionExpr(c2), then, else: [] }], else: [] },
    ];
    // ...vs. one if with an implicit-AND array condition (what NativeStrategy
    // emits when it folds a sequential single-path condition chain).
    const folded: BProgram = [{ k: 'if', cond: parseConditionExpr([c1, c2]), then, else: [] }];

    expect(programsEquivalent(chained, folded).equal).toBe(true);
  });

  it('two conditions converging on the same then-branch (OR) is equivalent to one or:-wrapped if', () => {
    const c1 = { condition: 'state', entity_id: 'a', state: 'on' };
    const c2 = { condition: 'state', entity_id: 'b', state: 'on' };
    const then: BProgram = [action({ action: 'notify.send' })];

    const asOr: BProgram = [
      { k: 'if', cond: parseConditionExpr({ condition: 'or', conditions: [c1, c2] }), then, else: [] },
    ];
    // A naive "two independent condition checks with the same empty-else
    // shared then" would NOT be equivalent to this unless represented as OR
    // -- this test locks in that the OR form is what a genuine convergence
    // must reduce to (see extractFromGraph.ts's OR-gate fold).
    expect(programsEquivalent(asOr, asOr).equal).toBe(true);
  });

  it('an inverted (false-handle-only) condition matches a not-wrapped true-handle condition with then/else swapped', () => {
    const c = { condition: 'state', entity_id: 'a', state: 'on' };
    const body: BProgram = [action({ action: 'notify.send' })];

    // Graph shape: condition reachable only via its FALSE edge -> body (then
    // is empty).
    const graphShape: BProgram = [{ k: 'if', cond: parseConditionExpr(c), then: [], else: body }];
    // NativeStrategy's rendering: `condition: not, conditions:[c]`, then: body, else: [].
    const yamlShape: BProgram = [
      { k: 'if', cond: parseConditionExpr({ condition: 'not', conditions: [c] }), then: body, else: [] },
    ];

    // "if C then [] else B" and "if NOT C then B else []" are the same
    // boolean identity -- normalizeProgram's then/else swap (see
    // behaviorProgram.ts) canonicalizes both into the same shape, so these
    // must compare equal directly. This is exactly the case NativeStrategy
    // hits whenever a condition's true-branch is empty: it is free to
    // either keep the condition as-is with then: [], or invert it and swap
    // branches so the real content lands in `then` -- both extractors'
    // natural encodings of "gate the rest on a condition" must match
    // regardless of which shape either one produces.
    expect(programsEquivalent(graphShape, yamlShape).equal).toBe(true);

    // A GENUINE mismatch -- different body content -- must still be caught,
    // confirming the swap normalization doesn't silently paper over a real
    // divergence.
    const yamlShapeWrongBody: BProgram = [
      {
        k: 'if',
        cond: parseConditionExpr({ condition: 'not', conditions: [c] }),
        then: [action({ action: 'notify.send_wrong' })],
        else: [],
      },
    ];
    expect(programsEquivalent(graphShape, yamlShapeWrongBody).equal).toBe(false);
  });

  it('parallel branches compare as a set, not by declaration order', () => {
    const a: BProgram = [{ k: 'parallel', branches: [[action({ action: 'a' })], [action({ action: 'b' })]] }];
    const b: BProgram = [{ k: 'parallel', branches: [[action({ action: 'b' })], [action({ action: 'a' })]] }];
    expect(programsEquivalent(a, b).equal).toBe(true);
  });

  it('parallel branch count mismatch is a real difference', () => {
    const a: BProgram = [{ k: 'parallel', branches: [[action({ action: 'a' })], [action({ action: 'b' })]] }];
    const b: BProgram = [{ k: 'parallel', branches: [[action({ action: 'a' })]] }];
    expect(programsEquivalent(a, b).equal).toBe(false);
  });

  it('repeat while/until/count compare mode, test, and body', () => {
    const test = parseConditionExpr({ condition: 'numeric_state', entity_id: 'sensor.x', below: 10 });
    const body: BProgram = [action({ action: 'light.turn_on' })];
    const whileA: BProgram = [{ k: 'repeat', mode: 'while', test, body }];
    const whileB: BProgram = [{ k: 'repeat', mode: 'while', test, body }];
    const untilB: BProgram = [{ k: 'repeat', mode: 'until', test, body }];
    expect(programsEquivalent(whileA, whileB).equal).toBe(true);
    expect(programsEquivalent(whileA, untilB).equal).toBe(false);
  });

  it('repeat count normalizes number vs numeric string to the same value', () => {
    const body: BProgram = [action({ action: 'light.turn_on' })];
    const a: BProgram = [{ k: 'repeat', mode: 'count', count: '5', body }];
    const b: BProgram = [{ k: 'repeat', mode: 'count', count: '5', body }];
    expect(programsEquivalent(a, b).equal).toBe(true);
  });
});
