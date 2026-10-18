/**
 * JSON with keys sorted and undefined-valued keys skipped: equal values
 * stringify equal, whatever the key order; shared by the graph store's
 * hash and the save's read-back.
 *
 * Deterministic JSON.stringify -- sorts object keys so key order never
 * affects the hash, AND, critically, skips any key whose value is
 * `undefined` -- exactly like native `JSON.stringify` does.
 *
 * This matters because HA config steps (actions/triggers/conditions)
 * commonly carry an optional field -- `alias` chief among them -- that's
 * `undefined` rather than simply absent when unset. Native
 * `JSON.stringify` (which is what actually serializes the POST body HA
 * persists, and therefore what a later GET/websocket load returns) drops
 * such a key entirely. Without this filter, `Object.keys()` would still
 * enumerate it here, and it would end up baked into the hashed string as
 * literal `undefined` text on the save-time side -- while the load-time
 * side, built from what HA actually returned, never had that key to
 * begin with. That one-sided key permanently defeated Option 1's fast
 * path (confirmed 2026-09-06: byte-identical hashing code at both call
 * sites, but a real `"alias":undefined` on the save side and no such key
 * at all on the load side). Skipping undefined-valued keys here makes
 * this function agree with what JSON (and thus HA) actually persists.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    // As JSON writes them (bug #279): an undefined item, or a hole, is
    // null -- this used to drop it, so a list with one never matched what
    // HA stored from the JSON that was sent.
    return `[${Array.from(value, (item) => (isOmittedByJson(item) ? 'null' : stableStringify(item))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => !isOmittedByJson(obj[key]))
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** What JSON.stringify leaves out of an object (and writes as null in a list). */
function isOmittedByJson(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/**
 * Where two JSON values first differ, as a path (`actions[2].target`), or
 * null when they are equal as stableStringify reads them. For telling the
 * user what Home Assistant stored differently (bug #279).
 */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (stableStringify(a) === stableStringify(b)) return null;
  const here = path || '(the whole automation)';
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return here;
    for (let i = 0; i < a.length; i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found !== null) return found;
    }
    return here;
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const found = firstDifference(left[key], right[key], path ? `${path}.${key}` : key);
      if (found !== null) return found;
    }
    return here;
  }
  return here;
}
