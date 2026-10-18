import { computeSourceHash } from '@/lib/graph-storage';
import type { HomeAssistantAPI } from '@/lib/ha-api';

/**
 * An Update refused because the automation in Home Assistant is no longer
 * the one this tab opened or last saved: it was changed somewhere else
 * (Home Assistant's own editor, another tab or device, a file edit), and
 * saving would silently replace those changes. Saving again, knowing,
 * goes through.
 */
export class ChangedElsewhereError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangedElsewhereError';
  }
}

/**
 * Whether Home Assistant's copy of an automation differs from the one this
 * tab last held (`savedHash`, from computeSourceHash: moving cards, which
 * only changes the stored layout, is no change). False when it is the
 * same, and also when Home Assistant's copy can't be read or isn't one a
 * save could replace: not knowing is no reason to hold a save back.
 */
export async function changedElsewhere(
  api: Pick<HomeAssistantAPI, 'readAutomation'>,
  automationId: string,
  savedHash: string
): Promise<boolean> {
  try {
    const read = await api.readAutomation(automationId);
    if (!read?.editable) return false;
    return computeSourceHash({ ...read.config }) !== savedHash;
  } catch (error) {
    console.warn('Circuitry: could not check the automation for outside changes:', error);
    return false;
  }
}
