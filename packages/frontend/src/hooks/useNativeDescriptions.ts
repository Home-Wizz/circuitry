import { useEffect } from 'react';
import { create } from 'zustand';
import { useOptionalHass } from '@/contexts/HassContext';
import type { NativeDescription, NativeDescriptions } from '@/lib/nativeDescriptions';
import type { Connection } from '@/types/hass';

type Kind = 'trigger' | 'condition';

interface DescriptionsState {
  trigger: NativeDescriptions;
  condition: NativeDescriptions;
}

/** What the connected HA has described so far (it sends them as its
 * integrations load, and again for any that load later). */
const useDescriptions = create<DescriptionsState>(() => ({ trigger: {}, condition: {} }));

let subscribedTo: Connection | undefined;
let unsubscribers: Promise<() => void>[] = [];

/** One subscription per connection, shared by every panel. An HA without
 * these commands (before they existed) sends nothing: the tables answer. */
function subscribe(connection: Connection): void {
  if (subscribedTo === connection) return;
  for (const unsubscribe of unsubscribers) unsubscribe.then((fn) => fn()).catch(() => undefined);
  subscribedTo = connection;
  useDescriptions.setState({ trigger: {}, condition: {} });
  unsubscribers = (['trigger', 'condition'] as const).map((kind) => {
    const pending = connection.subscribeMessage<NativeDescriptions>(
      (described) => useDescriptions.setState((state) => ({ [kind]: { ...state[kind], ...described } })),
      { type: `${kind}_platforms/subscribe` }
    );
    pending.catch(() => undefined);
    return pending;
  });
}

/**
 * The connected HA's description of a purpose-specific trigger or
 * condition (see lib/nativeDescriptions.ts), or undefined when it hasn't
 * sent one: the panel then reads its own tables.
 */
export function useNativeDescription(kind: Kind, type: string): NativeDescription | null | undefined {
  const connection = useOptionalHass()?.hass?.connection;
  useEffect(() => {
    if (connection) subscribe(connection);
  }, [connection]);
  return useDescriptions((state) => state[kind][type]);
}
