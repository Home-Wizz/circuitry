import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DOMAIN_GROUP_LABELS } from '@/components/panels/node-fields/TriggerTypePicker';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { BINARY_SENSOR_CLASSES } from '@/lib/triggerRecipes';
import { prettify, singleEntityIdFrom } from '@/lib/utils';
import type { TriggerNodeData } from '@/store/flow-store';

export interface TriggerDisplayInfo {
  title: string;
  subtitle: string | undefined;
  /** Set only when `subtitle` is a genuine single entity_id, so it can be made clickable. */
  subtitleEntityId?: string;
  detail: unknown;
  /** Domain to look up a card icon for (lib/domain-icons.ts) — falls back to the generic Zap icon when unset. */
  iconDomain?: string;
}

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
export function useTriggerCardDisplay() {
  const { t } = useTranslation(['nodes']);
  const { resolveEntityTarget, resolveDeviceTarget } = useNodeCardDisplay();

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
        const eventPhrase =
          event === 'turned_on'
            ? t('nodes:triggers.cardPhrases.turnedOn')
            : event === 'turned_off'
              ? t('nodes:triggers.cardPhrases.turnedOff')
              : t(`nodes:triggers.nativeEvents.${event}`, { defaultValue: prettify(event ?? '') });
        const targetCount = (
          [target.entity_id, target.device_id, target.area_id, target.floor_id, target.label_id] as (
            | string
            | string[]
            | undefined
          )[]
        ).flatMap((v) => (Array.isArray(v) ? v : v ? [v] : [])).length;
        return {
          title: data.alias || resolved?.label || DOMAIN_GROUP_LABELS[domain ?? ''] || prettify(domain ?? ''),
          subtitle: eventPhrase,
          subtitleEntityId: singleEntityId,
          detail: !resolved && targetCount > 1 ? `${targetCount} targets` : null,
          iconDomain: resolved?.domain ?? domain,
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
            iconDomain: target?.domain ?? domain,
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
          const binaryClass = target?.deviceClass ? BINARY_SENSOR_CLASSES[target.deviceClass] : undefined;
          const phrase =
            data.to === 'on'
              ? (binaryClass?.onLabel ?? t('nodes:triggers.cardPhrases.turnedOn'))
              : data.to === 'off'
                ? (binaryClass?.offLabel ?? t('nodes:triggers.cardPhrases.turnedOff'))
                : (data.to ?? undefined);
          return {
            title: data.alias || target?.label || getTriggerLabel(triggerType),
            subtitle: singleEntityId
              ? phrase || getTriggerLabel(triggerType)
              : Array.isArray(entityIdField) && entityIdField.length > 1
                ? `${entityIdField.length} entities:\n${entityIdField.join(', ')}`
                : getTriggerLabel(triggerType),
            subtitleEntityId: singleEntityId,
            detail: null,
            iconDomain: target?.domain,
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
              ? t('nodes:triggers.cardPhrases.attributeThreshold', { attribute: prettify(attribute) })
              : singleEntityId
                ? getTriggerLabel(triggerType)
                : Array.isArray(entityIdField) && entityIdField.length > 1
                  ? `${entityIdField.length} entities:\n${entityIdField.join(', ')}`
                  : getTriggerLabel(triggerType),
            subtitleEntityId: singleEntityId,
            detail: null,
            iconDomain: target?.domain,
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
            detail: data.at
              ? typeof data.at === 'string'
                ? data.at
                : `${(data.at as Record<string, unknown>).entity_id || ''}${(data.at as Record<string, unknown>).offset ? ` (${(data.at as Record<string, unknown>).offset})` : ''}`
              : null,
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
              data.zone ||
              (Array.isArray(data.entity_id) ? data.entity_id.join(', ') : data.entity_id) ||
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
    [t, resolveEntityTarget, resolveDeviceTarget]
  );

  return { getTriggerDisplayInfo };
}
