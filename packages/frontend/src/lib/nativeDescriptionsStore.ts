import { create } from 'zustand';
import type { NativeDescriptions } from '@/lib/nativeDescriptions';
import type { Connection } from '@/types/hass';

type Kind = 'trigger' | 'condition';

interface DescriptionsState {
  trigger: NativeDescriptions;
  condition: NativeDescriptions;
}

/**
 * What the connected HA has described so far (`trigger_platforms/
 * subscribe`, `condition_platforms/subscribe`; it sends them as its
 * integrations load, and again for any that load later). Held outside React
 * so the editor's own checks (store/flow-store.ts) read the same
 * descriptions the panel and the pickers do.
 */
export const useNativeDescriptionsStore = create<DescriptionsState>(() => ({
  trigger: {},
  condition: {},
}));

let subscribedTo: Connection | undefined;
let unsubscribers: Promise<() => void>[] = [];

/** One subscription per connection, shared by every panel. An HA without
 * these commands (before they existed) sends nothing: the tables answer. */
export function subscribeNativeDescriptions(connection: Connection): void {
  if (subscribedTo === connection) return;
  for (const unsubscribe of unsubscribers) unsubscribe.then((fn) => fn()).catch(() => undefined);
  subscribedTo = connection;
  useNativeDescriptionsStore.setState({ trigger: {}, condition: {} });
  unsubscribers = (['trigger', 'condition'] as const).map((kind: Kind) => {
    const pending = connection.subscribeMessage<NativeDescriptions>(
      (described) =>
        useNativeDescriptionsStore.setState((state) => ({
          [kind]: { ...state[kind], ...described },
        })),
      { type: `${kind}_platforms/subscribe` }
    );
    pending.catch(() => undefined);
    return pending;
  });
}
