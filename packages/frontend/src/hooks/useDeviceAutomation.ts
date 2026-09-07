import { useCallback } from 'react';
import { useHass } from '../contexts/HassContext';

/**
 * Device trigger definition from HA API
 */
export interface DeviceTrigger {
  platform: string;
  domain: string;
  device_id: string;
  type: string;
  subtype?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Device action definition from HA's `device_automation/action/list` API —
 * the action-side sibling of DeviceTrigger above. No `platform` field: HA's
 * device action schema is recognized structurally (device_id + domain +
 * type with no `service`/`action` key, see shared's `isDeviceAction`), not
 * by a discriminator string the way triggers/conditions are.
 *
 * This (and `getDeviceActions` below) previously didn't exist at all — the
 * Action miller's device drill-down only ever showed domain-service recipes
 * (lib/actionRecipes.ts), never the genuinely device-specific actions real
 * HA devices commonly expose (ZHA/deCONZ remote "press" actions, "identify",
 * IR-blaster commands, ...), which is why some devices kept showing empty
 * even after actionRecipes.ts's domain-coverage audit — those devices had
 * real actions, just not ones expressible as a plain domain.service call.
 * The transpiler side (`isDeviceAction`, native.ts/state-machine.ts/
 * YamlParser.ts) already round-trips this action shape; only the picker UI
 * to reach it was missing.
 */
export interface DeviceAction {
  domain: string;
  device_id: string;
  type: string;
  subtype?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Device condition definition from HA's `device_automation/condition/list`
 * API — the condition-side sibling of DeviceTrigger/DeviceAction above. Same
 * no-`platform`-field shape as DeviceAction (HA's device condition schema is
 * recognized by `condition: 'device'` instead, see DeviceConditionFields.tsx/
 * ConditionFields.tsx's `conditionType === 'device'` branch).
 *
 * This (and `getDeviceConditions` below) previously didn't exist — the
 * Condition miller's "Generic" section had no "Device" entry at all, unlike
 * the Trigger/Action millers which both already surfaced real
 * device-specific triggers/actions (ZHA/deCONZ remote button presses,
 * "identify", ...) alongside their domain-recipe catalogs.
 */
export interface DeviceCondition {
  condition: string;
  domain: string;
  device_id: string;
  type: string;
  subtype?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Selector types supported by Home Assistant
 */
export type SelectorType =
  | 'text'
  | 'boolean'
  | 'number'
  /**
   * Not a real HA selector type — a Circuitry-only field type for bounds
   * that HA's YAML accepts as either a literal number or an entity
   * reference (e.g. numeric_state's `above`/`below`), rendered as an
   * explicit number/entity toggle (see ThresholdValueField's `bare` mode)
   * rather than guessing at HA's own undocumented `choose`-selector wire
   * format for the same thing.
   */
  | 'number_or_entity'
  | 'select'
  | 'entity'
  | 'device'
  | 'area'
  | 'zone'
  | 'user'
  | 'time'
  | 'date'
  | 'datetime'
  | 'duration'
  | 'object'
  | 'template'
  | 'color_rgb'
  | 'color_temp'
  | 'icon'
  | 'media'
  | 'target'
  | 'action'
  | 'condition'
  | 'datetime'
  | 'attribute';

/**
 * Field configuration returned by trigger/capabilities API
 * HA returns fields with either 'type' (older format) or 'selector' (newer format)
 */
export interface TriggerField {
  name: string;
  required?: boolean;
  optional?: boolean;
  default?: unknown;
  // Newer selector format
  selector?: Partial<Record<SelectorType, Record<string, unknown>>>;
  // Older type format (e.g., "select", "number", etc.)
  type?: string;
  options?: [string, string][];
}

/**
 * Trigger capabilities response — same `{ extra_fields }` shape is returned
 * by HA's condition/action capabilities websocket commands below, so
 * `ConditionCapabilities`/`ActionCapabilities` are aliases rather than
 * separate interfaces.
 */
export interface TriggerCapabilities {
  extra_fields?: TriggerField[];
}
export type ConditionCapabilities = TriggerCapabilities;
export type ActionCapabilities = TriggerCapabilities;

/**
 * Hook to interact with Home Assistant Device Automation API
 */
export function useDeviceAutomation() {
  const { hass } = useHass();

  /**
   * Fetch available triggers for a specific device
   */
  const getDeviceTriggers = useCallback(
    async (deviceId: string): Promise<DeviceTrigger[]> => {
      if (!hass?.callWS) {
        console.warn('callWS not available');
        return [];
      }
      try {
        const response = (await hass.callWS({
          type: 'device_automation/trigger/list',
          device_id: deviceId,
        })) as DeviceTrigger[] | undefined;

        return response || [];
      } catch (error) {
        console.error('Failed to fetch device triggers:', error);
        throw error;
      }
    },
    [hass]
  );

  /**
   * Fetch available actions for a specific device — the action-side sibling
   * of getDeviceTriggers above, see DeviceAction's doc comment.
   */
  const getDeviceActions = useCallback(
    async (deviceId: string): Promise<DeviceAction[]> => {
      if (!hass?.callWS) {
        console.warn('callWS not available');
        return [];
      }
      try {
        const response = (await hass.callWS({
          type: 'device_automation/action/list',
          device_id: deviceId,
        })) as DeviceAction[] | undefined;

        return response || [];
      } catch (error) {
        console.error('Failed to fetch device actions:', error);
        throw error;
      }
    },
    [hass]
  );

  /**
   * Fetch available conditions for a specific device — the condition-side
   * sibling of getDeviceTriggers/getDeviceActions above, see DeviceCondition's
   * doc comment.
   */
  const getDeviceConditions = useCallback(
    async (deviceId: string): Promise<DeviceCondition[]> => {
      if (!hass?.callWS) {
        console.warn('callWS not available');
        return [];
      }
      try {
        const response = (await hass.callWS({
          type: 'device_automation/condition/list',
          device_id: deviceId,
        })) as DeviceCondition[] | undefined;

        return response || [];
      } catch (error) {
        console.error('Failed to fetch device conditions:', error);
        throw error;
      }
    },
    [hass]
  );

  /**
   * Fetch trigger capabilities (field schema) for a specific trigger
   */
  const getTriggerCapabilities = useCallback(
    async (trigger: Partial<DeviceTrigger>): Promise<TriggerCapabilities> => {
      if (!hass?.callWS) {
        console.warn('callWS not available');
        return { extra_fields: [] };
      }
      try {
        const response = await hass.callWS({
          type: 'device_automation/trigger/capabilities',
          trigger,
        });
        return (response as TriggerCapabilities) || { extra_fields: [] };
      } catch (error) {
        console.error('Failed to fetch trigger capabilities:', error);
        throw error;
      }
    },
    [hass]
  );

  /**
   * Fetch condition capabilities (field schema) for a specific device
   * condition — the condition-side sibling of getTriggerCapabilities above.
   * Real HA websocket command, same shape as trigger/capabilities
   * (`device_automation/condition/capabilities`).
   */
  const getConditionCapabilities = useCallback(
    async (condition: Partial<DeviceCondition>): Promise<ConditionCapabilities> => {
      if (!hass?.callWS) {
        console.warn('callWS not available');
        return { extra_fields: [] };
      }
      try {
        const response = await hass.callWS({
          type: 'device_automation/condition/capabilities',
          condition,
        });
        return (response as ConditionCapabilities) || { extra_fields: [] };
      } catch (error) {
        console.error('Failed to fetch condition capabilities:', error);
        throw error;
      }
    },
    [hass]
  );

  /**
   * Fetch action capabilities (field schema) for a specific device action —
   * the action-side sibling of getTriggerCapabilities above. Real HA
   * websocket command (`device_automation/action/capabilities`).
   */
  const getActionCapabilities = useCallback(
    async (action: Partial<DeviceAction>): Promise<ActionCapabilities> => {
      if (!hass?.callWS) {
        console.warn('callWS not available');
        return { extra_fields: [] };
      }
      try {
        const response = await hass.callWS({
          type: 'device_automation/action/capabilities',
          action,
        });
        return (response as ActionCapabilities) || { extra_fields: [] };
      } catch (error) {
        console.error('Failed to fetch action capabilities:', error);
        throw error;
      }
    },
    [hass]
  );

  return {
    getDeviceTriggers,
    getDeviceActions,
    getDeviceConditions,
    getTriggerCapabilities,
    getConditionCapabilities,
    getActionCapabilities,
  };
}
