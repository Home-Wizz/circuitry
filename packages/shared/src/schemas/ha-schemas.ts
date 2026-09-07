import { z } from 'zod';
import { MaxExceededSchema } from './base';
import { OptionalTargetSchema } from './ha-entities';

/**
 * List of valid Home Assistant weekday strings.
 * Used for time-based conditions and triggers.
 */
export const VALID_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof VALID_WEEKDAYS)[number];

/**
 * Zod schema for Home Assistant condition objects.
 * Supports recursive conditions for and/or/not groups.
 */
export const HAConditionSchema: z.ZodType<
  {
    [x: string]: unknown;
    condition?: string;
    alias?: string;
    enabled?: boolean;
    entity_id?: string | string[];
    state?: string | string[];
    value_template?: string;
    after?: string;
    before?: string;
    weekday?: Weekday[];
    after_offset?: string;
    before_offset?: string;
    zone?: string;
    conditions?: z.infer<typeof HAConditionSchema>[];
    above?: string | number;
    below?: string | number;
    attribute?: string;
    id?: string | string[];
    target?: { entity_id?: string | string[] };
    options?: Record<string, unknown>;
  },
  Record<string, unknown>
> = z.looseObject({
  alias: z.string().optional(),
  condition: z.string().optional(),
  enabled: z.boolean().optional(),
  entity_id: z.union([z.string(), z.array(z.string())]).optional(),
  state: z.union([z.string(), z.array(z.string())]).optional(),
  value_template: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  weekday: z.array(z.enum(VALID_WEEKDAYS)).optional(),
  after_offset: z.string().optional(),
  before_offset: z.string().optional(),
  zone: z.string().optional(),
  conditions: z.array(z.lazy(() => HAConditionSchema)).optional(),
  above: z.union([z.string(), z.number()]).optional(),
  below: z.union([z.string(), z.number()]).optional(),
  attribute: z.string().optional(),
  // Support both string and array for trigger conditions
  id: z.union([z.string(), z.array(z.string())]).optional(),
  // Purpose-specific conditions (HA 2025.12+ era, e.g. `condition:
  // light.is_on`) target the same entity/device/area/floor/label shape as
  // action targets and trigger targets — reusing OptionalTargetSchema rather
  // than redefining it here, same pattern as HATriggerSchema's `target`.
  target: OptionalTargetSchema,
  // Loose so unrecognized option keys from newer/less-common purpose-specific
  // conditions (thresholds, modes, ...) still round-trip untouched — unlike
  // HATriggerSchema's `options`, there's no single well-known key (like
  // `behavior`) shared across every purpose-specific condition, so this stays
  // a bare loose object rather than naming any particular field.
  options: z.looseObject({}).optional(),
});

export type HACondition = z.infer<typeof HAConditionSchema>;

/**
 * Enum of valid Home Assistant trigger platforms.
 */
export const HAPlatformEnum = z.enum([
  'event',
  'template',
  'zone',
  'state',
  'time',
  'time_pattern',
  'mqtt',
  'webhook',
  'sun',
  'numeric_state',
  'homeassistant',
  'device',
  'calendar',
]);
export type HAPlatform = z.infer<typeof HAPlatformEnum>;

/**
 * Zod schema for Home Assistant trigger objects.
 * Normalizes both legacy 'platform' and modern 'trigger' fields to a single 'trigger' property.
 * Supports both legacy format (platform: state) and modern format (trigger: state).
 */
/**
 * A single entry of the `time` trigger's `at` field — a fixed time string
 * (`HH:MM` / `HH:MM:SS`), an `input_datetime`/timestamp-sensor/`time` entity
 * id (also a plain string), a limited template (also a plain string — HA
 * evaluates it at setup time), or a mapping of an entity id plus an offset
 * to add to that entity's time. `at` itself is either one of these or a list
 * mixing them (see HATriggerSchema's `at` field below).
 */
const TimeAtEntrySchema = z.union([
  z.string(),
  z.object({
    entity_id: z.string(),
    offset: z.union([z.string(), z.number()]).optional(),
  }),
]);

export const HATriggerSchema = z
  .looseObject({
    alias: z.string().optional(),
    platform: z.string().optional(),
    trigger: z.string().optional(),
    // Universal trigger fields (every HA trigger platform supports these,
    // see home-assistant.io/docs/automation/trigger/#trigger-id): `id` for
    // later reference by trigger.id in templates / `condition: trigger`
    // routing, `enabled: false` to disable just this one trigger, and
    // `variables` (a map) to set values available as `trigger.*` when it
    // fires.
    id: z.string().optional(),
    enabled: z.boolean().optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    // Purpose-specific triggers (HA 2025.12+, e.g. `trigger: light.turned_on`)
    // target the same entity/device/area/floor/label shape as action targets
    // — reusing OptionalTargetSchema rather than redefining it here.
    target: OptionalTargetSchema,
    // `behavior` (each/first/all) controls multi-target firing for
    // purpose-specific triggers; loose otherwise so unrecognized option keys
    // from newer/less-common trigger platforms still round-trip untouched.
    options: z
      .looseObject({ behavior: z.enum(['each', 'first', 'all']).optional() })
      .optional(),
    entity_id: z.union([z.string(), z.array(z.string())]).optional(),
    // Home Assistant supports both string, array, and null for from/to fields
    // — `null` means "any state, including the very first state ever
    // recorded", distinct from leaving the field unset entirely, and is only
    // meaningful while ignoring attribute-only changes (see docs). `not_from`/
    // `not_to` are the YAML-only inverted counterparts ("trigger unless
    // transitioning from/to this") and cannot combine with `from`/`to`
    // respectively — that mutual exclusivity is a UI/authoring concern (see
    // StateTriggerFields.tsx), not something this passthrough schema enforces.
    from: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
    to: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
    not_from: z.union([z.string(), z.array(z.string())]).optional(),
    not_to: z.union([z.string(), z.array(z.string())]).optional(),
    for: z
      .union([
        z.string(),
        z.number(),
        z.object({
          hours: z.union([z.number(), z.string()]).optional(),
          minutes: z.union([z.number(), z.string()]).optional(),
          seconds: z.union([z.number(), z.string()]).optional(),
          milliseconds: z.union([z.number(), z.string()]).optional(),
        }),
      ])
      .optional(),
    // `time` trigger: a fixed time string, an entity reference, a limited
    // template, an { entity_id, offset } mapping, or a list mixing those
    // (see TimeAtEntrySchema above) — plus a separate `weekday` filter.
    at: z.union([TimeAtEntrySchema, z.array(TimeAtEntrySchema)]).optional(),
    weekday: z.union([z.enum(VALID_WEEKDAYS), z.array(z.enum(VALID_WEEKDAYS))]).optional(),
    offset: z.union([z.string(), z.number(), z.record(z.string(), z.number())]).optional(),
    event: z.string().optional(),
    event_type: z.union([z.string(), z.array(z.string())]).optional(),
    event_data: z.record(z.string(), z.unknown()).optional(),
    above: z.union([z.string(), z.number()]).optional(),
    below: z.union([z.string(), z.number()]).optional(),
    value_template: z.string().optional(),
    template: z.string().optional(),
    webhook_id: z.string().optional(),
    // Webhook trigger: which HTTP methods may invoke it (HA supports POST,
    // PUT, HEAD, GET — GET/HEAD aren't enabled by default), and whether it's
    // reachable from outside the local network (default true, i.e. local-only).
    allowed_methods: z.array(z.enum(['GET', 'POST', 'PUT', 'HEAD'])).optional(),
    local_only: z.boolean().optional(),
    zone: z.string().optional(),
    topic: z.string().optional(),
    payload: z.string().optional(),
    // MQTT trigger: payload decoding (default 'utf-8'; empty string disables
    // decoding for binary payloads) and a template to process the message
    // before matching it against `payload`.
    encoding: z.string().optional(),
    // Conversation trigger fields
    command: z.union([z.string(), z.array(z.string())]).optional(),
    // Tag trigger: the scanned NFC tag id(s), optionally restricted to
    // specific tag-reader device(s).
    tag_id: z.union([z.string(), z.array(z.string())]).optional(),
    device_id: z.union([z.string(), z.array(z.string())]).optional(),
    // Geolocation trigger: the geo_location platform providing the entity
    // (e.g. `nsw_rural_fire_service_feed`), the zone entity, and enter/leave.
    source: z.string().optional(),
    // Persistent notification trigger
    notification_id: z.string().optional(),
    update_type: z.array(z.enum(['added', 'removed', 'updated', 'current'])).optional(),
  })
  .transform((input) => {
    // Normalize to modern 'trigger' property (HA 2024.1+)
    const trigger = input.trigger ?? input.platform ?? 'state';
    // Remove the legacy 'platform' key
    const { platform: _platform, ...rest } = input;
    return {
      ...rest,
      trigger,
    };
  });

export type HATrigger = z.infer<typeof HATriggerSchema>;

/**
 * Home Assistant Trigger interface (for type annotations without schema parsing)
 */
export interface HATriggerInput {
  alias?: string;
  platform?: string;
  trigger?: string;
  id?: string;
  enabled?: boolean;
  variables?: Record<string, unknown>;
  target?: { entity_id?: string | string[] };
  options?: Record<string, unknown>;
  entity_id?: string | string[];
  from?: string | string[] | null;
  to?: string | string[] | null;
  not_from?: string | string[];
  not_to?: string | string[];
  for?: string | { hours?: number; minutes?: number; seconds?: number };
  at?:
    | string
    | { entity_id: string; offset?: string | number }
    | Array<string | { entity_id: string; offset?: string | number }>;
  weekday?: Weekday | Weekday[];
  offset?: string | number | Record<string, number>;
  event?: string;
  event_type?: string;
  event_data?: Record<string, unknown>;
  above?: string | number;
  below?: string | number;
  value_template?: string;
  template?: string;
  webhook_id?: string;
  allowed_methods?: Array<'GET' | 'POST' | 'PUT' | 'HEAD'>;
  local_only?: boolean;
  zone?: string;
  topic?: string;
  payload?: string;
  encoding?: string;
  command?: string | string[];
  tag_id?: string | string[];
  device_id?: string | string[];
  source?: string;
  notification_id?: string;
  update_type?: Array<'added' | 'removed' | 'updated' | 'current'>;
}

/**
 * Home Assistant Action interface (for type annotations)
 */
export interface HAAction {
  service?: string;
  action?: string;
  event?: string;
  event_data?: Record<string, unknown>;
  id?: string;
  alias?: string;
  target?: Record<string, unknown>;
  data?: Record<string, unknown>;
  data_template?: Record<string, unknown>;
  response_variable?: string;
  continue_on_error?: boolean;
  enabled?: boolean;
  delay?: string | number | { hours?: number; minutes?: number; seconds?: number };
  wait_template?: string | Record<string, unknown>;
  timeout?: string | number | Record<string, number>;
  continue_on_timeout?: boolean;
  wait_for_trigger?: HATrigger | HATrigger[];
  choose?: HAChooseOption | HAChooseOption[];
  default?: HAAction[];
  if?: HACondition[];
  then?: HAAction[];
  else?: HAAction[];
  variables?: Record<string, unknown>;
  repeat?: {
    count?: string | number;
    while?: HACondition[];
    until?: string | string[] | HACondition[];
    for_each?: string | unknown[];
    sequence: HAAction[];
  };
  /**
   * Inline "Test a condition" action step's array shorthand — a bare list of
   * conditions (implicit AND), stopping the sequence if any evaluate false.
   * The single-condition-object form (`condition: 'state', entity_id: ..., ...`)
   * doesn't need a field here — its `condition` value is a string type
   * discriminator on the action step itself, already covered by this
   * interface's `[key: string]: unknown` index signature.
   */
  condition?: HACondition[];
  /** "Grouping actions" building block — a nested sequence run as one unit (e.g. as a single parallel branch). */
  sequence?: HAAction[];
  [key: string]: unknown;
}

// Forward declaration for HAChooseOption (defined below)
export interface HAChooseOption {
  conditions: HACondition | HACondition[];
  sequence: HAAction | HAAction[];
  alias?: string;
}

/**
 * Zod schema for FlowGraph metadata block (automation-level settings)
 */
export const FlowGraphMetadataSchema = z.object({
  mode: z.enum(['single', 'restart', 'queued', 'parallel']).default('single'),
  max: z.number().optional(),
  max_exceeded: MaxExceededSchema.optional(),
  initial_state: z.boolean().optional(),
  hide_entity: z.boolean().optional(),
  trace: z.object({ stored_traces: z.number().optional() }).optional(),
});

export type FlowGraphMetadata = z.infer<typeof FlowGraphMetadataSchema>;

/**
 * Type guard for Home Assistant trigger objects.
 * Returns true if the object matches the HATrigger shape.
 */
export function isHATrigger(obj: unknown): obj is HATriggerInput {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ('platform' in obj || 'trigger' in obj || 'entity_id' in obj)
  );
}

/**
 * Type guard for Home Assistant condition objects.
 * Returns true if the object matches the HACondition shape.
 */
export function isHACondition(obj: unknown): obj is HACondition {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ('condition' in obj || 'entity_id' in obj || 'state' in obj)
  );
}

/**
 * Type guard for Home Assistant device actions.
 * Returns true if the object has type, device_id, and domain fields.
 */
export function isDeviceAction(obj: unknown): obj is Record<string, unknown> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    'device_id' in obj &&
    'domain' in obj
  );
}

/**
 * Circuitry metadata stored in automation YAML to preserve flow layout.
 *
 * Naming follows the same deprecated-alias precedent this schema already
 * used across the fork chain: C.A.F.E. wrote `_cafe_metadata`, FLODE
 * renamed the *write* key to `_flode_metadata` while keeping
 * `_cafe_metadata` readable for round-trip compat, and this schema's own
 * `CafeMetadataSchema` was already kept as a deprecated alias rather than
 * deleted outright. Circuitry does the same one step further: the new
 * canonical name is `CircuitryMetadataSchema`, and both `FlodeMetadataSchema`
 * and `CafeMetadataSchema` stay as deprecated aliases so anything importing
 * the old names keeps compiling. See YamlParser.ts's `extractMetadata` for
 * the matching read-side fallback chain, and FlowTranspiler.ts for the
 * write side (only ever writes the new key going forward).
 */
export const CircuitryMetadataSchema = z.object({
  version: z.number(),
  nodes: z.record(
    z.string(),
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ),
  graph_id: z.string(),
  graph_version: z.number(),
  strategy: z.enum(['native', 'state-machine']),
});
export type CircuitryMetadata = z.infer<typeof CircuitryMetadataSchema>;

/** @deprecated Use CircuitryMetadataSchema -- kept for automations saved by FLODE before this fork's rebrand. */
export const FlodeMetadataSchema = CircuitryMetadataSchema;
/** @deprecated Use CircuitryMetadata */
export type FlodeMetadata = CircuitryMetadata;

/** @deprecated Use CircuitryMetadataSchema -- kept for automations saved by the original C.A.F.E. project. */
export const CafeMetadataSchema = CircuitryMetadataSchema;
/** @deprecated Use CircuitryMetadata */
export type CafeMetadata = CircuitryMetadata;

/**
 * Type guard for Circuitry metadata.
 */
export function isCircuitryMetadata(obj: unknown): obj is CircuitryMetadata {
  return CircuitryMetadataSchema.safeParse(obj).success;
}
/** @deprecated Use isCircuitryMetadata */
export const isFlodeMetadata = isCircuitryMetadata;
/** @deprecated Use isCircuitryMetadata */
export const isCafeMetadata = isCircuitryMetadata;

/**
 * Zod schema for choose option in HA actions.
 */
export const HAChooseOptionSchema: z.ZodType<HAChooseOption> = z.lazy(() =>
  z.object({
    conditions: z.union([HAConditionSchema, z.array(HAConditionSchema)]),
    sequence: z.union([HAActionSchema, z.array(HAActionSchema)]),
    alias: z.string().optional(),
  })
);

/**
 * Zod schema for Home Assistant action objects.
 */
export const HAActionSchema: z.ZodType<HAAction> = z.lazy(() =>
  z.looseObject({
    service: z.string().optional(),
    action: z.string().optional(),
    event: z.string().optional(),
    event_data: z.record(z.string(), z.unknown()).optional(),
    id: z.string().optional(),
    alias: z.string().optional(),
    target: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    data_template: z.record(z.string(), z.unknown()).optional(),
    response_variable: z.string().optional(),
    continue_on_error: z.boolean().optional(),
    enabled: z.boolean().optional(),
    delay: z.union([z.string(), z.number(), z.record(z.string(), z.number())]).optional(),
    wait_template: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    timeout: z.union([z.string(), z.number(), z.record(z.string(), z.number())]).optional(),
    continue_on_timeout: z.boolean().optional(),
    wait_for_trigger: z.union([HATriggerSchema, z.array(HATriggerSchema)]).optional(),
    choose: z.union([HAChooseOptionSchema, z.array(HAChooseOptionSchema)]).optional(),
    default: z.array(HAActionSchema).optional(),
    if: z.array(HAConditionSchema).optional(),
    then: z.array(HAActionSchema).optional(),
    else: z.array(HAActionSchema).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    repeat: z
      .object({
        count: z.union([z.string(), z.number()]).optional(),
        while: z.array(HAConditionSchema).optional(),
        until: z.union([z.string(), z.array(z.string()), z.array(HAConditionSchema)]).optional(),
        for_each: z.union([z.string(), z.array(z.unknown())]).optional(),
        sequence: z.array(HAActionSchema),
      })
      .optional(),
    // Inline "Test a condition" action step — single condition object form is handled by
    // the looseObject's passthrough (condition acts as the type discriminator alongside
    // sibling fields like entity_id/state); this field only needs to type the array
    // shorthand ("a list of conditions" = implicit AND, per HA's action-step schema).
    condition: z.array(HAConditionSchema).optional(),
    // "Grouping actions" building block — a nested sequence run as one unit.
    sequence: z.array(HAActionSchema).optional(),
  })
);

/**
 * Zod schema for a full Home Assistant automation.
 */
export const HAAutomationSchema = z.object({
  id: z.string().optional(),
  alias: z.string().optional(),
  description: z.string().optional(),
  trigger_variables: z.record(z.string(), z.unknown()).optional(),
  trigger: z.union([HATriggerSchema, z.array(HATriggerSchema)]).optional(),
  condition: z.union([HAConditionSchema, z.array(HAConditionSchema)]).optional(),
  action: z.union([HAActionSchema, z.array(HAActionSchema)]),
  mode: z.enum(['single', 'restart', 'queued', 'parallel']).optional().default('single'),
  max: z.number().optional(),
  // Was its own hand-written `z.enum(['silent', 'warning'])` — missing
  // 'critical' (which real HA config allows, and which base.ts's
  // MaxExceededSchema and this file's own FlowGraphMetadataSchema above
  // both already included), so a valid automation with
  // `max_exceeded: critical` would fail this schema alone. Reusing the one
  // shared schema instead of a third hand-written copy per CLAUDE.md's DRY
  // rule.
  max_exceeded: MaxExceededSchema.optional(),
  initial_state: z.boolean().optional(),
  hide_entity: z.boolean().optional(),
  trace: z.record(z.string(), z.unknown()).optional(),
  variables: z
    .object({
      // `_circuitry_metadata` is the only key this fork ever writes now.
      // `_flode_metadata` stays declared (rather than falling through to
      // the catchall below) purely so it keeps a typed shape for anything
      // still reading an automation saved before this rebrand — see
      // YamlParser.ts's `extractMetadata` for the actual read-side fallback
      // chain (_circuitry_metadata -> _flode_metadata -> _cafe_metadata).
      _circuitry_metadata: CircuitryMetadataSchema.optional(),
      _flode_metadata: CircuitryMetadataSchema.optional(),
    })
    .catchall(z.unknown())
    .optional(),
});
export type HAAutomation = z.infer<typeof HAAutomationSchema>;

/**
 * Zod schema for a Home Assistant script.
 */
export const HAScriptSchema = HAAutomationSchema.omit({ action: true }).extend({
  action: z.union([HAActionSchema, z.array(HAActionSchema)]).optional(),
  sequence: z.union([HAActionSchema, z.array(HAActionSchema)]),
});
export type HAScript = z.infer<typeof HAScriptSchema>;

/**
 * Zod schema for Home Assistant delay action.
 */
export const HADelaySchema = z.looseObject({
  id: z.string().optional(),
  alias: z.string().optional(),
  delay: z.union([
    z.string(),
    z.looseObject({
      hours: z.union([z.number(), z.string()]).optional(),
      minutes: z.union([z.number(), z.string()]).optional(),
      seconds: z.union([z.number(), z.string()]).optional(),
      milliseconds: z.union([z.number(), z.string()]).optional(),
    }),
  ]),
});
export type HADelay = z.infer<typeof HADelaySchema>;

/**
 * Zod schema for Home Assistant wait action (wait_template or wait_for_trigger).
 */
export const HAWaitSchema = z
  .looseObject({
    id: z.string().optional(),
    alias: z.string().optional(),
    wait_template: z.string().optional(),
    wait_for_trigger: z.array(HATriggerSchema).optional(),
    timeout: z
      .union([
        z.string(),
        z.looseObject({
          hours: z.union([z.number(), z.string()]).optional(),
          minutes: z.union([z.number(), z.string()]).optional(),
          seconds: z.union([z.number(), z.string()]).optional(),
          milliseconds: z.union([z.number(), z.string()]).optional(),
        }),
      ])
      .optional(),
    continue_on_timeout: z.boolean().optional(),
  })
  .refine(
    (data) => {
      return data.wait_template === undefined || data.wait_for_trigger === undefined;
    },
    {
      message: 'Provide either `wait_template` or `wait_for_trigger`, but not both.',
      path: ['wait_template'],
    }
  );
export type HAWait = z.infer<typeof HAWaitSchema>;

/**
 * Zod schema for Home Assistant variables action.
 */
export const HAVariablesSchema = z.looseObject({
  id: z.string().optional(),
  alias: z.string().optional(),
  variables: z.record(z.string(), z.unknown()),
});
export type HAVariables = z.infer<typeof HAVariablesSchema>;

/**
 * Zod schema for a single Home Assistant script `fields:` entry — the typed
 * input parameters a script accepts when called (by another automation, a
 * dashboard, or a voice assistant). Mirrors HA's own script field shape
 * directly, same convention as the other HA*Schema definitions in this file.
 */
export const HAScriptFieldSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
  example: z.union([z.string(), z.number(), z.boolean()]).optional(),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
  selector: z.record(z.string(), z.unknown()).optional(),
});
export type HAScriptField = z.infer<typeof HAScriptFieldSchema>;

/**
 * Zod schema for a Home Assistant script's `fields:` block — a dict keyed by
 * field slug (the name used to reference the value as `{{ <key> }}` inside
 * the script).
 */
export const HAScriptFieldsSchema = z.record(z.string(), HAScriptFieldSchema);
export type HAScriptFields = z.infer<typeof HAScriptFieldsSchema>;
