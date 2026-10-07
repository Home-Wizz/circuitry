import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/input';
import { HaSelector } from '@/ha';
import { useTranslations } from '@/hooks/useTranslations';
import { describedExtraFields, describedFieldNeeded } from '@/lib/describedFields';
import type { NativeDescription } from '@/lib/nativeDescriptions';
import { prettify } from '@/lib/utils';

const TEXT_CATEGORIES = ['triggers', 'conditions'] as const;

interface DescribedOptionFieldsProps {
  kind: 'trigger' | 'condition';
  type: string;
  description: NativeDescription | null | undefined;
  /** The options the panel renders itself (lib/describedFields.ts). */
  handled: ReadonlySet<string>;
  options: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

/**
 * The options the connected HA describes for a purpose-specific trigger or
 * condition that the panel has no editor of its own for, each rendered by
 * HA's own selector (`ha-selector`) with HA's name and help text for it --
 * the way HA's own editor renders them: every field of a type discovered
 * from HA's descriptions (lib/haCatalog.ts), and an older HA's threshold
 * bounds (`above`/`below`, `threshold_type`/`lower_limit`/`upper_limit`,
 * where the panel's threshold editor steps aside: describedThresholdShape).
 * On HA 2026.9 the panel's own editors cover every field of the catalog's
 * types (ha-catalog-fields.test.tsx). Outside HA (no `ha-selector`), a
 * plain text field.
 */
export function DescribedOptionFields({
  kind,
  type,
  description,
  handled,
  options,
  onChange,
}: DescribedOptionFieldsProps) {
  const { translations } = useTranslations(TEXT_CATEGORIES);
  const fields = describedExtraFields(description, handled);
  if (fields.length === 0) return null;
  const dot = type.indexOf('.');
  const prefix = `component.${type.slice(0, dot)}.${kind}s.${type.slice(dot + 1)}.fields`;
  return (
    <>
      {fields.map(([key, field]) => {
        const value = options[key] ?? field.default;
        const needed = describedFieldNeeded(field);
        return (
          <FormField
            key={key}
            label={translations[`${prefix}.${key}.name`] || prettify(key)}
            description={translations[`${prefix}.${key}.description`]}
            required={needed}
          >
            <HaSelector
              selector={field.selector}
              value={value}
              required={needed}
              onChange={(v) => onChange(key, v)}
              fallback={
                <Input
                  value={
                    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
                  }
                  onChange={(e) => onChange(key, e.target.value || undefined)}
                />
              }
            />
          </FormField>
        );
      })}
    </>
  );
}
