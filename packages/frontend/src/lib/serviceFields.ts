import { isRecord } from '@/lib/utils';

/**
 * A service's fields as Home Assistant describes them, in order, with a
 * section's fields in its place: HA groups some fields into a section (a
 * field holding `fields:` of its own, e.g. light.turn_on's
 * `additional_fields`, "Advanced options"), and the section itself is never
 * a field of the service call.
 */
export function serviceFieldList(fields: unknown): [string, Record<string, unknown>][] {
  if (!isRecord(fields)) return [];
  return Object.entries(fields).flatMap(([name, field]) => {
    if (!isRecord(field)) return [];
    return isRecord(field.fields)
      ? serviceFieldList(field.fields)
      : [[name, field] as [string, Record<string, unknown>]];
  });
}

/** A select selector's options as value and label (HA allows bare strings). */
export function selectOptions(config: unknown): { value: string; label: string }[] {
  const options = isRecord(config) && Array.isArray(config.options) ? config.options : [];
  return options.flatMap((opt) => {
    if (typeof opt === 'string') return [{ value: opt, label: opt }];
    if (isRecord(opt) && typeof opt.value === 'string')
      return [{ value: opt.value, label: typeof opt.label === 'string' ? opt.label : opt.value }];
    return [];
  });
}

/**
 * The service call's data with one field set, as the property panel writes
 * it: a cleared field ("" or nothing) is taken out, and no data at all is
 * no `data:`.
 */
export function withServiceDataField(
  data: unknown,
  field: string,
  value: unknown
): Record<string, unknown> | undefined {
  const next = { ...(isRecord(data) ? data : {}), [field]: value };
  const kept = Object.fromEntries(
    Object.entries(next).filter(([, v]) => v !== undefined && v !== '')
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}
