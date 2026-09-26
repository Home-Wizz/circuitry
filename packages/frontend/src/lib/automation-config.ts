import type { TranspileResult } from '@circuitry/transpiler';
import type { AutomationConfig } from '@/types/hass';

/**
 * The automation config flow-store saves to Home Assistant for a
 * successful transpile: the flow's name and description, then the
 * transpiler's `config` -- the exact object its `yaml` serializes, which is
 * what the verification gate checked (top-level `variables:` and
 * `_circuitry_metadata` included).
 *
 * Bug #39 (2026-09-26): both save paths used to build this from
 * `result.output.automation` plus a `_circuitry_metadata` of their own.
 * `output.automation` has no top-level `variables:` when the state-machine
 * strategy is used (FlowTranspiler merges them in only when serializing),
 * so saving such an automation dropped its variables, and every template
 * that used one broke in HA. The hand-built metadata also always said
 * `strategy: native`, and lacked the node order and the state-machine
 * decompile hints (`fan_outs`, `markers`) the transpiler writes.
 *
 * The transpiler's own keys still win over the name and description, as
 * before.
 */
export function buildAutomationConfig(
  name: string,
  description: string,
  result: Pick<TranspileResult, 'config' | 'output'>
): AutomationConfig {
  const config = result.config;
  if (!config || !result.output?.automation) {
    throw new Error('Failed to transpile flow to automation config');
  }
  return {
    alias: name,
    description,
    ...config,
  };
}
