import { mapAutomationEntityToCatalogItem } from '@/hooks/useAutomationCatalog';
import type { HomeAssistantAPI } from '@/lib/ha-api';
import { readAutomationAsGraph } from '@/lib/read-automation';

/**
 * The Home Assistant releases Circuitry's checks run against in a real
 * Home Assistant (the newest and the one before). Kept equal to those
 * checks' version lists by a test, so this can't go stale.
 */
export const TESTED_HA_RELEASES = ['2026.9', '2026.10'] as const;
/** The oldest Home Assistant Circuitry installs on (hacs.json; held equal by a test). */
export const OLDEST_SUPPORTED_HA = '2025.8.0';

/** How a Home Assistant version stands with what Circuitry is checked against. */
export type VersionStanding = 'tested' | 'newer' | 'older' | 'unsupported' | 'unknown';

const releaseOf = (version: string): [number, number] | null => {
  const match = version.match(/^(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
};
const compareReleases = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];

export function haVersionStanding(version: string | undefined): VersionStanding {
  const release = version ? releaseOf(version) : null;
  if (!release) return 'unknown';
  const tested = TESTED_HA_RELEASES.map((r) => releaseOf(r)).filter(
    (r): r is [number, number] => r !== null
  );
  if (tested.some((r) => compareReleases(r, release) === 0)) return 'tested';
  const oldest = releaseOf(OLDEST_SUPPORTED_HA);
  if (oldest && compareReleases(release, oldest) < 0) return 'unsupported';
  const newest = tested.reduce((a, b) => (compareReleases(a, b) >= 0 ? a : b));
  return compareReleases(release, newest) > 0 ? 'newer' : 'older';
}

/**
 * What opening an automation would do with it:
 * - `exact`: opens editable, and its canvas runs as it does;
 * - `unchecked`: opens editable, but couldn't be run on test values;
 * - `readOnly`: its canvas would run differently, so only a copy can be saved;
 * - `keptElsewhere`: kept outside automations.yaml (a package, another
 *   file): opens, but can't be saved over;
 * - `unreadable`: Home Assistant couldn't give it, or it couldn't be read;
 * - `leftOver`: an entity Home Assistant restored for an automation that no
 *   longer exists (deleted, or removed from its file): nothing to read.
 */
export type AutomationOutcome =
  | 'exact'
  | 'unchecked'
  | 'readOnly'
  | 'keptElsewhere'
  | 'unreadable'
  | 'leftOver';

export interface AutomationCheck {
  name: string;
  entityId: string;
  outcome: AutomationOutcome;
  /** Why, for readOnly and unreadable. */
  detail?: string;
}

export interface SelfCheckResult {
  haVersion: string | undefined;
  standing: VersionStanding;
  /** Circuitry's integration answers (where it keeps the canvases). */
  integration: boolean;
  automations: AutomationCheck[];
  /** Stopped before every automation was checked. */
  stopped: boolean;
}

export interface SelfCheckOptions {
  onProgress?: (done: number, total: number) => void;
  /** Asked between automations: true ends the check there. */
  shouldStop?: () => boolean;
}

/**
 * The self-check: every automation opened the way the editor opens one --
 * read, read as a canvas, run against what it was read from -- one at a
 * time. Nothing is written to Home Assistant, and nothing leaves it.
 */
export async function runSelfCheck(
  api: HomeAssistantAPI,
  haVersion: string | undefined,
  { onProgress, shouldStop }: SelfCheckOptions = {}
): Promise<SelfCheckResult> {
  let integration = true;
  try {
    // A read of a canvas no automation has: answered (with nothing) when
    // the integration is set up.
    await api.sendMessage({ type: 'circuitry/load_graph', automation_id: '__self_check__' });
  } catch {
    integration = false;
  }
  const entities = api.getAutomations();
  // Restored by Home Assistant for an automation that no longer exists:
  // nothing to read, only to tidy away.
  const leftOver = new Set(
    entities
      .filter((e) => e.state === 'unavailable' && e.attributes.restored === true)
      .map((e) => e.entity_id)
  );
  const entries = entities
    .map((entity) => mapAutomationEntityToCatalogItem(entity))
    .filter((item) => item !== null)
    .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
  const automations: AutomationCheck[] = [];
  let stopped = false;
  onProgress?.(0, entries.length);
  for (const entry of entries) {
    if (shouldStop?.()) {
      stopped = true;
      break;
    }
    automations.push(
      leftOver.has(entry.entity_id)
        ? { name: entry.friendly_name, entityId: entry.entity_id, outcome: 'leftOver' }
        : await checkOne(api, entry.automation_id, entry.friendly_name, entry.entity_id)
    );
    onProgress?.(automations.length, entries.length);
    // Each check runs on this thread: let the dialog draw between them.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { haVersion, standing: haVersionStanding(haVersion), integration, automations, stopped };
}

async function checkOne(
  api: HomeAssistantAPI,
  automationId: string,
  name: string,
  entityId: string
): Promise<AutomationCheck> {
  try {
    const reading = await readAutomationAsGraph(api, automationId, name);
    if (!reading.ok) {
      return {
        name,
        entityId,
        outcome: 'unreadable',
        detail:
          reading.reason === 'unavailable' ? undefined : reading.errors.join('; ') || undefined,
      };
    }
    if (!reading.editable) return { name, entityId, outcome: 'keptElsewhere' };
    const { verdict, detail } = reading.importCheck;
    if (verdict === 'different') return { name, entityId, outcome: 'readOnly', detail };
    return { name, entityId, outcome: verdict === 'same' ? 'exact' : 'unchecked' };
  } catch (error) {
    return {
      name,
      entityId,
      outcome: 'unreadable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The automations with each outcome. */
export function byOutcome(result: SelfCheckResult, outcome: AutomationOutcome): AutomationCheck[] {
  return result.automations.filter((a) => a.outcome === outcome);
}
