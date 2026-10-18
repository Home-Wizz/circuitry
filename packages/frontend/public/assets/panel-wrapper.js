/**
 * Circuitry's panel loader: the module Home Assistant loads for the panel.
 *
 * Home Assistant's service worker serves files from its cache first and
 * refreshes them afterwards, so a file whose content changes under the same
 * name is served stale once. This one never changes: it asks Circuitry which
 * build is current (an /api/ request, which the service worker never caches)
 * and loads that build's entry, whose name changes with every build. A new
 * build is used at the next panel load, without restarting Home Assistant.
 * The panel's element is defined by the time this module has loaded.
 */
const response = await fetch('/api/circuitry/panel_build', { cache: 'no-store' });
if (!response.ok) {
  throw new Error(`Circuitry: the panel's build could not be found (${response.status})`);
}
const { entry } = await response.json();
await import(new URL(entry, import.meta.url).href);
