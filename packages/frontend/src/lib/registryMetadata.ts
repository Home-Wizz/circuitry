import type { HomeAssistantAPI } from '@/lib/ha-api';

/** What the save dialog sets on the automation's entity besides its config. */
export interface RegistryMetadata {
  icon: string;
  category: string;
  labels: string[];
  area: string;
}

const ALL_FIELDS: ReadonlySet<keyof RegistryMetadata> = new Set([
  'icon',
  'category',
  'labels',
  'area',
]);

/** Whether anything was chosen to set. */
export function hasRegistryChoices(metadata: RegistryMetadata): boolean {
  return Boolean(metadata.icon || metadata.area || metadata.category || metadata.labels.length > 0);
}

/**
 * Sets the dialog's icon, area, labels and category on the saved
 * automation's entity, and says whether that worked: it is a nice-to-have
 * on top of the automation, never a save failure, but a failure used to be
 * only a console message, so the user found them unset (bug #214).
 * `entityId` is the automation's entity when it could be found. Only
 * `fields` are written (all by default): an existing automation's are the
 * ones the dialog read from HA or the user changed, so one it hadn't read
 * yet, or couldn't, is left as it is in HA (bug #238: an Update before HA
 * answered cleared the automation's area, labels, category and icon).
 */
export async function applyRegistryMetadata(
  api: Pick<
    HomeAssistantAPI,
    'waitForAutomationEntity' | 'findAutomationEntityId' | 'updateEntityRegistryEntry'
  >,
  automationId: string,
  isNewAutomation: boolean,
  metadata: RegistryMetadata,
  fields: ReadonlySet<keyof RegistryMetadata> = ALL_FIELDS
): Promise<{ entityId: string | undefined; applied: boolean }> {
  let entityId: string | undefined;
  try {
    entityId =
      (isNewAutomation
        ? await api.waitForAutomationEntity(automationId)
        : api.findAutomationEntityId(automationId)) ?? undefined;
    if (!entityId) return { entityId: undefined, applied: false };
    const changes = {
      ...(fields.has('icon') ? { icon: metadata.icon || null } : {}),
      ...(fields.has('area') ? { area_id: metadata.area || null } : {}),
      ...(fields.has('labels') ? { labels: metadata.labels } : {}),
      ...(fields.has('category') ? { categories: { automation: metadata.category || null } } : {}),
    };
    if (Object.keys(changes).length > 0) await api.updateEntityRegistryEntry(entityId, changes);
    return { entityId, applied: true };
  } catch (err) {
    console.warn('Failed to apply registry metadata:', err);
    return { entityId, applied: false };
  }
}
