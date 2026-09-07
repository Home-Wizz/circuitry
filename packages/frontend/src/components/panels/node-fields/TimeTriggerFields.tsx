import type { FlowNode } from '@circuitry/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import { Input } from '@/components/ui/input';
import { getTriggerFields } from '@/config/triggerFields';
import { HaSelector } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { HassEntity } from '@/types/hass';
import { getNodeData } from '@/utils/nodeData';

/**
 * One entry of the `time` trigger's `at` field — a fixed time string
 * (`HH:MM:SS`), an `input_datetime`/timestamp-sensor/`time` entity id, a
 * limited template, or an `{ entity_id, offset }` mapping (see
 * TimeAtEntrySchema in @circuitry/shared's ha-schemas.ts). The first three
 * are all plain strings from the UI's perspective — only the mapping shape
 * needs its own editor mode.
 */
type AtEntry = string | { entity_id: string; offset?: string };

function isAtEntryObject(entry: unknown): entry is { entity_id: string; offset?: string } {
  return typeof entry === 'object' && entry !== null && 'entity_id' in entry;
}

/** Normalizes the stored `at` value (a bare entry or a list, per HA's shape) into a plain array for editing. */
function toAtEntries(value: unknown): AtEntry[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is AtEntry => typeof entry === 'string' || isAtEntryObject(entry)
    );
  }
  if (typeof value === 'string' || isAtEntryObject(value)) {
    return [value];
  }
  return [];
}

/** Collapses a single-entry list back to a bare value (HA's common case); keeps multi-entry lists as arrays. */
function fromAtEntries(entries: AtEntry[]): AtEntry | AtEntry[] | undefined {
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0];
  return entries;
}

interface TimeTriggerFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

/**
 * Fields for the `time` trigger platform.
 * `at` supports multiple wire shapes mixed in one list (fixed time, entity
 * reference, `{ entity_id, offset }` mapping) that don't fit
 * config/triggerFields.ts's static one-field-one-widget system, so — like
 * StateTriggerFields.tsx for `state` — this is a dedicated component instead.
 * `weekday` reuses the same static field config/i18n keys
 * (`nodes:fieldOptions.weekday`) the `time` condition type already has, via
 * the ordinary DynamicFieldRenderer.
 */
export function TimeTriggerFields({ node, onChange, entities }: TimeTriggerFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const { getFieldError } = useNodeErrors(node.id);

  const atEntries = toAtEntries(getNodeData(node, 'at'));
  const weekdayField = getTriggerFields('time').find((f) => f.name === 'weekday');

  const updateEntries = (entries: AtEntry[]) => onChange('at', fromAtEntries(entries));

  const handleAddEntry = () => updateEntries([...atEntries, '']);
  const handleRemoveEntry = (index: number) =>
    updateEntries(atEntries.filter((_, i) => i !== index));
  const handleEntryChange = (index: number, entry: AtEntry) =>
    updateEntries(atEntries.map((e, i) => (i === index ? entry : e)));

  // Always show at least one entry — an empty `at` list isn't valid HA YAML,
  // so this mirrors the previous single-text-field UI's baseline of one row.
  const displayEntries: AtEntry[] = atEntries.length === 0 ? [''] : atEntries;

  return (
    <>
      <FormField
        label={t('nodes:fieldLabels.at')}
        description={t('nodes:fieldDescriptions.at')}
        required
      >
        <div className="space-y-3">
          {displayEntries.map((entry, index) => (
            <AtEntryEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: entries have no stable identity of their own
              key={index}
              entry={entry}
              index={index}
              showRemove={displayEntries.length > 1}
              onChange={(next) => handleEntryChange(index, next)}
              onRemove={() => handleRemoveEntry(index)}
            />
          ))}
        </div>
        <FieldError message={getFieldError('at')} />
      </FormField>

      <Button
        type="button"
        variant="outline"
        onClick={handleAddEntry}
        className="w-full gap-2"
        size="sm"
      >
        <Plus className="h-4 w-4" />
        {t('nodes:triggerFields.time.addEntry')}
      </Button>

      {weekdayField && (
        <DynamicFieldRenderer
          field={weekdayField}
          value={(node.data as Record<string, unknown>).weekday}
          onChange={(value) => onChange('weekday', value)}
          entities={entities}
          error={getFieldError('weekday')}
        />
      )}
    </>
  );
}

interface AtEntryEditorProps {
  entry: AtEntry;
  index: number;
  showRemove: boolean;
  onChange: (entry: AtEntry) => void;
  onRemove: () => void;
}

/** Editor for a single `at` list entry — toggles between a plain value (fixed time / entity id / template) and an explicit `{ entity_id, offset }` mapping, mirroring ThresholdValueField's number/entity toggle convention. */
function AtEntryEditor({ entry, index, showRemove, onChange, onRemove }: AtEntryEditorProps) {
  const { t } = useTranslation(['nodes']);
  const isEntityMode = isAtEntryObject(entry);

  const switchToValue = () => onChange('');
  const switchToEntity = () => onChange({ entity_id: '' });

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-muted-foreground text-xs">
          {t('nodes:triggerFields.time.entryLabel', { index: index + 1 })}
        </span>
        {showRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="mb-2 flex gap-1">
        <Button
          type="button"
          variant={isEntityMode ? 'outline' : 'secondary'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={switchToValue}
        >
          {t('nodes:triggerFields.time.modeValue')}
        </Button>
        <Button
          type="button"
          variant={isEntityMode ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={switchToEntity}
        >
          {t('nodes:triggerFields.time.modeEntity')}
        </Button>
      </div>

      {isAtEntryObject(entry) ? (
        <div className="space-y-2">
          <HaSelector
            selector={{ entity: {} }}
            value={entry.entity_id}
            onChange={(v) => onChange({ ...entry, entity_id: typeof v === 'string' ? v : '' })}
            fallback={
              <Input
                value={entry.entity_id}
                onChange={(e) => onChange({ ...entry, entity_id: e.target.value })}
                placeholder="input_datetime.wake_up"
              />
            }
          />
          <Input
            value={entry.offset ?? ''}
            onChange={(e) => onChange({ ...entry, offset: e.target.value || undefined })}
            placeholder={t('nodes:triggerFields.time.offsetPlaceholder')}
          />
        </div>
      ) : (
        <HaSelector
          selector={{ text: {} }}
          value={entry}
          onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          fallback={
            <Input
              value={entry}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t('nodes:fieldPlaceholders.at')}
            />
          }
        />
      )}
    </div>
  );
}
