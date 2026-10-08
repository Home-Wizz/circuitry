import { useCallback, useRef } from 'react';
import type { HomeAssistant } from '@/types/hass';

/**
 * Keys work on Home Assistant's connection rather than on `hass` itself.
 * HA hands the panel a new `hass` object on every state change (every few
 * seconds in a busy home), so an effect or a call keyed on `hass` runs
 * again each time: the pickers re-fetched their device automations and
 * their lists moved, the trace viewer jumped back to the latest run (bug
 * #183). `connection` stays the same while HA's websocket does (a new one
 * is a new HA to ask); `getHass` reads the latest `hass` when it runs.
 */
export function useHassConnection(hass: HomeAssistant | undefined): {
  getHass: () => HomeAssistant | undefined;
  connection: HomeAssistant['connection'] | undefined;
} {
  const latest = useRef(hass);
  latest.current = hass;
  const getHass = useCallback(() => latest.current, []);
  return { getHass, connection: hass?.connection };
}
