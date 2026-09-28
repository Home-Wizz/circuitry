// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ConditionNodeValidationSchema, validateNodeData } from '../schemas/validation';

describe('Trigger Condition ID Array Support', () => {
  it('should accept trigger condition with single string ID', () => {
    const triggerCondition = {
      condition: 'trigger',
      id: 'arriving',
    };

    const result = ConditionNodeValidationSchema.safeParse(triggerCondition);
    expect(result.success).toBe(true);
  });

  it('should accept trigger condition with array of IDs', () => {
    const triggerConditionWithArray = {
      condition: 'trigger',
      id: ['arriving', 'leaving', 'motion_detected'],
    };

    const result = ConditionNodeValidationSchema.safeParse(triggerConditionWithArray);
    expect(result.success).toBe(true);
  });

  // HA accepts a blank trigger id (checked in HA 2026.9.3, bug #65), so
  // the editor only warns: saving isn't blocked (decision D3).
  it('warns about, but does not block, a trigger condition with empty string ID', () => {
    expect(validateNodeData('condition', { condition: 'trigger', id: '' })).toEqual([
      { path: ['id'], message: 'errors:validation.condition.triggerIdEmpty', severity: 'warning' },
    ]);
  });

  // HA accepts a blank trigger id (checked in HA 2026.9.3, bug #65), so
  // the editor only warns: saving isn't blocked (decision D3).
  it('warns about, but does not block, a trigger condition with empty array ID', () => {
    expect(validateNodeData('condition', { condition: 'trigger', id: [] })).toEqual([
      { path: ['id'], message: 'errors:validation.condition.triggerIdEmpty', severity: 'warning' },
    ]);
  });

  // HA accepts a blank trigger id (checked in HA 2026.9.3, bug #65), so
  // the editor only warns: saving isn't blocked (decision D3).
  it('warns about, but does not block, a trigger condition with array containing empty string', () => {
    expect(
      validateNodeData('condition', { condition: 'trigger', id: ['arriving', '', 'leaving'] })
    ).toEqual([
      { path: ['id'], message: 'errors:validation.condition.triggerIdEmpty', severity: 'warning' },
    ]);
  });

  it('should reject trigger condition without ID', () => {
    const triggerConditionWithoutId = {
      condition: 'trigger',
    };

    const result = ConditionNodeValidationSchema.safeParse(triggerConditionWithoutId);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        message: 'errors:validation.condition.triggerIdRequired',
        path: ['id'],
      })
    );
  });
});
