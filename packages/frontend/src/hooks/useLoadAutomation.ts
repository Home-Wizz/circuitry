import { useReactFlow } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';
import { saveGraph } from '@/lib/graph-storage';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/haToast';
import { readAutomationAsGraph } from '@/lib/read-automation';
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
  const {
    reset,
    openInNewTab,
    fromFlowGraph,
    setFlowName,
    setAutomationId,
    setSavedConfigHash,
    setKeptElsewhere,
  } = useFlowStore();
  const { fitView } = useReactFlow();

  return async (
    automation: LoadableAutomation,
    openMode: 'current' | 'new' = 'current'
  ): Promise<boolean> => {
    const displayName = automation.friendly_name || automation.automation_id;
    // The tab Open was pressed in: replaced only if it's still the active
    // one when the automation arrives (bug #203).
    const startTab = useFlowStore.getState().flowId;
    try {
      const api = getHomeAssistantAPI(hass, hassConfig);

      if (!api.isConnected()) {
        throw new Error(t('errors:connection.noConnection'));
      }

      const reading = await readAutomationAsGraph(api, automation.automation_id, displayName);
      if (!reading.ok) {
        // HA couldn't give it: open nothing. An empty canvas linked to the
        // automation was saved over it (bug #204).
        if (reading.reason === 'unavailable')
          throw new Error(t('dialogs:import.configUnavailable'));
        throw new Error(reading.errors.join('\n') || t('errors:import.parseFailed'));
      }
      const { config, editable, sourceHash, graph, decompiled, importCheck } = reading;
      const readingDiffers = importCheck.verdict === 'different';

      // Only now, with the automation read: replace the tab, or open a new
      // one -- also when another tab became active meanwhile, which must
      // not be replaced.
      if (openMode === 'new' || useFlowStore.getState().flowId !== startTab) {
        openInNewTab();
      } else {
        reset();
      }
      fromFlowGraph(graph);
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300, maxZoom: 0.75 });
      }, 150);
      // The automation's own alias: the entity's name can differ (renamed
      // in HA's entity settings), and putting it here opened the tab as
      // changed and renamed the automation at its next save (bug #240).
      setFlowName(typeof config.alias === 'string' && config.alias ? config.alias : displayName);
      if (readingDiffers) {
        setKeptElsewhere('readingDiffers');
        showWarningToast(t('dialogs:import.readingDiffers', { name: displayName }), {
          description: t('dialogs:import.readingDiffersDescription', {
            detail: importCheck.detail ?? '',
          }),
        });
      } else if (editable) {
        setAutomationId(automation.automation_id);
        // What HA held when this tab opened it: an Update warns if it
        // changed since.
        setSavedConfigHash(sourceHash);
        showSuccessToast(t('dialogs:import.importSuccess', { name: displayName }));
      } else {
        // Kept outside automations.yaml (a package, another file): HA can't
        // save over it, so the tab isn't linked to it (bug #205), and only a
        // copy can be saved -- a plain save made a second automation beside
        // it, both running (bug #226).
        setKeptElsewhere(true);
        showWarningToast(t('dialogs:import.notEditable', { name: displayName }), {
          description: t('dialogs:import.notEditableDescription'),
        });
      }

      if (decompiled?.graph) {
        // Close the canonical store's staleness gap: this automation was
        // edited outside Circuitry since Circuitry last saved it (or never
        // saved by it), so the stored graph is re-persisted with this
        // config's hash, and the next load of the unchanged automation
        // takes the fast path. Best-effort, as the save path's saveGraph.
        try {
          await saveGraph(api, automation.automation_id, decompiled.graph, sourceHash);
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

        // Parsed, but not losslessly: a Repair issue outlives the toast.
        if (decompiled.warnings.length > 0 && automation.entity_id) {
          showWarningToast(t('dialogs:import.lossyImportWarning', { name: displayName }), {
            description: t('dialogs:import.lossyImportWarningDescription', {
              count: decompiled.warnings.length,
            }),
          });
          void api.reportImportIssue(automation.entity_id, decompiled.warnings);
        }
      }

      // A reading that runs differently outlives the toast as a Repair
      // issue too (the lossy-import one, with this as its text).
      if (
        readingDiffers &&
        automation.entity_id &&
        !(decompiled && decompiled.warnings.length > 0)
      ) {
        void api.reportImportIssue(automation.entity_id, [
          t('dialogs:import.readingDiffersDescription', { detail: importCheck.detail ?? '' }),
        ]);
      }

      // Read in full: an earlier lossy-import Repair for it is cleared (it
      // stayed until HA restarted; bug #216).
      if (
        automation.entity_id &&
        !readingDiffers &&
        !(decompiled && decompiled.warnings.length > 0)
      ) {
        void api.reportImportIssue(automation.entity_id, []);
      }

      return true;
    } catch (error) {
      console.error('Circuitry: Failed to open automation:', error);
      showErrorToast(
        t('dialogs:import.importFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
      return false;
    }
  };
}
