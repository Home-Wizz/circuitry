import type { DeviceAction } from '@/hooks/useDeviceAutomation';
import type { ActionRecipe } from '@/lib/actionRecipes';

/**
 * The outcomes ThenActionDialog.tsx's "By type"/"By target" flows can
 * produce — the Then-dialog equivalent of lib/triggerNodeData.ts's
 * TriggerSelection / lib/conditionNodeData.ts's ConditionSelection.
 *
 * `recipe` has no generic "By target" fallback the way `entityTarget` is for
 * triggers/conditions (a bare `state`/`numeric_state` check is always valid
 * for *any* entity — there's no equivalent "always-valid, no-verb-needed"
 * action; every action call requires a real service). See
 * ThenActionDialog.tsx's `ThenTargetResultsPanel` — no singleEntityId
 * fallback row. The dialog's Blocks section (`lib/actionBlocks.ts`) covers
 * the non-entity-scoped cases instead, same division of labor as
 * AndConditionDialog's Blocks.
 *
 * `deviceAction` is the device-specific sibling of triggerNodeData.ts's
 * `deviceTrigger` case — a genuinely device-specific action (ZHA/deCONZ
 * remote "press" commands, "identify", IR-blaster commands, ...) fetched
 * live from `device_automation/action/list`, not expressible as a plain
 * domain.service recipe. See useDeviceAutomation.ts's DeviceAction doc
 * comment for why this was missing before.
 */
export type ActionSelection =
  | { kind: 'recipe'; entityIds: string[]; recipe: ActionRecipe }
  | { kind: 'deviceAction'; action: DeviceAction };

/**
 * Single source of truth for turning an action-picker selection into the
 * actual `data` fields an action node needs — mirrors
 * lib/triggerNodeData.ts/lib/conditionNodeData.ts.
 */
// Services HA describes with no target and no entity_id field (HA
// 2026.9.3's services.yaml): they act on no entity (#123).
const NO_ENTITY_SERVICES = new Set<string>([
  'conversation.process',
  'conversation.reload',
  'group.reload',
  'group.remove',
  'group.set',
]);

/** Whether picking this recipe asks for entities first: not for a service
 * that acts on no entity (#123 -- there are no conversation.* entities, so
 * those actions couldn't be added at all). */
export function actionRecipeTakesEntities(recipe: ActionRecipe): boolean {
  return !NO_ENTITY_SERVICES.has(recipe.service);
}

export function buildActionNodeData(selection: ActionSelection): Record<string, unknown> {
  switch (selection.kind) {
    case 'recipe': {
      const { entityIds, recipe } = selection;
      return {
        service: recipe.service,
        ...(actionRecipeTakesEntities(recipe) ? { target: { entity_id: entityIds } } : {}),
      };
    }
    case 'deviceAction': {
      const { action } = selection;
      return {
        device_id: action.device_id,
        domain: action.domain,
        type: action.type,
        subtype: action.subtype ?? undefined,
        entity_id: action.entity_id ?? undefined,
      };
    }
  }
}
