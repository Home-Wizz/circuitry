import type { DeviceCondition } from '@/hooks/useDeviceAutomation';
import type { ConditionBlock, ConditionRecipe } from '@/lib/conditionRecipes';

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
  | { kind: 'entityTarget'; entityId: string }
  | { kind: 'recipe'; entityIds: string[]; recipe: ConditionRecipe }
  | { kind: 'deviceCondition'; condition: DeviceCondition };

/**
 * Single source of truth for turning a condition-picker selection into the
 * actual `data` fields a condition node needs — mirrors
 * lib/triggerNodeData.ts's buildTriggerNodeData exactly, just for
 * conditions instead of triggers.
 */
export function buildConditionNodeData(selection: ConditionSelection): Record<string, unknown> {
  switch (selection.kind) {
    // Blocks (and/or/not/template/time/trigger) have no entity target at
    // all — the block's own `data` is already a complete, minimal starting
    // point for that condition type.
    case 'block':
      return { ...selection.block.data };

    // "By target" picker shortcut, mirroring buildTriggerNodeData's
    // identical case: jump straight to a legacy `state` condition pre-filled
    // with the chosen entity, matching nodeTypeCatalog's own condition
    // node default shape (`{ condition: 'state', entity_id: '' }').
    case 'entityTarget':
      return { condition: 'state', entity_id: [selection.entityId] };

    case 'recipe': {
      const { entityIds, recipe } = selection;
      const { condition, options } = recipe.fields;
      // Every recipe in lib/conditionRecipes.ts is a purpose-specific,
      // dotted `domain.is_*` condition (unlike triggers, there's no legacy
      // fallback branch to handle here — see that file's doc comment) —
      // always a `target`/`options` shape.
      return {
        condition,
        target: { entity_id: entityIds },
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
