import type { NodeValidationError } from '@circuitry/shared';
import type { HassServices } from 'home-assistant-js-websocket';
import { isRecord } from '@/lib/utils';

/**
 * An action's service fields HA needs (#125). HA saves an automation whose
 * step leaves one out, and the step fails when it runs; so the editor warns
 * (never an error: decision D3, the editor blocks only what HA refuses).
 * Read from the connected HA's own service descriptions, the ones the
 * action panel renders its fields from.
 */

/** Each service's required fields: `domain.service` -> field names. */
export type ServiceRequiredFields = Record<string, string[]>;

/** A service's fields, with a section's (`fields:` inside a field) flattened. */
function flatFields(fields: unknown): [string, Record<string, unknown>][] {
  if (!isRecord(fields)) return [];
  return Object.entries(fields).flatMap(([name, field]) => {
    if (!isRecord(field)) return [];
    return isRecord(field.fields) ? flatFields(field.fields) : [[name, field] as [string, Record<string, unknown>]];
  });
}

export function requiredServiceFields(services: HassServices): ServiceRequiredFields {
  const out: ServiceRequiredFields = {};
  for (const [domain, domainServices] of Object.entries(services ?? {})) {
    for (const [service, description] of Object.entries(domainServices ?? {})) {
      const required = flatFields(description?.fields)
        .filter(([, field]) => field.required === true)
        .map(([name]) => name);
      if (required.length > 0) out[`${domain}.${service}`] = required;
    }
  }
  return out;
}

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0);

/** A warning for each required field an action step leaves empty. A field
 * given in the step's target (an `entity_id`) counts. */
export function serviceFieldIssues(
  data: Record<string, unknown>,
  required: ServiceRequiredFields
): NodeValidationError[] {
  const service = typeof data.service === 'string' ? data.service : undefined;
  if (!service) return [];
  const given = { ...(isRecord(data.target) ? data.target : {}), ...(isRecord(data.data) ? data.data : {}) };
  return (required[service] ?? [])
    .filter((field) => isEmpty(given[field]))
    .map((field) => ({
      path: ['data', field],
      message: 'errors:validation.action.fieldEmpty',
      severity: 'warning' as const,
    }));
}
