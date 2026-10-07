import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The pick a Replace… started from (the canvas's right-click Replace…): the
 * picker opens where that pick is, and marks its row "Current". A pick is
 * named by a key: `type:<HA type>` (door.opened, light.is_on),
 * `platform:<trigger platform>`, `block:<block key>`, `service:<action>`.
 */
const PickerCurrentContext = createContext<string | undefined>(undefined);

export const PickerCurrentProvider = PickerCurrentContext.Provider;

/** Whether the row for this pick is the one being replaced. */
export function useIsCurrent(key: string | undefined): boolean {
  const current = useContext(PickerCurrentContext);
  return key !== undefined && key === current;
}

/** A trigger type's pick key: an HA type's own. A legacy recipe (`state`
 * set up for a device class) is a platform pick, marked on the platform's
 * row (`platform:<p>`, as WhenTriggerDialog names it). */
export function triggerPickKey(type: string): string | undefined {
  return type.includes('.') ? `type:${type}` : undefined;
}

/** A condition's pick key: its `condition:` type, a block's or an HA
 * type's alike. */
export function conditionPickKey(condition: unknown): string | undefined {
  return typeof condition === 'string' ? `type:${condition}` : undefined;
}

/** A Then step's pick key, from its node type and data: an action's
 * service, its block (Stop, Define variables, Repeat for each, Fire manual
 * event), or the Wait for… choice a wait or a delay was made with. */
export function actionPickKey(type: string, data: Record<string, unknown>): string | undefined {
  if (type === 'delay') return 'wait:delay';
  if (type === 'wait')
    return data.wait_for_trigger !== undefined ? 'wait:trigger' : 'wait:template';
  if (type === 'set_variables') return 'block:set_variables';
  if (type !== 'action') return undefined;
  // As the property panel tells them (ActionFields.tsx): stop, then event
  // (a name, or the event_data only event steps carry), then the rest.
  if (typeof data.stop === 'string') return 'block:stop';
  if ((typeof data.event === 'string' && data.event !== '') || data.event_data !== undefined)
    return 'block:fire_event';
  if (typeof data.repeat === 'object' && data.repeat !== null && 'for_each' in data.repeat)
    return 'block:repeat_for_each';
  return typeof data.service === 'string' && data.service !== ''
    ? `service:${data.service}`
    : undefined;
}

/** The "Current" mark on a row. */
export function CurrentChip() {
  const { t } = useTranslation(['nodes']);
  return (
    <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
      {t('nodes:picker.current')}
    </span>
  );
}

/**
 * What was chosen in a picker column: the key of the row whose pick opened
 * the column after it (the dialog's `selectedKeys` at that column). Its row
 * is marked chosen, in the primary colour, as a column's chosen place is.
 */
const PickerChosenContext = createContext<string | null | undefined>(undefined);

export const PickerChosenProvider = PickerChosenContext.Provider;

/** Whether this row is the one chosen in its column. */
export function useIsChosen(key: string | undefined): boolean {
  const chosen = useContext(PickerChosenContext);
  return key !== undefined && key === chosen;
}

/** The key a type picked for these entities is chosen by (none: a type
 * picked from a list of types). */
export function recipeChoiceKey(recipeId: string, entityIds: readonly string[]): string {
  return `recipe:${recipeId}:${entityIds.join(',')}`;
}
