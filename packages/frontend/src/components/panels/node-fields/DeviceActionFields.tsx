import type { FlowNode } from '@circuitry/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { DeviceSelector } from '@/components/ui/DeviceSelector';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHass } from '@/contexts/HassContext';
import { HaSelect, HaSelector } from '@/ha';
import type { DeviceAction, TriggerField } from '@/hooks/useDeviceAutomation';
import { useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useTranslations } from '@/hooks/useTranslations';
import { buildCompositeValue, getDeviceAutomationLabel } from '@/lib/deviceTriggerLabels';
import type { HassEntity } from '@/types/hass';
import { getNodeDataString } from '@/utils/nodeData';

interface DeviceActionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

function buildSelectedCompositeValue(
  selectedActionType: string,
  selectedSubtype: string,
  entityId: string
): string {
  const parts = [selectedActionType].filter(Boolean);
  if (selectedSubtype) parts.push(selectedSubtype);
  if (entityId) parts.push(entityId);
  return parts.join('::');
}

/**
 * Editor for genuinely device-specific actions (ZHA/deCONZ remote "press"
 * commands, "identify", IR-blaster commands, ...) — fetched live from
 * `device_automation/action/list`, distinct from a plain `domain.service`
 * call. See `lib/actionNodeData.ts`'s `deviceAction` case and
 * `useDeviceAutomation.ts`'s `DeviceAction` doc comment for how a node ends
 * up in this shape (device_id + domain + type, no `service`/`event`/`stop`
 * key at all).
 *
 * Previously there was no editor for this case whatsoever — ActionFields.tsx
 * only branched on stop/event/service, so a placed device action fell into
 * the "service" branch and rendered a service picker + target-entity UI
 * against data that has no `service` field: a completely broken editor for
 * this action type. Mirrors DeviceTriggerFields.tsx/DeviceConditionFields.tsx
 * exactly, for the action side.
 */
export function DeviceActionFields({ node, onChange, entities }: DeviceActionFieldsProps) {
  const { t } = useTranslation(['common', 'nodes', 'errors']);
  const { getDeviceActions, getActionCapabilities } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { entities: allEntities, getDeviceNameById } = useHass();

  const [availableDeviceActions, setAvailableDeviceActions] = useState<DeviceAction[]>([]);
  const [actionCapabilities, setActionCapabilities] = useState<TriggerField[]>([]);
  const [loadingActions, setLoadingActions] = useState(false);

  const deviceId = getNodeDataString(node, 'device_id');
  const deviceName = deviceId ? getDeviceNameById(deviceId) : null;
  const selectedActionType = getNodeDataString(node, 'type');
  const domain = getNodeDataString(node, 'domain');
  const entityId = getNodeDataString(node, 'entity_id');
  const selectedSubtype = getNodeDataString(node, 'subtype');

  const selectedCompositeValue = buildSelectedCompositeValue(
    selectedActionType,
    selectedSubtype,
    entityId
  );

  // HA's own device automation UI sorts these alphabetically by resolved
  // label rather than API response order — see DeviceTriggerFields.tsx's
  // matching sortedDeviceTriggers doc comment.
  const sortedDeviceActions = useMemo(
    () =>
      [...availableDeviceActions].sort((a, b) =>
        getDeviceAutomationLabel(
          'action',
          a,
          translations,
          allEntities,
          deviceName
        ).localeCompare(getDeviceAutomationLabel('action', b, translations, allEntities, deviceName))
      ),
    [availableDeviceActions, translations, allEntities, deviceName]
  );

  useEffect(() => {
    if (!deviceId) {
      setAvailableDeviceActions([]);
      return;
    }

    setLoadingActions(true);
    getDeviceActions(deviceId)
      .then((actions) => {
        setAvailableDeviceActions(actions);
      })
      .catch((error) => {
        console.error(t('errors:api.loadDeviceActionsFailed'), error);
        setAvailableDeviceActions([]);
      })
      .finally(() => {
        setLoadingActions(false);
      });
  }, [deviceId, getDeviceActions, t]);

  useEffect(() => {
    if (!deviceId || !selectedActionType) {
      setActionCapabilities([]);
      return;
    }

    const action = availableDeviceActions.find(
      (a) =>
        a.type === selectedActionType &&
        a.domain === domain &&
        (a.subtype ?? '') === (selectedSubtype ?? '') &&
        (a.entity_id ?? '') === (entityId ?? '')
    );

    if (!action) {
      setActionCapabilities([]);
      return;
    }

    getActionCapabilities(action)
      .then((capabilities) => {
        setActionCapabilities(capabilities.extra_fields || []);
      })
      .catch((error) => {
        console.error(t('errors:api.loadActionCapabilitiesFailed'), error);
        setActionCapabilities([]);
      });
  }, [
    deviceId,
    selectedActionType,
    selectedSubtype,
    entityId,
    domain,
    availableDeviceActions,
    getActionCapabilities,
    t,
  ]);

  const handleActionTypeSelected = (value: string) => {
    const action = availableDeviceActions.find((a) => buildCompositeValue(a) === value);
    if (action) {
      onChange('type', action.type);
      onChange('domain', action.domain);
      onChange('subtype', action.subtype ?? undefined);
      onChange('entity_id', action.entity_id ?? undefined);
    }
  };

  return (
    <>
      <HaSelector
        selector={{ device: {} }}
        value={deviceId}
        onChange={(val) => onChange('device_id', typeof val === 'string' ? val : '')}
        label={t('common:labels.device')}
        required
        fallback={
          <DeviceSelector
            value={deviceId}
            onChange={(val) => onChange('device_id', val)}
            label={t('common:labels.device')}
            required
            placeholder={t('common:placeholders.selectDevice')}
          />
        }
      />

      {deviceId && sortedDeviceActions.length > 0 ? (
        <FormField label={t('nodes:actions.actionLabel')} required>
          <HaSelect
            value={selectedCompositeValue}
            onChange={(v) => handleActionTypeSelected(String(v))}
            options={sortedDeviceActions.map((action) => ({
              value: buildCompositeValue(action),
              label: getDeviceAutomationLabel(
                'action',
                action,
                translations,
                allEntities,
                deviceName
              ),
            }))}
            fallback={
              <Select value={selectedCompositeValue} onValueChange={handleActionTypeSelected}>
                <SelectTrigger>
                  <SelectValue placeholder={t('nodes:actions.selectAction')} />
                </SelectTrigger>
                <SelectContent>
                  {sortedDeviceActions.map((action) => (
                    <SelectItem
                      key={buildCompositeValue(action)}
                      value={buildCompositeValue(action)}
                    >
                      {getDeviceAutomationLabel(
                        'action',
                        action,
                        translations,
                        allEntities,
                        deviceName
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </FormField>
      ) : (
        deviceId &&
        selectedActionType && (
          <FormField label={t('nodes:actions.actionLabel')}>
            <TruncatedTooltip
              content={`${selectedActionType}${selectedSubtype ? ` · ${selectedSubtype}` : ''}${domain ? ` (${domain})` : ''}`}
            >
              <div className="truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm">
                {selectedActionType}
                {selectedSubtype && (
                  <span className="text-muted-foreground">
                    {' · '}
                    {selectedSubtype}
                  </span>
                )}
                {domain && <span className="text-muted-foreground"> {`(${domain})`}</span>}
              </div>
            </TruncatedTooltip>
          </FormField>
        )
      )}

      {loadingActions && (
        <div className="text-muted-foreground text-sm">{t('common:status.loadingTriggers')}</div>
      )}

      {actionCapabilities.map((field) => (
        <DynamicFieldRenderer
          key={field.name}
          field={field}
          value={(node.data as Record<string, unknown>)[field.name]}
          onChange={(value) => onChange(field.name, value)}
          entities={entities}
          domain={domain}
          translations={translations}
        />
      ))}
    </>
  );
}
