import { dump as yamlDump } from 'js-yaml';

/**
 * Helpers for an action node holding a step Circuitry doesn't know
 * (`scene:`, the legacy `service_template:`, a step type Home Assistant adds
 * later). The transpiler keeps such a step exactly as written and writes it
 * back unchanged (bug #57; see OPAQUE_STEP_KEY in @circuitry/shared); the
 * canvas shows it as a locked block with its YAML.
 */

/** Keys every HA step may carry; they don't say what kind of step it is. */
const COMMON_STEP_KEYS = new Set(['alias', 'enabled', 'continue_on_error']);

/** The step as it will be saved: the node's data without internal `_` keys or cleared keys. */
export function opaqueStepContent(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([key, value]) => !key.startsWith('_') && value !== undefined)
  );
}

/** The key that names the kind of step (`scene` for `scene: scene.x`), if any. */
export function opaqueStepKind(data: Record<string, unknown>): string | undefined {
  return Object.keys(opaqueStepContent(data)).find((key) => !COMMON_STEP_KEYS.has(key));
}

/** One line for the card: `scene.evening` for `scene: scene.evening`, compact JSON otherwise. */
export function opaqueStepSummary(data: Record<string, unknown>): string {
  const kind = opaqueStepKind(data);
  if (kind === undefined) return '';
  const value = data[kind];
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The step as YAML, for the card's tooltip and the property panel. */
export function opaqueStepYaml(data: Record<string, unknown>): string {
  return yamlDump(opaqueStepContent(data), { lineWidth: -1 }).trimEnd();
}
