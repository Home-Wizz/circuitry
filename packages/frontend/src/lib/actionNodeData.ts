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
export function buildActionNodeData(selection: ActionSelection): Record<string, unknown> {
  switch (selection.kind) {
    case 'recipe': {
      const { entityIds, recipe } = selection;
      return {
        service: recipe.service,
        target: { entity_id: entityIds },
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
