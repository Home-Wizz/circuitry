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
import type { DeviceCondition, TriggerField } from '@/hooks/useDeviceAutomation';
import { useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useTranslations } from '@/hooks/useTranslations';
import { buildCompositeValue, getDeviceAutomationLabel } from '@/lib/deviceTriggerLabels';
import type { HassEntity } from '@/types/hass';
import { getNodeDataString } from '@/utils/nodeData';

interface DeviceConditionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

/**
 * Composite value uniquely identifying the currently-selected condition —
 * same type[::subtype][::entity_id] shape as DeviceTriggerFields.tsx's
 * buildSelectedCompositeValue.
 */
function buildSelectedCompositeValue(
  selectedConditionType: string,
  selectedSubtype: string,
  entityId: string
): string {
  const parts = [selectedConditionType].filter(Boolean);
  if (selectedSubtype) parts.push(selectedSubtype);
  if (entityId) parts.push(entityId);
  return parts.join('::');
}

/**
 * Component for device condition fields with dynamic API-based rendering —
 * the condition-side sibling of DeviceTriggerFields.tsx. Previously this was
 * a fully hardcoded stub (device picker + raw text `domain`/`type` inputs,
 * no `entity_id`, no live API calls) — real device conditions found via
 * `device_automation/condition/list` (e.g. "Battery level" checks, ZHA
 * conditions) always carry an `entity_id` alongside `device_id`/`domain`/
 * `type`, and many also have extra fields (numeric thresholds, `for`, ...)
 * only discoverable via `device_automation/condition/capabilities` — neither
 * was reachable through the old stub once a device condition was placed on
 * the canvas.
 */
export function DeviceConditionFields({ node, onChange, entities }: DeviceConditionFieldsProps) {
  const { t } = useTranslation(['common', 'nodes', 'errors']);
  const { getDeviceConditions, getConditionCapabilities } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { entities: allEntities, getDeviceNameById } = useHass();

  const [availableDeviceConditions, setAvailableDeviceConditions] = useState<DeviceCondition[]>(
    []
  );
  const [conditionCapabilities, setConditionCapabilities] = useState<TriggerField[]>([]);
  const [loadingConditions, setLoadingConditions] = useState(false);

  const deviceId = getNodeDataString(node, 'device_id');
  const deviceName = deviceId ? getDeviceNameById(deviceId) : null;
  const selectedConditionType = getNodeDataString(node, 'type');
  const domain = getNodeDataString(node, 'domain');
  const entityId = getNodeDataString(node, 'entity_id');
  const selectedSubtype = getNodeDataString(node, 'subtype');

  const selectedCompositeValue = buildSelectedCompositeValue(
    selectedConditionType,
    selectedSubtype,
    entityId
  );

  // HA's own device automation UI sorts these alphabetically by resolved
  // label rather than API response order — see DeviceTriggerFields.tsx's
  // matching sortedDeviceTriggers doc comment.
  const sortedDeviceConditions = useMemo(
    () =>
      [...availableDeviceConditions].sort((a, b) =>
        getDeviceAutomationLabel(
          'condition',
          a,
          translations,
          allEntities,
          deviceName
        ).localeCompare(
          getDeviceAutomationLabel('condition', b, translations, allEntities, deviceName)
        )
      ),
    [availableDeviceConditions, translations, allEntities, deviceName]
  );

  // Fetch conditions when device is selected
  useEffect(() => {
    if (!deviceId) {
      setAvailableDeviceConditions([]);
      return;
    }

    setLoadingConditions(true);
    getDeviceConditions(deviceId)
      .then((conditions) => {
        setAvailableDeviceConditions(conditions);
      })
      .catch((error) => {
        console.error(t('errors:api.loadDeviceConditionsFailed'), error);
        setAvailableDeviceConditions([]);
      })
      .finally(() => {
        setLoadingConditions(false);
      });
  }, [deviceId, getDeviceConditions, t]);

  // Fetch capabilities when condition type is selected
  useEffect(() => {
    if (!deviceId || !selectedConditionType) {
      setConditionCapabilities([]);
      return;
    }

    const condition = availableDeviceConditions.find(
      (c) =>
        c.type === selectedConditionType &&
        c.domain === domain &&
        (c.subtype ?? '') === (selectedSubtype ?? '') &&
        (c.entity_id ?? '') === (entityId ?? '')
    );

    if (!condition) {
      setConditionCapabilities([]);
      return;
    }

    getConditionCapabilities(condition)
      .then((capabilities) => {
        setConditionCapabilities(capabilities.extra_fields || []);
      })
      .catch((error) => {
        console.error(t('errors:api.loadConditionCapabilitiesFailed'), error);
        setConditionCapabilities([]);
      });
  }, [
    deviceId,
    selectedConditionType,
    selectedSubtype,
    entityId,
    domain,
    availableDeviceConditions,
    getConditionCapabilities,
    t,
  ]);

  const handleConditionTypeSelected = (value: string) => {
    const condition = availableDeviceConditions.find((c) => buildCompositeValue(c) === value);
    if (condition) {
      onChange('type', condition.type);
      onChange('domain', condition.domain);
      onChange('subtype', condition.subtype ?? undefined);
      // Set entity_id from the condition — real device conditions always
      // carry it alongside device_id/domain/type.
      onChange('entity_id', condition.entity_id ?? undefined);
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

      {deviceId && sortedDeviceConditions.length > 0 ? (
        <FormField label={t('nodes:deviceCondition.typeLabel')} required>
          <HaSelect
            value={selectedCompositeValue}
            onChange={(v) => handleConditionTypeSelected(String(v))}
            options={sortedDeviceConditions.map((condition) => ({
              value: buildCompositeValue(condition),
              label: getDeviceAutomationLabel(
                'condition',
                condition,
                translations,
                allEntities,
                deviceName
              ),
            }))}
            fallback={
              <Select value={selectedCompositeValue} onValueChange={handleConditionTypeSelected}>
                <SelectTrigger>
                  <SelectValue placeholder={t('common:placeholders.selectTriggerType')} />
                </SelectTrigger>
                <SelectContent>
                  {sortedDeviceConditions.map((condition) => (
                    <SelectItem
                      key={buildCompositeValue(condition)}
                      value={buildCompositeValue(condition)}
                    >
                      {getDeviceAutomationLabel(
                        'condition',
                        condition,
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
        selectedConditionType && (
          <FormField label={t('nodes:deviceCondition.typeLabel')}>
            <TruncatedTooltip
              content={`${selectedConditionType}${selectedSubtype ? ` · ${selectedSubtype}` : ''}${domain ? ` (${domain})` : ''}`}
            >
              <div className="truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm">
                {selectedConditionType}
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

      {loadingConditions && (
        <div className="text-muted-foreground text-sm">{t('common:status.loadingTriggers')}</div>
      )}

      {conditionCapabilities.map((field) => (
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
