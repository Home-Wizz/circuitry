import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  stateTriggerPhrase,
  thresholdPhrase,
  triggerEventPhrase,
} from '@/components/nodes/cardWording';
import { DOMAIN_GROUP_LABELS } from '@/components/panels/node-fields/TriggerTypePicker';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { iconKeyFor } from '@/lib/domain-icons';
import { isEmptyValue, isRecord, prettify, singleEntityIdFrom } from '@/lib/utils';
import type { TriggerNodeData } from '@/store/flow-store';

export interface TriggerDisplayInfo {
  title: string;
  subtitle: string | undefined;
  /** Set only when `subtitle` is a genuine single entity_id, so it can be made clickable. */
  subtitleEntityId?: string;
  detail: unknown;
  /** Domain to look up a card icon for (lib/domain-icons.ts) — falls back to the generic Zap icon when unset. */
  iconDomain?: string;
  /** The area of the entity it watches, for the card's context line. */
  place?: string;
  /** What happens, to follow its entities in the card's sentence ("opened",
   * "turned on"), whatever their number. */
  phrase?: string;
}

/** A trigger in one line, as its card reads: its device and what happens
 * ("Hall · turns off"). */
export const triggerSummary = (info: TriggerDisplayInfo): string =>
  [info.title, info.subtitle].filter(Boolean).join(' · ');

/**
 * Device-name-plus-plain-language-phrase resolution for a
 * trigger — originally lived inline in TriggerNode.tsx's own getDisplayInfo,
 * extracted so WaitNode.tsx can reuse the exact same summary for each entry
 * in its `wait_for_trigger` list (a `TriggerNodeData[]` — see
 * lib/actionRecipes.ts's Wait-for consolidation) instead of showing the
 * generic "Waits for N trigger(s)" count with no indication of *what* it's
 * actually waiting for. Per CLAUDE.md's DRY mandate: this was the one and
 * only place trigger-card display logic existed, so a second card that
 * needs the same resolution reuses it rather than re-deriving it.
 */
/** Whether a trigger must hold for a while (`for`, its own or a
 * purpose-specific type's option). */
function holdsFor(data: TriggerNodeData): boolean {
  const options = isRecord(data.options) ? data.options : undefined;
  return !isEmptyValue(data.for) || (options !== undefined && !isEmptyValue(options.for));
}

/** An `entity_id` field as a list (one id, several, or none). */
function entityIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

/** A time trigger's `at` in words: a time as written, a helper by its name
 * ("Wake-up time"), with its offset when it has one. */
function timeAtDetail(at: unknown, entityNames: (ids: readonly string[]) => string): string | null {
  const one = (value: unknown): string => {
    if (typeof value === 'string') return /^[a-z_]+\./.test(value) ? entityNames([value]) : value;
    if (isRecord(value)) {
      const name = typeof value.entity_id === 'string' ? entityNames([value.entity_id]) : '';
      return typeof value.offset === 'string' && value.offset ? `${name} (${value.offset})` : name;
    }
    return '';
  };
  const parts = (Array.isArray(at) ? at : at === undefined || at === null ? [] : [at]).map(one);
  return parts.filter(Boolean).join(', ') || null;
}

export function useTriggerCardDisplay() {
  const { t } = useTranslation(['nodes']);
  const { resolveEntityTarget, resolveDeviceTarget, entityNames } = useNodeCardDisplay();

  const triggerPlatformLabels: Record<string, string> = {
    state: t('nodes:triggers.platforms.state'),
    numeric_state: t('nodes:triggers.platforms.numeric_state'),
    time: t('nodes:triggers.platforms.time'),
    time_pattern: t('nodes:triggers.platforms.time_pattern'),
    sun: t('nodes:triggers.platforms.sun'),
    event: t('nodes:triggers.platforms.event'),
    mqtt: t('nodes:triggers.platforms.mqtt'),
    webhook: t('nodes:triggers.platforms.webhook'),
    zone: t('nodes:triggers.platforms.zone'),
    template: t('nodes:triggers.platforms.template'),
    homeassistant: t('nodes:triggers.platforms.homeassistant'),
    device: t('nodes:triggers.platforms.device'),
    calendar: t('nodes:triggers.platforms.calendar'),
    geo_location: t('nodes:triggers.platforms.geo_location'),
    tag: t('nodes:triggers.platforms.tag'),
    conversation: t('nodes:triggers.platforms.conversation'),
    persistent_notification: t('nodes:triggers.platforms.persistent_notification'),
  };
  const getTriggerLabel = (type: string) => triggerPlatformLabels[type] ?? type;

  const getTriggerDisplayInfo = useCallback(
    (data: TriggerNodeData): TriggerDisplayInfo => {
      const triggerType = data.trigger;

      // Purpose-specific triggers (HA 2025.12+, dotted domain.event platform
      // like `light.turned_on`) — see NativeTriggerFields.tsx for the
      // target/options shape these commit. Handled before the switch below
      // since none of its cases apply to this fundamentally different shape.
      if (triggerType.includes('.')) {
        const [domain, event] = triggerType.split('.');
        const target = (data.target ?? {}) as {
          entity_id?: string | string[];
          device_id?: string | string[];
          area_id?: string | string[];
          floor_id?: string | string[];
          label_id?: string | string[];
        };
        const singleEntityId = singleEntityIdFrom(target.entity_id);
        const singleDeviceId = singleEntityIdFrom(target.device_id);
        const resolved = singleEntityId
          ? resolveEntityTarget(singleEntityId)
          : resolveDeviceTarget(singleDeviceId, domain);
        // In the cards' own words ("opens", "detects motion"); HA's for a
        // type the tables don't know yet.
        const eventPhrase =
          triggerEventPhrase(t, domain ?? '', event ?? '', holdsFor(data)) ??
          t(`nodes:triggers.nativeEvents.${event}`, { defaultValue: prettify(event ?? '') });
        const targetCount = (
          [
            target.entity_id,
            target.device_id,
            target.area_id,
            target.floor_id,
            target.label_id,
          ] as (string | string[] | undefined)[]
        ).flatMap((v) => (Array.isArray(v) ? v : v ? [v] : [])).length;
        return {
          title:
            data.alias ||
            resolved?.label ||
            DOMAIN_GROUP_LABELS[domain ?? ''] ||
            prettify(domain ?? ''),
          subtitle: eventPhrase,
          subtitleEntityId: singleEntityId,
          detail: !resolved && targetCount > 1 ? `${targetCount} targets` : null,
          iconDomain: iconKeyFor(resolved?.deviceClass, domain, resolved?.domain),
          place: resolved?.area,
          phrase: eventPhrase,
        };
      }

      switch (triggerType) {
        case 'device': {
          const deviceEntityId = typeof data.entity_id === 'string' ? data.entity_id : undefined;
          const deviceId = typeof data.device_id === 'string' ? data.device_id : undefined;
          const domain = typeof data.domain === 'string' ? data.domain : undefined;
          // A single device trigger is the common device-plus-home-name case
          // ("Vacuum - Home"): resolve it to the device/home name instead of the raw
          // domain:type pair. Falls back to the device_id itself if the
          // device registry lookup comes up empty (deleted device, etc.).
          const target = deviceEntityId
            ? resolveEntityTarget(deviceEntityId)
            : resolveDeviceTarget(deviceId, domain);
          const type = typeof data.type === 'string' ? data.type : undefined;
          const subtype = typeof data.subtype === 'string' ? data.subtype : undefined;
          return {
            title: data.alias || target?.label || t('nodes:types.trigger'),
            subtitle: type
              ? `${prettify(type)}${subtype ? ` (${prettify(subtype)})` : ''}`
              : getTriggerLabel(triggerType),
            subtitleEntityId: deviceEntityId,
            detail: null,
            iconDomain: iconKeyFor(target?.deviceClass, target?.domain, domain),
            place: target?.area,
          };
        }

        case 'state': {
          // HA stores entity_id as an array even for a single selected entity
          // (`entity_id: ["light.x"]`) — singleEntityIdFrom unwraps that so the
          // common single-entity case still resolves a friendly device/home
          // name instead of falling through to the generic "N entities" list.
          const entityIdField = data.entity_id;
          const singleEntityId = singleEntityIdFrom(entityIdField);
          const target = resolveEntityTarget(singleEntityId);
          // A device-class-aware phrase for binary_sensor on/off states — a
          // contact sensor should read "Opened"/"Closed", not the generic
          // "Turned on"/"Turned off" (which is what real HA's own more-info
          // dialog shows too). Falls back to the generic plain-language
          // "Turned on"/"Turned off" phrase when there's no device_class
          // match (matches the purpose-built dotted-trigger branch above,
          // which already gets this right for `door.opened`-style triggers —
          // this covers the same entities reached via the plain legacy
          // `state`/to:on/off shape instead, e.g. picked via a generic Area/
          // Entity path in the miller rather than its device-class-specific
          // "By type" row). Any other target state falls back to just naming
          // that state, and no target at all keeps the generic "State
          // Change" label rather than guessing a phrase.
          const phrase = stateTriggerPhrase(t, data.to, target?.deviceClass, holdsFor(data));
          return {
            title: data.alias || target?.label || getTriggerLabel(triggerType),
            subtitle: singleEntityId
              ? phrase || getTriggerLabel(triggerType)
              : Array.isArray(entityIdField) && entityIdField.length > 1
                ? `${t('nodes:pill.entities', { count: entityIdField.length })}:\n${entityNames(entityIdField)}`
                : getTriggerLabel(triggerType),
            subtitleEntityId: singleEntityId,
            detail: null,
            iconDomain: iconKeyFor(target?.deviceClass, target?.domain),
            place: target?.area,
            phrase: phrase || undefined,
          };
        }

        case 'numeric_state': {
          // Same array-unwrap + device/home name resolution as 'state' above.
          const entityIdField = data.entity_id;
          const singleEntityId = singleEntityIdFrom(entityIdField);
          const target = resolveEntityTarget(singleEntityId);
          const attribute = typeof data.attribute === 'string' ? data.attribute : undefined;
          return {
            title: data.alias || target?.label || getTriggerLabel(triggerType),
            subtitle: attribute
              ? t('nodes:triggers.cardPhrases.attributeThreshold', {
                  attribute: prettify(attribute),
                })
              : singleEntityId
                ? getTriggerLabel(triggerType)
                : Array.isArray(entityIdField) && entityIdField.length > 1
                  ? `${t('nodes:pill.entities', { count: entityIdField.length })}:\n${entityNames(entityIdField)}`
                  : getTriggerLabel(triggerType),
            subtitleEntityId: singleEntityId,
            detail: null,
            iconDomain: iconKeyFor(target?.deviceClass, target?.domain),
            place: target?.area,
            phrase: thresholdPhrase(t, attribute),
          };
        }

        case 'event':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: data.event_type || null,
          };

        case 'time':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: timeAtDetail(data.at, entityNames),
          };

        case 'sun':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: data.event ? `${data.event}${data.offset ? ` ${data.offset}` : ''}` : null,
          };

        case 'mqtt':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: data.topic || null,
          };

        case 'webhook':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: data.webhook_id || null,
          };

        case 'zone':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail:
              (typeof data.zone === 'string' && data.zone ? entityNames([data.zone]) : '') ||
              entityNames(entityIdList(data.entity_id)) ||
              null,
          };

        case 'tag':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: Array.isArray(data.tag_id) ? data.tag_id.join(', ') : data.tag_id || null,
          };

        case 'geo_location':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: data.source || null,
          };

        case 'conversation':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: Array.isArray(data.command) ? data.command.join(', ') : data.command || null,
          };

        case 'persistent_notification':
          return {
            title: data.alias || getTriggerLabel(triggerType),
            subtitle: getTriggerLabel(triggerType),
            detail: data.notification_id || null,
          };

        default:
          return {
            title: data.alias || getTriggerLabel(triggerType) || t('nodes:types.trigger'),
            subtitle: getTriggerLabel(triggerType) || triggerType,
            detail: null,
          };
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: triggerPlatformLabels/getTriggerLabel are recreated every render off `t`, which is itself already a dependency — including them would just re-add `t` transitively.
    [t, resolveEntityTarget, resolveDeviceTarget, entityNames]
  );

  return { getTriggerDisplayInfo };
}
