import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyStateMachineOutput } from '../verification/verifyStateMachineOutput';

/**
 * Bug #11 (2026-09-06, Phase B item 3 round 3, found via the randomized
 * fuzzer). parseChooseBlock's/parseIfBlock's terminal-node tracking
 * (outputNodeIds.push(...sequenceResult.terminalNodeIds), the bug #2 fix
 * from earlier this same audit) correctly captures WHICH node(s) a
 * choose-case/then/else branch's sequence ends at, but never propagated
 * WHICH of those terminals are themselves condition nodes whose real
 * forward continuation is via the FALSE handle (e.g. a nested
 * `repeat: while` block, whose own condition node's "true" edge is fully
 * consumed by its own loop body -- the real "the loop is done, continue
 * the automation" signal comes from its FALSE edge, per the parser's own
 * repeat.while handling).
 *
 * Without that propagation, the classification loop in parseActions'
 * isChooseAction/isIfThenAction handlers (deciding whether a produced
 * condition-node output belongs in localConditionNodeIds ["true" is the
 * live path] or falsePathConditionIds ["false" is the live path]) always
 * defaulted such an id to the TRUE bucket. That silently wired a SECOND,
 * spurious 'true'-handle edge from the while-condition to whatever
 * follows the whole choose block, alongside the loop's own legitimate
 * true-handle edge into its body -- so state-machine.ts's
 * generateConditionBlock (whose contract is to fan multiple 'true'
 * targets out together) merged the loop's own body with a completely
 * unrelated downstream subtree into one bogus `parallel:` block.
 *
 * This is a severe failure mode: state-machine is the strategy of last
 * resort with no further fallback, so when its own output failed
 * behavioral verification for this shape, `transpile()` returned
 * success:false with NO valid YAML at all, for a shape topology.ts
 * otherwise correctly routes to state-machine.
 *
 * Fixed in parseChooseBlock (case-sequence AND default-sequence terminal
 * handling) and parseIfBlock (then/else terminal handling) by also
 * pushing each sequence's `falsePathTerminalNodeIds` (parseActions' own,
 * already-computed answer for exactly this question) into the matching
 * `falsePathOutputIds` array.
 */
describe('choose-case ending in a nested repeat loop (Phase B item 3 round 3, bug #11)', () => {
  const transpiler = new FlowTranspiler();

  it('a choose-case whose entire sequence is a repeat:while block correctly continues via the loop\'s FALSE path, not a spurious duplicate TRUE edge', async () => {
    const yaml = `
alias: Choose case ending in repeat while
trigger:
  - platform: state
    entity_id: binary_sensor.door
action:
  - choose:
      - conditions:
          - condition: numeric_state
            entity_id: sensor.humidity
            above: 28
        sequence:
          - repeat:
              while:
                - condition: numeric_state
                  entity_id: sensor.temp
                  above: 17
              sequence:
                - service: climate.set_hvac_mode
                  target:
                    entity_id: light.b
    default:
      - service: light.turn_on
        target:
          entity_id: climate.main
  - service: notify.notify
    data:
      message: "done"
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    // The while-condition node must have exactly ONE 'true'-handle edge
    // (into its own loop body) -- not a second, spurious one leaking out
    // to whatever follows the whole choose block.
    const whileCond = graph.nodes.find(
      (n) => n.type === 'condition' && (n.data as { _blockKey?: string })._blockKey === 'repeat_while'
    )!;
    expect(whileCond).toBeDefined();
    const trueEdgesFromWhile = graph.edges.filter(
      (e) => e.source === whileCond.id && e.sourceHandle === 'true'
    );
    expect(trueEdgesFromWhile.length).toBe(1);
    // The loop's real "continue the automation" signal must be its FALSE
    // edge, and it must reach the shared tail (notify.notify), not dead-end.
    const falseEdgesFromWhile = graph.edges.filter(
      (e) => e.source === whileCond.id && e.sourceHandle === 'false'
    );
    expect(falseEdgesFromWhile.length).toBe(1);

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    // Whichever strategy topology.ts selects, the loop's body and the
    // shared tail must both come through exactly once, cleanly -- no
    // duplicated/bogus merged-parallel wrapping the loop body (the exact
    // corruption this bug produced when state-machine's
    // generateConditionBlock was reached for this shape).
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);
    expect(yamlOut.match(/climate\.set_hvac_mode/g) ?? []).toHaveLength(1);
    expect(yamlOut).not.toMatch(/parallel:\s*\n\s*-\s*sequence:/); // no bogus merged-parallel wrapping the loop body

    if (yamlOut.includes('current_node')) {
      const verification = verifyStateMachineOutput(graph, yamlOut);
      expect(verification.valid, verification.reason).toBe(true);
    }
  });

  it('an if-block whose then-branch ends in a repeat:until block correctly continues via the loop\'s TRUE path', async () => {
    const yaml = `
alias: If then ending in repeat until
trigger:
  - platform: state
    entity_id: binary_sensor.door
action:
  - if:
      - condition: state
        entity_id: input_boolean.a
        state: 'on'
    then:
      - repeat:
          until:
            - condition: numeric_state
              entity_id: sensor.temp
              above: 30
          sequence:
            - service: light.turn_on
              target:
                entity_id: light.a
  - service: notify.notify
    data:
      message: "done"
mode: single
`;
    const parser = new YamlParser();
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const graph = parsed.graph!;

    const result = transpiler.transpile(graph);
    expect(result.success, JSON.stringify(result.errors)).toBe(true);
    const yamlOut = result.yaml ?? '';
    expect(yamlOut.match(/notify\.notify/g) ?? []).toHaveLength(1);
  });
});
