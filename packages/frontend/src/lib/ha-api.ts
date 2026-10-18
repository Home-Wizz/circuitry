import type { AutomationConfig, HassEntity, HomeAssistant } from '@/types/hass';
import { restRequest } from './restApi';
import { SavedUnconfirmedError } from './saved-unconfirmed';
import { firstDifference } from './stableJson';

export interface CircuitryMetadata {
  version: number;
  strategy: 'native' | 'state-machine';
  nodes: Record<string, unknown>;
  graph_id: string;
  graph_version: number;
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
  [key: string]: unknown;
}

export interface EntityRegistryEntry {
  entity_id: string;
  area_id?: string | null;
  [key: string]: unknown;
}

/** Response shape of `config/entity_registry/get` — the per-entity detail call, richer than the `list` entries. */
export interface ExtendedEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  labels: string[];
  categories: Record<string, string>;
  icon: string | null;
  [key: string]: unknown;
}

export interface EntityRegistryEntryUpdate {
  icon?: string | null;
  area_id?: string | null;
  labels?: string[];
  categories?: Record<string, string | null>;
}

export interface ZoneCatalogItem {
  entity_id: string;
  zone_id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  passive?: boolean;
}

export interface AutomationCatalogItem {
  entity_id: string;
  automation_id: string;
  friendly_name: string;
  enabled: boolean;
  last_triggered?: string;
  description: string;
  mode?: string;
  area_id?: string;
  tags: string[];
}

export interface TraceStep {
  path: string;
  timestamp: string;
  /** Set when this step raised an exception during the real run. */
  error?: string;
  changed_variables?: Record<string, unknown>;
  result?: {
    result?: boolean;
    state?: Record<string, unknown>;
    params?: Record<string, unknown>;
    delay?: number;
    done?: boolean;
    /** Present on `stop:` action steps — `true` if it stopped due to an error. */
    error?: boolean;
  };
}

export interface AutomationTrace {
  last_step: string;
  run_id: string;
  state: 'running' | 'stopped';
  script_execution: 'running' | 'finished' | 'cancelled';
  timestamp: {
    start: string;
    finish?: string;
  };
  domain: string;
  item_id: string;
  trigger: string;
  trace: Record<string, TraceStep[]>;
  config: AutomationConfig;
  context: {
    id: string;
    parent_id?: string;
    user_id?: string;
  };
}

export interface TraceListItem {
  run_id: string;
  last_step: string;
  state: 'running' | 'stopped';
  script_execution: 'running' | 'finished' | 'cancelled';
  timestamp: {
    start: string;
    finish?: string;
  };
  trigger: string;
  domain: string;
  item_id: string;
}

/**
 * Extracts a human-readable message from a thrown value of unknown shape.
 *
 * fetchRestAPI (below) has two branches: standalone/dev mode does its own
 * `fetch` and throws a real `Error` on a non-ok response, but embedded mode
 * (a real Home Assistant panel — see fetchRestAPI's doc comment) delegates
 * to `hass.callApi` instead, and HA's own `callApi` throws the parsed error
 * response object directly, not an `Error` instance. That object usually
 * carries the actual "here's what's wrong with your automation config"
 * detail from HA's backend validation under `.body.message` or `.message`.
 *
 * Every catch block below used to gate on `error instanceof Error` and
 * silently replace anything that wasn't with the fixed string 'Unknown
 * error' — discarding that detail and leaving the user with a save error
 * that doesn't say what's actually wrong (a real user report: "unable to
 * save... unknown error it doesn't specify the error", while running
 * embedded in a real HA panel). Falls back to JSON-stringifying the whole
 * thrown value — still more useful than a fixed string — only when nothing
 * recognizable is found.
 */
function extractApiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  if (error && typeof error === 'object') {
    const asRecord = error as Record<string, unknown>;
    const body = asRecord.body;
    if (body && typeof body === 'object') {
      const bodyMessage = (body as Record<string, unknown>).message;
      if (typeof bodyMessage === 'string' && bodyMessage.trim() !== '') return bodyMessage;
    }
    if (typeof body === 'string' && body.trim() !== '') return body;
    if (typeof asRecord.message === 'string' && asRecord.message.trim() !== '') {
      return asRecord.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** A REST failure that is HA's "not found" (HA's callApi or a plain fetch). */
function isNotFound(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    (error as { status_code?: unknown }).status_code === 404
  ) {
    return true;
  }
  return error instanceof Error && /\b404\b/.test(error.message);
}

/**
 * Home Assistant API abstraction layer
 * Works in both custom panel mode (with hass object) and standalone mode
 */
/** The REST path of an automation's config. Its id is encoded: one with a
 * `/`, `?` or `#` (hand-written in automations.yaml) was cut short or
 * split, so it read as missing, or as the automation whose id is the part
 * before it, and could be saved over (bug #242; checked in HA 2026.10,
 * which decodes the encoded id). */
export const automationConfigPath = (automationId: string): string =>
  `config/automation/config/${encodeURIComponent(automationId)}`;

export class HomeAssistantAPI {
  public hass: HomeAssistant | null = null;
  private baseUrl?: string;
  private token?: string;

  constructor(hass?: HomeAssistant, config?: { url?: string; token?: string }) {
    this.hass = hass || null;

    // Store base URL and token for REST API calls
    if (config?.url && config?.token) {
      this.baseUrl = config.url;
      this.token = config.token;
    } else if (typeof window !== 'undefined') {
      // In embedded mode, use current window location
      this.baseUrl = window.location.origin;
    }
  }

  /**
   * Update the hass reference (for when it changes)
   */
  updateHass(hass: HomeAssistant | null, config?: { url?: string; token?: string }) {
    this.hass = hass;

    // Update base URL and token if provided
    if (config?.url && config?.token) {
      this.baseUrl = config.url;
      this.token = config.token;
    } else if (typeof window !== 'undefined' && !this.baseUrl) {
      // In embedded mode, use current window location if not already set
      this.baseUrl = window.location.origin;
    }
  }

  /**
   * Check if we have a valid connection
   */
  isConnected(): boolean {
    if (!this.hass) return false;

    // Check for different possible API structures
    return !!(
      this.hass.connection ||
      this.hass.callApi ||
      this.hass.callService ||
      (this.hass.states && Object.keys(this.hass.states).length > 0)
    );
  }

  /**
   * Get all entity states
   */
  getStates(): Record<string, HassEntity> | null {
    if (!this.hass) return null;

    return this.hass.states;
  }

  /**
   * Get a specific entity state
   */
  getState(entityId: string): HassEntity | null {
    const states = this.getStates();
    return states?.[entityId] || null;
  }

  /**
   * Get all automation entities
   */
  getAutomations(): HassEntity[] {
    const states = this.getStates();
    if (!states) return [];

    return Object.values(states).filter((entity) => entity.entity_id.startsWith('automation.'));
  }

  private normalizeTags(tags: unknown): string[] {
    if (Array.isArray(tags)) {
      return tags.filter((tag): tag is string => typeof tag === 'string');
    }
    if (typeof tags === 'string' && tags.trim()) {
      return [tags];
    }
    return [];
  }

  /**
   * Send a websocket message
   */
  async sendMessage(message: Record<string, unknown> & { type: string }): Promise<unknown> {
    if (!this.hass?.connection) {
      throw new Error('No Home Assistant connection available');
    }

    return await this.hass.connection.sendMessagePromise(message);
  }

  /**
   * Call a Home Assistant service
   */
  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.hass?.callService) {
      // Use built-in service calling (custom panel mode)
      // Combine serviceData and target into data object for the interface
      const data = { ...serviceData, ...(target && { target }) };
      return await this.hass.callService(domain, service, data);
    }

    if (this.hass?.connection) {
      // Use websocket message
      return await this.sendMessage({
        type: 'call_service',
        domain,
        service,
        service_data: serviceData,
        target,
      });
    }

    throw new Error('No service calling method available');
  }

  /**
   * Execute a Home Assistant action
   * An action can be either a service call or other HA action types
   */
  async executeAction(action: {
    service?: string;
    data?: Record<string, unknown>;
    target?: Record<string, unknown>;
    [key: string]: unknown;
  }): Promise<unknown> {
    if (!action.service) {
      throw new Error('Action must have a service property');
    }

    const [domain, service] = action.service.split('.');
    if (!domain || !service) {
      throw new Error(`Invalid service format: ${action.service}`);
    }

    return await this.callService(domain, service, action.data, action.target);
  }

  /**
   * Call Home Assistant REST API
   */
  async callAPI(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.hass?.callApi) {
      // Use built-in API calling (custom panel mode)
      return await this.hass.callApi(method, path, data);
    } else {
      // In standalone mode, we'd need to implement HTTP requests
      // For now, throw an error as this requires auth tokens
      throw new Error('REST API calls not supported in standalone mode');
    }
  }

  /**
   * Fire a custom event on HA's event bus via the documented
   * `POST /api/events/<event_type>` REST endpoint — the same mechanism
   * Developer Tools > Events uses. Lets other automations/scripts react to
   * Circuitry-specific occurrences (e.g. `circuitry_automation_saved`).
   */
  async fireBusEvent(eventType: string, eventData?: Record<string, unknown>): Promise<void> {
    await this.callAPI('POST', `events/${eventType}`, eventData);
  }

  /**
   * Reports a lossy YAML import to Circuitry's backend, which files a Repair
   * issue (Settings > System > Repairs) so the finding survives past the
   * one-time toast. Best-effort — never blocks or fails the import itself.
   *
   * The service domain here MUST match custom_components/circuitry/const.py's
   * DOMAIN exactly — this isn't a cosmetic string, it's a real HA service
   * call (`hass.services.async_register(DOMAIN, ...)` in __init__.py). Left
   * as the old 'flode' domain after the Python side's rename, this would
   * silently fail every time (no matching service registered) rather than
   * erroring loudly, since it's caught and only best-effort logged below.
   */
  async reportImportIssue(entityId: string, warnings: string[]): Promise<void> {
    try {
      await this.callService('circuitry', 'report_import_issue', {
        entity_id: entityId,
        warnings,
      });
    } catch (error) {
      console.warn('Failed to report import issue:', error);
    }
  }

  /**
   * Fetch data from Home Assistant REST API
   * Uses built-in callApi in embedded mode, or direct fetch in remote mode
   */
  private async fetchRestAPI(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<unknown> {
    if (this.hass?.callApi) {
      // Embedded mode - use built-in callApi

      return await this.hass.callApi(method, path, body);
    }

    // Remote/standalone mode - use fetch
    if (!this.baseUrl || !this.token) {
      console.error('Circuitry: No authentication configured', {
        baseUrl: this.baseUrl,
        hasToken: !!this.token,
      });
      throw new Error('No authentication configured for REST API');
    }

    return restRequest(this.baseUrl, this.token, method, path, body);
  }

  /**
   * The automations HA has, as id, alias and description, read from their
   * entities (HA has no command that lists automation configs; the
   * `config/automation/list` this used to ask first doesn't exist).
   */
  async getAutomationConfigs(): Promise<AutomationConfig[]> {
    return this.getAutomations().map((entity) => ({
      id: entity.entity_id.replace('automation.', ''),
      alias:
        typeof entity.attributes.friendly_name === 'string'
          ? entity.attributes.friendly_name
          : entity.entity_id,
      description:
        typeof entity.attributes.description === 'string' ? entity.attributes.description : '',
    }));
  }

  /**
   * The entity of the automation with this id (its `id:`), from HA's states.
   */
  private automationEntityId(automationId: string): string | undefined {
    if (automationId.startsWith('automation.')) return automationId;
    return this.getAutomations().find((entity) => entity.attributes.id === automationId)?.entity_id;
  }

  /**
   * An automation's config, and whether it is kept in automations.yaml (so
   * it can be saved over), or null when HA can't give it. First the REST
   * config endpoint, which serves the automations in automations.yaml, then
   * HA's own `automation/config` (by entity id: any automation, wherever it
   * is defined; such a one isn't editable, as in HA's own editor). Nothing
   * else: the newest trace's config can be older than the automation, and a
   * stub built from its entity has no triggers or steps -- opened, either was
   * saved over the real automation (bug #204).
   */
  async readAutomation(
    automationId: string
  ): Promise<{ config: AutomationConfig; editable: boolean } | null> {
    if (!automationId.startsWith('automation.')) {
      try {
        const config = await this.fetchRestAPI(automationConfigPath(automationId));
        if (config && typeof config === 'object') {
          return { config: config as AutomationConfig, editable: true };
        }
      } catch (restError) {
        console.warn('Circuitry: REST API failed for automation %s:', automationId, restError);
      }
    }
    const entityId = this.automationEntityId(automationId);
    if (entityId && this.hass?.connection) {
      try {
        const result = await this.sendMessage({ type: 'automation/config', entity_id: entityId });
        const config = (result as { config?: unknown } | null)?.config;
        if (config && typeof config === 'object') {
          return { config: config as AutomationConfig, editable: false };
        }
      } catch (wsError) {
        console.warn('Circuitry: automation/config failed for %s:', entityId, wsError);
      }
    }
    return null;
  }

  /** An automation's config, or null when HA can't give it (see readAutomation). */
  async getAutomationConfig(automationId: string): Promise<AutomationConfig | null> {
    return (await this.readAutomation(automationId))?.config ?? null;
  }

  /**
   * Whether HA's REST config endpoint says it has no automation with this
   * id in automations.yaml (a 404) -- not merely that it couldn't be asked.
   */
  private async isMissingFromAutomationsYaml(automationId: string): Promise<boolean> {
    try {
      await this.fetchRestAPI(automationConfigPath(automationId));
      return false;
    } catch (error) {
      return isNotFound(error);
    }
  }

  /**
   * Create a new automation in Home Assistant
   */
  async createAutomation(config: AutomationConfig): Promise<string> {
    try {
      // Generate a numeric ID like Home Assistant uses
      const automationId = config.id || Date.now().toString();

      // Spread all fields from config so nothing is accidentally stripped,
      // then normalise the keys HA requires (plural trigger/condition/action forms).
      const { trigger, condition, action, ...rest } = config as Record<string, unknown>;
      const configWithId = {
        ...rest,
        id: automationId,
        alias: config.alias || `Circuitry Automation ${automationId}`,
        description: config.description || '',
        triggers: (trigger as unknown[] | undefined) || (config.triggers as unknown[]) || [],
        conditions: (condition as unknown[] | undefined) || (config.conditions as unknown[]) || [],
        actions: (action as unknown[] | undefined) || (config.actions as unknown[]) || [],
        mode: config.mode || 'single',
        variables: (config.variables as Record<string, unknown>) || {},
      };

      // Step 1: Create/save the automation configuration using REST API
      try {
        await this.fetchRestAPI(automationConfigPath(automationId), 'POST', configWithId);
      } catch (saveError) {
        console.error('Circuitry: Failed to save automation config:', saveError);
        throw new Error(`Failed to save automation config: ${extractApiErrorMessage(saveError)}`);
      }
      await this.confirmSaved(automationId, configWithId);

      // No reload on top: HA's config endpoint reloads the automation it
      // just wrote, so it is live at once. The full automation.reload this
      // used to call reloaded every automation, and when it failed the
      // automation was saved but reported as failed (bug #213).
      return automationId;
    } catch (error) {
      console.error('Circuitry: Failed to create automation:', error);
      // Taken but not confirmed: the caller needs the id it was taken under.
      if (error instanceof SavedUnconfirmedError) throw error;
      throw new Error(`Failed to create automation: ${extractApiErrorMessage(error)}`);
    }
  }

  /**
   * Update an existing automation in Home Assistant
   */
  async updateAutomation(automationId: string, config: AutomationConfig): Promise<void> {
    // HA writes a save into automations.yaml: over an automation kept
    // anywhere else it adds a second one with the same id, and HA then
    // ignores the real one (bug #205). HA's own editor refuses it too.
    if (await this.isMissingFromAutomationsYaml(automationId)) {
      // Gone from Home Assistant altogether (deleted while open), or kept
      // in another YAML file: only the latter still has its entity (told
      // only where the entities are known; with a token alone they aren't).
      const deleted = Boolean(this.getStates()) && !this.findAutomationEntityId(automationId);
      throw new Error(
        !deleted
          ? "Failed to update automation: it isn't kept in automations.yaml, so it can't be saved over (Home Assistant's own editor can't either). Save it as a new automation instead."
          : 'Failed to update automation: it no longer exists in Home Assistant (it was deleted). Save it as a new automation instead.'
      );
    }
    // Spread all fields from config so nothing is accidentally stripped,
    // then normalise the keys HA requires (plural trigger/condition/action forms).
    const { trigger, condition, action, ...rest } = config as Record<string, unknown>;
    const configWithId = {
      ...rest,
      id: automationId,
      alias: config.alias || `Circuitry Automation ${automationId}`,
      description: config.description || '',
      triggers: (trigger as unknown[] | undefined) || (config.triggers as unknown[]) || [],
      conditions: (condition as unknown[] | undefined) || (config.conditions as unknown[]) || [],
      actions: (action as unknown[] | undefined) || (config.actions as unknown[]) || [],
      mode: config.mode || 'single',
      variables: (config.variables as Record<string, unknown>) || {},
    };
    try {
      // Use POST method for updates (HA doesn't support PUT for automation config updates)
      await this.fetchRestAPI(automationConfigPath(automationId), 'POST', configWithId);
    } catch (error) {
      console.error('Circuitry: Failed to update automation:', error);
      throw new Error(`Failed to update automation: ${extractApiErrorMessage(error)}`);
    }
    await this.confirmSaved(automationId, configWithId);
  }

  /**
   * A save is confirmed, not assumed: the automation is read back from HA
   * and must be what was sent (HA's config endpoint stores exactly the
   * JSON it gets; checked in HA 2026.10), and its entity, once HA has set
   * it up, must not be unavailable (HA's "could not be validated", a
   * Repair issue with the reason). Either throws, so the tab stays unsaved
   * and the user saves again. With a token outside HA's frontend the
   * entities aren't known, so only the read-back decides there.
   */
  private async confirmSaved(automationId: string, sent: Record<string, unknown>): Promise<void> {
    let stored: unknown;
    try {
      stored = await this.fetchRestAPI(automationConfigPath(automationId));
    } catch (error) {
      // The write was acknowledged; a read that fails right after says
      // nothing about what was stored, so it isn't held against the save.
      console.warn('Circuitry: the saved automation could not be read back:', error);
      return;
    }
    const differs = firstDifference(sent, stored);
    if (differs !== null) {
      console.warn(
        `Circuitry: what Home Assistant stored differs from what was sent, at ${differs}:`,
        { sent, stored }
      );
      throw new SavedUnconfirmedError(
        `Saved, but what Home Assistant stored differs from what was sent (at ${differs}). Save again; if it happens again, check Home Assistant's log.`,
        automationId,
        stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
      );
    }
    if (!this.getStates()) return;
    // HA reloads the automation after answering the write, not before
    // (config/view.py schedules the hook), so its entity, and its state
    // after the reload, arrive a moment later.
    const entityId = await this.waitForAutomationEntity(automationId, 2000);
    if (!entityId) return;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const state = this.getStates()?.[entityId]?.state;
    if (state !== 'unavailable') return;
    throw new SavedUnconfirmedError(
      `Saved, but Home Assistant couldn't set the automation up: ${await this.validationReason(entityId)}`,
      automationId,
      sent
    );
  }

  /** HA's reason for an automation it couldn't validate, from its Repair issue. */
  private async validationReason(entityId: string): Promise<string> {
    try {
      const result = (await this.sendMessage({ type: 'repairs/list_issues' })) as {
        issues?: { issue_id?: string; translation_placeholders?: { error?: string } }[];
      };
      const issue = result?.issues?.find((i) => i.issue_id?.startsWith(`${entityId}_validation_`));
      if (issue?.translation_placeholders?.error) return issue.translation_placeholders.error;
    } catch {
      // No reason to be had: the state says enough.
    }
    return 'it is unavailable (see Settings > Repairs)';
  }

  /**
   * Delete an automation from Home Assistant
   */
  async deleteAutomation(automationId: string): Promise<void> {
    // Its entity, while it still has one: a "couldn't be read in full"
    // Repair issue for it is cleared with it (it stayed until HA
    // restarted, bug #251).
    const entityId = this.findAutomationEntityId(automationId);
    try {
      // Use the automation config DELETE endpoint
      await this.fetchRestAPI(automationConfigPath(automationId), 'DELETE');
    } catch (error) {
      console.error('Circuitry: Failed to delete automation:', error);
      throw new Error(`Failed to delete automation: ${extractApiErrorMessage(error)}`);
    }
    if (entityId) void this.reportImportIssue(entityId, []);
  }

  /**
   * Check if an automation with the given alias already exists
   */
  async automationExistsByAlias(alias: string): Promise<boolean> {
    try {
      const configs = await this.getAutomationConfigs();
      const exists = configs.some((config) => config.alias === alias);

      return exists;
    } catch (error) {
      console.error('Circuitry: Failed to check automation existence:', error);
      return false;
    }
  }

  /**
   * Get unique automation alias by appending number if needed
   */
  async getUniqueAutomationAlias(baseAlias: string): Promise<string> {
    try {
      let alias = baseAlias;
      let counter = 1;

      while (await this.automationExistsByAlias(alias)) {
        alias = `${baseAlias} (${counter})`;
        counter++;
      }

      return alias;
    } catch (error) {
      console.error('Circuitry: Failed to get unique automation alias:', error);
      return baseAlias;
    }
  }

  /**
   * Trigger an automation
   */
  async triggerAutomation(entityId: string, skipCondition = true): Promise<void> {
    await this.callService('automation', 'trigger', {
      entity_id: entityId,
      skip_condition: skipCondition,
    });
  }

  /**
   * Turn automation on/off
   */
  async setAutomationState(entityId: string, enabled: boolean): Promise<void> {
    const service = enabled ? 'turn_on' : 'turn_off';
    await this.callService('automation', service, {
      entity_id: entityId,
    });
  }

  /**
   * Get areas
   */
  async getAreas(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/area_registry/list' });
    } catch (error) {
      console.error('Failed to get areas:', error);
      return [];
    }
  }

  /**
   * Get devices
   */
  async getDevices(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/device_registry/list' });
    } catch (error) {
      console.error('Failed to get devices:', error);
      return [];
    }
  }

  /**
   * List categories for a given scope (e.g. "automation").
   */
  async getCategories(scope: string): Promise<{ category_id: string; name: string }[]> {
    try {
      const result = await this.sendMessage({ type: 'config/category_registry/list', scope });
      return Array.isArray(result) ? (result as { category_id: string; name: string }[]) : [];
    } catch (error) {
      console.error('Failed to get categories:', error);
      return [];
    }
  }

  /**
   * Create a new category in a given scope. Used by Circuitry's own category
   * field when the native `ha-category-picker` (which handles creation
   * itself) isn't available in this browser tab.
   */
  async createCategory(
    scope: string,
    name: string
  ): Promise<{ category_id: string; name: string }> {
    return (await this.sendMessage({
      type: 'config/category_registry/create',
      scope,
      name,
    })) as { category_id: string; name: string };
  }

  /**
   * Get entities registry
   */
  async getEntities(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'config/entity_registry/list' });
    } catch (error) {
      console.error('Failed to get entities:', error);
      return [];
    }
  }

  /**
   * Get the extended entity registry entry (area/labels/categories/icon) for a single entity.
   */
  async getEntityRegistryEntry(entityId: string): Promise<ExtendedEntityRegistryEntry | null> {
    try {
      return (await this.sendMessage({
        type: 'config/entity_registry/get',
        entity_id: entityId,
      })) as ExtendedEntityRegistryEntry;
    } catch (error) {
      console.error('Failed to get entity registry entry:', error);
      return null;
    }
  }

  /**
   * Update area/labels/categories/icon on an entity registry entry.
   */
  async updateEntityRegistryEntry(
    entityId: string,
    updates: EntityRegistryEntryUpdate
  ): Promise<void> {
    await this.sendMessage({
      type: 'config/entity_registry/update',
      entity_id: entityId,
      ...updates,
    });
  }

  /**
   * Find an automation's entity_id from its config id, by matching the
   * `id` state attribute HA exposes on automation entities (same value as
   * the entity registry's `unique_id`, but readable straight off `states`
   * without an extra round-trip).
   */
  findAutomationEntityId(automationId: string): string | null {
    const match = this.getAutomations().find(
      (entity) =>
        String(entity.attributes.id ?? '') === automationId ||
        entity.entity_id === `automation.${automationId}`
    );
    return match?.entity_id ?? null;
  }

  /**
   * Same as `findAutomationEntityId`, but polls briefly — needed right after
   * creating a new automation, where `automation.reload` has resolved but the
   * resulting entity's state may not have propagated to `hass.states` yet.
   */
  async waitForAutomationEntity(automationId: string, timeoutMs = 5000): Promise<string | null> {
    const immediate = this.findAutomationEntityId(automationId);
    if (immediate) return immediate;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const found = this.findAutomationEntityId(automationId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Get zones from current states
   */
  async getZones(): Promise<ZoneCatalogItem[]> {
    try {
      const states = this.getStates();
      if (!states) return [];

      return Object.values(states)
        .filter((entity) => entity.entity_id.startsWith('zone.'))
        .map((entity) => {
          const zoneId = entity.entity_id.replace('zone.', '');
          return {
            entity_id: entity.entity_id,
            zone_id: zoneId,
            name:
              typeof entity.attributes.friendly_name === 'string'
                ? entity.attributes.friendly_name
                : zoneId,
            latitude:
              typeof entity.attributes.latitude === 'number'
                ? entity.attributes.latitude
                : undefined,
            longitude:
              typeof entity.attributes.longitude === 'number'
                ? entity.attributes.longitude
                : undefined,
            radius:
              typeof entity.attributes.radius === 'number' ? entity.attributes.radius : undefined,
            passive:
              typeof entity.attributes.passive === 'boolean'
                ? entity.attributes.passive
                : undefined,
          };
        });
    } catch (error) {
      console.error('Failed to get zones:', error);
      return [];
    }
  }

  /**
   * Build a normalized automation catalog for import/explorer views
   */
  async getAutomationCatalog(): Promise<AutomationCatalogItem[]> {
    try {
      const [entityRegistryResult] = await Promise.all([this.getEntities()]);
      const entityRegistry = Array.isArray(entityRegistryResult)
        ? (entityRegistryResult as EntityRegistryEntry[])
        : [];

      const entityIdToAreaId = new Map<string, string>();
      for (const entry of entityRegistry) {
        if (entry.entity_id && entry.area_id) {
          entityIdToAreaId.set(entry.entity_id, entry.area_id);
        }
      }

      return this.getAutomations().map((entity) => {
        const friendlyName =
          typeof entity.attributes.friendly_name === 'string'
            ? entity.attributes.friendly_name
            : entity.entity_id;
        const automationId =
          typeof entity.attributes.id === 'string' || typeof entity.attributes.id === 'number'
            ? String(entity.attributes.id)
            : entity.entity_id.replace('automation.', '');

        return {
          entity_id: entity.entity_id,
          automation_id: automationId,
          friendly_name: friendlyName,
          enabled: entity.state === 'on',
          last_triggered:
            typeof entity.attributes.last_triggered === 'string'
              ? entity.attributes.last_triggered
              : undefined,
          description:
            typeof entity.attributes.description === 'string' ? entity.attributes.description : '',
          mode: typeof entity.attributes.mode === 'string' ? entity.attributes.mode : undefined,
          area_id: entityIdToAreaId.get(entity.entity_id),
          tags: this.normalizeTags(entity.attributes.tags),
        } satisfies AutomationCatalogItem;
      });
    } catch (error) {
      console.error('Failed to build automation catalog:', error);
      return [];
    }
  }

  /**
   * Get multiple automation configurations with bounded concurrency
   */
  async getAutomationConfigsBatch(
    ids: string[],
    maxConcurrency = 4
  ): Promise<Record<string, AutomationConfig | null>> {
    const automationIds = Array.from(new Set(ids.filter(Boolean)));
    const results: Record<string, AutomationConfig | null> = {};
    if (automationIds.length === 0) {
      return results;
    }

    const queue = [...automationIds];
    const workerCount = Math.max(1, Math.min(maxConcurrency, queue.length));

    const workers = Array.from({ length: workerCount }).map(async () => {
      while (queue.length > 0) {
        const nextId = queue.shift();
        if (!nextId) {
          continue;
        }

        try {
          results[nextId] = await this.getAutomationConfig(nextId);
        } catch (error) {
          console.warn('Failed to fetch automation config for %s:', nextId, error);
          results[nextId] = null;
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Get services
   */
  async getServices(): Promise<unknown | []> {
    try {
      return await this.sendMessage({ type: 'get_services' });
    } catch (error) {
      console.error('Failed to get services:', error);
      return {};
    }
  }

  /**
   * Validate automation config
   */
  async validateAutomationConfig(config: {
    trigger?: Record<string, unknown>[];
    condition?: Record<string, unknown>[];
    action?: Record<string, unknown>[];
  }): Promise<unknown> {
    try {
      return await this.sendMessage({
        type: 'validate_config',
        ...config,
      });
    } catch (error) {
      console.error('Failed to validate config:', error);
      return { valid: false, error: 'Validation failed' };
    }
  }

  /**
   * Get automation trace list
   */
  async getAutomationTraces(automationId: string): Promise<TraceListItem[]> {
    try {
      const result = await this.sendMessage({
        type: 'trace/list',
        domain: 'automation',
        item_id: automationId,
      });
      return (Array.isArray(result) ? result : []) as TraceListItem[];
    } catch (error) {
      console.error('Failed to get automation traces:', error);
      return [];
    }
  }

  /**
   * Get specific automation trace details
   */
  async getAutomationTraceDetails(
    automationId: string,
    runId: string
  ): Promise<AutomationTrace | null> {
    try {
      const result = await this.sendMessage({
        type: 'trace/get',
        domain: 'automation',
        item_id: automationId,
        run_id: runId,
      });
      return (result as AutomationTrace) || null;
    } catch (error) {
      console.error('Failed to get automation trace details:', error);
      return null;
    }
  }
}

// Global API instance
let haAPI: HomeAssistantAPI | null = null;

/**
 * Get the global Home Assistant API instance
 */
export function getHomeAssistantAPI(
  hass?: HomeAssistant,
  config?: { url?: string; token?: string }
): HomeAssistantAPI {
  if (!haAPI) {
    haAPI = new HomeAssistantAPI(hass, config);
  } else {
    // Only update if we have a valid hass object or if the current one is null/empty
    const shouldUpdate =
      hass &&
      (!haAPI.hass || !haAPI.isConnected() || (hass.states && Object.keys(hass.states).length > 0));

    if (shouldUpdate) {
      haAPI.updateHass(hass ?? null, config);
    }
  }
  return haAPI;
}

/**
 * Initialize API for standalone mode
 */
export function initializeStandaloneAPI(): HomeAssistantAPI {
  haAPI = new HomeAssistantAPI();
  return haAPI;
}

/**
 * Reset the API instance (useful for testing)
 */
export function resetAPI(): void {
  haAPI = null;
}
