import { transpiler } from '@circuitry/transpiler';
import { useReactFlow } from '@xyflow/react';
import { dump as yamlDump } from 'js-yaml';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';
import { computeSourceHash, loadGraphIfFresh, saveGraph } from '@/lib/graph-storage';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/haToast';
import { useFlowStore } from '@/store/flow-store';

export interface LoadableAutomation {
  automation_id: string;
  entity_id?: string;
  friendly_name?: string;
}

/**
 * Loads an automation's config into the editor by automation_id — shared
 * between `AutomationImportDialog` (picking from a list) and Circuitry's
 * `?automation=` deep-link handling (see App.tsx), so both go through the
 * exact same fetch/parse/toast logic.
 *
 * `openMode` mirrors flow-store.ts's `reset()`/`openInNewTab()` split:
 * `'current'` (the default, matching every existing call site's prior
 * behavior) replaces whatever's in the active tab; `'new'` backgrounds it
 * and opens this automation in a fresh tab instead — see
 * AutomationImportDialog.tsx's per-row "open in new tab" button.
 */
export function useLoadAutomation() {
  const { t } = useTranslation(['dialogs', 'errors']);
  const { hass, config: hassConfig } = useHass();
  const { reset, openInNewTab, fromFlowGraph, setFlowName, setAutomationId } = useFlowStore();
  const { fitView } = useReactFlow();

  return async (
    automation: LoadableAutomation,
    openMode: 'current' | 'new' = 'current'
  ): Promise<boolean> => {
    const displayName = automation.friendly_name || automation.automation_id;
    try {
      const api = getHomeAssistantAPI(hass, hassConfig);

      if (!api.isConnected()) {
        throw new Error(t('errors:connection.noConnection'));
      }

      const config = await api.getAutomationConfigWithFallback(
        automation.automation_id,
        automation.friendly_name
      );

      if (openMode === 'new') {
        openInNewTab();
      } else {
        reset();
      }

      if (config) {
        // Option 1 fast path: if Circuitry itself saved this automation and
        // nothing has touched it since (the stored canonical graph's hash
        // still matches this live config), load that graph back verbatim --
        // no heuristic YAML decompilation involved at all. Any mismatch
        // (hand-edited YAML, the native HA UI, another tool, or simply an
        // automation Circuitry never saved) falls through to the existing
        // decompiler below, exactly as it always has.
        const sourceHash = computeSourceHash(config as unknown as Record<string, unknown>);
        const canonicalGraph = await loadGraphIfFresh(
          api,
          automation.automation_id,
          sourceHash
        ).catch((lookupError) => {
          console.warn(
            'Circuitry: canonical graph lookup failed, falling back to YAML decompile:',
            lookupError
          );
          return null;
        });

        if (canonicalGraph) {
          // eslint-disable-next-line no-console -- deliberate, user-facing
          // diagnostic for verifying Option 1: makes which load path fired
          // visible in the browser console without needing to inspect raw
          // websocket frames.
          console.info(
            `Circuitry: loaded "${displayName}" via the canonical graph (Option 1 fast path) -- no YAML decompile.`
          );
          fromFlowGraph(canonicalGraph);
          setTimeout(() => {
            fitView({ padding: 0.2, duration: 300, maxZoom: 0.75 });
          }, 150);

          setFlowName(displayName);
          setAutomationId(automation.automation_id);

          showSuccessToast(t('dialogs:import.importSuccess', { name: displayName }));
        } else {
          // eslint-disable-next-line no-console -- see the matching log in
          // the canonicalGraph branch above.
          console.info(
            `Circuitry: loaded "${displayName}" via YAML decompile (no canonical graph, or it's stale).`
          );
          const yamlString = yamlDump(config, {
            indent: 2,
            lineWidth: -1,
            quotingType: '"',
            forceQuotes: false,
          });

          const result = await transpiler.fromYaml(yamlString);
          if (!result.success || !result.graph) {
            throw new Error(result.errors?.join('\n') || t('errors:import.parseFailed'));
          }

          fromFlowGraph(result.graph);
          setTimeout(() => {
            fitView({ padding: 0.2, duration: 300, maxZoom: 0.75 });
          }, 150);

          setFlowName(displayName);
          setAutomationId(automation.automation_id);

          showSuccessToast(t('dialogs:import.importSuccess', { name: displayName }));

          // Close the JSON-canonical-store staleness gap (Phase B): this
          // branch is reached whenever the stored canonical graph was
          // missing, schema-invalid, or stale (this automation was edited
          // outside Circuitry -- by hand, via HA's native UI, or by
          // another tool -- since Circuitry last saved it). Until now, the
          // freshly decompiled graph above was only ever loaded into
          // memory for this editor session; the STORED canonical JSON
          // stayed exactly as stale as it was before this load, silently,
          // until the user happened to make and save a further edit from
          // inside Circuitry. Re-persisting it here the moment the
          // mismatch is caught keeps the "canonical JSON always matches
          // what's actually running" invariant from lapsing indefinitely
          // just from opening (and not touching) an externally-edited
          // automation -- and, as a side benefit, means the *next* load of
          // this same unmodified automation takes the fast canonical-graph
          // path instead of decompiling all over again.
          //
          // `sourceHash` (computed above, before the canonical-graph
          // lookup) was hashed from this exact `config` -- the same
          // automation config this decompile just parsed -- so it's
          // exactly the hash the next load's freshness check needs to see
          // to treat this newly-stored graph as fresh. Best-effort, same
          // rationale as flow-store.ts's own saveAutomation/updateAutomation
          // calls to saveGraph: a failure here never blocks anything the
          // user is doing, it just means the next load decompiles again,
          // exactly as it did before this fix.
          try {
            await saveGraph(api, automation.automation_id, result.graph, sourceHash);
            // eslint-disable-next-line no-console -- deliberate diagnostic,
            // matching flow-store.ts's identical log for the save path.
            console.info(
              'Circuitry: re-synced canonical graph after stale-hash decompile fallback for automation',
              automation.automation_id
            );
          } catch (graphStoreError) {
            console.warn(
              'Circuitry: failed to re-sync canonical graph after decompile fallback (will decompile again on next load):',
              graphStoreError
            );
          }

          // Parsed successfully, but not losslessly — file a Repair issue so this
          // survives past the toast instead of being a one-time UI warning only.
          if (result.warnings.length > 0 && automation.entity_id) {
            showWarningToast(t('dialogs:import.lossyImportWarning', { name: displayName }), {
              description: t('dialogs:import.lossyImportWarningDescription', {
                count: result.warnings.length,
              }),
            });
            void api.reportImportIssue(automation.entity_id, result.warnings);
          }
        }
      } else {
        setFlowName(displayName);
        setAutomationId(automation.automation_id);

        showWarningToast(t('dialogs:import.openedWarning', { name: displayName }), {
          description: t('dialogs:import.openedWarningDescription'),
        });
      }

      return true;
    } catch (error) {
      console.error('Circuitry: Failed to open automation:', error);
      showErrorToast(t('dialogs:import.importFailed', { message: (error as Error).message }));
      return false;
    }
  };
}
