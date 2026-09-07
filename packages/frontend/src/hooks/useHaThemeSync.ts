import { useEffect } from 'react';
import { useAppRoot } from '@/contexts/AppRootContext';
import { useHass } from '@/contexts/HassContext';
import { useThemeOverride } from '@/contexts/ThemeOverrideContext';
import { applyHaTheme } from '@/lib/ha-theme';

/**
 * Mirrors HA's active theme (light/dark + custom theme overrides) onto
 * Circuitry's own CSS custom properties on every `hass` update, writing
 * them onto the app-root element (see contexts/AppRootContext.tsx) rather
 * than `document.documentElement` — in panel mode that's HA's own shared
 * `<html>`, which we must not mutate.
 *
 * A previous version of this hook also mirrored these variables onto
 * `document.documentElement` (guarded to always use 'auto', with cleanup on
 * unmount) to fix native HA components whose popups portal outside our
 * shadow tree (ha-select's dropdown menu is the known case — see
 * HA_WEBAWESOME_TEXT_TOKENS in lib/ha-theme.ts). That caused a worse bug:
 * HA doesn't reliably destroy this panel's DOM on in-app navigation (it just
 * hides it for fast switching back), so the React unmount our cleanup
 * depended on often never fires, permanently leaking a dark override onto
 * the rest of the real Home Assistant UI. Reverted — the dropdown-contrast
 * issue needs a fix that doesn't touch the shared document root at all.
 *
 * Reads Circuitry's own light/dark override from ThemeOverrideContext
 * and passes it straight through to applyHaTheme — same source of truth as
 * useDarkMode, so the CSS variables set here always agree with components
 * branching on useDarkMode().
 */
export function useHaThemeSync() {
  const { hass } = useHass();
  const appRoot = useAppRoot();
  const { themeOverride } = useThemeOverride();

  useEffect(() => {
    if (!appRoot) return;
    applyHaTheme(appRoot, hass, themeOverride);
  }, [hass, appRoot, themeOverride]);
}
