import type { FlowNode } from '@circuitry/shared';

/**
 * Normalizes a leaf action/delay/wait/set_variables step into the same
 * "compiled YAML step" shape on both sides of the comparison, so
 * `behaviorProgram.ts`'s plain deep-equal can compare them directly.
 *
 * The candidate side already IS that shape -- it's the literal parsed
 * output of NativeStrategy's own builders (buildActionCall/buildDelay/
 * buildWait/buildSetVariables in native.ts), so extractFromYaml.ts only
 * needs to strip cosmetic fields from it (see yamlStepToCompiledShape
 * below). The graph side starts from a canvas node's own `data` (an
 * HAActionSchema/HADelaySchema/HAWaitSchema/HAVariablesSchema shape, which
 * differs from the compiled shape -- e.g. `service` vs. compiled `action`,
 * a device action's fields nested under `data.data` vs. compiled top-
 * level, `id` present vs. compiled always dropping it) and must be mapped
 * into the same compiled shape independently here (graphActionToCompiled
 * below).
 *
 * This file's mapping rules are transcribed directly from native.ts's own
 * buildActionCall/buildDelay/buildWait/buildSetVariables (read in full
 * this session, not from memory) -- but implemented as fresh, separate
 * code rather than calling into those methods. That distinction matters:
 * calling into NativeStrategy's own builders here would make this
 * comparison trivially blind to any bug IN those builders (both "sides"
 * would run the exact same buggy code), which is exactly the "shared
 * blind spot" the maintainer rejected option (a) over. A field-name transcription
 * mistake made independently here, by contrast, shows up as a genuine
 * comparison mismatch instead of disappearing.
 */

const KNOWN_DEVICE_FIELDS = ['type', 'device_id', 'domain', 'entity_id', 'subtype'];

function stripInternal<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_'))) as T;
}

/** Mirrors BaseStrategy.hasMeaningfulDuration exactly (see base.ts's doc
 * comment for the full HA-issue-backed rationale) -- a literal all-zero
 * timeout is "give up instantly," not "no timeout," so it's only kept when
 * at least one field is a positive number. */
function hasMeaningfulDuration(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return /[1-9]/.test(value);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => {
      const n = typeof v === 'string' ? Number(v) : v;
      return typeof n === 'number' && !Number.isNaN(n) && n > 0;
    });
  }
  return false;
}

/** Mirrors BaseStrategy.cleanTriggerFields + foldEventContextUserId. */
function cleanTrigger(trigger: Record<string, unknown>): Record<string, unknown> {
  const cleaned = Object.fromEntries(
    Object.entries(trigger).filter(([key, v]) => {
      if (v === undefined || v === '') return false;
      if (v === null) return key === 'from' || key === 'to';
      return true;
    })
  );
  if (typeof cleaned.context_user_id === 'string' && cleaned.context_user_id) {
    const { context_user_id, ...rest } = cleaned;
    return { ...rest, context: { user_id: context_user_id } };
  }
  return cleaned;
}

function isDeviceActionData(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'device_id' in data &&
    'domain' in data
  );
}

/**
 * Graph side: maps a canvas node's own `data` into the same compiled shape
 * NativeStrategy's builders would emit for it. Only ever called for
 * 'action' | 'delay' | 'wait' | 'set_variables' nodes.
 */
export function graphActionToCompiled(node: FlowNode): Record<string, unknown> {
  if (node.type === 'delay') {
    const { id: _id, delay: delayValue, ...extra } = stripInternal(node.data as Record<string, unknown>);
    return { ...extra, delay: delayValue };
  }

  if (node.type === 'wait') {
    const {
      id: _id,
      wait_template,
      wait_for_trigger,
      timeout,
      continue_on_timeout,
      ...extra
    } = stripInternal(node.data as Record<string, unknown>);
    const out: Record<string, unknown> = { ...extra };
    if (wait_template) {
      out.wait_template = wait_template;
    } else if (Array.isArray(wait_for_trigger)) {
      out.wait_for_trigger = wait_for_trigger.map((t) => cleanTrigger(t as Record<string, unknown>));
    }
    if (hasMeaningfulDuration(timeout)) out.timeout = timeout;
    if (continue_on_timeout !== undefined) out.continue_on_timeout = continue_on_timeout;
    return out;
  }

  if (node.type === 'set_variables') {
    const { id: _id, variables, ...extra } = stripInternal(node.data as Record<string, unknown>);
    return { ...extra, variables };
  }

  // 'action' node -- one of: device action, opaque fallback repeat, fire
  // event, stop, or a standard service call.
  const data = stripInternal(node.data as Record<string, unknown>);

  if (isDeviceActionData(data.data)) {
    const deviceData = data.data as Record<string, unknown>;
    const out: Record<string, unknown> = {
      device_id: deviceData.device_id,
      domain: deviceData.domain,
      type: deviceData.type,
    };
    if (deviceData.entity_id) out.entity_id = deviceData.entity_id;
    if (deviceData.subtype) out.subtype = deviceData.subtype;
    for (const [key, value] of Object.entries(deviceData)) {
      if (!KNOWN_DEVICE_FIELDS.includes(key) && value !== undefined) out[key] = value;
    }
    if (data.enabled === false) out.enabled = false;
    return out;
  }

  if (data.repeat && typeof data.repeat === 'object') {
    // A fallback repeat action node -- this exists as an opaque single
    // node on the canvas (YamlParser couldn't decompose it into a real
    // condition/back-edge loop), but represents exactly the same `repeat:`
    // construct as one that IS decomposed. Callers detect this via the
    // presence of `repeat` and route it to the same BStep 'repeat' path a
    // decomposed loop uses (see extractFromGraph.ts) rather than treating
    // it as a plain action -- this function only produces its raw content.
    return data;
  }

  if (typeof data.event === 'string' && data.event.trim() !== '') {
    const out: Record<string, unknown> = { event: data.event };
    if (data.event_data && Object.keys(data.event_data as object).length > 0) {
      out.event_data = data.event_data;
    }
    if (data.continue_on_error) out.continue_on_error = data.continue_on_error;
    if (data.enabled === false) out.enabled = false;
    return out;
  }

  if ('stop' in data) {
    const out: Record<string, unknown> = { stop: data.stop ?? '' };
    if (data.error === true) out.error = true;
    if (data.response_variable) out.response_variable = data.response_variable;
    if (data.continue_on_error) out.continue_on_error = data.continue_on_error;
    if (data.enabled === false) out.enabled = false;
    return out;
  }

  // Standard service call.
  const {
    service,
    action: _originalActionKey,
    id: _id,
    target,
    data: svcData,
    data_template,
    response_variable,
    continue_on_error,
    enabled,
    repeat: _repeat,
    ...extraProps
  } = data;
  const out: Record<string, unknown> = { ...extraProps, action: service };
  if (target) out.target = target;
  if (svcData && Object.keys(svcData as object).length > 0) out.data = svcData;
  if (data_template) out.data_template = data_template;
  if (response_variable) out.response_variable = response_variable;
  if (continue_on_error) out.continue_on_error = continue_on_error;
  if (enabled === false) out.enabled = false;
  return out;
}

/**
 * YAML side: the parsed step object already IS the compiled shape (it's
 * literally what NativeStrategy wrote, parsed back into a JS object), so
 * this only strips cosmetic fields (see behaviorProgram.ts's
 * normalizeActionData, which both sides also pass through afterward).
 */
export function yamlStepToCompiled(step: Record<string, unknown>): Record<string, unknown> {
  return stripInternal(step);
}

/** True if a graph action-node's `data` represents an opaque fallback
 * repeat block rather than a real leaf action (see graphActionToCompiled's
 * 'repeat' branch above). */
export function isFallbackRepeatNodeData(data: Record<string, unknown>): boolean {
  return Boolean(data.repeat && typeof data.repeat === 'object');
}
