import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

// Decompile-direction audit, batch 3 (2026-09-06). Covers automation
// `mode:` values not yet exercised by any earlier audit batch (only
// `mode: single`/`restart`(via fixtures)/`parallel` had been checked before
// bug #12 -- `queued` specifically, plus its `max`/`max_exceeded` fields,
// hadn't been round-tripped at all) and a couple of trigger platforms not
// covered by decompile-audit(.test|-2.test).ts: time_pattern and zone.
describe('YAML decompile-direction audit, batch 3', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  it('mode: queued with max and max_exceeded round-trips without loss', async () => {
    const yaml = `
alias: Queued mode test
description: ""
triggers:
  - trigger: state
    entity_id: binary_sensor.doorbell
    to: "on"
conditions: []
actions:
  - action: notify.notify
    data:
      message: "doorbell"
mode: queued
max: 5
max_exceeded: warning
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const outYaml = transpiler.toYaml(parsed.graph!);
    expect(outYaml).toContain('mode: queued');
    expect(outYaml).toContain('max: 5');
    expect(outYaml).toContain('max_exceeded: warning');
  });

  it('mode: restart round-trips without loss (direct check, not just via an unrelated fixture)', async () => {
    const yaml = `
alias: Restart mode test
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - delay:
      seconds: 30
  - action: light.turn_off
    target:
      entity_id: light.hallway
mode: restart
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const outYaml = transpiler.toYaml(parsed.graph!);
    expect(outYaml).toContain('mode: restart');
    expect(outYaml).toContain('light.hallway');
  });

  it('time_pattern trigger round-trips its hours/minutes/seconds fields', async () => {
    const yaml = `
alias: Time pattern trigger test
triggers:
  - trigger: time_pattern
    minutes: "/15"
conditions: []
actions:
  - action: sensor.turn_on
    target:
      entity_id: sensor.heartbeat
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const outYaml = transpiler.toYaml(parsed.graph!);
    expect(outYaml).toContain('trigger: time_pattern');
    expect(outYaml).toContain('minutes: /15');
  });

  it('zone trigger (enter/leave a geofenced zone) round-trips its fields', async () => {
    const yaml = `
alias: Zone trigger test
triggers:
  - trigger: zone
    entity_id: person.owner
    zone: zone.home
    event: enter
conditions: []
actions:
  - action: notify.notify
    data:
      message: "welcome home"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const outYaml = transpiler.toYaml(parsed.graph!);
    expect(outYaml).toContain('trigger: zone');
    expect(outYaml).toContain('zone: zone.home');
    expect(outYaml).toContain('event: enter');
  });

  it('webhook trigger round-trips its webhook_id field', async () => {
    const yaml = `
alias: Webhook trigger test
triggers:
  - trigger: webhook
    webhook_id: my-secret-webhook-id
    allowed_methods:
      - POST
    local_only: true
conditions: []
actions:
  - action: notify.notify
    data:
      message: "webhook fired"
mode: single
`;
    const parsed = await parser.parse(yaml);
    expect(parsed.success).toBe(true);
    const outYaml = transpiler.toYaml(parsed.graph!);
    expect(outYaml).toContain('trigger: webhook');
    expect(outYaml).toContain('webhook_id: my-secret-webhook-id');
    expect(outYaml).toContain('local_only: true');
  });
});
