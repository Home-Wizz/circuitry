import { useTranslation } from 'react-i18next';
import {
  listOf,
  simplePattern,
  sunOffset,
  timeText,
  WEEKDAYS,
} from '@/components/canvas/fillInForms';
import { thresholdPhrase, triggerEventPhrase } from '@/components/nodes/cardWording';
import { durationUnits, formatDuration } from '@/components/nodes/formatDuration';
import type { DurationValue } from '@/components/panels/node-fields/DurationField';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useWholeArea } from '@/hooks/useStepTargets';
import { isRecord } from '@/lib/utils';

/** The entity ids a step names: its target's, or a legacy `entity_id`. */
function namedEntityIds(data: Readonly<Record<string, unknown>>): string[] {
  const raw = isRecord(data.target) ? data.target.entity_id : data.entity_id;
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  return typeof raw === 'string' && raw ? [raw] : [];
}

/** A piece of the Fill in sentence: what it names (the step's subject),
 * what's being set (its level, its "for"), or the words between. */
export interface SentencePart {
  text: string;
  role: 'words' | 'subject' | 'value';
}

/**
 * The sentence a threshold pick will read as on the canvas, for the Fill in
 * column: "When Office temperature goes above 22 °C for 10 min", updated as
 * it's set, in parts (the values set are shown apart). In the cards' own
 * words (cardWording.ts); German's verb goes last there too. Undefined for
 * anything but a threshold.
 */
export function useFillInSentence(
  kind: 'trigger' | 'condition' | null,
  data: Readonly<Record<string, unknown>>,
  threshold: string | undefined
): SentencePart[] | undefined {
  const { t, i18n } = useTranslation(['nodes']);
  const { entityNames } = useNodeCardDisplay();
  const wholeArea = useWholeArea(data.target);
  if (!kind || threshold === undefined) return undefined;
  const type = typeof data[kind] === 'string' ? String(data[kind]) : '';
  const ids = namedEntityIds(data);
  const subject = wholeArea
    ? t('nodes:picker.rows.anythingIn', { name: wholeArea.place })
    : ids.length > 0 && ids.length <= 2
      ? entityNames(ids)
      : ids.length > 2
        ? t('nodes:cardVerbs.devices', { count: ids.length })
        : '';
  const attribute = typeof data.attribute === 'string' ? data.attribute : undefined;
  const [domain = '', event = ''] = type.split('.');
  const verb =
    kind === 'trigger'
      ? type.includes('.')
        ? triggerEventPhrase(t, domain, event, false)
        : thresholdPhrase(t, attribute)
      : t('nodes:cardVerbs.is');
  const options = isRecord(data.options) ? data.options : {};
  const held = type.includes('.') ? options.for : data.for;
  const forText =
    held !== undefined && held !== null && !(isRecord(held) && Object.keys(held).length === 0)
      ? `${t('nodes:pill.for')} ${formatDuration(held as DurationValue, durationUnits(t))}`
      : '';
  const lead = t(kind === 'trigger' ? 'nodes:picker.kinds.when' : 'nodes:picker.kinds.and');
  const words = (text: string): SentencePart => ({ text, role: 'words' });
  const value = (text: string): SentencePart => ({ text, role: 'value' });
  const named: SentencePart = { text: subject, role: 'subject' };
  const parts = i18n.language.startsWith('de')
    ? [words(lead), named, value(threshold), value(forText), words(verb ?? '')]
    : [words(lead), named, words(verb ?? ''), value(threshold), value(forText)];
  return parts.filter((part) => part.text);
}

/** Where each value goes in a translated sentence ("When it's {{times}}"). */
const MARK = (i: number) => `\u0001${i}\u0001`;

/** A translated sentence with its values as parts of their own. */
function sentenceParts(
  template: (marks: Record<string, string>) => string,
  values: Record<string, SentencePart>
): SentencePart[] {
  const keys = Object.keys(values);
  const marks = Object.fromEntries(keys.map((key, i) => [key, MARK(i)]));
  const parts: SentencePart[] = [];
  for (const piece of template(marks).split('\u0001')) {
    const index = /^\d+$/.test(piece) ? Number(piece) : -1;
    const key = keys[index];
    if (key !== undefined) parts.push(values[key] as SentencePart);
    else if (piece.trim()) parts.push({ text: piece.trim(), role: 'words' });
  }
  return parts.filter((part) => part.text);
}

/**
 * The sentence a time, sun, zone or template trigger will read as, for the
 * Fill in column: "When it's 7:00 AM on weekdays", "When the sun sets,
 * 15 min before", "When Alex leaves Home". Undefined for other types.
 */
export function useShortFormSentence(
  data: Readonly<Record<string, unknown>>
): SentencePart[] | undefined {
  const { t, i18n } = useTranslation(['nodes']);
  const { entityNames } = useNodeCardDisplay();
  const value = (text: string): SentencePart => ({ text, role: 'value' });
  const or = ` ${t('nodes:fillIn.sentence.or')} `;
  switch (data.trigger) {
    case 'time': {
      const times = listOf(data.at)
        .filter((v): v is string => typeof v === 'string')
        .map((v) => (v.includes('.') ? entityNames([v]) : timeText(v, i18n.language)));
      const days = listOf(data.weekday).filter((d): d is string => typeof d === 'string');
      const set = new Set(days);
      const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
      const dayText =
        days.length === 0 || days.length === 7
          ? ''
          : days.length === 5 && weekdays.every((d) => set.has(d))
            ? t('nodes:fillIn.days.weekdays')
            : days.length === 2 && set.has('sat') && set.has('sun')
              ? t('nodes:fillIn.days.weekends')
              : WEEKDAYS.filter((d) => set.has(d))
                  .map((d) => t(`nodes:fillIn.days.abbr.${d}`))
                  .join(', ');
      const timesPart = value(times.join(or) || '…');
      return dayText
        ? sentenceParts(
            (m) => t('nodes:fillIn.sentence.timeOn', { times: m.times ?? '', days: m.days ?? '' }),
            {
              times: timesPart,
              days: value(dayText),
            }
          )
        : sentenceParts((m) => t('nodes:fillIn.sentence.time', { times: m.times ?? '' }), {
            times: timesPart,
          });
    }
    case 'sun': {
      const event = value(
        t(data.event === 'sunrise' ? 'nodes:fillIn.sun.risesWord' : 'nodes:fillIn.sun.setsWord')
      );
      const offset = sunOffset(data.offset);
      if (!offset || offset.minutes === 0)
        return sentenceParts((m) => t('nodes:fillIn.sentence.sun', { event: m.event ?? '' }), {
          event,
        });
      const time = formatDuration({ minutes: offset.minutes }, durationUnits(t));
      return sentenceParts(
        (m) =>
          t('nodes:fillIn.sentence.sunOffset', { event: m.event ?? '', offset: m.offset ?? '' }),
        {
          event,
          offset: value(
            t(offset.before ? 'nodes:fillIn.sun.beforeWord' : 'nodes:fillIn.sun.afterWord', {
              time,
            })
          ),
        }
      );
    }
    case 'zone': {
      const who = listOf(data.entity_id).filter((id): id is string => typeof id === 'string');
      return sentenceParts(
        (m) =>
          t('nodes:fillIn.sentence.zone', {
            who: m.who ?? '',
            event: m.event ?? '',
            zone: m.zone ?? '',
          }),
        {
          who: {
            text: who.length > 0 ? entityNames(who) : t('nodes:fillIn.zone.someone'),
            role: 'subject',
          },
          event: value(
            t(
              data.event === 'leave'
                ? 'nodes:fillIn.zone.leavesWord'
                : 'nodes:fillIn.zone.entersWord'
            )
          ),
          zone: value(typeof data.zone === 'string' ? entityNames([data.zone]) : '…'),
        }
      );
    }
    case 'template': {
      const held = data.for;
      const has =
        held !== undefined &&
        held !== null &&
        held !== '' &&
        !(isRecord(held) && Object.keys(held).length === 0);
      return has
        ? sentenceParts((m) => t('nodes:fillIn.sentence.templateFor', { for: m.for ?? '' }), {
            for: value(
              `${t('nodes:pill.for')} ${formatDuration(held as DurationValue, durationUnits(t))}`
            ),
          })
        : sentenceParts(() => t('nodes:fillIn.sentence.template'), {});
    }
    case 'time_pattern': {
      const pattern = simplePattern(data);
      if (!pattern) return undefined;
      const every = pattern.every
        ? formatDuration({ [pattern.unit]: pattern.every }, durationUnits(t))
        : '…';
      return sentenceParts((m) => t('nodes:fillIn.sentence.pattern', { every: m.every ?? '' }), {
        every: value(every),
      });
    }
    case 'calendar': {
      const calendar: SentencePart = {
        text: typeof data.entity_id === 'string' ? entityNames([data.entity_id]) : '…',
        role: 'subject',
      };
      const event = value(
        t(
          data.event === 'end'
            ? 'nodes:fillIn.calendar.endsWord'
            : 'nodes:fillIn.calendar.startsWord'
        )
      );
      const offset = sunOffset(data.offset);
      if (!offset || offset.minutes === 0)
        return sentenceParts(
          (m) =>
            t('nodes:fillIn.sentence.calendar', {
              calendar: m.calendar ?? '',
              event: m.event ?? '',
            }),
          { calendar, event }
        );
      const time = formatDuration({ minutes: offset.minutes }, durationUnits(t));
      return sentenceParts(
        (m) =>
          t('nodes:fillIn.sentence.calendarOffset', {
            calendar: m.calendar ?? '',
            event: m.event ?? '',
            offset: m.offset ?? '',
          }),
        {
          calendar,
          event,
          offset: value(
            t(offset.before ? 'nodes:fillIn.sun.beforeWord' : 'nodes:fillIn.sun.afterWord', {
              time,
            })
          ),
        }
      );
    }
    case 'event':
      return sentenceParts((m) => t('nodes:fillIn.sentence.event', { event: m.event ?? '' }), {
        event: value(
          typeof data.event_type === 'string' && data.event_type ? data.event_type : '…'
        ),
      });
    case 'mqtt': {
      const topic = value(typeof data.topic === 'string' && data.topic ? data.topic : '…');
      return typeof data.payload === 'string' && data.payload
        ? sentenceParts(
            (m) =>
              t('nodes:fillIn.sentence.mqttPayload', {
                topic: m.topic ?? '',
                payload: m.payload ?? '',
              }),
            { topic, payload: value(data.payload) }
          )
        : sentenceParts((m) => t('nodes:fillIn.sentence.mqtt', { topic: m.topic ?? '' }), {
            topic,
          });
    }
    case 'webhook':
      return sentenceParts((m) => t('nodes:fillIn.sentence.webhook', { id: m.id ?? '' }), {
        id: value(typeof data.webhook_id === 'string' && data.webhook_id ? data.webhook_id : '…'),
      });
    case 'tag':
    case 'conversation': {
      const words = listOf(data.trigger === 'tag' ? data.tag_id : data.command).filter(
        (v): v is string => typeof v === 'string'
      );
      const text = value(
        data.trigger === 'conversation'
          ? words.map((w) => `“${w}”`).join(or) || '…'
          : words.join(or) || '…'
      );
      return data.trigger === 'tag'
        ? sentenceParts((m) => t('nodes:fillIn.sentence.tag', { tag: m.tag ?? '' }), { tag: text })
        : sentenceParts((m) => t('nodes:fillIn.sentence.conversation', { says: m.says ?? '' }), {
            says: text,
          });
    }
    default:
      return undefined;
  }
}
