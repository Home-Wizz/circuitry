import { describe, expect, it } from 'vitest';
import { YamlParser } from '../parser/YamlParser';

describe('Issue #219 - trigger fallback (must have at least one trigger node)', () => {
  const parser = new YamlParser();

  it('handles event_type as array (modern HA multi-event trigger)', async () => {
    const yaml = `
alias: Test
triggers:
  - trigger: event
    event_type:
      - ha_started
      - homeassistant_started
conditions: []
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
`;
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    const triggers = result.graph!.nodes.filter((n) => n.type === 'trigger');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
  });

  it('handles for: as a number (seconds)', async () => {
    const yaml = `
alias: Test
triggers:
  - trigger: state
    entity_id: sensor.temperature
    to: "on"
    for: 300
conditions: []
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
`;
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    const triggers = result.graph!.nodes.filter((n) => n.type === 'trigger');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
  });

  // A trigger keyed by its type (`- state: {...}`) is refused by HA
  // (2026.2 to 2026.10: "required key not provided at trigger"), so it is
  // refused here too, with that reason (#245, decision D3); it was read as
  // a state trigger holding its options as a `state:` value.
  it('a dict-keyed trigger, which HA refuses, is refused with the reason', async () => {
    const yaml = `
alias: Test
triggers:
  - state:
      entity_id: sensor.temperature
      to: "on"
conditions: []
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
`;
    const result = await parser.parse(yaml);
    expect(result.success).toBe(false);
    expect((result.errors ?? []).join('\n')).toMatch(
      /Could not read trigger 1: it has no trigger type/
    );
  });

  it('handles for: with template string value in duration object', async () => {
    const yaml = `
alias: Test
triggers:
  - trigger: state
    entity_id: sensor.temperature
    to: "on"
    for:
      minutes: "{{ states('input_number.delay') | int }}"
conditions: []
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
`;
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    const triggers = result.graph!.nodes.filter((n) => n.type === 'trigger');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
  });
});
