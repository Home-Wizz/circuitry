import { describe, expect, it, vi } from 'vitest';
import { findBackEdges } from '../analyzer/topology';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Mock the generateIds functions for deterministic IDs
let mockNodeCounter = 0;
vi.mock('../utils/generateIds', () => ({
  generateNodeId: (type: string, index: number) => `${type}_test_${index}_${mockNodeCounter++}`,
  generateEdgeId: (source: string, target: string) => `e-${source}-${target}`,
  generateGraphId: () => `a18b0fbb-d966-432c-aba7-4f7361da8d29`,
  resetNodeCounter: () => {
    mockNodeCounter = 0;
  },
}));

describe('Repeat block roundtrip', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  describe('repeat.while', () => {
    const yaml = `
alias: While Loop
description: Test while
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.motion
          state: "on"
      sequence:
        - action: light.turn_on
          target:
            entity_id: light.living_room
        - delay:
            seconds: 5
mode: single
`;

    it('should parse repeat.while into exploded nodes', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();

      const graph = result.graph!;

      // Should have: 1 trigger + 1 condition + 1 action + 1 delay = 4 nodes
      expect(graph.nodes.length).toBe(4);

      // Should have a condition node for the while condition
      const conditionNodes = graph.nodes.filter((n) => n.type === 'condition');
      expect(conditionNodes.length).toBe(1);
      expect(conditionNodes[0].data.condition).toBe('state');

      // Should have a structurally-detected back-edge pointing to the condition node
      const backEdgeIds = findBackEdges(graph);
      expect(backEdgeIds.size).toBe(1);
      const backEdge = graph.edges.find((e) => backEdgeIds.has(e.id))!;
      expect(backEdge.target).toBe(conditionNodes[0].id);
    });

    it('should transpile repeat.while back to valid YAML with repeat block', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!);
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('while');
      expect(outputYaml).toContain('sequence');
      expect(outputYaml).toContain('light.turn_on');
      // Should NOT contain 'service: undefined'
      expect(outputYaml).not.toContain('service: undefined');
    });
  });

  describe('repeat.until', () => {
    const yaml = `
alias: Until Loop
description: Test until
triggers:
  - trigger: state
    entity_id: binary_sensor.door
    to: "on"
actions:
  - repeat:
      until:
        - condition: state
          entity_id: binary_sensor.door
          state: "off"
      sequence:
        - action: notify.mobile_app
          data:
            message: Door is still open!
        - delay:
            minutes: 1
mode: single
`;

    it('should parse repeat.until into exploded nodes', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();

      const graph = result.graph!;

      // Should have: 1 trigger + 1 action + 1 delay + 1 condition = 4 nodes
      expect(graph.nodes.length).toBe(4);

      // Should have a condition node for the until condition
      const conditionNodes = graph.nodes.filter((n) => n.type === 'condition');
      expect(conditionNodes.length).toBe(1);
      expect(conditionNodes[0].data.condition).toBe('state');

      // Should have a structurally-detected back-edge
      const backEdgeIds = findBackEdges(graph);
      expect(backEdgeIds.size).toBe(1);
    });

    it('should transpile repeat.until back to valid YAML with repeat block', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!);
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('until');
      expect(outputYaml).toContain('sequence');
      expect(outputYaml).toContain('notify.mobile_app');
      expect(outputYaml).not.toContain('service: undefined');
    });
  });

  describe('repeat.count', () => {
    const yaml = `
alias: Count Loop
description: Test count
triggers:
  - trigger: state
    entity_id: input_boolean.test
    to: "on"
actions:
  - repeat:
      count: 3
      sequence:
        - action: light.toggle
          target:
            entity_id: light.living_room
        - delay:
            seconds: 1
mode: single
`;

    it('should parse repeat.count into exploded state machine nodes', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();

      const graph = result.graph!;

      // Should have: 1 trigger + 1 init set_vars + 1 action + 1 delay + 1 incr set_vars + 1 condition = 6 nodes
      expect(graph.nodes.length).toBe(6);

      // Should have set_variables nodes for init and increment
      const setVarNodes = graph.nodes.filter((n) => n.type === 'set_variables');
      expect(setVarNodes.length).toBe(2);

      // Init node should be the one initializing counter to 0
      const initNode = setVarNodes.find((n) =>
        Object.values(n.data.variables as Record<string, unknown>).includes(0)
      );
      expect(initNode).toBeDefined();

      // Should have a condition node for the counter check
      const conditionNodes = graph.nodes.filter((n) => n.type === 'condition');
      expect(conditionNodes.length).toBe(1);
      expect(conditionNodes[0].data.condition).toBe('template');

      // Should have a structurally-detected back-edge
      const backEdgeIds = findBackEdges(graph);
      expect(backEdgeIds.size).toBe(1);
      const backEdge = graph.edges.find((e) => backEdgeIds.has(e.id))!;
      expect(backEdge.source).toBe(conditionNodes[0].id);
    });

    it('should transpile repeat.count back to valid YAML with repeat block', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!);
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('count: 3');
      expect(outputYaml).toContain('sequence');
      expect(outputYaml).toContain('light.toggle');
      expect(outputYaml).not.toContain('service: undefined');
      // Should NOT contain the internal counter variable
      expect(outputYaml).not.toContain('_repeat_counter_');
    });
  });

  describe('repeat nested inside if/then', () => {
    const yaml = `
alias: Repeat Inside If
description: Nested repeat
triggers:
  - trigger: time
    at: "08:00:00"
actions:
  - if:
      - condition: state
        entity_id: binary_sensor.workday
        state: "on"
    then:
      - repeat:
          while:
            - condition: state
              entity_id: input_boolean.reminder_needed
              state: "on"
          sequence:
            - action: notify.mobile_app
              data:
                message: Time to get ready!
            - delay:
                minutes: 5
    else:
      - action: notify.mobile_app
        data:
          message: Enjoy your day off!
mode: single
`;

    it('should parse nested repeat inside if/then', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();

      const graph = result.graph!;

      // Should have condition nodes for both the if-condition and the while-condition
      const conditionNodes = graph.nodes.filter((n) => n.type === 'condition');
      expect(conditionNodes.length).toBe(2);

      // Should have a structurally-detected back-edge for the while loop
      const backEdgeIds = findBackEdges(graph);
      expect(backEdgeIds.size).toBe(1);
    });

    it('should roundtrip nested repeat', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!);
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('while');
      expect(outputYaml).not.toContain('service: undefined');
    });
  });

  describe('repeat with device actions', () => {
    const yaml = `
alias: Repeat With Device Action
description: Repeat containing device action calls
triggers:
  - trigger: state
    entity_id: input_boolean.test
    to: "on"
actions:
  - repeat:
      count: 5
      sequence:
        - action: light.turn_on
          target:
            entity_id: light.kitchen
          data:
            brightness: 255
        - delay:
            seconds: 2
        - action: light.turn_off
          target:
            entity_id: light.kitchen
        - delay:
            seconds: 2
mode: single
`;

    it('should parse and transpile repeat with multiple actions', async () => {
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!);
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('count: 5');
      expect(outputYaml).toContain('light.turn_on');
      expect(outputYaml).toContain('light.turn_off');
      expect(outputYaml).not.toContain('service: undefined');
    });
  });

  describe('topology analysis with repeat', () => {
    it('should classify repeat-only flows as native strategy', async () => {
      const yaml = `
alias: Simple Repeat
triggers:
  - trigger: state
    entity_id: binary_sensor.test
actions:
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.test
          state: "on"
      sequence:
        - action: light.turn_on
          target:
            entity_id: light.test
mode: single
`;
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const analysis = transpiler.analyzeTopology(result.graph!);
      // Repeat back-edges should not cause cycle detection
      expect(analysis.hasCycles).toBe(false);
      expect(analysis.recommendedStrategy).toBe('native');
    });
  });

  // Regression coverage for two bugs found via empirical audit on 2026-09-06:
  // (1) a repeat loop placed as the else-branch of an if/else had its own
  //     while-condition misclassified as an else-if branch condition,
  //     silently dropping the `repeat:` wrapper entirely; (2) a repeat
  //     loop whose body opened with its own nested if/else had that
  //     if/else's condition wrongly folded into the loop's own `while:`
  //     AND-chain, and lost the else-branch's actions altogether. Both are
  //     specific instances of the same underlying problem: structure
  //     detection along a condition's true-edge chain didn't stop at a
  //     node that was itself already a distinct pattern's entry point.
  describe('repeat with branching body', () => {
    it('should keep the repeat: wrapper intact when the loop is an if/else else-branch', async () => {
      const yaml = `
alias: Loop in both branches
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - if:
      - condition: state
        entity_id: sun.sun
        state: below_horizon
    then:
      - repeat:
          while:
            - condition: state
              entity_id: binary_sensor.motion
              state: "on"
          sequence:
            - action: light.turn_on
              target:
                entity_id: light.porch
    else:
      - repeat:
          while:
            - condition: state
              entity_id: binary_sensor.motion2
              state: "on"
          sequence:
            - action: light.turn_on
              target:
                entity_id: light.lamp
mode: single
`;
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!, { forceStrategy: 'native' });
      expect(outputYaml).toContain('if:');
      expect(outputYaml).toContain('then:');
      expect(outputYaml).toContain('else:');
      // Both branches must keep their own repeat/while wrapper -- not get
      // absorbed into the if/else's own condition chain.
      const repeatCount = (outputYaml.match(/repeat:/g) ?? []).length;
      expect(repeatCount).toBe(2);
      expect(outputYaml).toContain('light.porch');
      expect(outputYaml).toContain('light.lamp');
      expect(outputYaml).not.toContain('choose');
    });

    it('should keep a nested if/else inside a while-loop body fully intact', async () => {
      const yaml = `
alias: Loop with branch inside
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.motion
          state: "on"
      sequence:
        - if:
            - condition: state
              entity_id: sun.sun
              state: below_horizon
          then:
            - action: light.turn_on
              target:
                entity_id: light.porch
          else:
            - action: light.turn_on
              target:
                entity_id: light.lamp
        - delay:
            seconds: 2
mode: single
`;
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!, { forceStrategy: 'native' });
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('while');
      // The while: header must contain only the loop's own condition --
      // not the nested if's sun.sun condition folded in as an AND-chain.
      const whileMatch = outputYaml.match(/while:\n((?:\s{8}.*\n)+)/);
      expect(whileMatch).not.toBeNull();
      expect(whileMatch![1]).not.toContain('sun.sun');
      // Both branches of the nested if/else must survive with their
      // actions in place, and the trailing delay must still run after it.
      expect(outputYaml).toContain('then:');
      expect(outputYaml).toContain('else:');
      expect(outputYaml).toContain('light.porch');
      expect(outputYaml).toContain('light.lamp');
      expect(outputYaml).toContain('seconds: 2');
    });

    it('should keep both branches of a parallel: block that opens the loop body', async () => {
      const yaml = `
alias: Loop with parallel body
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.motion
          state: "on"
      sequence:
        - parallel:
            - action: light.turn_on
              target:
                entity_id: light.porch
            - action: notify.notify
              data:
                message: still on
        - delay:
            seconds: 2
mode: single
`;
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!, { forceStrategy: 'native' });
      expect(outputYaml).toContain('repeat');
      expect(outputYaml).toContain('parallel');
      // Both parallel branches must survive -- a while-condition with more
      // than one TRUE edge (the loop body opening with `parallel:`, fanning
      // out directly from the condition) used to have collectBodyNodes seed
      // its walk from only one of those edges, silently dropping the rest.
      expect(outputYaml).toContain('light.porch');
      expect(outputYaml).toContain('notify.notify');
      expect(outputYaml).toContain('still on');
      expect(outputYaml).toContain('seconds: 2');
    });

    it('should keep a loop nested inside an if/else, itself nested inside another loop', async () => {
      // Regression for findConvergencePoint/getShortestDistance following
      // back edges: an outer while-loop whose body has an if/else, where
      // the "then" branch is ANOTHER while-loop and the "else" branch is a
      // plain delay that loops back to the outer while-condition. Because
      // the else-branch's back edge (delay -> outer while-condition) was
      // being followed as a normal forward edge, findConvergencePoint could
      // walk all the way around the outer loop and land back on the INNER
      // loop's own while-condition, misidentifying it as the if/else's
      // shared convergence point. That collapsed the "then" branch to
      // `then: []` and hoisted the entire inner repeat: out to run
      // unconditionally after the if/else on every outer iteration, instead
      // of only when the if was true. Found via empirical audit, 2026-09-06.
      const yaml = `
alias: Loop branch loop
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.motion
          state: "on"
      sequence:
        - if:
            - condition: state
              entity_id: sun.sun
              state: below_horizon
          then:
            - repeat:
                while:
                  - condition: state
                    entity_id: binary_sensor.door
                    state: "on"
                sequence:
                  - action: light.toggle
                    target:
                      entity_id: light.porch
                  - delay:
                      seconds: 1
          else:
            - delay:
                seconds: 5
mode: single
`;
      const result = await parser.parse(yaml);
      expect(result.success).toBe(true);

      const outputYaml = transpiler.toYaml(result.graph!, { forceStrategy: 'native' });
      const repeatCount = (outputYaml.match(/repeat:/g) ?? []).length;
      expect(repeatCount).toBe(2);
      // The inner repeat must live INSIDE the if's then: block, not as a
      // sibling step that runs on every outer iteration regardless of the
      // sun condition.
      const thenIdx = outputYaml.indexOf('then:');
      const elseIdx = outputYaml.indexOf('else:', thenIdx);
      expect(thenIdx).toBeGreaterThan(-1);
      expect(elseIdx).toBeGreaterThan(thenIdx);
      const thenBlock = outputYaml.slice(thenIdx, elseIdx);
      expect(thenBlock).toContain('repeat:');
      expect(thenBlock).toContain('binary_sensor.door');
      expect(outputYaml).toContain('light.porch');
      expect(outputYaml).toContain('seconds: 5');
    });
  });
});
