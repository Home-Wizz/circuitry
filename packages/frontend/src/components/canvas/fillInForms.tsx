import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HoldForField } from '@/components/nodes/holdFor';
import { DurationInput } from '@/components/panels/node-fields/DurationField';
import { FieldHeading } from '@/components/ui/field-heading';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import { entityName } from '@/lib/entityNames';
import { cn } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';

type Data = Readonly<Record<string, unknown>>;
type Patch = (patch: Record<string, unknown>) => void;

/** The trigger types with a short form of their own: the Fill in column and a card's "+ more" show it. */
const SHORT_FORM_TRIGGERS: ReadonlySet<string> = new Set([
  'time',
  'sun',
  'zone',
  'template',
  'time_pattern',
  'event',
  'mqtt',
  'webhook',
  'calendar',
  'tag',
  'conversation',
]);

const PATTERN_UNITS = ['hours', 'minutes', 'seconds'] as const;
type PatternUnit = (typeof PATTERN_UNITS)[number];

/** A time pattern that's one "every N" ("/15" minutes), or none yet; null
 * for anything richer (it's edited as the panel edits it). */
export function simplePattern(data: Data): { unit: PatternUnit; every: number } | null {
  const set = PATTERN_UNITS.filter((u) => data[u] !== undefined && data[u] !== '');
  if (set.length === 0) return { unit: 'minutes', every: 0 };
  if (set.length !== 1) return null;
  const unit = set[0] as PatternUnit;
  const match = /^\/(\d+)$/.exec(String(data[unit]).trim());
  return match ? { unit, every: Number(match[1]) } : null;
}

/** Whether a trigger has its own short form (a time pattern only when it's
 * one "every N"). */
export function hasShortForm(data: Data): boolean {
  const type = String(data.trigger ?? '');
  if (type === 'time_pattern') return simplePattern(data) !== null;
  return SHORT_FORM_TRIGGERS.has(type);
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** A value as a list: one or several. */
export function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === '' ? [] : [value];
}

/** One or several, as HA takes it: none is unset, one is itself. */
function oneOrMany<T>(list: T[]): T | T[] | undefined {
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : list;
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** "07:00:00" as the person reads a time ("7:00 AM", "07:00"). */
export function timeText(value: string, language: string): string {
  const match = TIME.exec(value);
  if (!match) return value;
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]), Number(match[3] ?? 0));
  return date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });
}

/** A sun offset ("-00:15:00") as minutes and a side; null where it isn't
 * whole minutes (it's then edited as a duration). */
export function sunOffset(value: unknown): { minutes: number; before: boolean } | null {
  if (value === undefined || value === null || value === '') return { minutes: 0, before: true };
  if (typeof value !== 'string') return null;
  const match = /^(-)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match || Number(match[4] ?? 0) !== 0) return null;
  return { minutes: Number(match[2]) * 60 + Number(match[3]), before: match[1] === '-' };
}

/** Minutes before or after, as HA writes an offset ("-00:15:00"). */
export function sunOffsetValue(minutes: number, before: boolean): string | undefined {
  if (!(minutes > 0)) return undefined;
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${before ? '-' : ''}${h}:${m}:00`;
}

const byName = (entities: HassEntity[], domain: string) =>
  entities
    .filter((e) => e.entity_id.startsWith(`${domain}.`))
    .sort((a, b) => entityName(a, a.entity_id).localeCompare(entityName(b, b.entity_id)));

function Chip({
  on,
  dashed,
  onClick,
  children,
}: {
  on?: boolean;
  dashed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={dashed ? undefined : Boolean(on)}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm',
        on ? 'border-primary bg-primary/10 font-semibold' : 'border-foreground/20',
        dashed && 'border-dashed text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

function TimeForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t, i18n } = useTranslation(['nodes']);
  const entities = useResolvedEntities();
  const [adding, setAdding] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const at = listOf(data.at);
  const days = listOf(data.weekday).filter((d): d is string => typeof d === 'string');
  const setAt = (next: unknown[]) => onPatch({ at: oneOrMany(next) });
  const label = (value: unknown) =>
    typeof value !== 'string'
      ? '…'
      : value.includes('.')
        ? entityName(
            entities.find((e) => e.entity_id === value),
            value
          )
        : timeText(value, i18n.language);
  const helpers = byName(entities, 'input_datetime').filter((e) => !at.includes(e.entity_id));
  return (
    <>
      <FieldHeading label={t('nodes:fillIn.time.at')}>
        <div className="flex flex-wrap gap-1.5">
          {at.map((value, i) => (
            <Chip
              key={`${String(value)}:${i}`}
              on
              onClick={() => setAt(at.filter((_, j) => j !== i))}
            >
              {label(value)}
              <X className="h-3 w-3 opacity-60" aria-label={t('nodes:fillIn.remove')} />
            </Chip>
          ))}
          {adding ? (
            <Input
              type="time"
              autoFocus
              className="h-7 w-32"
              aria-label={t('nodes:fillIn.time.addTime')}
              onBlur={() => setAdding(false)}
              onChange={(e) => {
                if (!e.target.value) return;
                setAt([...at, `${e.target.value}:00`]);
                setAdding(false);
              }}
            />
          ) : (
            <Chip dashed onClick={() => setAdding(true)}>
              {`+ ${t('nodes:fillIn.time.addTime')}`}
            </Chip>
          )}
        </div>
        {helperOpen ? (
          <div className="flex flex-wrap gap-1.5">
            {helpers.map((helper) => (
              <Chip
                key={helper.entity_id}
                onClick={() => {
                  setAt([...at, helper.entity_id]);
                  setHelperOpen(false);
                }}
              >
                {entityName(helper, helper.entity_id)}
              </Chip>
            ))}
            {helpers.length === 0 && (
              <span className="text-muted-foreground text-xs">
                {t('nodes:fillIn.time.noHelpers')}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHelperOpen(true)}
            className="self-start font-medium text-primary text-xs hover:underline"
          >
            {t('nodes:fillIn.time.orHelper')}
          </button>
        )}
      </FieldHeading>
      <FieldHeading label={t('nodes:fillIn.time.on')}>
        <div className="flex gap-1">
          {WEEKDAYS.map((day) => {
            const on = days.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={t(`nodes:fillIn.days.long.${day}`)}
                onClick={() =>
                  onPatch({
                    weekday: oneOrMany(
                      WEEKDAYS.filter((d) => (d === day ? !on : days.includes(d)))
                    ),
                  })
                }
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full border text-xs',
                  on
                    ? 'border-transparent bg-primary font-semibold text-primary-foreground'
                    : 'border-foreground/20'
                )}
              >
                {t(`nodes:fillIn.days.short.${day}`)}
              </button>
            );
          })}
        </div>
        <span className="text-muted-foreground text-xs">{t('nodes:fillIn.time.everyDay')}</span>
      </FieldHeading>
    </>
  );
}

function SunForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t } = useTranslation(['nodes']);
  const event = data.event === 'sunrise' ? 'sunrise' : 'sunset';
  return (
    <>
      <FieldHeading label={t('nodes:fillIn.sun.when')}>
        <Segmented
          tone="primary"
          className="self-start"
          value={event}
          options={[
            { value: 'sunrise', label: t('nodes:fillIn.sun.rises') },
            { value: 'sunset', label: t('nodes:fillIn.sun.sets') },
          ]}
          onChange={(next) => onPatch({ event: next })}
        />
      </FieldHeading>
      <OffsetField value={data.offset} onChange={(offset) => onPatch({ offset })} />
    </>
  );
}

/** Minutes earlier or later (a sun event, a calendar event), as HA's
 * offset ("-00:15:00"); one that isn't whole minutes is kept as it is. */
function OffsetField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useTranslation(['nodes']);
  const offset = sunOffset(value);
  return (
    <FieldHeading label={t('nodes:fillIn.sun.offset')}>
      {offset ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            className="h-8 w-20"
            aria-label={t('nodes:fillIn.sun.minutes')}
            value={offset.minutes || ''}
            placeholder="0"
            onChange={(e) => onChange(sunOffsetValue(Number(e.target.value), offset.before))}
          />
          <span className="text-muted-foreground text-sm">{t('nodes:fillIn.sun.min')}</span>
          <Segmented
            tone="primary"
            value={offset.before ? 'before' : 'after'}
            options={[
              { value: 'before', label: t('nodes:fillIn.sun.before') },
              { value: 'after', label: t('nodes:fillIn.sun.after') },
            ]}
            onChange={(side) => onChange(sunOffsetValue(offset.minutes, side === 'before'))}
          />
        </div>
      ) : (
        <DurationInput value={typeof value === 'string' ? value : ''} onChange={onChange} />
      )}
    </FieldHeading>
  );
}

/** Words to match, one or several, as chips ("+ Add" types another). */
function TextChips({
  label,
  values,
  onChange,
  addLabel,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  placeholder?: string;
}) {
  const { t } = useTranslation(['nodes']);
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (text && !values.includes(text)) onChange([...values, text]);
    setDraft('');
  };
  return (
    <FieldHeading label={label}>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Chip key={value} on onClick={() => onChange(values.filter((v) => v !== value))}>
              {value}
              <X className="h-3 w-3 opacity-60" aria-label={t('nodes:fillIn.remove')} />
            </Chip>
          ))}
        </div>
      )}
      <Input
        aria-label={addLabel}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
        }}
      />
    </FieldHeading>
  );
}

/** A plain text setting under its heading. */
function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: unknown;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <FieldHeading label={label}>
      <Input
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </FieldHeading>
  );
}

function TimePatternForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t } = useTranslation(['nodes']);
  const pattern = simplePattern(data) ?? { unit: 'minutes' as const, every: 0 };
  // One unit set, "/N"; the others left unset (HA starts them at 0).
  const write = (unit: PatternUnit, every: number) =>
    onPatch(
      Object.fromEntries(
        PATTERN_UNITS.map((u) => [u, u === unit && every > 0 ? `/${every}` : undefined])
      )
    );
  return (
    <FieldHeading label={t('nodes:fillIn.pattern.every')}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          className="h-8 w-20"
          aria-label={t('nodes:fillIn.pattern.every')}
          value={pattern.every || ''}
          onChange={(e) => write(pattern.unit, Number(e.target.value))}
        />
        <Segmented
          tone="primary"
          value={pattern.unit}
          options={PATTERN_UNITS.map((u) => ({ value: u, label: t(`nodes:fillIn.pattern.${u}`) }))}
          onChange={(unit) => write(unit, pattern.every)}
        />
      </div>
    </FieldHeading>
  );
}

function CalendarForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t } = useTranslation(['nodes']);
  const entities = useResolvedEntities();
  const calendars = byName(entities, 'calendar');
  return (
    <>
      <FieldHeading label={t('nodes:fillIn.calendar.calendar')}>
        <select
          aria-label={t('nodes:fillIn.calendar.calendar')}
          value={typeof data.entity_id === 'string' ? data.entity_id : ''}
          onChange={(e) => onPatch({ entity_id: e.target.value || undefined })}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t('nodes:fillIn.calendar.pick')}</option>
          {calendars.map((c) => (
            <option key={c.entity_id} value={c.entity_id}>
              {entityName(c, c.entity_id)}
            </option>
          ))}
        </select>
      </FieldHeading>
      <FieldHeading label={t('nodes:fillIn.calendar.when')}>
        <Segmented
          tone="primary"
          className="self-start"
          value={data.event === 'end' ? 'end' : 'start'}
          options={[
            { value: 'start', label: t('nodes:fillIn.calendar.starts') },
            { value: 'end', label: t('nodes:fillIn.calendar.ends') },
          ]}
          onChange={(event) => onPatch({ event })}
        />
      </FieldHeading>
      <OffsetField value={data.offset} onChange={(offset) => onPatch({ offset })} />
    </>
  );
}

function ZoneForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t } = useTranslation(['nodes']);
  const entities = useResolvedEntities();
  const who = listOf(data.entity_id).filter((id): id is string => typeof id === 'string');
  const people = byName(entities, 'person');
  const trackers = byName(entities, 'device_tracker');
  const zones = byName(entities, 'zone');
  const [trackersOpen, setTrackersOpen] = useState(false);
  const toggle = (id: string) =>
    onPatch({
      entity_id: oneOrMany(who.includes(id) ? who.filter((w) => w !== id) : [...who, id]),
    });
  // Who it is: the people, any tracker already picked, the rest on request.
  const shown = [...people, ...trackers.filter((tr) => who.includes(tr.entity_id) || trackersOpen)];
  return (
    <>
      <FieldHeading label={t('nodes:fillIn.zone.who')}>
        <div className="flex flex-wrap gap-1.5">
          {shown.map((e) => (
            <Chip
              key={e.entity_id}
              on={who.includes(e.entity_id)}
              onClick={() => toggle(e.entity_id)}
            >
              {entityName(e, e.entity_id)}
            </Chip>
          ))}
          {!trackersOpen && trackers.length > 0 && (
            <Chip dashed onClick={() => setTrackersOpen(true)}>
              {`+ ${t('nodes:fillIn.zone.tracker')}`}
            </Chip>
          )}
        </div>
      </FieldHeading>
      <FieldHeading label={t('nodes:fillIn.zone.zone')}>
        <select
          aria-label={t('nodes:fillIn.zone.zone')}
          value={typeof data.zone === 'string' ? data.zone : ''}
          onChange={(e) => onPatch({ zone: e.target.value || undefined })}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t('nodes:fillIn.zone.pick')}</option>
          {zones.map((z) => (
            <option key={z.entity_id} value={z.entity_id}>
              {entityName(z, z.entity_id)}
            </option>
          ))}
        </select>
      </FieldHeading>
      <FieldHeading label={t('nodes:fillIn.zone.when')}>
        <Segmented
          tone="primary"
          className="self-start"
          value={data.event === 'leave' ? 'leave' : 'enter'}
          options={[
            { value: 'enter', label: t('nodes:fillIn.zone.enter') },
            { value: 'leave', label: t('nodes:fillIn.zone.leave') },
          ]}
          onChange={(event) => onPatch({ event })}
        />
      </FieldHeading>
    </>
  );
}

function TemplateForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t } = useTranslation(['nodes']);
  return (
    <>
      <FieldHeading label={t('nodes:fillIn.template.template')}>
        <Textarea
          rows={3}
          className="font-mono text-xs"
          aria-label={t('nodes:fillIn.template.template')}
          value={typeof data.value_template === 'string' ? data.value_template : ''}
          placeholder={'{{ … }}'}
          onChange={(e) => onPatch({ value_template: e.target.value || undefined })}
        />
        <span className="text-muted-foreground text-xs">{t('nodes:fillIn.template.hint')}</span>
      </FieldHeading>
      <HoldForField kind="trigger" data={data} onPatch={onPatch} />
    </>
  );
}

/** An event, MQTT, webhook, tag or sentence trigger: its words to match. */
function TextForms({ data, onPatch }: { data: Data; onPatch: Patch }) {
  const { t } = useTranslation(['nodes']);
  const strings = (value: unknown) =>
    listOf(value).filter((v): v is string => typeof v === 'string');
  switch (data.trigger) {
    case 'event':
      return (
        <TextField
          label={t('nodes:fillIn.event.type')}
          value={data.event_type}
          placeholder={t('nodes:fillIn.event.placeholder')}
          onChange={(event_type) => onPatch({ event_type })}
        />
      );
    case 'mqtt':
      return (
        <>
          <TextField
            label={t('nodes:fillIn.mqtt.topic')}
            value={data.topic}
            placeholder="home/door/front"
            onChange={(topic) => onPatch({ topic })}
          />
          <TextField
            label={t('nodes:fillIn.mqtt.payload')}
            value={data.payload}
            hint={t('nodes:fillIn.mqtt.payloadHint')}
            onChange={(payload) => onPatch({ payload })}
          />
        </>
      );
    case 'webhook':
      return (
        <TextField
          label={t('nodes:fillIn.webhook.id')}
          value={data.webhook_id}
          placeholder="front_door_bell"
          hint={t('nodes:fillIn.webhook.hint')}
          onChange={(webhook_id) => onPatch({ webhook_id })}
        />
      );
    case 'tag':
      return (
        <TextChips
          label={t('nodes:fillIn.tag.tags')}
          addLabel={t('nodes:fillIn.tag.add')}
          placeholder="A7-6B-90-5F"
          values={strings(data.tag_id)}
          onChange={(tags) => onPatch({ tag_id: oneOrMany(tags) })}
        />
      );
    case 'conversation':
      return (
        <TextChips
          label={t('nodes:fillIn.conversation.says')}
          addLabel={t('nodes:fillIn.conversation.add')}
          placeholder={t('nodes:fillIn.conversation.placeholder')}
          values={strings(data.command)}
          onChange={(commands) => onPatch({ command: oneOrMany(commands) })}
        />
      );
    default:
      return null;
  }
}

/**
 * A trigger's own short form (hasShortForm): only what its type needs
 * (chips for lists, buttons for small choices, blue for every choice). Null for any other type.
 */
export function TriggerShortForm({ data, onPatch }: { data: Data; onPatch: Patch }) {
  switch (data.trigger) {
    case 'time':
      return <TimeForm data={data} onPatch={onPatch} />;
    case 'sun':
      return <SunForm data={data} onPatch={onPatch} />;
    case 'zone':
      return <ZoneForm data={data} onPatch={onPatch} />;
    case 'template':
      return <TemplateForm data={data} onPatch={onPatch} />;
    case 'time_pattern':
      return simplePattern(data) ? <TimePatternForm data={data} onPatch={onPatch} /> : null;
    case 'calendar':
      return <CalendarForm data={data} onPatch={onPatch} />;
    default:
      return <TextForms data={data} onPatch={onPatch} />;
  }
}
