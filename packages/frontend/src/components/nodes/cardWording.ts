import type { TFunction } from 'i18next';
import { getConditionThresholdShape } from '@/lib/nativeThreshold';
import { BINARY_SENSOR_CLASSES } from '@/lib/triggerRecipes';
import { prettify } from '@/lib/utils';
import { phraseAfterName } from './StepCard';

/** The `t` of a component translating with the nodes namespace. */
type NodesT = TFunction<readonly ['nodes']>;

/**
 * How a step reads in words, shared by the canvas cards and the pickers'
 * cards, so a pick reads in the picker as it will on the canvas.
 */

/** An action's verb: "Turn on" for `light.turn_on`. */
export function actionVerb(t: NodesT, service: string | undefined): string | undefined {
  const name = service?.split('.')[1];
  return name ? t(`nodes:serviceActions.${name}`, { defaultValue: prettify(name) }) : undefined;
}

/** A word from the cards' own phrase tables (`nodes:cardVerbs`), or
 * undefined when the table has none. */
function cardVerb(
  t: NodesT,
  key: string,
  options: Record<string, string> = {}
): string | undefined {
  const text = t(`nodes:cardVerbs.${key}`, { ...options, defaultValue: '' });
  return text || undefined;
}

/** A binary sensor class's words in the tables: what it does when it turns
 * on or off ("opens", "detects motion") and what it is then ("open",
 * "clear"). */
type BinaryWord = 'on' | 'off' | 'isOn' | 'isOff';
export function binaryWord(
  t: NodesT,
  deviceClass: string | undefined,
  word: BinaryWord
): string | undefined {
  return deviceClass && deviceClass in BINARY_SENSOR_CLASSES
    ? cardVerb(t, `binary.${deviceClass}.${word}`)
    : undefined;
}

/** What a State trigger's entity does, after its name: "opens" for a door
 * turning on, "turns on" for anything else, "changes to home" for another
 * state; "stays open" when it must hold. */
export function stateTriggerPhrase(
  t: NodesT,
  to: unknown,
  deviceClass: string | undefined,
  holds: boolean
): string | undefined {
  if (to === 'on' || to === 'off') {
    const state = binaryWord(t, deviceClass, to === 'on' ? 'isOn' : 'isOff');
    if (holds && state) return cardVerb(t, 'stays', { state });
    return binaryWord(t, deviceClass, to) ?? cardVerb(t, to === 'on' ? 'turnsOn' : 'turnsOff');
  }
  return typeof to === 'string' && to ? cardVerb(t, 'changesTo', { state: to }) : undefined;
}

/** What a value does before its threshold pill: "goes [above 22 °C]",
 * "brightness goes [above 40 %]" for an attribute. */
export function thresholdPhrase(t: NodesT, attribute?: string): string | undefined {
  return attribute
    ? cardVerb(t, 'goesOf', { what: prettify(attribute).toLowerCase() })
    : cardVerb(t, 'goes');
}

/** What a purpose-specific trigger (`door.opened`) does, after its
 * subject's name: "opens", "detects motion", "goes" (before its threshold
 * pill), "target temperature changes". Undefined for an event the tables
 * don't know (a type HA adds later): the caller keeps HA's own words. */
export function triggerEventPhrase(
  t: NodesT,
  domain: string,
  event: string,
  holds: boolean
): string | undefined {
  if (holds && (event === 'opened' || event === 'closed')) {
    const state = binaryWord(t, domain, event === 'opened' ? 'isOn' : 'isOff');
    if (state) return cardVerb(t, 'stays', { state });
  }
  const known = cardVerb(t, `events.${domain}__${event}`) ?? cardVerb(t, `events.${event}`);
  if (known) return known;
  const what = (suffix: string) => prettify(event.slice(0, -suffix.length)).toLowerCase();
  if (event === 'crossed_threshold') return cardVerb(t, 'goes');
  if (event.endsWith('_crossed_threshold'))
    return cardVerb(t, 'goesOf', { what: what('_crossed_threshold') });
  if (event === 'changed') return cardVerb(t, 'changes');
  if (event.endsWith('_changed')) return cardVerb(t, 'changesOf', { what: what('_changed') });
  return undefined;
}

/** A State condition's state in words, after "is": "open" for a door's
 * `on`, "on" or "off" otherwise, or the state itself. */
export function conditionStatePhrase(
  t: NodesT,
  state: unknown,
  deviceClass: string | undefined
): string | undefined {
  // Several states (HA passes on any of them): "on or unavailable".
  if (Array.isArray(state)) {
    const words = state
      .map((one) => conditionStatePhrase(t, one, deviceClass))
      .filter((word): word is string => Boolean(word));
    return words.length > 0 ? words.join(` ${cardVerb(t, 'orWord') ?? ','} `) : undefined;
  }
  if (state === 'on') return binaryWord(t, deviceClass, 'isOn') ?? cardVerb(t, 'isOn');
  if (state === 'off') return binaryWord(t, deviceClass, 'isOff') ?? cardVerb(t, 'isOff');
  return typeof state === 'string' ? state : undefined;
}

/** A purpose-specific condition (`cover.is_closed`) in words: its domain,
 * its type, and the type as a phrase ("Closed"; "is_" dropped, said by the
 * sentence instead). */
export function dottedConditionParts(condition: string): {
  domain?: string;
  suffix?: string;
  phrase?: string;
} {
  if (!condition.includes('.')) return {};
  const domain = condition.split('.')[0];
  const suffix = condition.slice(domain.length + 1);
  return {
    domain,
    suffix,
    phrase: prettify(suffix.startsWith('is_') ? suffix.slice(3) : suffix),
  };
}

/** Whether a purpose-specific condition reads as a state ("is closed"):
 * an `is_` type, unless it compares a value ("brightness" above a level). */
export function dottedConditionIsState(condition: string): boolean {
  const { suffix } = dottedConditionParts(condition);
  return (suffix?.startsWith('is_') ?? false) && getConditionThresholdShape(condition) === 'none';
}

/** A condition's phrase after its subject: "is closed" for a state, as is
 * otherwise. */
export function conditionPhraseAfterName(
  t: NodesT,
  language: string,
  phrase: string,
  isState: boolean
): string {
  const after = phraseAfterName(phrase, language);
  return isState ? t('nodes:conditions.cardPhrases.isState', { state: after }) : after;
}

/** A plain condition's phrase after its one subject ("is open", "is
 * closed"), for a State condition or a purpose-specific one. */
export function singleConditionPhrase(
  t: NodesT,
  language: string,
  data: { condition: string; state?: unknown },
  deviceClass: string | undefined
): string | undefined {
  if (data.condition === 'state') {
    const phrase = conditionStatePhrase(t, data.state, deviceClass);
    return phrase ? conditionPhraseAfterName(t, language, phrase, true) : undefined;
  }
  const { phrase } = dottedConditionParts(data.condition);
  return phrase
    ? conditionPhraseAfterName(t, language, phrase, dottedConditionIsState(data.condition))
    : undefined;
}

/** What a count pill holds, by what its entities are: "lights · 2",
 * "doors · 2" (a binary sensor or sensor by its class), else "2 devices". */
export function countNoun(
  t: NodesT,
  entities: readonly ({ domain?: string; deviceClass?: string } | null)[]
): string {
  const count = entities.length;
  const kinds = new Set(
    entities.map((e) => {
      const byClass = e?.deviceClass ? cardVerb(t, `nouns.${e.deviceClass}`) : undefined;
      return byClass ?? (e?.domain ? cardVerb(t, `nouns.${e.domain}`) : undefined) ?? '';
    })
  );
  const [noun] = kinds;
  return kinds.size === 1 && noun
    ? (cardVerb(t, 'countOf', { noun, count: String(count) }) ?? noun)
    : t('nodes:cardVerbs.devices', { count });
}

/** A phrase for several subjects: "[lights · 2] turn on", not "turns on".
 * English changes its first word ("turns" -> "turn", "is" -> "are");
 * German its last ("erkennt" -> "erkennen", "wird" -> "werden"). */
export function pluralPhrase(phrase: string, language: string): string {
  if (language.startsWith('en')) {
    const [first = '', ...rest] = phrase.split(' ');
    const plural: Record<string, string> = { is: 'are', has: 'have', goes: 'go', does: 'do' };
    const word =
      plural[first] ??
      (/ies$/.test(first)
        ? first.replace(/ies$/, 'y')
        : /(ss|sh|ch|x|z)es$/.test(first)
          ? first.slice(0, -2)
          : /s$/.test(first) && !/ss$/.test(first)
            ? first.slice(0, -1)
            : first);
    return [word, ...rest].join(' ');
  }
  if (language.startsWith('de')) {
    const words = phrase.split(' ');
    const last = words.pop() ?? '';
    const plural: Record<string, string> = { ist: 'sind', wird: 'werden', hat: 'haben' };
    const word =
      plural[last] ??
      (/iert$/.test(last)
        ? last.replace(/iert$/, 'ieren')
        : /(e[lr])t$/.test(last)
          ? last.replace(/t$/, 'n')
          : /et$/.test(last)
            ? last.replace(/et$/, 'en')
            : /t$/.test(last)
              ? last.replace(/t$/, 'en')
              : last);
    return [...words, word].join(' ');
  }
  return phrase;
}
