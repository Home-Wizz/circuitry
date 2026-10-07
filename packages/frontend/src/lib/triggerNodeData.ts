import type { TriggerPlatform } from '@circuitry/shared';
import { getTriggerDefaults } from '@/config/triggerFields';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import { defaultThreshold, triggerIsTargetless } from '@/lib/nativeThreshold';
import { picksZone } from '@/lib/nativeZone';
import type { TriggerRecipe } from '@/lib/triggerRecipes';

/**
 * The four outcomes the trigger picker (TriggerTargetPicker.tsx /
 * TriggerTypePicker.tsx) can produce — mirrors that picker's
 * onSelectPlatform / onSelectEntityTarget / onSelectDeviceTrigger /
 * onSelectRecipe callback shapes, just bundled as one discriminated union so
 * a single function can turn any of them into node data.
 */
export type TriggerSelection =
  | { kind: 'platform'; platform: TriggerPlatform }
  | { kind: 'entityTarget'; entityIds: string[] }
  | { kind: 'deviceTrigger'; trigger: DeviceTrigger }
  | {
      kind: 'recipe';
      entityIds: string[];
      recipe: TriggerRecipe;
      /** A whole area as its target ("Anything in <room>"), instead of entities. */
      areaId?: string;
    };

/**
 * Single source of truth for turning a trigger-picker selection into the
 * actual `data` fields a trigger node needs. Both TriggerFields.tsx (editing
 * an already-placed node's fields one `onChange` call at a time) and
 * WhenTriggerDialog.tsx (building a brand new node's initial data in one
 * shot from the "+Add > When" Miller-column modal) call this instead of
 * each re-deriving the platform/entity_id/to/from/attribute mapping.
 */
/** Whether picking this recipe asks for entities first: not for a
 * trigger with no target in HA and nothing else to pick (sun, moon; #118 --
 * the moon has no entities, so its trigger couldn't be added at all). */
export function triggerRecipeTakesEntities(recipe: TriggerRecipe): boolean {
  const { trigger } = recipe.fields;
  return !recipeIsTargetless(recipe) || picksZone('trigger', trigger);
}

/** Whether a recipe's type can target a whole area: a purpose-specific
 * type with a target (not one whose picked entities are its zones). A
 * legacy type takes entities only. */
export function triggerRecipeTakesArea(recipe: TriggerRecipe): boolean {
  const { trigger } = recipe.fields;
  return trigger.includes('.') && !recipeIsTargetless(recipe) && !picksZone('trigger', trigger);
}

/** Whether a recipe's type has no target: as HA describes it, for a type
 * the tables don't know, else the tables'. */
function recipeIsTargetless(recipe: TriggerRecipe): boolean {
  return recipe.fields.targetless ?? triggerIsTargetless(recipe.fields.trigger);
}

export function buildTriggerNodeData(selection: TriggerSelection): Record<string, unknown> {
  switch (selection.kind) {
    case 'platform':
      return { ...getTriggerDefaults(selection.platform) };

    case 'entityTarget':
      // "By target" picker shortcut: jump straight to a `state` trigger
      // pre-filled with the chosen entity, rather than making the user pick
      // "State Change" afterward on the "By type" tab.
      return { ...getTriggerDefaults('state'), entity_id: selection.entityIds };

    case 'deviceTrigger': {
      const { trigger } = selection;
      return {
        ...getTriggerDefaults('device'),
        device_id: trigger.device_id,
        type: trigger.type,
        domain: trigger.domain,
        subtype: trigger.subtype ?? undefined,
        entity_id: trigger.entity_id ?? undefined,
      };
    }

    case 'recipe': {
      const { entityIds, recipe } = selection;
      const { trigger } = recipe.fields;

      // Purpose-specific triggers (HA 2025.12+, e.g. `light.turned_on` —
      // always dotted domain.event, never a bare legacy platform) commit a
      // `target`/`options` shape instead of the old entity_id/to/from/
      // attribute one. No `behavior` is written: HA's own default applies,
      // and the panel shows it (#117 -- `behavior: 'each'` was written here,
      // which HA refuses on the triggers that have no behavior, and which
      // HA before 2026.5 refused on every trigger).
      // A trigger with no target in HA (every `sun.*`, `moon.phase_changed`,
      // zone occupancy) gets none, whatever was picked (#118: HA refuses a
      // target there), and a zone trigger's picked zones are its zone.
      if (trigger.includes('.')) {
        const zone = picksZone('trigger', trigger);
        // zone.entered/left still need a target (the people and device
        // trackers), which HA requires: an empty one, filled in the panel.
        const target = recipeIsTargetless(recipe)
          ? undefined
          : selection.areaId && triggerRecipeTakesArea(recipe)
            ? { area_id: selection.areaId }
            : { entity_id: zone ? [] : entityIds };
        // A threshold type starts with the threshold the panel shows (#124).
        const threshold = recipe.fields.thresholdless
          ? undefined
          : (recipe.fields.options?.threshold ?? defaultThreshold('trigger', trigger));
        return {
          trigger,
          ...(target ? { target } : {}),
          options: {
            ...recipe.fields.options,
            ...(threshold !== undefined ? { threshold } : {}),
            ...(zone && entityIds.length > 0 ? { zone: entityIds } : {}),
          },
        };
      }

      const data: Record<string, unknown> = {
        ...getTriggerDefaults(trigger),
        entity_id: entityIds,
      };
      if (recipe.fields.to !== undefined) data.to = recipe.fields.to;
      if (recipe.fields.from !== undefined) data.from = recipe.fields.from;
      if (recipe.fields.attribute !== undefined) data.attribute = recipe.fields.attribute;
      return data;
    }

    default: {
      const exhaustive: never = selection;
      throw new Error(`Unhandled trigger selection: ${JSON.stringify(exhaustive)}`);
    }
  }
}
