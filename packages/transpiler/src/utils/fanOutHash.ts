/**
 * Phase 5 (2026-09-26): a stable fingerprint of a state-machine state's
 * inline fan-out steps (the `parallel:` blocks it renders its branches
 * as). StateMachineStrategy records it, with the branch targets, in
 * `_circuitry_metadata.fan_outs`; the state-machine decompiler trusts the
 * recorded targets only while the fingerprint still matches -- if the
 * steps were edited outside Circuitry, it rebuilds them from what's there.
 * FNV-1a over the JSON; not cryptographic, only a change detector.
 */
export function fanOutHash(steps: unknown[]): string {
  return fnv1aHex(JSON.stringify(steps));
}

/** FNV-1a (32-bit) of a string, as 8 hex digits. */
export function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
