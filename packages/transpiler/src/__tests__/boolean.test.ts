import { describe, expect, it } from 'vitest';
import { boolExprEquivalent, parseConditionExpr } from '../verification/boolean';

describe('boolean.ts -- truth-table condition equivalence', () => {
  it('two identical leaf conditions are equivalent', () => {
    const a = parseConditionExpr({ condition: 'state', entity_id: 'light.kitchen', state: 'on' });
    const b = parseConditionExpr({ condition: 'state', entity_id: 'light.kitchen', state: 'on' });
    expect(boolExprEquivalent(a, b).equivalent).toBe(true);
  });

  it('two different leaf conditions are not equivalent', () => {
    const a = parseConditionExpr({ condition: 'state', entity_id: 'light.kitchen', state: 'on' });
    const b = parseConditionExpr({ condition: 'state', entity_id: 'light.kitchen', state: 'off' });
    expect(boolExprEquivalent(a, b).equivalent).toBe(false);
  });

  it('alias differences do not affect equivalence', () => {
    const a = parseConditionExpr({ condition: 'state', entity_id: 'light.kitchen', state: 'on', alias: 'foo' });
    const b = parseConditionExpr({ condition: 'state', entity_id: 'light.kitchen', state: 'on', alias: 'bar' });
    expect(boolExprEquivalent(a, b).equivalent).toBe(true);
  });

  it('a two-item implicit-AND array equals an explicit condition:and wrapper', () => {
    const cond1 = { condition: 'state', entity_id: 'a', state: 'on' };
    const cond2 = { condition: 'state', entity_id: 'b', state: 'on' };
    const asArray = parseConditionExpr([cond1, cond2]);
    const asAnd = parseConditionExpr({ condition: 'and', conditions: [cond1, cond2] });
    expect(boolExprEquivalent(asArray, asAnd).equivalent).toBe(true);
  });

  it('AND is order-independent', () => {
    const cond1 = { condition: 'state', entity_id: 'a', state: 'on' };
    const cond2 = { condition: 'state', entity_id: 'b', state: 'on' };
    const forward = parseConditionExpr([cond1, cond2]);
    const backward = parseConditionExpr([cond2, cond1]);
    expect(boolExprEquivalent(forward, backward).equivalent).toBe(true);
  });

  it('OR is order-independent and distinct from AND', () => {
    const cond1 = { condition: 'state', entity_id: 'a', state: 'on' };
    const cond2 = { condition: 'state', entity_id: 'b', state: 'on' };
    const orForward = parseConditionExpr({ condition: 'or', conditions: [cond1, cond2] });
    const orBackward = parseConditionExpr({ condition: 'or', conditions: [cond2, cond1] });
    const and = parseConditionExpr({ condition: 'and', conditions: [cond1, cond2] });
    expect(boolExprEquivalent(orForward, orBackward).equivalent).toBe(true);
    expect(boolExprEquivalent(orForward, and).equivalent).toBe(false);
  });

  it("not(list) matches HA's real semantics: NOT(OR(list)), not NOT(AND(list))", () => {
    const cond1 = { condition: 'state', entity_id: 'a', state: 'on' };
    const cond2 = { condition: 'state', entity_id: 'b', state: 'on' };
    const not = parseConditionExpr({ condition: 'not', conditions: [cond1, cond2] });
    const notOfOr = { op: 'not' as const, arg: { op: 'or' as const, args: [parseConditionExpr(cond1), parseConditionExpr(cond2)] } };
    const notOfAnd = { op: 'not' as const, arg: { op: 'and' as const, args: [parseConditionExpr(cond1), parseConditionExpr(cond2)] } };
    expect(boolExprEquivalent(not, notOfOr).equivalent).toBe(true);
    expect(boolExprEquivalent(not, notOfAnd).equivalent).toBe(false);
  });

  it('a single-condition false-handle-only branch equals a not-wrapped true-handle branch (De Morgan swap)', () => {
    // Graph: condition C reachable only via its false edge -- equivalent to
    // `if: {not: [C]}`. Verified at the BProgram level in behaviorProgram.test.ts;
    // here we just confirm the raw boolean identity holds.
    const c = { condition: 'state', entity_id: 'a', state: 'on' };
    const notC = parseConditionExpr({ condition: 'not', conditions: [c] });
    const rawC = parseConditionExpr(c);
    // not(C) should be the logical negation of C -- confirm via a
    // three-valued check: not(not(C)) === C would require double-negation
    // elimination, which truth-table equivalence gives for free.
    const doubleNot = parseConditionExpr({ condition: 'not', conditions: [{ condition: 'not', conditions: [c] }] });
    expect(boolExprEquivalent(doubleNot, rawC).equivalent).toBe(true);
    expect(boolExprEquivalent(notC, rawC).equivalent).toBe(false);
  });

  it('two conditions converging via OR is not the same as requiring both (AND)', () => {
    const cond1 = { condition: 'numeric_state', entity_id: 'sensor.a', above: 10 };
    const cond2 = { condition: 'numeric_state', entity_id: 'sensor.b', above: 10 };
    const or = parseConditionExpr({ condition: 'or', conditions: [cond1, cond2] });
    const and = parseConditionExpr({ condition: 'and', conditions: [cond1, cond2] });
    expect(boolExprEquivalent(or, and).equivalent).toBe(false);
  });

  it('nested combinators normalize correctly: (A or B) and C vs A and C or B and C', () => {
    const a = { condition: 'state', entity_id: 'a', state: 'on' };
    const b = { condition: 'state', entity_id: 'b', state: 'on' };
    const c = { condition: 'state', entity_id: 'c', state: 'on' };
    const left = parseConditionExpr({
      condition: 'and',
      conditions: [{ condition: 'or', conditions: [a, b] }, c],
    });
    const right = parseConditionExpr({
      condition: 'or',
      conditions: [
        { condition: 'and', conditions: [a, c] },
        { condition: 'and', conditions: [b, c] },
      ],
    });
    expect(boolExprEquivalent(left, right).equivalent).toBe(true);
  });

  it('a bare template-shorthand string is a leaf condition', () => {
    const a = parseConditionExpr('{{ is_state("light.kitchen", "on") }}');
    const b = parseConditionExpr({ condition: 'template', value_template: '{{ is_state("light.kitchen", "on") }}' });
    expect(boolExprEquivalent(a, b).equivalent).toBe(true);
  });

  it('an absent condition is trivially true (matches HA: no conditions = pass)', () => {
    const a = parseConditionExpr(undefined);
    const b = parseConditionExpr([]);
    expect(boolExprEquivalent(a, b).equivalent).toBe(true);
  });

  it('id array-vs-scalar normalization treats them as the same leaf', () => {
    const a = parseConditionExpr({ condition: 'trigger', id: ['motion'] });
    const b = parseConditionExpr({ condition: 'trigger', id: 'motion' });
    expect(boolExprEquivalent(a, b).equivalent).toBe(true);
  });

  // "A disabled condition behaves as if it were removed" -- HA's own docs
  // (home-assistant.io/docs/scripts/conditions/), confirmed against
  // condition.py/script.py source during the StateMachineStrategy audit
  // (2026-09-06). These tests exercise the context-sensitive collapse
  // (const:true inside an AND-context list, const:false inside an
  // OR-context list or not:'s own inner OR) that parseConditionExpr's
  // `context` parameter implements -- not just that disabling a condition
  // does *something*, but that it does the mathematically correct thing
  // per list type, including for a whole disabled and/or/not GROUP (not
  // just a disabled leaf), and that a *non*-disabled condition is never
  // accidentally treated the same way.
  describe('a disabled condition (enabled: false) behaves as if removed', () => {
    const a = { condition: 'state', entity_id: 'a', state: 'on' };
    const b = { condition: 'state', entity_id: 'b', state: 'on' };
    const c = { condition: 'state', entity_id: 'c', state: 'on' };

    it('inside and:, a disabled member collapses to const:true (AND identity) -- same as removing it', () => {
      const withDisabled = parseConditionExpr({ condition: 'and', conditions: [a, { ...b, enabled: false }] });
      const removed = parseConditionExpr({ condition: 'and', conditions: [a] });
      expect(boolExprEquivalent(withDisabled, removed).equivalent).toBe(true);
    });

    it('inside or:, a disabled member collapses to const:false (OR identity) -- same as removing it', () => {
      const withDisabled = parseConditionExpr({ condition: 'or', conditions: [a, { ...b, enabled: false }] });
      const removed = parseConditionExpr({ condition: 'or', conditions: [a] });
      expect(boolExprEquivalent(withDisabled, removed).equivalent).toBe(true);
    });

    it("inside not:, a disabled member collapses the same way as or: (not(list) === NOT(OR(list)))", () => {
      const withDisabled = parseConditionExpr({ condition: 'not', conditions: [a, { ...b, enabled: false }] });
      const removed = parseConditionExpr({ condition: 'not', conditions: [a] });
      expect(boolExprEquivalent(withDisabled, removed).equivalent).toBe(true);
    });

    it('a disabled condition used alone as the top-level gate is trivially true (matches an absent condition)', () => {
      const disabledAlone = parseConditionExpr({ ...a, enabled: false });
      const absent = parseConditionExpr(undefined);
      expect(boolExprEquivalent(disabledAlone, absent).equivalent).toBe(true);
    });

    it('a whole disabled and/or GROUP (not just a leaf) collapses the same way as a disabled leaf would', () => {
      const groupDisabledInAnd = parseConditionExpr({
        condition: 'and',
        conditions: [a, { condition: 'or', conditions: [b, c], enabled: false }],
      });
      const groupRemovedFromAnd = parseConditionExpr({ condition: 'and', conditions: [a] });
      expect(boolExprEquivalent(groupDisabledInAnd, groupRemovedFromAnd).equivalent).toBe(true);

      const groupDisabledInOr = parseConditionExpr({
        condition: 'or',
        conditions: [a, { condition: 'and', conditions: [b, c], enabled: false }],
      });
      const groupRemovedFromOr = parseConditionExpr({ condition: 'or', conditions: [a] });
      expect(boolExprEquivalent(groupDisabledInOr, groupRemovedFromOr).equivalent).toBe(true);
    });

    it('a single disabled member of or: matches an explicitly empty or: (both always false)', () => {
      const singleDisabled = parseConditionExpr({ condition: 'or', conditions: [{ ...a, enabled: false }] });
      const empty = parseConditionExpr({ condition: 'or', conditions: [] });
      expect(boolExprEquivalent(singleDisabled, empty).equivalent).toBe(true);
    });

    it('negative check: the same member NOT disabled is NOT dropped -- and:[A,B] still differs from and:[A]', () => {
      const enabled = parseConditionExpr({ condition: 'and', conditions: [a, b] });
      const withoutB = parseConditionExpr({ condition: 'and', conditions: [a] });
      expect(boolExprEquivalent(enabled, withoutB).equivalent).toBe(false);
    });

    it('explicit enabled: true is behaviorally identical to enabled being absent (same leaf identity)', () => {
      const withTrue = parseConditionExpr({ ...a, enabled: true });
      const withoutField = parseConditionExpr({ ...a });
      expect(boolExprEquivalent(withTrue, withoutField).equivalent).toBe(true);
    });
  });
});
