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
import type { DeviceTrigger, TriggerField } from '@/hooks/useDeviceAutomation';
import { useDeviceAutomation } from '@/hooks/useDeviceAutomation';
import { useTranslations } from '@/hooks/useTranslations';
import { buildCompositeValue, getTriggerLabel } from '@/lib/deviceTriggerLabels';
import type { HassEntity } from '@/types/hass';
import { getNodeDataString } from '@/utils/nodeData';

interface DeviceTriggerFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

/**
 * Composite value uniquely identifying the currently-selected trigger:
 * type[::subtype][::entity_id] — same shape as lib/deviceTriggerLabels.ts's
 * buildCompositeValue, but that helper requires a non-empty `type` (and
 * `domain`), whereas the node's `type`/`subtype`/`entity_id` fields may
 * still be unset here (before the user has picked a trigger type), so it
 * can't be reused as-is without weakening its types. Extracted to a named
 * helper (rather than an inline IIFE) per CLAUDE.md's no-IIFE rule.
 */
function buildSelectedCompositeValue(
  selectedTriggerType: string,
  selectedSubtype: string,
  entityId: string
): string {
  const parts = [selectedTriggerType].filter(Boolean);
  if (selectedSubtype) parts.push(selectedSubtype);
  if (entityId) parts.push(entityId);
  return parts.join('::');
}

/**
 * Component for device trigger fields with dynamic API-based rendering.
 * Moved from PropertyPanel and updated to use new hooks.
 */
export function DeviceTriggerFields({ node, onChange, entities }: DeviceTriggerFieldsProps) {
  const { t } = useTranslation(['common', 'nodes', 'errors']);
  const { getDeviceTriggers, getTriggerCapabilities } = useDeviceAutomation();
  const { translations } = useTranslations();
  const { entities: allEntities, getDeviceNameById } = useHass();

  const [availableDeviceTriggers, setAvailableDeviceTriggers] = useState<DeviceTrigger[]>([]);
  const [triggerCapabilities, setTriggerCapabilities] = useState<TriggerField[]>([]);
  const [loadingTriggers, setLoadingTriggers] = useState(false);

  const deviceId = getNodeDataString(node, 'device_id');
  const deviceName = deviceId ? getDeviceNameById(deviceId) : null;
  const selectedTriggerType = getNodeDataString(node, 'type');
  const domain = getNodeDataString(node, 'domain');
  const entityId = getNodeDataString(node, 'entity_id');
  const selectedSubtype = getNodeDataString(node, 'subtype');

  // Build the composite value that uniquely identifies the selected trigger
  const selectedCompositeValue = buildSelectedCompositeValue(
    selectedTriggerType,
    selectedSubtype,
    entityId
  );

  // HA's own device automation UI sorts trigger types alphabetically by
  // their resolved label rather than showing them in whatever order the
  // integration's `device_automation/trigger/list` response happens to
  // return them in (typically declaration order, not alphabetical) —
  // matched here so the dropdown reads the same way it does in real HA.
  const sortedDeviceTriggers = useMemo(
    () =>
      [...availableDeviceTriggers].sort((a, b) =>
        getTriggerLabel(a, translations, allEntities, deviceName).localeCompare(
          getTriggerLabel(b, translations, allEntities, deviceName)
        )
      ),
    [availableDeviceTriggers, translations, allEntities, deviceName]
  );

  // Fetch triggers when device is selected
  useEffect(() => {
    if (!deviceId) {
      setAvailableDeviceTriggers([]);
      return;
    }

    setLoadingTriggers(true);
    getDeviceTriggers(deviceId)
      .then((triggers) => {
        setAvailableDeviceTriggers(triggers);
      })
      .catch((error) => {
        console.error(t('errors:api.loadDeviceTriggersFailed'), error);
        setAvailableDeviceTriggers([]);
      })
      .finally(() => {
        setLoadingTriggers(false);
      });
  }, [deviceId, getDeviceTriggers, t]);

  // Fetch capabilities when trigger type is selected
  useEffect(() => {
    if (!deviceId || !selectedTriggerType) {
      setTriggerCapabilities([]);
      return;
    }

    // Find the full trigger object from the list - HA API needs the complete trigger
    const trigger = availableDeviceTriggers.find(
      (tr) =>
        tr.type === selectedTriggerType &&
        tr.domain === domain &&
        (tr.subtype ?? '') === (selectedSubtype ?? '') &&
        (tr.entity_id ?? '') === (entityId ?? '')
    );

    if (!trigger) {
      setTriggerCapabilities([]);
      return;
    }

    getTriggerCapabilities(trigger)
      .then((capabilities) => {
        setTriggerCapabilities(capabilities.extra_fields || []);
      })
      .catch((error) => {
        console.error(t('errors:api.loadTriggerCapabilitiesFailed'), error);
        setTriggerCapabilities([]);
      });
  }, [
    deviceId,
    selectedTriggerType,
    selectedSubtype,
    entityId,
    domain,
    availableDeviceTriggers,
    getTriggerCapabilities,
    t,
  ]);

  const handleTriggerTypeSelected = (value: string) => {
    const trigger = availableDeviceTriggers.find((tr) => buildCompositeValue(tr) === value);
    if (trigger) {
      onChange('type', trigger.type);
      onChange('domain', trigger.domain);
      onChange('subtype', trigger.subtype ?? undefined);
      // Set entity_id from the trigger — required by HA for device automation triggers
      onChange('entity_id', trigger.entity_id ?? undefined);
    }
  };

  return (
    <>
      {/* Device selector */}
      <HaSelector
        selector={{ device: {} }}
        value={deviceId}
        onChange={(val) => onChange('device_id', typeof val === 'string' ? val : '')}
        label={t('labels.device')}
        required
        fallback={
          <DeviceSelector
            value={deviceId}
            onChange={(val) => onChange('device_id', val)}
            label={t('labels.device')}
            required
            placeholder={t('placeholders.selectDevice')}
          />
        }
      />

      {/* Trigger type selector - show dropdown if API data available, otherwise show as text */}
      {deviceId && sortedDeviceTriggers.length > 0 ? (
        <FormField label={t('labels.triggerType')} required>
          <HaSelect
            value={selectedCompositeValue}
            onChange={(v) => handleTriggerTypeSelected(String(v))}
            options={sortedDeviceTriggers.map((trigger) => ({
              value: buildCompositeValue(trigger),
              label: getTriggerLabel(trigger, translations, allEntities, deviceName),
            }))}
            fallback={
              <Select value={selectedCompositeValue} onValueChange={handleTriggerTypeSelected}>
                <SelectTrigger>
                  <SelectValue placeholder={t('placeholders.selectTriggerType')} />
                </SelectTrigger>
                <SelectContent>
                  {sortedDeviceTriggers.map((trigger) => (
                    <SelectItem
                      key={buildCompositeValue(trigger)}
                      value={buildCompositeValue(trigger)}
                    >
                      {getTriggerLabel(trigger, translations, allEntities, deviceName)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </FormField>
      ) : (
        /* Show existing type/domain as read-only when API not available */
        deviceId &&
        selectedTriggerType && (
          <FormField label="Trigger Type">
            <TruncatedTooltip
              content={`${selectedTriggerType}${selectedSubtype ? ` · ${selectedSubtype}` : ''}${domain ? ` (${domain})` : ''}`}
            >
            <div className="truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {selectedTriggerType}
              {selectedSubtype && (
                <span className="text-muted-foreground">
                  {' \u00B7 '}
                  {selectedSubtype}
                </span>
              )}
              {domain && <span className="text-muted-foreground"> {`(${domain})`}</span>}
            </div>
            </TruncatedTooltip>
          </FormField>
        )
      )}

      {/* Loading state */}
      {loadingTriggers && (
        <div className="text-muted-foreground text-sm">{t('status.loadingTriggers')}</div>
      )}

      {/* Dynamic fields from capabilities API */}
      {triggerCapabilities.map((field) => (
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
