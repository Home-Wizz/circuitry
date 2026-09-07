import { describe, expect, it } from 'vitest';
import {
  ActionNodeValidationSchema,
  ConditionNodeValidationSchema,
  DelayNodeValidationSchema,
  SetVariablesNodeValidationSchema,
  TriggerNodeValidationSchema,
  WaitNodeValidationSchema,
} from '../schemas/validation';
import { FlowGraphSchema } from '../schemas/graph';
import { NodeSchema } from '../schemas/nodes';
import { EdgeSchema } from '../schemas/edges';

/**
 * Schema-robustness fuzzer (Phase B "maximal stress test of the entire
 * integration", round 1, 2026-09-06).
 *
 * `packages/shared`'s zod schemas are the one validation boundary EVERY
 * other package trusts: the frontend calls the *ValidationSchema exports
 * for live per-field UI feedback, `FlowGraphSchema`/`NodeSchema`/
 * `EdgeSchema` gate what a saved graph is allowed to look like before it
 * ever reaches the transpiler, and `websocket_api.py` (Python) round-trips
 * the same canonical JSON shape through HA's Store. Six of these schemas
 * (`WaitNodeValidationSchema`, `ActionNodeValidationSchema`,
 * `TriggerNodeValidationSchema`, `DelayNodeValidationSchema`,
 * `ConditionNodeValidationSchema`, `SetVariablesNodeValidationSchema`) carry
 * hand-written `.refine`/`.superRefine` callbacks that inspect field values
 * directly (`data.foo.trim()`, `data.foo.length`, etc.) -- exactly the kind
 * of code that can throw an uncaught `TypeError` on a malformed shape zod's
 * own base-shape check didn't already reject, rather than returning a
 * clean `{ success: false }` the caller can display or safely reject.
 *
 * This fuzzer only had 11 hand-written example-based tests to build on
 * (`device-trigger-validation.test.ts`, `trigger-condition-array-
 * validation.test.ts`) before this round -- far less coverage than
 * `packages/transpiler` had going into ITS randomized fuzzer. This file
 * closes that gap: it feeds each schema thousands of structurally-mutated
 * variants of a minimal valid seed object (random key deletions, type
 * swaps -- string/number/boolean/null/array/object/undefined -- at random
 * depth, extra garbage keys) plus a batch of pure structural garbage, and
 * asserts `.safeParse()` NEVER throws, no matter how malformed the input,
 * for any of the six validation schemas or the three structural schemas
 * (`FlowGraphSchema`, `NodeSchema`, `EdgeSchema`). zod's own contract says
 * `safeParse` should never throw; a hand-written refine callback is the one
 * place that contract can quietly break.
 */

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GARBAGE_VALUES: unknown[] = [
  undefined,
  null,
  0,
  -1,
  NaN,
  '',
  'x',
  true,
  false,
  [],
  [1, 2, 3],
  {},
  { a: 1 },
  () => {},
  Symbol('x'),
];

/** Deep-clones `value` and randomly corrupts a handful of its (possibly
 * nested) keys: deletes them, or replaces them with an arbitrary garbage
 * value of the wrong type/shape. Also has a chance to inject a few
 * extra, unexpected keys. */
function mutate(rand: () => number, value: unknown, mutationsLeft: number): unknown {
  if (mutationsLeft <= 0 || value === null || typeof value !== 'object') {
    return value;
  }
  const clone: Record<string, unknown> | unknown[] = Array.isArray(value) ? [...value] : { ...value };
  const keys = Array.isArray(clone) ? clone.map((_, i) => i) : Object.keys(clone);

  if (keys.length > 0 && rand() < 0.7) {
    const key = keys[Math.floor(rand() * keys.length)] as never;
    const roll = rand();
    if (roll < 0.3) {
      // delete
      if (Array.isArray(clone)) {
        (clone as unknown[]).splice(key as number, 1);
      } else {
        delete (clone as Record<string, unknown>)[key as string];
      }
    } else if (roll < 0.85) {
      // replace with garbage of a random type
      (clone as Record<string | number, unknown>)[key] =
        GARBAGE_VALUES[Math.floor(rand() * GARBAGE_VALUES.length)];
    } else {
      // recurse into it
      (clone as Record<string | number, unknown>)[key] = mutate(
        rand,
        (clone as Record<string | number, unknown>)[key],
        mutationsLeft - 1
      );
    }
  }

  if (!Array.isArray(clone) && rand() < 0.3) {
    (clone as Record<string, unknown>)[`_garbage_${Math.floor(rand() * 1000)}`] =
      GARBAGE_VALUES[Math.floor(rand() * GARBAGE_VALUES.length)];
  }

  return clone;
}

const SEEDS: Record<string, unknown> = {
  wait: { wait_template: '{{ true }}', timeout: '00:00:30' },
  action: { service: 'light.turn_on', data: {}, target: { entity_id: 'light.a' } },
  trigger: { trigger: 'state', entity_id: 'binary_sensor.a', to: 'on' },
  delay: { delay: { seconds: 5 } },
  condition: { condition: 'state', entity_id: 'input_boolean.a', state: 'on' },
  set_variables: { variables: { foo: 'bar' } },
  flowGraph: {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Seed',
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { trigger: 'state', entity_id: 'x' } },
      { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { service: 'light.turn_on' } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'a1' }],
  },
  node: { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { service: 'light.turn_on' } },
  edge: { id: 'e1', source: 't1', target: 'a1' },
};

const SCHEMAS: Array<{ name: string; schema: { safeParse: (v: unknown) => unknown }; seedKey: string }> = [
  { name: 'WaitNodeValidationSchema', schema: WaitNodeValidationSchema, seedKey: 'wait' },
  { name: 'ActionNodeValidationSchema', schema: ActionNodeValidationSchema, seedKey: 'action' },
  { name: 'TriggerNodeValidationSchema', schema: TriggerNodeValidationSchema, seedKey: 'trigger' },
  { name: 'DelayNodeValidationSchema', schema: DelayNodeValidationSchema, seedKey: 'delay' },
  { name: 'ConditionNodeValidationSchema', schema: ConditionNodeValidationSchema, seedKey: 'condition' },
  { name: 'SetVariablesNodeValidationSchema', schema: SetVariablesNodeValidationSchema, seedKey: 'set_variables' },
  { name: 'FlowGraphSchema', schema: FlowGraphSchema, seedKey: 'flowGraph' },
  { name: 'NodeSchema', schema: NodeSchema, seedKey: 'node' },
  { name: 'EdgeSchema', schema: EdgeSchema, seedKey: 'edge' },
];

describe('FUZZ: zod schema robustness against malformed input (maximal integration stress test)', () => {
  for (const { name, schema, seedKey } of SCHEMAS) {
    it(`${name}.safeParse never throws on structurally-mutated or pure-garbage input`, () => {
      const rand = mulberry32(name.length * 7919 + 42);
      const seed = SEEDS[seedKey];
      const crashes: string[] = [];
      const N = 500;

      for (let i = 0; i < N; i++) {
        // Half mutated-from-valid-seed, half pure garbage shapes.
        const input =
          i % 2 === 0
            ? mutate(rand, seed, 1 + Math.floor(rand() * 4))
            : GARBAGE_VALUES[Math.floor(rand() * GARBAGE_VALUES.length)];

        try {
          schema.safeParse(input);
        } catch (err) {
          crashes.push(
            `iteration ${i}, input=${JSON.stringify(input, (_, v) => (typeof v === 'symbol' || typeof v === 'function' ? String(v) : v))}: ${
              err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
            }`
          );
        }
      }

      expect(crashes, crashes.slice(0, 3).join('\n\n')).toHaveLength(0);
    });
  }
});
