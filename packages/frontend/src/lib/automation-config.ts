import type { FlowGraph } from '@circuitry/shared';
import type { FlowTranspiler, TranspileResult } from '@circuitry/transpiler';
import { t as i18t } from 'i18next';
import type { AutomationConfig } from '@/types/hass';

/**
 * Validates and transpiles a flow for saving, both save paths' way. When
 * the transpiler can't write it, the error carries its reasons: a save that
 * fails says why (a flow Home Assistant can't express, a loop that can't be
 * written), as the YAML preview already did. The save paths used to throw
 * "Failed to transpile flow to automation config" and drop them.
 */
export function transpileForSave(transpiler: FlowTranspiler, graph: FlowGraph): TranspileResult {
  const validation = transpiler.validate(graph);
  if (validation.errors.length > 0) {
    throw new Error(
      i18t('errors:validation.validationFailed', {
        errors: validation.errors.map((e) => e.message).join(', '),
      })
    );
  }
  const result = transpiler.transpile(graph);
  if (result.success && result.output?.automation) return result;
  const reasons = (result.errors ?? []).filter((e) => e.trim() !== '');
  throw new Error(
    reasons.length > 0 ? reasons.join('\n') : i18t('errors:validation.transpileFailed')
  );
}

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
