import type { NodeValidationError } from '@circuitry/shared';
import type { HassServices } from 'home-assistant-js-websocket';
import { targetNamesSomething } from '@/lib/nativeRequired';
import { getConditionThresholdShape, getTriggerThresholdShape } from '@/lib/nativeThreshold';
import { isEmptyValue, isRecord } from '@/lib/utils';
import { serviceHasTarget } from '@/lib/serviceTargets';

/**
 * What a pick still needs before it's worth adding: everything the editor
 * flags on such a node (`issues`: what the canvas would show on it, errors
 * and warnings, with the connected HA's service checks; not a group's
 * empty contents, CONTENTS_ISSUES), and what leaves it
 * doing nothing as picked though nothing flags it -- an action on a service
 * that takes a target, with none (HA runs it on nothing), and a for-each
 * loop with no items. The pickers open their settings column only when
 * there is something here: a pick that's ready is added at once, its
 * optional settings left at HA's defaults.
 */
/** Issues about what a block holds rather than how it's set: an And/Or/
 * Not group starts empty and its conditions are added to it afterwards, on
 * the canvas, as an If/Then's steps are -- the canvas still flags it until
 * then, but it's added at once. */
const CONTENTS_ISSUES: ReadonlySet<string> = new Set(['errors:validation.condition.groupEmpty']);

export function pickGaps(
  nodeType: string,
  data: Record<string, unknown>,
  issues: NodeValidationError[],
  services: HassServices | undefined
): NodeValidationError[] {
  const gaps = issues.filter((issue) => !CONTENTS_ISSUES.has(issue.message));
  if (nodeType === 'action') {
    const service = typeof data.service === 'string' ? data.service : '';
    const takesTarget = service.includes('.') && serviceHasTarget(services, service);
    if (takesTarget && !targetNamesSomething(data.target)) {
      gaps.push({
        path: ['target'],
        message: 'nodes:pickerConfig.gaps.target',
        severity: 'warning',
      });
    }
    const repeat = isRecord(data.repeat) ? data.repeat : undefined;
    if (repeat && 'for_each' in repeat && isEmptyValue(repeat.for_each)) {
      gaps.push({
        path: ['repeat', 'for_each'],
        message: 'nodes:pickerConfig.gaps.forEach',
        severity: 'warning',
      });
    }
  }
  return gaps;
}

/**
 * Whether a pick, as the catalog makes it, opens the settings column: when
 * it still needs something (`gaps`), and when it's a threshold type -- a
 * threshold starts at a placeholder (0, above) so the node is complete,
 * but the number is the point of the pick, so it's asked for. A threshold
 * that starts as "any change" (a `changed` trigger) is a real default and
 * is added at once.
 */
export function pickNeedsSettings(
  nodeType: string,
  data: Record<string, unknown>,
  gaps: NodeValidationError[]
): boolean {
  if (gaps.length > 0) return true;
  const kind =
    nodeType === 'trigger' ? 'trigger' : nodeType === 'condition' ? 'condition' : undefined;
  const type =
    kind === 'trigger' ? data.trigger : kind === 'condition' ? data.condition : undefined;
  if (!kind || typeof type !== 'string' || !type.includes('.')) return false;
  const shape =
    kind === 'trigger' ? getTriggerThresholdShape(type) : getConditionThresholdShape(type);
  if (shape === 'none') return false;
  // Its bounds are the point of it, whether a `threshold` or (on an HA from
  // before the threshold rework) that HA's own bound fields.
  const threshold = isRecord(data.options) ? data.options.threshold : undefined;
  return !(isRecord(threshold) && threshold.type === 'any');
}
