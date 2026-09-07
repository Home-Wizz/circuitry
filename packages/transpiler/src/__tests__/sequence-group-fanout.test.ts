import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Bug #10 (found 2026-09-06 via a StateMachineStrategy nested-fan-out
// stress test, but the defect actually lives in native.ts and affects
// ordinary NativeStrategy output too -- this is the plain, unforced,
// minimal reproduction, no forceStrategy needed).
//
// detectSequencePatterns (native.ts) computes a "Grouping actions"
// (`sequence:`) pattern's body entry point with
// `flow.edges.find(e => e.source === node.id && ...)` -- a single .find(),
// not a filter. When the group's very first statement is itself a
// `parallel:` block, sequence_start fans out directly into 2+ body entry
// points, and every branch but the first was silently discarded from the
// pattern entirely (not just under-built -- structurally invisible to
// bodyNodeIds and to buildSequenceBlock's walk alike), the same class of
// bug as #4 (repeat-loop body) and #9 (condition branch), just on a
// sequence group's own opening fan-out.
describe('NativeStrategy sequence ("Grouping actions") group with parallel as its own first statement', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('a plain tree-shaped automation (no forceStrategy) must run every branch of the fan-out', async () => {
    const yaml = `
alias: Sequence group opening with parallel
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - sequence:
      - parallel:
          - action: light.turn_on
            target:
              entity_id: light.hallway
          - action: light.turn_on
            target:
              entity_id: light.kitchen
      - action: input_boolean.turn_on
        target:
          entity_id: input_boolean.inner_done
  - action: notify.notify
    data:
      message: "done"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    // Confirm this is the common, unforced case: a plain tree, no cycles,
    // no manual strategy override needed to hit the bug.
    const forced = transpiler.transpile(graph);
    expect(forced.success).toBe(true);
    const yamlOut = transpiler.toYaml(graph);
    console.log('NATIVE (unforced) YAML:\n', yamlOut);

    expect(yamlOut).toContain('light.hallway');
    expect(yamlOut).toContain('light.kitchen');
    expect(yamlOut).toContain('input_boolean.inner_done');
    expect(yamlOut).toContain('notify.notify');

    // input_boolean.inner_done must run exactly once, AFTER both lights --
    // not duplicated into each parallel branch (the follow-up regression
    // the first attempted fix for bug #10 introduced, caught before
    // shipping: bounding each branch directly at the sequence group's own
    // end, rather than at the branches' own nearest shared convergence
    // point, pulled the group's shared tail into both branches at once).
    expect((yamlOut.match(/inner_done/g) || []).length).toBe(1);

    // The parallel block itself must be a sibling step BEFORE
    // input_boolean.turn_on within the sequence's own body, not nested
    // inside it.
    const parallelIdx = yamlOut.indexOf('parallel:');
    const innerDoneIdx = yamlOut.indexOf('inner_done');
    expect(parallelIdx).toBeGreaterThan(-1);
    expect(innerDoneIdx).toBeGreaterThan(parallelIdx);
  });
});
