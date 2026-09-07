import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Turns a snake_case identifier (HA domain/service/state names) into a
 * human-readable fallback label, e.g. `turn_on` -> `Turn on`. Used wherever
 * a translation is preferred but a raw HA identifier needs a readable
 * default when no translation exists yet.
 */
export function prettify(str: string): string {
  return str.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Unwraps a maybe-array entity_id field down to a single id, but only when
 * there's exactly one — HA stores `entity_id` as an array even for a single
 * selected entity (state trigger `entity_id: ["light.x"]`, action
 * `target.entity_id: ["light.x"]`), so a naive `!Array.isArray(...)` check
 * (as TriggerNode.tsx/ActionNode.tsx originally had) never actually resolves
 * the common single-entity case — the node card fell back to its generic
 * "N entities" / raw-id display instead of the friendly device/home name.
 * Returns `undefined` for zero or multiple entities (nothing single to name).
 */
export function singleEntityIdFrom(value: string | string[] | undefined | null): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

export function generateUUID(): string {
  // Use crypto.randomUUID if available
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback implementation for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let nodeIdCounter = 0;

/**
 * Generate a unique node ID with the standard format: {type}_{timestamp}_{counter}
 * This format is used throughout the app for consistent node identification.
 * The counter avoids collisions when multiple nodes are created within the same millisecond.
 */
export function generateNodeId(type: string): string {
  return `${type}_${Date.now()}_${nodeIdCounter++}`;
}
