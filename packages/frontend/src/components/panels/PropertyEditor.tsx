import type { FlowNode } from '@circuitry/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HaSelect, HaSwitch } from '@/ha';
import { type PropertyType, usePropertyEditor } from '@/hooks/usePropertyEditor';

interface PropertyEditorProps {
  node: FlowNode;
  handledProperties: Set<string>;
  onChange: (key: string, value: unknown) => void;
  onDelete: (key: string) => void;
}

/**
 * Property editor component for managing additional/unhandled properties.
 * Extracts the 150-line "Additional Properties" section from PropertyPanel.
 */
export function PropertyEditor({
  node,
  handledProperties,
  onChange,
  onDelete,
}: PropertyEditorProps) {
  const { t } = useTranslation(['common', 'nodes', 'errors']);
  const handlePropertyAdd = (key: string, value: unknown) => {
    onChange(key, value);
  };

  const editor = usePropertyEditor(handlePropertyAdd);

  const data = node.data as Record<string, unknown>;

  // Get unhandled properties
  const unhandledProperties = Object.entries(data).filter(
    ([key, value]) =>
      // A text cleared to '' keeps its row (it vanished while the key
      // stayed in the step; bug #215).
      !handledProperties.has(key) && value !== undefined && value !== null
  );

  // Don't render if no properties and not adding
  if (unhandledProperties.length === 0 && !editor.state.isAdding) {
    return null;
  }

  const handleAdd = () => {
    try {
      editor.handleAdd();
    } catch (error) {
      alert(error instanceof Error ? error.message : t('errors:properties.addFailed'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <Label className="font-medium text-muted-foreground text-xs">
            {t('nodes:panel.additionalProperties')}
          </Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={editor.startAdding}
            className="h-6 px-2 text-xs"
          >
            <Plus className="mr-1 h-3 w-3" />
            {t('buttons.add')}
          </Button>
        </div>
      </div>

      {/* Add new property form */}
      {editor.state.isAdding && (
        <div className="space-y-2 rounded border p-3">
          <FormField label={t('nodes:panel.propertyName')} required>
            <Input
              type="text"
              value={editor.state.key}
              onChange={(e) => editor.setKey(e.target.value)}
              placeholder={t('nodes:placeholders.customProperty')}
            />
          </FormField>

          <FormField label={t('nodes:panel.type')}>
            <HaSelect
              value={editor.state.type}
              onChange={(value) => editor.setType(value as PropertyType)}
              options={[
                { value: 'string', label: t('nodes:triggers.dataTypes.string') },
                { value: 'number', label: t('nodes:triggers.dataTypes.number') },
                { value: 'boolean', label: t('nodes:triggers.dataTypes.boolean') },
                { value: 'array', label: t('nodes:triggers.dataTypes.json') },
              ]}
              fallback={
                <Select
                  value={editor.state.type}
                  onValueChange={(value: PropertyType) => editor.setType(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">{t('nodes:triggers.dataTypes.string')}</SelectItem>
                    <SelectItem value="number">{t('nodes:triggers.dataTypes.number')}</SelectItem>
                    <SelectItem value="boolean">{t('nodes:triggers.dataTypes.boolean')}</SelectItem>
                    <SelectItem value="array">{t('nodes:triggers.dataTypes.json')}</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </FormField>

          <FormField label={t('nodes:panel.value')}>
            {editor.state.type === 'boolean' ? (
              <div className="flex items-center space-x-2">
                <HaSwitch
                  checked={editor.state.value === 'true'}
                  onChange={(checked) => editor.setValue(checked ? 'true' : 'false')}
                  fallback={
                    <Switch
                      checked={editor.state.value === 'true'}
                      onCheckedChange={(checked) => editor.setValue(checked ? 'true' : 'false')}
                    />
                  }
                />
                <Label className="text-sm">
                  {editor.state.value === 'true' ? t('boolean.true') : t('boolean.false')}
                </Label>
              </div>
            ) : editor.state.type === 'array' ? (
              <Textarea
                value={editor.state.value}
                onChange={(e) => editor.setValue(e.target.value)}
                placeholder={t('nodes:placeholders.jsonArray')}
                className="font-mono"
                rows={2}
              />
            ) : (
              <Input
                type={editor.state.type === 'number' ? 'number' : 'text'}
                value={editor.state.value}
                onChange={(e) => editor.setValue(e.target.value)}
                placeholder={
                  editor.state.type === 'number'
                    ? t('nodes:placeholders.number')
                    : t('nodes:placeholders.enterValue')
                }
              />
            )}
          </FormField>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={editor.cancelAdding}>
              {t('buttons.cancel')}
            </Button>
            <Button size="sm" onClick={handleAdd}>
              {t('nodes:panel.addProperty')}
            </Button>
          </div>
        </div>
      )}

      {/* Display existing unhandled properties */}
      {unhandledProperties.map(([key, value]) => (
        <PropertyDisplay
          key={key}
          name={key}
          value={value}
          onChange={(newValue) => onChange(key, newValue)}
          onDelete={() => onDelete(key)}
        />
      ))}
    </div>
  );
}

interface PropertyDisplayProps {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onDelete: () => void;
}

/**
 * Component for displaying and editing a single property.
 */
function PropertyDisplay({ name, value, onChange, onDelete }: PropertyDisplayProps) {
  const { t } = useTranslation(['common', 'nodes']);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="font-medium text-muted-foreground text-xs capitalize">
          {name.replace(/_/g, ' ')}
        </Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {typeof value === 'boolean' ? (
        <div className="flex items-center space-x-2">
          <HaSwitch
            checked={value}
            onChange={onChange}
            fallback={<Switch checked={value} onCheckedChange={(checked) => onChange(checked)} />}
          />
          <Label className="text-sm">{value ? t('boolean.true') : t('boolean.false')}</Label>
        </div>
      ) : Array.isArray(value) || typeof value === 'object' ? (
        <DraftField
          value={value}
          format={formatJson}
          parse={parseJson}
          onChange={onChange}
          multiline
          rows={Array.isArray(value) ? Math.min(value.length + 1, 4) : 4}
          placeholder={t(
            Array.isArray(value) ? 'nodes:placeholders.jsonArray' : 'nodes:placeholders.jsonObject'
          )}
        />
      ) : typeof value === 'number' ? (
        <DraftField
          value={value}
          format={String}
          parse={parseNumber}
          onChange={onChange}
          placeholder={t('nodes:placeholders.enterType', { type: typeof value })}
        />
      ) : (
        <Input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('nodes:placeholders.enterType', {
            type: typeof value,
          })}
        />
      )}
    </div>
  );
}

const formatJson = (v: unknown) => JSON.stringify(v, null, 2);

/** JSON text as a value, or `invalid` while it doesn't read. */
const invalid = Symbol('invalid');
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return invalid;
  }
}
function parseNumber(text: string): unknown {
  const n = Number(text);
  return text.trim() === '' || Number.isNaN(n) ? invalid : n;
}

/**
 * A field that keeps what is typed and saves it once it reads (`parse`
 * gives `invalid` until then), and shows a value changed elsewhere. A
 * controlled field undid every keystroke that left the text unreadable --
 * the "," before a new JSON key, the "." of a decimal (bug #215).
 */
function DraftField({
  value,
  format,
  parse,
  onChange,
  multiline,
  rows,
  placeholder,
}: {
  value: unknown;
  format: (value: unknown) => string;
  parse: (text: string) => unknown;
  onChange: (value: unknown) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => format(value));
  // A value changed elsewhere (undo, another field) replaces the draft,
  // unless the draft already reads as it.
  useEffect(() => {
    setDraft((current) => {
      const read = parse(current);
      return read !== invalid && JSON.stringify(read) === JSON.stringify(value)
        ? current
        : format(value);
    });
  }, [value, format, parse]);
  const handle = (text: string) => {
    setDraft(text);
    const read = parse(text);
    if (read !== invalid) onChange(read);
  };
  return multiline ? (
    <Textarea
      value={draft}
      onChange={(e) => handle(e.target.value)}
      className="font-mono"
      rows={rows}
      placeholder={placeholder}
    />
  ) : (
    <Input
      type="text"
      value={draft}
      onChange={(e) => handle(e.target.value)}
      placeholder={placeholder}
    />
  );
}
