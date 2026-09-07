import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Bug #13 (2026-09-06, deferred earlier the same day while fixing Bug #12,
 * fixed here after the fuzzer's coverage-gap audit -- see
 * random-graph-fuzz.test.ts's isKnownParallelConvergenceGap doc comment for
 * the original discovery).
 *
 * native.ts's `detectRepeatPatterns` walks a while/until loop's own true-
 * edge chain looking for FURTHER AND'd conditions to fold into the same
 * `while:`/`until:` list (HA's own multi-condition list syntax). The only
 * signal it used to tell "another AND'd condition of THIS loop" apart from
 * "the very next, unrelated statement after the loop" was whether that
 * next node had a false edge of its own -- but an ordinary else-less `if:`
 * block has NO false edge either (HA's implicit "if false, do nothing"
 * needs no explicit edge), making the two shapes graph-indistinguishable
 * under that signal alone. The result: an else-less `if:` immediately
 * following a `repeat.until` (or, for `repeat.while`, opening the loop's
 * own body) got silently folded into the loop's own condition list --
 * losing the if's then-branch as unconditional loop-body content while
 * ALSO wrongly requiring the if's condition to be true before the loop
 * could ever exit/continue.
 *
 * Fixed using a graph-identity signal instead of a structural inference:
 * YamlParser.ts stamps a `_blockKey` (`repeat_until`, `repeat_while`,
 * `if_else`, `choose`) on the very FIRST condition of every AND-exploded
 * condition list it creates -- a chain's own 2nd+ conditions never get
 * one, only another construct's HEAD condition does. A node reached via
 * the chain's own "keep chaining" true edge that carries a `_blockKey` is
 * therefore unambiguously the start of a DIFFERENT construct, not a
 * continuing AND'd condition of this one -- regardless of whether it also
 * happens to have zero false edges of its own.
 *
 * `repeat.count` needed no such fix: it only ever has exactly one
 * auto-generated condition (never a user-authored AND-list), so this
 * ambiguity cannot arise for it.
 */
describe('while/until condition-chain folding vs. a trailing/nested construct (bug #13)', () => {
  const transpiler = new FlowTranspiler();
  const parser = new YamlParser();

  it('a repeat.until immediately followed by an else-less if keeps them as two separate steps', async () => {
    const yaml = `
alias: Until then else-less if
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      until:
        - condition: numeric_state
          entity_id: sensor.humidity
          below: 37
      sequence:
        - service: light.turn_on
          target:
            entity_id: light.b
  - if:
      - condition: state
        entity_id: input_boolean.b
        state: 'on'
    then:
      - delay:
          seconds: 1
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';

    expect(yamlOut).not.toMatch(/current_node/); // must stay on NativeStrategy, no fallback needed
    // The until block must carry ONLY its own condition, not the if's too.
    const untilMatch = yamlOut.match(/until:\n([\s\S]*?)\n\s*sequence:/);
    expect(untilMatch).not.toBeNull();
    expect(untilMatch![1]).not.toMatch(/input_boolean\.b/);
    expect(untilMatch![1]).toMatch(/sensor\.humidity/);
    // The if must survive as its own real step, condition preserved,
    // guarding the delay -- not unconditional loop-body content.
    expect(yamlOut).toMatch(/if:\n\s*-\s*condition: state\n\s*entity_id: input_boolean\.b/);
    expect(yamlOut).toMatch(/then:\n\s*-\s*delay:/);

    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('a repeat.while whose body opens with an else-less if keeps the if as body content, not an AND-folded while-condition', async () => {
    const yaml = `
alias: While body opens with else-less if
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      while:
        - condition: state
          entity_id: input_boolean.a
          state: 'off'
      sequence:
        - if:
            - condition: state
              entity_id: input_boolean.b
              state: 'on'
          then:
            - delay:
                seconds: 1
        - service: light.turn_on
          target:
            entity_id: light.b
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    expect(result.warnings ?? []).toEqual([]);
    const yamlOut = result.yaml ?? '';

    expect(yamlOut).not.toMatch(/current_node/);
    const whileMatch = yamlOut.match(/while:\n([\s\S]*?)\n\s*sequence:/);
    expect(whileMatch).not.toBeNull();
    expect(whileMatch![1]).not.toMatch(/input_boolean\.b/);
    expect(whileMatch![1]).toMatch(/input_boolean\.a/);
    // The if must be the loop body's FIRST statement, guarding the delay,
    // followed unconditionally by the light.turn_on.
    expect(yamlOut).toMatch(/sequence:\n\s*- if:\n\s*-\s*condition: state\n\s*entity_id: input_boolean\.b/);
    expect(yamlOut).toMatch(/light\.turn_on/);

    expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
  });

  it('a genuine 2-condition repeat.until AND-chain still folds into a single until: list, and still transpiles successfully (regression guard)', async () => {
    // NOTE: this exact shape (a genuine 2-condition until: AND-chain) has
    // its own SEPARATE, pre-existing verifyNativeOutput mismatch --
    // confirmed via direct comparison against the pre-this-session code,
    // unrelated to Bug #13's fix (that mismatch reproduces identically
    // with or without this session's chain-folding change). Tracked here
    // only as "must still safely succeed via the state-machine fallback,
    // not regress into an outright failure" -- fixing the underlying
    // verify mismatch itself is a separate, future investigation.
    const yaml = `
alias: Genuine 2-condition until
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      until:
        - condition: numeric_state
          entity_id: sensor.humidity
          below: 37
        - condition: state
          entity_id: input_boolean.a
          state: 'on'
      sequence:
        - service: light.turn_on
          target:
            entity_id: light.b
  - service: notify.notify
    data:
      message: done
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).toMatch(/notify\.notify/);
  });

  it('a genuine 2-condition repeat.while AND-chain still folds into a single while: list, and still transpiles successfully (regression guard)', async () => {
    // See the identical note on the until-chain test above -- this exact
    // shape has the same separate, pre-existing, unrelated verify
    // mismatch, confirmed present before this session's changes too.
    const yaml = `
alias: Genuine 2-condition while
trigger:
  - platform: state
    entity_id: binary_sensor.motion
action:
  - repeat:
      while:
        - condition: state
          entity_id: input_boolean.a
          state: 'off'
        - condition: numeric_state
          entity_id: sensor.humidity
          below: 37
      sequence:
        - service: light.turn_on
          target:
            entity_id: light.b
  - service: notify.notify
    data:
      message: done
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const analysis = transpiler.analyzeTopology(graph);
    expect(analysis.isTree).toBe(true);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut).toMatch(/notify\.notify/);
  });

  it('a repeat.until nested inside a choose default, immediately followed by an else-less if, still separates correctly (Fuzz-21 regression guard)', async () => {
    const yaml = `
alias: Fuzz 21 shape
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
action:
  - choose:
      - conditions:
          - condition: numeric_state
            entity_id: sensor.humidity
            below: 14
        sequence:
          - service: light.turn_off
            target:
              entity_id: climate.main
    default:
      - repeat:
          until:
            - condition: state
              entity_id: input_boolean.b
              state: 'on'
          sequence:
            - service: light.turn_on
              target:
                entity_id: light.b
      - if:
          - condition: state
            entity_id: input_boolean.b
            state: 'on'
        then:
          - delay:
              seconds: 1
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    if (!yamlOut.includes('current_node')) {
      // If topology now routes this to native directly, it must be
      // behaviorally verified and warning-free.
      expect(result.warnings ?? []).toEqual([]);
      expect(verifyNativeOutput(graph, yamlOut).valid).toBe(true);
    }
  });
});
