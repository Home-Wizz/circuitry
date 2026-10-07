import { useEffect } from 'react';
import { useOptionalHass } from '@/contexts/HassContext';
import {
  describedThresholdShape,
  type NativeDescription,
  type NativeDescriptions,
} from '@/lib/nativeDescriptions';
import type { ThresholdShape } from '@/lib/nativeThreshold';
import {
  subscribeNativeDescriptions,
  useNativeDescriptionsStore,
} from '@/lib/nativeDescriptionsStore';

type Kind = 'trigger' | 'condition';

/** Subscribes to the connected HA's descriptions (lib/nativeDescriptionsStore.ts). */
function useDescriptionsSubscription(): void {
  const connection = useOptionalHass()?.hass?.connection;
  useEffect(() => {
    if (connection) subscribeNativeDescriptions(connection);
  }, [connection]);
}

/**
 * The connected HA's description of a purpose-specific trigger or
 * condition (see lib/nativeDescriptions.ts), or undefined when it hasn't
 * sent one: the panel then reads its own tables.
 */
export function useNativeDescription(
  kind: Kind,
  type: string
): NativeDescription | null | undefined {
  useDescriptionsSubscription();
  return useNativeDescriptionsStore((state) => state[kind][type]);
}

/** Every trigger or condition the connected HA describes (empty for an HA
 * that sends none, or before it has). */
export function useNativeDescriptions(kind: Kind): NativeDescriptions {
  useDescriptionsSubscription();
  return useNativeDescriptionsStore((state) => state[kind]);
}

/** A purpose-specific type's threshold shape as the connected HA has it
 * (lib/nativeDescriptions.ts's describedThresholdShape); 'none' for a type
 * that isn't one (`type` empty or legacy). */
export function useThresholdShape(kind: Kind, type: string): ThresholdShape {
  const description = useNativeDescription(kind, type);
  return type.includes('.') ? describedThresholdShape(kind, type, description) : 'none';
}
