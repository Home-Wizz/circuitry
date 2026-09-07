import type { TriggerPlatform } from '@circuitry/shared';
import { getTriggerDefaults } from '@/config/triggerFields';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
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
  | { kind: 'entityTarget'; entityId: string }
  | { kind: 'deviceTrigger'; trigger: DeviceTrigger }
  | { kind: 'recipe'; entityIds: string[]; recipe: TriggerRecipe };

/**
 * Single source of truth for turning a trigger-picker selection into the
 * actual `data` fields a trigger node needs. Both TriggerFields.tsx (editing
 * an already-placed node's fields one `onChange` call at a time) and
 * WhenTriggerDialog.tsx (building a brand new node's initial data in one
 * shot from the "+Add > When" Miller-column modal) call this instead of
 * each re-deriving the platform/entity_id/to/from/attribute mapping.
 */
export function buildTriggerNodeData(selection: TriggerSelection): Record<string, unknown> {
  switch (selection.kind) {
    case 'platform':
      return { ...getTriggerDefaults(selection.platform) };

    case 'entityTarget':
      // "By target" picker shortcut: jump straight to a `state` trigger
      // pre-filled with the chosen entity, rather than making the user pick
      // "State Change" afterward on the "By type" tab.
      return { ...getTriggerDefaults('state'), entity_id: [selection.entityId] };

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
      // attribute one. `behavior: 'each'` is every purpose-specific
      // trigger's own default when multiple entities end up targeted (a
      // recipe picked for several same-domain entities at once, e.g.
      // selecting a whole area of lights) — set explicitly so the property
      // panel's behavior field always has a real value to show/edit rather
      // than an empty one.
      if (trigger.includes('.')) {
        return {
          trigger,
          target: { entity_id: entityIds },
          options: { behavior: 'each', ...recipe.fields.options },
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
