import type { DeviceCondition } from '@/hooks/useDeviceAutomation';
import type { ConditionBlock, ConditionRecipe } from '@/lib/conditionRecipes';
import { conditionIsTargetless, defaultThreshold } from '@/lib/nativeThreshold';
import { picksZone } from '@/lib/nativeZone';
import { isRecord } from '@/lib/utils';

/**
 * The outcomes AndConditionDialog.tsx's Miller-column picker can produce —
 * the AND-dialog equivalent of lib/triggerNodeData.ts's TriggerSelection.
 *
 * `deviceCondition` is the condition-side sibling of triggerNodeData.ts's
 * `deviceTrigger` / actionNodeData.ts's `deviceAction` cases — a genuinely
 * device-specific condition fetched live from
 * `device_automation/condition/list`, reached via the "Generic" > "Device"
 * entry (mirrors real HA's own Add-condition dialog's Generic collection,
 * `{ device: {}, entity: { members: { state, numeric_state } } }`).
 */
export type ConditionSelection =
  | { kind: 'block'; block: ConditionBlock }
  | { kind: 'entityTarget'; entityIds: string[] }
  | {
      kind: 'recipe';
      entityIds: string[];
      recipe: ConditionRecipe;
      /** A whole area as its target ("Anything in <room>"), instead of entities. */
      areaId?: string;
    }
  | { kind: 'deviceCondition'; condition: DeviceCondition };

/** Whether picking this recipe asks for entities first: not for a
 * condition with no target in HA and nothing else to pick; a zone
 * occupancy condition's entities are its zones (as triggerNodeData.ts's
 * triggerRecipeTakesEntities). */
export function conditionRecipeTakesEntities(recipe: ConditionRecipe): boolean {
  const { condition } = recipe.fields;
  return !recipeIsTargetless(recipe) || picksZone('condition', condition);
}

/** Whether a recipe's type can target a whole area: one with a target that
 * isn't its zones (as triggerNodeData.ts's triggerRecipeTakesArea). */
export function conditionRecipeTakesArea(recipe: ConditionRecipe): boolean {
  const { condition } = recipe.fields;
  return (
    condition.includes('.') && !recipeIsTargetless(recipe) && !picksZone('condition', condition)
  );
}

/** Whether a recipe's type has no target: as HA describes it, for a type
 * the tables don't know, else the tables'. */
function recipeIsTargetless(recipe: ConditionRecipe): boolean {
  return recipe.fields.targetless ?? conditionIsTargetless(recipe.fields.condition);
}

/** A new purpose-specific condition's options: a threshold type starts
 * with the threshold the panel shows (#124, #127). */
function startingOptions(
  condition: unknown,
  options: Record<string, unknown> | undefined,
  thresholdless = false
): Record<string, unknown> | undefined {
  if (typeof condition !== 'string' || !condition.includes('.') || thresholdless) return options;
  const threshold = options?.threshold ?? defaultThreshold('condition', condition);
  return threshold !== undefined ? { ...options, threshold } : options;
}

/**
 * Single source of truth for turning a condition-picker selection into the
 * actual `data` fields a condition node needs — mirrors
 * lib/triggerNodeData.ts's buildTriggerNodeData exactly, just for
 * conditions instead of triggers.
 */
export function buildConditionNodeData(selection: ConditionSelection): Record<string, unknown> {
  switch (selection.kind) {
    // Blocks (and/or/not/template/time/trigger, and the sun conditions,
    // which take no entity) have no entity target at all — the block's own
    // `data` is the starting point, with the threshold the panel shows
    // where the type has one (#127: #124 seeded recipes only, so "Sun
    // elevation" started with none).
    case 'block': {
      const { data } = selection.block;
      const options = startingOptions(
        data.condition,
        isRecord(data.options) ? data.options : undefined
      );
      return { ...data, ...(options ? { options } : {}) };
    }

    // "By target" picker shortcut, mirroring buildTriggerNodeData's
    // identical case: jump straight to a legacy `state` condition pre-filled
    // with the chosen entity, matching nodeTypeCatalog's own condition
    // node default shape (`{ condition: 'state', entity_id: '' }').
    case 'entityTarget':
      return { condition: 'state', entity_id: selection.entityIds };

    case 'recipe': {
      const { entityIds, recipe } = selection;
      const { condition } = recipe.fields;
      // A zone condition's picked entities are its zones; zone.in_zone/
      // not_in_zone still need a target (the people and device trackers),
      // which HA requires: an empty one, filled in the panel.
      const zone = picksZone('condition', condition);
      const picked = startingOptions(condition, recipe.fields.options, recipe.fields.thresholdless);
      const options = zone && entityIds.length > 0 ? { ...picked, zone: entityIds } : picked;
      // Every recipe in lib/conditionRecipes.ts is a purpose-specific,
      // dotted `domain.is_*` condition (unlike triggers, there's no legacy
      // fallback branch to handle here — see that file's doc comment) —
      // always a `target`/`options` shape.
      return {
        condition,
        // None for a condition with no target in HA (#118).
        ...(recipeIsTargetless(recipe)
          ? {}
          : {
              target:
                selection.areaId && conditionRecipeTakesArea(recipe)
                  ? { area_id: selection.areaId }
                  : { entity_id: zone ? [] : entityIds },
            }),
        ...(options ? { options } : {}),
      };
    }

    case 'deviceCondition': {
      const { condition } = selection;
      // `condition: 'device'` is the real HA discriminator ConditionFields.tsx/
      // DeviceConditionFields.tsx already key off of — see this type's doc
      // comment.
      return {
        condition: 'device',
        device_id: condition.device_id,
        domain: condition.domain,
        type: condition.type,
        subtype: condition.subtype ?? undefined,
        entity_id: condition.entity_id ?? undefined,
      };
    }

    default: {
      const exhaustive: never = selection;
      throw new Error(`Unhandled condition selection: ${JSON.stringify(exhaustive)}`);
    }
  }
}
