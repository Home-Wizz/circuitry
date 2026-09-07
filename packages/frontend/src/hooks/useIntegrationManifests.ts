import { useCallback, useRef, useState } from 'react';
import { useHass } from '@/contexts/HassContext';

/**
 * Matches Home Assistant's own `IntegrationType` (home-assistant/frontend's
 * data/integration.ts) — which bucket an integration belongs to, used by
 * ThenActionDialog.tsx to reproduce real HA's own "Add action" > "By type" >
 * Generic/Integration split (see that file's `integrationDomainRows`).
 */
export type IntegrationType = 'device' | 'helper' | 'hub' | 'service' | 'hardware' | 'entity' | 'system';

export interface IntegrationManifest {
  domain: string;
  name: string;
  integration_type?: IntegrationType;
  is_built_in?: boolean;
}

/**
 * Wraps HA's `manifest/list` WS command — the same call real HA's own "Add
 * action"/"Add trigger"/"Add condition" dialog uses to classify every
 * service domain (home-assistant/frontend's data/integration.ts's
 * `fetchIntegrationManifests`, `add-automation-element-dialog.ts`'s
 * `_classifyDomain`). ThenActionDialog.tsx uses this so its "Integration"
 * list — the ~30-40 service-only domains (Backup, File, Home Assistant
 * Cloud, ...) a real HA instance exposes — is generated from the connected
 * instance's actual installed integrations rather than a hand-maintained
 * static guess, per direct user request ("use the native home assistant
 * automation to generate this list").
 *
 * Fetched once and cached for the lifetime of this hook instance (mirrors
 * real HA's own dialog, which fetches manifests once per dialog open in
 * `showDialog()` — see `_fetchManifests`).
 *
 * `fetchManifests` is intentionally kept at a *permanently stable* identity
 * (empty `useCallback` deps, `hass`/guard state read from refs instead of
 * closed-over state) rather than depending on `hass`/`manifests`/`loading`
 * directly. Home Assistant recreates its `hass` object on essentially every
 * state-changed event from the websocket (can be several times a second in
 * an active home), and `manifests`/`loading` themselves change as a direct
 * side effect of calling this function — either one being a dep would give
 * `fetchManifests` a new identity on nearly every render while a dialog is
 * open. ThenActionDialog.tsx lists `fetchManifests` in a `useEffect` dep
 * array that resets its whole Miller navigation state, so an unstable
 * identity here was silently snapping the dialog back to its first column
 * (Blocks) every time *any* entity in the house changed state — reported as
 * "after ~3 seconds the UI goes back to Blocks and I can't make my
 * selection."
 */
export function useIntegrationManifests() {
  const { hass } = useHass();
  const [manifests, setManifests] = useState<Record<string, IntegrationManifest> | null>(null);
  const [loading, setLoading] = useState(false);

  const hassRef = useRef(hass);
  hassRef.current = hass;
  const fetchStateRef = useRef<{
    manifests: Record<string, IntegrationManifest> | null;
    loading: boolean;
  }>({ manifests: null, loading: false });

  const fetchManifests = useCallback(async () => {
    const currentHass = hassRef.current;
    if (!currentHass?.callWS || fetchStateRef.current.manifests || fetchStateRef.current.loading) {
      return;
    }
    fetchStateRef.current.loading = true;
    setLoading(true);
    try {
      const response = (await currentHass.callWS({
        type: 'manifest/list',
      })) as IntegrationManifest[] | undefined;
      const byDomain: Record<string, IntegrationManifest> = {};
      for (const manifest of response ?? []) {
        byDomain[manifest.domain] = manifest;
      }
      fetchStateRef.current.manifests = byDomain;
      setManifests(byDomain);
    } catch (error) {
      console.error('Failed to fetch integration manifests:', error);
      fetchStateRef.current.manifests = {};
      setManifests({});
    } finally {
      fetchStateRef.current.loading = false;
      setLoading(false);
    }
  }, []);

  return { manifests, loading, fetchManifests };
}
