import { describe, expect, it } from 'vitest';
import { YamlParser } from '../parser/YamlParser';

// Blueprint-based automations are extremely common in real HA setups
// (use_blueprint: replaces explicit triggers:/actions: with a reference +
// input values). Checking here whether the parser fails clearly (so the
// UI can show a sensible "not supported" message) or silently produces an
// empty/nonsensical graph that would look like data loss to the user.
describe('YAML decompile-direction audit: blueprint automations', () => {
  const parser = new YamlParser();

  it('a use_blueprint: automation is either parsed sensibly or fails with a clear error', async () => {
    const yaml = `
alias: Motion light blueprint
use_blueprint:
  path: homeassistant/motion_light.yaml
  input:
    motion_entity: binary_sensor.motion
    light_target:
      entity_id: light.hallway
    no_motion_wait: 120
`;
    const parsed = await parser.parse(yaml);
    console.log('PARSE result:', JSON.stringify({
      success: parsed.success,
      errors: parsed.errors,
      nodeCount: parsed.graph?.nodes?.length,
      nodes: parsed.graph?.nodes?.map((n) => `${n.id}(${n.type})`),
    }, null, 2));

    if (parsed.success) {
      // If it claims success, it must not silently claim to be a fully
      // decompiled, editable automation with zero nodes/actions -- that
      // would look to the user like their automation was wiped.
      expect(parsed.graph!.nodes.length).toBeGreaterThan(0);
    } else {
      // If it fails, the error should be understandable, not a raw
      // exception/stack trace -- and specifically call out blueprints as
      // unsupported (added after this audit found the parser was instead
      // falling through to a generic "no trigger node" validation error).
      expect(Array.isArray(parsed.errors) && parsed.errors.length > 0).toBe(true);
      expect(typeof parsed.errors![0]).toBe('string');
      expect(parsed.errors![0]).toMatch(/blueprint/i);
      expect(parsed.errors![0]).not.toMatch(/at least one trigger node/i);
    }
  });
});
