import { useEffect, useRef } from 'react';
import { useHass } from '@/contexts/HassContext';
import { useLoadAutomation } from '@/hooks/useLoadAutomation';
import { useFlowStore } from '@/store/flow-store';

/**
 * Deep-link entry points — `/circuitry?automation=automation.xyz` opens that
 * automation, `/circuitry?new=1` starts blank. Query params only (not HA's
 * `route` property, which carries just prefix/path, no search string).
 * Rendered inside `<ReactFlowProvider>` (see `App`'s return) because loading
 * an automation needs `useReactFlow`'s `fitView` — this hook can't be called
 * from `App` itself, since `App` is the one *creating* that provider, not a
 * descendant of it. Waits for a real `hass` (needed to resolve
 * entity_id -> automation_id) and only ever runs once per mount.
 */
export function DeepLinkHandler() {
  const { hass } = useHass();
  const { reset, openInNewTab } = useFlowStore();
  const loadAutomation = useLoadAutomation();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !hass) return;

    const params = new URLSearchParams(window.location.search);
    const automationEntityId = params.get('automation');
    const isNew = params.get('new') === '1';
    if (!automationEntityId && !isNew) return;

    handled.current = true;
    // A link never replaces unsaved work: it opens beside it (bug #240:
    // the active tab was replaced without a word, its changes lost).
    const store = useFlowStore.getState();
    const keepsWork = store.hasUnsavedChanges && store.hasRealChanges();

    if (automationEntityId) {
      const stateObj = hass.states[automationEntityId];
      const rawId = stateObj?.attributes?.id;
      const automationConfigId =
        typeof rawId === 'string' || typeof rawId === 'number'
          ? String(rawId)
          : automationEntityId.replace('automation.', '');
      loadAutomation(
        {
          automation_id: automationConfigId,
          entity_id: automationEntityId,
          friendly_name:
            typeof stateObj?.attributes?.friendly_name === 'string'
              ? stateObj.attributes.friendly_name
              : undefined,
        },
        keepsWork ? 'new' : 'current'
      );
    } else if (keepsWork) {
      openInNewTab();
    } else {
      reset();
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('automation');
    url.searchParams.delete('new');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [hass, loadAutomation, reset, openInNewTab]);

  return null;
}
