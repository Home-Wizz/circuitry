import type { NodeValidationError } from '@circuitry/shared';
import type { HassServices } from 'home-assistant-js-websocket';
import { isEmptyValue, isRecord } from '@/lib/utils';
import { serviceFieldList } from '@/lib/serviceFields';

/**
 * An action's service fields HA needs (#125). HA saves an automation whose
 * step leaves one out, and the step fails when it runs; so the editor warns
 * (never an error: decision D3, the editor blocks only what HA refuses).
 * Read from the connected HA's own service descriptions, the ones the
 * action panel renders its fields from, corrected where HA's schema needs
 * other than they mark (#131: a thermostat's HVAC mode, one of a
 * thermostat's target temperatures, ...).
 */

/** What an action step must give for its service to run (#125, #131):
 * each of `fields`, and, when there are `oneOf` ways, every field of one of
 * them. */
export interface ServiceNeeds {
  fields: string[];
  oneOf: string[][];
}

/** Each service's needs: `domain.service` -> what a step must give. */
export type ServiceRequiredFields = Record<string, ServiceNeeds>;

/**
 * Where HA's schema needs other than its description marks required (#131),
 * the same in HA 2025.8 through 2026.9. Read from a real HA (each
 * service's schema, given an empty step and then the fields it asks for);
 * the service-needs tests hold the editor's needs to that HA's on every
 * service it has.
 */
const UNDESCRIBED_NEEDS: Record<string, Partial<ServiceNeeds>> = {
  'assist_satellite.announce': { oneOf: [['message'], ['media_id']] },
  'assist_satellite.ask_question': { oneOf: [['question'], ['question_media_id']] },
  'assist_satellite.start_conversation': { oneOf: [['start_message'], ['start_media_id']] },
  'calendar.create_event': {
    oneOf: [['start_date', 'end_date'], ['start_date_time', 'end_date_time'], ['in']],
  },
  'calendar.get_events': { oneOf: [['end_date_time'], ['duration']] },
  'climate.set_hvac_mode': { fields: ['hvac_mode'] },
  'climate.set_temperature': { oneOf: [['temperature'], ['target_temp_high', 'target_temp_low']] },
  'input_datetime.set_datetime': { oneOf: [['date'], ['time'], ['datetime'], ['timestamp']] },
  'media_player.select_sound_mode': { fields: ['sound_mode'] },
  'scene.create': { oneOf: [['entities'], ['snapshot_entities']] },
  'todo.update_item': {
    oneOf: [['rename'], ['status'], ['due_date'], ['due_datetime'], ['description']],
  },
};

/** Fields HA's description marks required that HA runs the step without:
 * timer.change's duration defaults to 0. */
const DESCRIBED_NOT_NEEDED: Record<string, string[]> = {
  'timer.change': ['duration'],
};

/** Each service's fields HA's description marks required (every service it
 * describes, with none for those without). */
export function describedRequiredFields(services: HassServices): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [domain, domainServices] of Object.entries(services ?? {})) {
    for (const [service, description] of Object.entries(domainServices ?? {})) {
      out[`${domain}.${service}`] = serviceFieldList(description?.fields)
        .filter(([, field]) => field.required === true)
        .map(([name]) => name);
    }
  }
  return out;
}

/** Each described service's needs: the fields its description marks
 * required, corrected where HA's schema says otherwise. */
export function serviceNeeds(described: Record<string, string[]>): ServiceRequiredFields {
  const out: ServiceRequiredFields = {};
  for (const [service, fields] of Object.entries(described)) {
    const notNeeded = DESCRIBED_NOT_NEEDED[service] ?? [];
    const extra = UNDESCRIBED_NEEDS[service] ?? {};
    const needs = {
      fields: [...fields.filter((f) => !notNeeded.includes(f)), ...(extra.fields ?? [])],
      oneOf: extra.oneOf ?? [],
    };
    if (needs.fields.length > 0 || needs.oneOf.length > 0) out[service] = needs;
  }
  return out;
}

export function requiredServiceFields(services: HassServices): ServiceRequiredFields {
  return serviceNeeds(describedRequiredFields(services));
}

const isEmpty = isEmptyValue;

/** A warning for each required field an action step leaves empty, and for
 * each field of a group none of whose ways it gives in full. A field given
 * in the step's target (an `entity_id`) counts. */
export function serviceFieldIssues(
  data: Record<string, unknown>,
  required: ServiceRequiredFields
): NodeValidationError[] {
  const service = typeof data.service === 'string' ? data.service : undefined;
  const needs = service ? required[service] : undefined;
  if (!needs) return [];
  const given = {
    ...(isRecord(data.target) ? data.target : {}),
    ...(isRecord(data.data) ? data.data : {}),
  };
  const empty = (field: string) => isEmpty(given[field]);
  const warning = (field: string, message: string): NodeValidationError => ({
    path: ['data', field],
    message,
    severity: 'warning',
  });
  const missing = needs.fields
    .filter(empty)
    .map((f) => warning(f, 'errors:validation.action.fieldEmpty'));
  const wayGiven = needs.oneOf.some((way) => !way.some(empty));
  const groupFields = wayGiven ? [] : [...new Set(needs.oneOf.flat())].filter(empty);
  return [...missing, ...groupFields.map((f) => warning(f, 'errors:validation.action.oneOfEmpty'))];
}
