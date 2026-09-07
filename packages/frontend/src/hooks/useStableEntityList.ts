import { useRef } from 'react';
import type { HassEntity } from '@/types/hass';

/**
 * Returns `entities` with a stable array reference across renders where the
 * actual *set* of entity IDs hasn't changed — even though `entities` itself
 * gets a brand new array reference on every single HA state push (any
 * entity anywhere changing state, not just ones relevant to whatever's
 * consuming this list). See useHass()'s own `entities` value
 * (HassContext.tsx): `Object.values(hass?.states ?? {})`, recomputed
 * whenever `hass.states` changes — which, per HA's own frontend convention,
 * is a *new* object every single time literally any entity's state updates
 * anywhere in the house.
 *
 * The Miller-column trigger/condition/action pickers (WhenTriggerDialog.tsx,
 * AndConditionDialog.tsx, ThenActionDialog.tsx, TriggerTargetPicker.tsx) all
 * build their area/device/label groupings from `entities` via their own
 * `useMemo` chains — but that grouping only ever reads `entity_id`/domain/
 * area-device-label assignment, never a live `state` value. Depending on the
 * raw, constantly-reference-changing `entities` array meant every one of
 * those (often deeply nested) groupings recomputed from scratch on every
 * single live state tick — including entities the picker doesn't even show
 * — while the dialog was open. Confirmed directly from a user screen
 * recording: opening a Miller panel while several presence/motion sensors
 * were actively flipping state caused a multi-second freeze followed by a
 * sudden "jump" once the backlog of blocked re-renders finally caught up —
 * the signature of a blocked main thread repeating expensive synchronous
 * work every tick, not a CSS transition glitch.
 *
 * Comparing a cheap, plain (non-memoized) id-list join against the previous
 * one on every render is itself O(n) — far cheaper than the O(n × areas)+
 * grouping work it gates — so this intentionally does NOT wrap the id-list
 * computation in its own `useMemo`; the point is only to give downstream
 * `useMemo`s (which key off this function's *return value*) a reference
 * that stays stable except when entities are actually added, removed, or
 * reassigned — not on every live-state-only tick.
 */
export function useStableEntityList<T extends HassEntity>(entities: T[]): T[] {
  const stableRef = useRef<T[]>(entities);
  const prevIdsRef = useRef<string>('');

  const ids = entities.map((e) => e.entity_id).join('|');
  if (ids !== prevIdsRef.current) {
    prevIdsRef.current = ids;
    stableRef.current = entities;
  }

  return stableRef.current;
}
