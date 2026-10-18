import type { FlowGraph } from '@circuitry/shared';
import { checkImport, transpiler } from '@circuitry/transpiler';
import { dump as yamlDump } from 'js-yaml';
import { computeSourceHash, loadGraphIfFresh } from '@/lib/graph-storage';
import type { HomeAssistantAPI } from '@/lib/ha-api';
import type { AutomationConfig } from '@/types/hass';

/** An automation read from Home Assistant as a canvas, checked by running. */
export type AutomationReading =
  | {
      ok: true;
      config: AutomationConfig;
      /** Kept in automations.yaml, so a save can replace it. */
      editable: boolean;
      /** computeSourceHash of the config as read. */
      sourceHash: string;
      graph: FlowGraph;
      /** The decompiler's result when there was no fresh stored graph. */
      decompiled: Awaited<ReturnType<typeof transpiler.fromYaml>> | null;
      /** The graph run against the automation it was read from. */
      importCheck: ReturnType<typeof checkImport>;
      /** The config as YAML, as checked. */
      yaml: string;
    }
  /** Home Assistant couldn't give its config. */
  | { ok: false; reason: 'unavailable' }
  /** Its YAML couldn't be read as a canvas. */
  | { ok: false; reason: 'unparsed'; errors: string[] };

/**
 * Reads an automation the way opening it does: its config from Home
 * Assistant, the graph Circuitry stored for it while that still matches
 * (Option 1's fast path), else the YAML decompiled, then the import check
 * (the graph run against the YAML, on test values). Shared by opening an
 * automation and the self-check, so both read it the same way.
 */
export async function readAutomationAsGraph(
  api: HomeAssistantAPI,
  automationId: string,
  displayName: string
): Promise<AutomationReading> {
  const read = await api.readAutomation(automationId);
  if (!read) return { ok: false, reason: 'unavailable' };
  const { config, editable } = read;

  // Option 1 fast path: if Circuitry itself saved this automation and
  // nothing has touched it since (the stored canonical graph's hash still
  // matches this live config), its graph is read back verbatim. Any
  // mismatch (hand-edited YAML, the native HA UI, another tool, or an
  // automation Circuitry never saved) falls through to the decompiler.
  const sourceHash = computeSourceHash({ ...config });
  const canonicalGraph = await loadGraphIfFresh(api, automationId, sourceHash).catch(
    (lookupError) => {
      console.warn(
        'Circuitry: canonical graph lookup failed, falling back to YAML decompile:',
        lookupError
      );
      return null;
    }
  );

  const yaml = yamlDump(config, {
    indent: 2,
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  });
  let decompiled: Awaited<ReturnType<typeof transpiler.fromYaml>> | null = null;
  if (canonicalGraph) {
    // eslint-disable-next-line no-console -- deliberate, user-facing
    // diagnostic: which load path fired.
    console.info(
      `Circuitry: loaded "${displayName}" via the canonical graph (Option 1 fast path) -- no YAML decompile.`
    );
  } else {
    // eslint-disable-next-line no-console -- see the matching log above.
    console.info(
      `Circuitry: loaded "${displayName}" via YAML decompile (no canonical graph, or it's stale).`
    );
    decompiled = await transpiler.fromYaml(yaml);
    if (!decompiled.success || !decompiled.graph) {
      return { ok: false, reason: 'unparsed', errors: decompiled.errors ?? [] };
    }
  }
  const graph = canonicalGraph ?? decompiled?.graph;
  if (!graph) return { ok: false, reason: 'unparsed', errors: [] };

  // The import check: a graph that runs differently opens read-only (only
  // a copy can be saved): saved over the automation it would change what
  // it does. The stored graph is checked too: a stale or damaged one is as
  // wrong as a misread one.
  const importCheck = checkImport(yaml, graph);
  return { ok: true, config, editable, sourceHash, graph, decompiled, importCheck, yaml };
}
