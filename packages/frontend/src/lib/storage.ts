/**
 * Circuitry's own settings in localStorage (the theme, the connection, the
 * side panel's rail, folded picker groups, debug logging). Storage can be
 * missing or throw (a sandboxed frame, blocked site data, a full quota), and
 * none of these settings is worth failing over: a read that can't be done is
 * "not set", and a write that can't be done lasts until the page reloads.
 */

export function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Not kept: see above.
  }
}
