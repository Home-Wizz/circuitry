import { type NativeDescription, resolveTargetless } from '@/lib/nativeDescriptions';
import { picksZone } from '@/lib/nativeZone';
import { isRecord } from '@/lib/utils';

/**
 * The entities a step acts on, where the canvas card can edit them in place
 * (the target pill): a trigger's or condition's target (a purpose-specific
 * type's `target.entity_id`, a State or Numeric state one's `entity_id`) and
 * an action's `target.entity_id`. Only a list of plain entity ids is edited
 * there: a target that also names devices, areas, floors or labels, or a
 * template, is left to the property panel, as is a type that takes no
 * target, or whose picked entities are its zones.
 */

export type TargetField = 'target' | 'entity_id';

export interface EditableTargets {
  field: TargetField;
  entityIds: string[];
}

const TARGET_KEYS = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'] as const;

/** A value that is a plain entity id list (one id, or a list), or empty. */
function plainIds(value: unknown): string[] | null {
  if (value === undefined || value === null || value === '') return [];
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
  if (!list) return null;
  const ids: string[] = [];
  for (const id of list) {
    if (typeof id !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(id)) return null;
    ids.push(id);
  }
  return ids;
}

/** A `target:` that names entities only (or nothing yet): its ids. */
function targetEntityIds(target: unknown): string[] | null {
  if (target === undefined || target === null) return [];
  if (!isRecord(target)) return null;
  for (const key of Object.keys(target)) {
    if (!(TARGET_KEYS as readonly string[]).includes(key)) return null;
    if (key !== 'entity_id' && plainIds(target[key])?.length !== 0) return null;
  }
  return plainIds(target.entity_id);
}

/** Whether a trigger or condition of this type takes entities to edit. */
function nativeTakesTargets(
  kind: 'trigger' | 'condition',
  type: string,
  description: NativeDescription | null | undefined
): boolean {
  return !resolveTargetless(kind, type, description) && !picksZone(kind, type);
}

/**
 * The step's entities, when the card edits them: null when it doesn't.
 * `actionTakesTargets` says whether the action's service acts on entities
 * (from its description, lib/serviceTargets.ts).
 */
export function editableTargets(
  nodeType: string | undefined,
  data: Readonly<Record<string, unknown>>,
  context: {
    description?: NativeDescription | null;
    actionTakesTargets?: (service: string) => boolean;
  } = {}
): EditableTargets | null {
  const plainEntityField = (): EditableTargets | null => {
    const ids = plainIds(data.entity_id);
    return ids ? { field: 'entity_id', entityIds: ids } : null;
  };
  const nativeTarget = (): EditableTargets | null => {
    const ids = targetEntityIds(data.target);
    return ids ? { field: 'target', entityIds: ids } : null;
  };

  if (nodeType === 'trigger' || nodeType === 'condition') {
    const key = nodeType === 'trigger' ? 'trigger' : 'condition';
    const type = data[key];
    if (typeof type !== 'string') return null;
    if (type === 'state' || type === 'numeric_state') return plainEntityField();
    if (!type.includes('.')) return null;
    return nativeTakesTargets(nodeType, type, context.description) ? nativeTarget() : null;
  }

  if (nodeType === 'action') {
    const service = data.service;
    if (typeof service !== 'string' || service === '' || service.includes('{')) return null;
    // A stop, an event step and a repeat aren't service calls.
    if (data.stop !== undefined || data.event !== undefined || data.event_data !== undefined)
      return null;
    if (data.repeat !== undefined || data.entity_id !== undefined) return null;
    // The entities named in the call's data are the panel's to edit.
    if (isRecord(data.data) && data.data.entity_id !== undefined) return null;
    if (!context.actionTakesTargets?.(service)) return null;
    return nativeTarget();
  }

  return null;
}

/** The data patch that sets the step's entities. */
export function withTargets(
  data: Readonly<Record<string, unknown>>,
  field: TargetField,
  entityIds: readonly string[]
): Record<string, unknown> {
  if (field === 'entity_id') return { entity_id: [...entityIds] };
  const target = isRecord(data.target) ? data.target : {};
  return { target: { ...target, entity_id: [...entityIds] } };
}

/** The places a target can name as a whole: an area, a floor or a label. */
export type PlaceKey = 'area_id' | 'floor_id' | 'label_id';

/** One place a step can target as a whole ("Anything in <room>", "Anything
 * on <floor>", "Anything labelled <label>"). */
export interface PlaceTarget {
  key: PlaceKey;
  id: string;
}

/** The picker's and card's words for a whole place, by its kind. */
export const ANYTHING_IN = {
  area_id: 'nodes:picker.rows.anythingIn',
  floor_id: 'nodes:picker.rows.anythingOn',
  label_id: 'nodes:picker.rows.anythingLabelled',
} as const satisfies Readonly<Record<PlaceKey, string>>;

/** The target a whole place is written as. */
export function placeTarget(place: PlaceTarget): Record<string, string> {
  return { [place.key]: place.id };
}

/** The places a target names when it names one kind of place and nothing
 * else ("Anything in <room>", on a floor, with a label): null for any other
 * target. */
export function wholePlace(target: unknown): { key: PlaceKey; ids: string[] } | null {
  if (!isRecord(target)) return null;
  let found: { key: PlaceKey; ids: string[] } | null = null;
  for (const key of TARGET_KEYS) {
    const value = target[key];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0))
      continue;
    if (key === 'entity_id' || key === 'device_id' || found) return null;
    const ids = plainPlaceIds(value);
    if (ids.length === 0) return null;
    found = { key, ids };
  }
  return found;
}

/** The areas a target names when it names nothing else: null for any other
 * target. */
export function wholeAreaIds(target: unknown): string[] | null {
  const place = wholePlace(target);
  return place?.key === 'area_id' ? place.ids : null;
}

function plainPlaceIds(value: unknown): string[] {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return list.filter(
    (id): id is string => typeof id === 'string' && id !== '' && !id.includes('{')
  );
}
