import type { FlowGraph } from '@circuitry/shared';
import { FlowGraphSchema } from '@circuitry/shared';
import type { HomeAssistantAPI } from './ha-api';

/**
 * Canonical graph storage (Option 1 architecture).
 *
 * Home Assistant's own `config/automation/config` REST endpoint remains
 * the single source of truth for the automation itself -- Circuitry
 * never stops writing real HA YAML there (see ha-api.ts's
 * createAutomation/updateAutomation). This module additionally persists
 * the exact FlowGraph JSON that produced that YAML, through three
 * custom `circuitry/save_graph` / `circuitry/load_graph` /
 * `circuitry/delete_graph` websocket commands backed by HA's `Store`
 * helper (see custom_components/circuitry/storage.py +
 * websocket_api.py).
 *
 * The point is to stop *decompiling* YAML back into a graph for
 * anything Circuitry itself saved. Decompilation (YamlParser.ts) is
 * heuristic -- pattern-matching generated choose/if/repeat blocks and
 * Jinja strings -- and is exactly the kind of code that silently breaks
 * when the generator's own output shape drifts. Storing the graph
 * verbatim and reading it back verbatim removes that whole failure
 * class for the common case; heuristic decompilation still runs,
 * unchanged, whenever there's no stored graph or the stored one has
 * gone stale (see `loadGraphIfFresh` below) -- e.g. the automation was
 * hand-edited via YAML or the native HA UI since Circuitry last saved
 * it, or it was never created by Circuitry in the first place.
 */

export interface StoredGraphEntry {
  graph: unknown;
  source_hash: string;
  saved_at: string;
}

/**
 * A cheap, non-cryptographic hash of the automation config Circuitry
 * just generated (everything except `variables._circuitry_metadata`,
 * which changes on every save purely from node-position drift and must
 * never affect staleness -- moving a node on the canvas is not an
 * out-of-band edit).
 *
 * Deliberately NOT Web Crypto's `crypto.subtle`: that API only exists in
 * a "secure context" (HTTPS or localhost), and plenty of real Home
 * Assistant installs are reached over plain `http://` on the LAN --
 * `crypto.subtle` is simply `undefined` there, which would silently
 * break every save on exactly the setups Circuitry needs to be rock
 * solid on. This only needs to detect "did this change since Circuitry
 * last saved it", not resist tampering, so a fast, always-available
 * string hash (FNV-1a, 32-bit) is the right tool.
 */
export function computeSourceHash(automationConfig: Record<string, unknown>): string {
  const hashable = normalizeForHash(automationConfig);
  const json = stableStringify(hashable);

  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalizes an automation config to one canonical shape before hashing,
 * so the same automation hashes identically regardless of which of two
 * different shapes it's in at the call site:
 *
 *  - the object flow-store.ts builds and hashes BEFORE handing it to
 *    `api.createAutomation`/`updateAutomation` -- singular `trigger` /
 *    `condition` / `action` keys, no `id` yet, and
 *  - the object Home Assistant hands back on load -- plural `triggers` /
 *    `conditions` / `actions`, `id` present.
 *
 * ha-api.ts's createAutomation/updateAutomation do exactly this
 * singular-to-plural normalization on the way in (see their
 * `configWithId`), which is what HA actually persists and later returns.
 * Without mirroring that normalization here, every save would hash
 * differently from the load that immediately follows it, permanently
 * defeating Option 1's fast path -- every load would silently take the
 * heuristic-decompiler fallback instead. `id` is deliberately dropped:
 * it's assigned server-side and isn't part of the automation's logic,
 * and the caller already knows which automation_id this hash is for.
 */
function normalizeForHash(config: Record<string, unknown>): Record<string, unknown> {
  const {
    trigger,
    condition,
    action,
    triggers,
    conditions,
    actions,
    variables,
    id: _id,
    ...rest
  } = config;
  const { _circuitry_metadata, ...otherVariables } = (variables ?? {}) as Record<string, unknown>;

  return {
    ...rest,
    mode: (rest as { mode?: unknown }).mode ?? 'single',
    triggers: triggers ?? trigger ?? [],
    conditions: conditions ?? condition ?? [],
    actions: actions ?? action ?? [],
    variables: otherVariables,
  };
}

/**
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
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Persists the canonical FlowGraph for one automation. Call this right
 * after a successful `api.createAutomation`/`api.updateAutomation` — see
 * flow-store.ts's `saveAutomation`/`updateAutomation`. Best-effort by
 * design: if this fails, the automation itself is already saved via HA's
 * native endpoint, and the next load simply falls back to the existing
 * heuristic decompiler, exactly as it did before Option 1 existed.
 */
export async function saveGraph(
  api: HomeAssistantAPI,
  automationId: string,
  graph: FlowGraph,
  sourceHash: string
): Promise<void> {
  await api.sendMessage({
    type: 'circuitry/save_graph',
    automation_id: automationId,
    graph,
    source_hash: sourceHash,
  });
}

/**
 * Loads the canonical graph for an automation, but only returns it when
 * `expectedSourceHash` (freshly computed from the automation config HA
 * just handed back) still matches what Circuitry stored at save time.
 * Any mismatch means the automation was edited outside Circuitry since
 * then, so the canonical JSON no longer describes what's actually
 * running -- callers must fall back to the heuristic decompiler in that
 * case. Also falls back (returns null) if the stored graph fails Zod
 * validation, so a future schema change on a graph saved by an older
 * Circuitry version degrades to the old behavior instead of crashing.
 */
export async function loadGraphIfFresh(
  api: HomeAssistantAPI,
  automationId: string,
  expectedSourceHash: string
): Promise<FlowGraph | null> {
  const entry = (await api.sendMessage({
    type: 'circuitry/load_graph',
    automation_id: automationId,
  })) as StoredGraphEntry | null;

  if (!entry || entry.source_hash !== expectedSourceHash) {
    return null;
  }

  const parsed = FlowGraphSchema.safeParse(entry.graph);
  if (!parsed.success) {
    console.warn(
      'Circuitry: stored graph failed schema validation, falling back to YAML decompile:',
      parsed.error
    );
    return null;
  }

  return parsed.data;
}

/**
 * Removes the stored graph for a deleted automation. Best-effort and
 * silently non-fatal: an orphaned stored graph for an automation that no
 * longer exists is harmless (its automation_id is simply never looked up
 * again), so this must never block the deletion the user actually asked
 * for.
 */
export async function deleteGraph(api: HomeAssistantAPI, automationId: string): Promise<void> {
  try {
    await api.sendMessage({
      type: 'circuitry/delete_graph',
      automation_id: automationId,
    });
  } catch (error) {
    console.warn('Circuitry: failed to delete stored graph:', error);
  }
}
