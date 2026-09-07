import type { HAScriptField, StartNode } from '@circuitry/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HaSelect, HaSelector, HaSwitch } from '@/ha';
import { getNodeDataObject } from '@/utils/nodeData';

interface StartFieldsProps {
  node: StartNode;
  onChange: (key: string, value: unknown) => void;
}

/**
 * Common HA selector types worth exposing here — a small, curated subset
 * (not the full HA `selector:` schema, which has ~30 types, many needing
 * their own dedicated config UI e.g. `select`'s options list) chosen to
 * cover the field types real scripts commonly declare. Stored as
 * `field.selector = { [type]: {} }`, exactly HA's own wire shape —
 * `HAScriptFieldSchema` already declares `selector: z.record(...).optional()`,
 * so this was always representable in the data model; only the UI to set it
 * was missing.
 */
const FIELD_TYPES = ['text', 'number', 'boolean', 'entity', 'time', 'date'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

function getFieldType(field: HAScriptField): FieldType {
  const selector = field.selector;
  if (selector) {
    const key = Object.keys(selector)[0];
    if ((FIELD_TYPES as readonly string[]).includes(key)) return key as FieldType;
  }
  return 'text';
}

/**
 * Start node field component — editor for the script's `fields:` block
 * (Start-block input parameters). Each entry is a typed input
 * parameter other flows, dashboards, or voice assistants can pass in when
 * calling this flow; downstream nodes reference it as `{{ <key> }}` exactly
 * like any other HA script field.
 *
 * Previously scoped to only name/description/required/default (plain text)
 * with no `selector:` at all — real HA's `selector:` schema is how a
 * script's Start-block input renders as a typed widget (a number slider, an
 * entity picker, ...) rather than a bare text box everywhere it's used
 * (voice assistants, dashboards, other flows calling this one). The `Field
 * type` picker below sets a minimal `selector`; the Default value input then
 * renders through that same selector via HaSelector.
 */
export function StartFields({ node, onChange }: StartFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const fields = getNodeDataObject<Record<string, HAScriptField>>(node, 'fields', {});
  const fieldEntries = Object.entries(fields);

  const commitFields = (next: Record<string, HAScriptField>) => onChange('fields', next);

  const handleAddField = () => {
    const existingKeys = Object.keys(fields);
    let newKey = 'input';
    let counter = 1;
    while (existingKeys.includes(newKey)) {
      newKey = `input_${counter}`;
      counter++;
    }
    commitFields({ ...fields, [newKey]: { name: '', required: false, selector: { text: {} } } });
  };

  const handleKeyChange = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey.trim()) return;
    const next: Record<string, HAScriptField> = {};
    for (const [key, value] of Object.entries(fields)) {
      next[key === oldKey ? newKey : key] = value;
    }
    commitFields(next);
  };

  const handleFieldChange = (key: string, patch: Partial<HAScriptField>) => {
    commitFields({ ...fields, [key]: { ...fields[key], ...patch } });
  };

  const handleFieldTypeChange = (key: string, newType: string) => {
    // Switching type clears the old default value — a boolean default
    // ("true") and a number default ("42") aren't interchangeable, so
    // carrying it across would just produce a mismatched value.
    commitFields({
      ...fields,
      [key]: { ...fields[key], selector: { [newType]: {} }, default: undefined },
    });
  };

  const handleDeleteField = (keyToDelete: string) => {
    const next = { ...fields };
    delete next[keyToDelete];
    commitFields(next);
  };

  return (
    <div className="space-y-4">
      {fieldEntries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('nodes:startFields.empty')}</p>
      ) : (
        fieldEntries.map(([key, field], index) => (
          <div key={`${key}-${index}`} className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-muted-foreground text-xs">
                {t('nodes:startFields.fieldLabel', { index: index + 1 })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteField(key)}
                className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="space-y-3">
              <FormField label={t('nodes:startFields.key')}>
                <Input
                  value={key}
                  onChange={(e) => handleKeyChange(key, e.target.value)}
                  placeholder={t('nodes:startFields.keyPlaceholder')}
                  className="font-mono text-sm"
                />
              </FormField>

              <FormField label={t('nodes:startFields.name')}>
                <Input
                  value={field.name ?? ''}
                  onChange={(e) => handleFieldChange(key, { name: e.target.value })}
                  placeholder={t('nodes:startFields.namePlaceholder')}
                />
              </FormField>

              <FormField label={t('nodes:startFields.description')}>
                <Textarea
                  value={field.description ?? ''}
                  onChange={(e) => handleFieldChange(key, { description: e.target.value })}
                  placeholder={t('nodes:startFields.descriptionPlaceholder')}
                  rows={2}
                />
              </FormField>

              <FormField label={t('nodes:startFields.fieldType')}>
                <HaSelect
                  value={getFieldType(field)}
                  onChange={(v) => handleFieldTypeChange(key, String(v))}
                  options={FIELD_TYPES.map((ft) => ({
                    value: ft,
                    label: t(`nodes:startFields.fieldTypes.${ft}`),
                  }))}
                  fallback={
                    <Select
                      value={getFieldType(field)}
                      onValueChange={(v) => handleFieldTypeChange(key, v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((ft) => (
                          <SelectItem key={ft} value={ft}>
                            {t(`nodes:startFields.fieldTypes.${ft}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
              </FormField>

              <FormField label={t('nodes:startFields.default')}>
                {getFieldType(field) === 'boolean' ? (
                  <HaSwitch
                    checked={field.default === true || field.default === 'true'}
                    onChange={(checked) => handleFieldChange(key, { default: checked })}
                    fallback={
                      <Switch
                        checked={field.default === true || field.default === 'true'}
                        onCheckedChange={(checked) => handleFieldChange(key, { default: checked })}
                      />
                    }
                  />
                ) : (
                  <HaSelector
                    selector={field.selector ?? { text: {} }}
                    value={field.default}
                    onChange={(v) => handleFieldChange(key, { default: v })}
                    fallback={
                      <Input
                        value={field.default != null ? String(field.default) : ''}
                        onChange={(e) => handleFieldChange(key, { default: e.target.value })}
                        placeholder={t('nodes:startFields.defaultPlaceholder')}
                        className="font-mono text-sm"
                      />
                    }
                  />
                )}
              </FormField>

              <FormField label={t('nodes:startFields.required')}>
                <Switch
                  checked={field.required ?? false}
                  onCheckedChange={(checked) => handleFieldChange(key, { required: checked })}
                />
              </FormField>
            </div>
          </div>
        ))
      )}

      <Button variant="outline" onClick={handleAddField} className="w-full gap-2" size="sm">
        <Plus className="h-4 w-4" />
        {t('nodes:startFields.addField')}
      </Button>
    </div>
  );
}
