import { z } from 'zod';

/**
 * Validation schemas for node data.
 * These are used for real-time validation in the UI, separate from the
 * structural schemas used for parsing.
 */

/**
 * Wait node validation - requires either wait_template or wait_for_trigger.
 * A wait with only timeout is not valid - use a Delay node instead.
 */
export const WaitNodeValidationSchema = z
  .object({
    wait_template: z.string().optional(),
    wait_for_trigger: z.array(z.any()).optional(),
    timeout: z.union([z.string(), z.object({})]).optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      const hasTemplate = data.wait_template && data.wait_template.trim() !== '';
      const hasTrigger = data.wait_for_trigger && data.wait_for_trigger.length > 0;
      return hasTemplate || hasTrigger;
    },
    {
      message: 'errors:validation.wait.templateOrTriggerRequired',
      path: ['_root'],
    }
  );

/**
 * Action node validation - requires one of:
 *   - service in domain.service format (service call action), or
 *   - event string (fire event action), or
 *   - stop string (stop action — see below), or
 *   - an opaque repeat object (repeat.count / repeat.while / repeat.until)
 */
export const ActionNodeValidationSchema = z
  .object({
    service: z.string().optional(),
    event: z.string().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    // Opaque repeat nodes (repeat.count / repeat.while / repeat.until) are valid without service/event
    if (data.repeat !== null && typeof data.repeat === 'object') return;

    // Stop actions (`stop: "<message>"` + optional `error: true/false`) are
    // a third valid action shape alongside service/event — HA's own "Stop"
    // action ends the automation/script, optionally with a message and/or
    // marking it an error. An empty string ("") is a legitimate stop
    // reason (real HA UI defaults new Stop actions to it), so this only
    // checks the field's presence/type, not its content — mirroring
    // ActionFields.tsx's own `actionType = stopMessage !== undefined ?
    // 'stop' : ...` test. Before this check, EVERY stop action failed this
    // schema (neither `service` nor `event` is ever set on one), so any
    // flow containing a Stop node — e.g. the Else branch of an If/Then/Else
    // — could never be saved.
    if (typeof data.stop === 'string') return;

    const hasEvent = typeof data.event === 'string' && data.event.trim() !== '';
    const hasService = typeof data.service === 'string' && data.service.trim() !== '';

    if (!hasEvent && !hasService) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'errors:validation.action.serviceOrEventRequired',
        path: ['service'],
      });
      return;
    }

    if (hasService && !data.service!.includes('.')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'errors:validation.action.serviceFormat',
        path: ['service'],
      });
    }
  });

/**
 * Helper to check if an entity_id value is non-empty.
 * Handles both string and array formats.
 */
function hasEntityId(entityId: unknown): boolean {
  if (Array.isArray(entityId)) return entityId.length > 0;
  if (typeof entityId === 'string') return entityId.trim() !== '';
  return false;
}

/**
 * Helper to check if a trigger ID value is valid (non-empty).
 * Handles both string and array formats, ensuring no empty strings.
 */
function hasValidTriggerId(id: unknown): boolean {
  if (Array.isArray(id)) {
    return id.length > 0 && id.every((item) => typeof item === 'string' && item.trim() !== '');
  }
  if (typeof id === 'string') return id.trim() !== '';
  return false;
}

/**
 * Trigger node validation - requires trigger platform and type-specific fields.
 * Accepts both 'trigger' (modern) and 'platform' (legacy) field names.
 */
export const TriggerNodeValidationSchema = z
  .object({
    trigger: z.string().optional(),
    platform: z.string().optional(),
    entity_id: z.unknown().optional(),
    to: z.unknown().optional(),
    from: z.unknown().optional(),
    event_type: z.string().optional(),
    at: z.unknown().optional(),
    topic: z.string().optional(),
    webhook_id: z.string().optional(),
    // string for device triggers (a single device), string|array for the tag
    // trigger's optional reader-device restriction (see hasEntityId reuse in
    // the 'device'/'tag' cases below, which accepts either shape).
    device_id: z.union([z.string(), z.array(z.string())]).optional(),
    zone: z.string().optional(),
    event: z.string().optional(),
    value_template: z.string().optional(),
    tag_id: z.unknown().optional(),
    source: z.string().optional(),
    command: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const triggerType = data.trigger || data.platform;
    if (!triggerType || triggerType.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'errors:validation.trigger.platformRequired',
        path: ['trigger'],
      });
      return;
    }

    switch (triggerType) {
      case 'state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.entityRequired.state',
            path: ['entity_id'],
          });
        }
        break;

      case 'numeric_state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.entityRequired.numericState',
            path: ['entity_id'],
          });
        }
        break;

      case 'event':
        if (
          !data.event_type ||
          (typeof data.event_type === 'string' && data.event_type.trim() === '')
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.eventTypeRequired',
            path: ['event_type'],
          });
        }
        break;

      case 'time':
        if (!data.at) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.timeRequired',
            path: ['at'],
          });
        }
        break;

      case 'mqtt':
        if (!data.topic || data.topic.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.mqttTopicRequired',
            path: ['topic'],
          });
        }
        break;

      case 'webhook':
        if (!data.webhook_id || data.webhook_id.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.webhookIdRequired',
            path: ['webhook_id'],
          });
        }
        break;

      case 'device':
        if (!hasEntityId(data.device_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.deviceRequired',
            path: ['device_id'],
          });
        }
        break;

      case 'zone':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.entityRequired.zone',
            path: ['entity_id'],
          });
        }
        if (!data.zone || data.zone.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.zoneRequired',
            path: ['zone'],
          });
        }
        break;

      case 'sun':
      case 'homeassistant':
        if (!data.event || data.event.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              triggerType === 'sun'
                ? 'errors:validation.trigger.sunEventRequired'
                : 'errors:validation.trigger.haEventRequired',
            path: ['event'],
          });
        }
        break;

      case 'template':
        if (!data.value_template || data.value_template.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.templateRequired',
            path: ['value_template'],
          });
        }
        break;

      case 'tag':
        if (!hasEntityId(data.tag_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.tagIdRequired',
            path: ['tag_id'],
          });
        }
        break;

      case 'geo_location':
        if (!data.source || data.source.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.sourceRequired',
            path: ['source'],
          });
        }
        if (!data.zone || data.zone.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.zoneRequired',
            path: ['zone'],
          });
        }
        if (!data.event || data.event.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.geoEventRequired',
            path: ['event'],
          });
        }
        break;

      case 'conversation':
        if (!hasEntityId(data.command)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.trigger.commandRequired',
            path: ['command'],
          });
        }
        break;

      // 'persistent_notification' has no required fields — omitting
      // notification_id/update_type is valid and means "any notification,
      // any update type" per HA's docs.
    }
  });

/**
 * Delay node validation - requires delay value.
 */
export const DelayNodeValidationSchema = z
  .object({
    // The object member previously had no fields defined (`z.object({})`),
    // which — without `.passthrough()` on this inner schema — silently
    // stripped any hours/minutes/seconds/etc the user actually set before
    // the refine below ever saw them, so "has any duration field" could
    // never be checked no matter what was fixed downstream. Real HA delay
    // objects allow days/hours/minutes/seconds/milliseconds, each a number
    // or a template string.
    delay: z.union([
      z.string(),
      z.object({
        days: z.union([z.number(), z.string()]).optional(),
        hours: z.union([z.number(), z.string()]).optional(),
        minutes: z.union([z.number(), z.string()]).optional(),
        seconds: z.union([z.number(), z.string()]).optional(),
        milliseconds: z.union([z.number(), z.string()]).optional(),
      }),
    ]),
  })
  .passthrough()
  .refine(
    (data) => {
      if (typeof data.delay === 'string') {
        return data.delay.trim() !== '';
      }
      // Object-based delay is valid only if it actually has a duration
      // field set to something non-empty — an empty `delay: {}` previously
      // passed this check (the refine's object branch always `return true`)
      // and would reach Home Assistant as nonsensical, immediately-rejected
      // YAML despite the UI reporting the node as fully valid.
      return Object.values(data.delay).some((v) => v !== undefined && v !== null && v !== '');
    },
    {
      message: 'errors:validation.delay.valueRequired',
      path: ['delay'],
    }
  );

/**
 * Condition node validation - requires condition type and type-specific fields.
 */
export const ConditionNodeValidationSchema = z
  .object({
    condition: z.string().min(1, 'errors:validation.condition.typeRequired'),
    entity_id: z.unknown().optional(),
    state: z.unknown().optional(),
    value_template: z.string().optional(),
    zone: z.string().optional(),
    device_id: z.string().optional(),
    id: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    switch (data.condition) {
      case 'state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.entityRequired.state',
            path: ['entity_id'],
          });
        }
        if (!data.state || (typeof data.state === 'string' && data.state.trim() === '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.stateRequired',
            path: ['state'],
          });
        }
        break;

      case 'numeric_state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.entityRequired.numericState',
            path: ['entity_id'],
          });
        }
        break;

      case 'trigger':
        if (!hasValidTriggerId(data.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.triggerIdRequired',
            path: ['id'],
          });
        }
        break;

      case 'template':
        if (!data.value_template || data.value_template.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.templateRequired',
            path: ['value_template'],
          });
        }
        break;

      case 'zone':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.entityRequired.zone',
            path: ['entity_id'],
          });
        }
        if (!data.zone || data.zone.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.zoneRequired',
            path: ['zone'],
          });
        }
        break;

      case 'device':
        if (!data.device_id || data.device_id.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.deviceRequired',
            path: ['device_id'],
          });
        }
        break;

      case 'or':
      case 'and':
      case 'not': {
        const conditions = (data as Record<string, unknown>).conditions;
        if (!Array.isArray(conditions) || conditions.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'errors:validation.condition.groupConditionsRequired',
            path: ['conditions'],
          });
        }
        break;
      }
    }
  });

/**
 * SetVariables node validation - requires at least one variable.
 */
export const SetVariablesNodeValidationSchema = z
  .object({
    variables: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      if (!data.variables) return false;
      return Object.keys(data.variables).length > 0;
    },
    {
      message: 'errors:validation.setVariables.atLeastOne',
      path: ['variables'],
    }
  );

/**
 * Map node types to their validation schemas.
 * Returns undefined for node types without specific validation.
 */
export function getNodeValidationSchema(nodeType: string): z.ZodSchema | undefined {
  switch (nodeType) {
    case 'wait':
      return WaitNodeValidationSchema;
    case 'action':
      return ActionNodeValidationSchema;
    case 'trigger':
      return TriggerNodeValidationSchema;
    case 'delay':
      return DelayNodeValidationSchema;
    case 'condition':
      return ConditionNodeValidationSchema;
    case 'set_variables':
      return SetVariablesNodeValidationSchema;
    default:
      return undefined;
  }
}

/**
 * Validation error structure
 */
export interface NodeValidationError {
  path: string[];
  message: string;
}

/**
 * Validate node data against its schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateNodeData(
  nodeType: string,
  data: Record<string, unknown>
): NodeValidationError[] {
  const schema = getNodeValidationSchema(nodeType);
  if (!schema) {
    return []; // No validation schema for this node type
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
  }));
}
