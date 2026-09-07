import type { FlowNode, Target } from '@circuitry/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { Combobox } from '@/components/ui/Combobox';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import { IdList } from '@/components/ui/IdList';
import { Input } from '@/components/ui/input';
import { MultiEntitySelector } from '@/components/ui/MultiEntitySelector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { FieldConfig } from '@/config/triggerFields';
import { useHass } from '@/contexts/HassContext';
import { HaSelect, HaSelector, HaServicePicker, HaSwitch } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { prettify } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';
import { getNodeDataObject, getNodeDataString } from '@/utils/nodeData';
import { ContinueOnErrorField } from './ContinueOnErrorField';
import { DeviceActionFields } from './DeviceActionFields';
import { ResponseVariableField } from './ResponseVariableField';
import { ServiceDataFields } from './ServiceDataFields';

// Domains where any entity type can be targeted — don't filter
const MULTI_DOMAIN_SERVICES = new Set(['homeassistant', 'group']);

// Fire-event action's `event_data` payload — deliberately a distinct field
// `name` from triggerFields.ts's own `event_data` (the `event` trigger
// platform's filter field): both resolve the same "Event data (optional)"
// i18n label (nodes:fieldLabels), but their *descriptions* mean opposite
// things (trigger: filter incoming events by these fields; action: the
// payload sent out with the fired event), and DynamicFieldRenderer keys both
// label and description lookups off the same `field.name` — so reusing the
// exact same name would also reuse the trigger's filter-specific description
// text here, which would be wrong. See fieldDescriptions.fire_event_data.
const EVENT_DATA_FIELD: FieldConfig = {
  name: 'fire_event_data',
  label: 'Event Data',
  type: 'object',
  required: false,
};

// repeat.for_each — home-assistant.io/docs/scripts/#for-each: "accepts a
// list of items to iterate over. The list of items can be a pre-defined
// list, or a list created by a template." List items can be plain values or
// mappings (dicts), used as `repeat.item` / `repeat.item.<key>` in the
// nested sequence.
const FOR_EACH_ITEMS_FIELD: FieldConfig = {
  name: 'for_each_items',
  label: 'Items',
  type: 'object',
  required: false,
};

const FOR_EACH_TEMPLATE_FIELD: FieldConfig = {
  name: 'for_each_template',
  label: 'Items template',
  type: 'template',
  required: false,
};

/** Narrows an `ha-selector` `value-changed` payload (always an array for multiple:true selectors) to string[]. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Filter entities for the target selector based on the selected service.
 * For most services (e.g. scene.turn_on), only entities in the same domain
 * are valid targets. For generic services (homeassistant.*), all entities apply.
 */
function getTargetEntities(serviceName: string, entities: HassEntity[]): HassEntity[] {
  if (!serviceName || !serviceName.includes('.')) return entities;
  const domain = serviceName.split('.')[0];
  if (MULTI_DOMAIN_SERVICES.has(domain)) return entities;
  const filtered = entities.filter((e) => e.entity_id.startsWith(`${domain}.`));
  // Fall back to all entities if the domain has no matching entities
  return filtered.length > 0 ? filtered : entities;
}

interface ActionFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

export function ActionFields({ node, onChange, entities }: ActionFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const { getAllServices, getServiceDefinition } = useHass();
  const { getFieldError } = useNodeErrors(node.id);
  const serviceName = getNodeDataString(node, 'service');
  const eventName = getNodeDataString(node, 'event');
  const nodeData = node.data as Record<string, unknown>;
  const stopMessage = typeof nodeData.stop === 'string' ? nodeData.stop : undefined;
  const isStopError = nodeData.error === true;

  // Genuinely device-specific actions (ZHA/deCONZ remote "press" commands,
  // "identify", ...) carry device_id/domain/type with no service/event/stop
  // key at all — see lib/actionNodeData.ts's `deviceAction` case and
  // DeviceActionFields.tsx's doc comment for why this needs its own branch:
  // without it, this shape fell into the "service" render below and showed a
  // service picker + target-entity UI against data that has no `service`
  // field, a completely broken editor for this action type.
  const deviceActionDeviceId = getNodeDataString(node, 'device_id');
  const deviceActionDomain = getNodeDataString(node, 'domain');
  const deviceActionType = getNodeDataString(node, 'type');
  const isDeviceAction =
    !serviceName &&
    !eventName &&
    stopMessage === undefined &&
    !!deviceActionDeviceId &&
    !!deviceActionDomain &&
    !!deviceActionType;

  const serviceDefinition = getServiceDefinition(serviceName);
  const serviceFields = serviceDefinition?.fields || {};
  const currentData = getNodeDataObject(node, 'data', {});
  const responseVariable = getNodeDataString(node, 'response_variable');
  const [showResponseVariable, setShowResponseVariable] = useState(!!responseVariable);
  const continueOnError = nodeData.continue_on_error === true;

  // Detect opaque repeat node (repeat.count or repeat.for_each stored in data.repeat)
  const repeatData =
    nodeData.repeat !== null && typeof nodeData.repeat === 'object'
      ? (nodeData.repeat as Record<string, unknown>)
      : null;
  const isForEachRepeat = repeatData !== null && repeatData.for_each !== undefined;
  const isRepeatNode =
    repeatData !== null && (repeatData.count !== undefined || isForEachRepeat);

  // Determine action type: stop > event > service
  const actionType = stopMessage !== undefined ? 'stop' : eventName ? 'event' : 'service';

  // Keep toggle in sync if node changes externally
  useEffect(() => {
    setShowResponseVariable(!!responseVariable);
  }, [responseVariable]);

  const handleActionTypeChange = (type: string) => {
    if (type === 'stop') {
      onChange('service', undefined);
      onChange('target', undefined);
      onChange('data', undefined);
      onChange('event', undefined);
      onChange('event_data', undefined);
      onChange('stop', '');
      onChange('error', undefined);
    } else if (type === 'event') {
      onChange('service', undefined);
      onChange('target', undefined);
      onChange('data', undefined);
      onChange('stop', undefined);
      onChange('error', undefined);
    } else {
      onChange('event', undefined);
      onChange('event_data', undefined);
      onChange('stop', undefined);
      onChange('error', undefined);
    }
  };

  const handleServiceChange = (value: string) => {
    onChange('service', value);
    // Clear data when service changes
    onChange('data', undefined);
  };

  const handleEntityTargetChange = (value: string[]) => {
    const currentTarget = getNodeDataObject(node, 'target', {});
    const newTarget = { ...currentTarget, entity_id: value.length > 0 ? value : undefined };
    // Clean up empty arrays/undefined values
    if (!newTarget.entity_id) delete newTarget.entity_id;
    onChange('target', Object.keys(newTarget).length > 0 ? newTarget : undefined);
  };

  const handleDeviceTargetChange = (value: string[]) => {
    const currentTarget = getNodeDataObject(node, 'target', {});
    const newTarget = { ...currentTarget, device_id: value.length > 0 ? value : undefined };
    if (!newTarget.device_id) delete newTarget.device_id;
    onChange('target', Object.keys(newTarget).length > 0 ? newTarget : undefined);
  };

  const handleAreaTargetChange = (value: string[]) => {
    const currentTarget = getNodeDataObject(node, 'target', {});
    const newTarget = { ...currentTarget, area_id: value.length > 0 ? value : undefined };
    if (!newTarget.area_id) delete newTarget.area_id;
    onChange('target', Object.keys(newTarget).length > 0 ? newTarget : undefined);
  };

  const handleLabelTargetChange = (value: string[]) => {
    const currentTarget = getNodeDataObject(node, 'target', {});
    const newTarget = { ...currentTarget, label_id: value.length > 0 ? value : undefined };
    if (!newTarget.label_id) delete newTarget.label_id;
    onChange('target', Object.keys(newTarget).length > 0 ? newTarget : undefined);
  };

  const handleFloorTargetChange = (value: string[]) => {
    const currentTarget = getNodeDataObject(node, 'target', {});
    const newTarget = { ...currentTarget, floor_id: value.length > 0 ? value : undefined };
    if (!newTarget.floor_id) delete newTarget.floor_id;
    onChange('target', Object.keys(newTarget).length > 0 ? newTarget : undefined);
  };

  const handleDataFieldChange = (fieldName: string, value: unknown) => {
    const newData = { ...currentData, [fieldName]: value === '' ? undefined : value };
    // Clean up undefined values
    const cleanedData = Object.fromEntries(
      Object.entries(newData).filter(([, v]) => v !== undefined && v !== '')
    );
    onChange('data', Object.keys(cleanedData).length > 0 ? cleanedData : undefined);
  };

  const handleResponseVariableChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('response_variable', e.target.value === '' ? undefined : e.target.value);
  };

  const handleContinueOnErrorChange = (checked: boolean) => {
    onChange('continue_on_error', checked || undefined);
  };

  // Extract target values (entity_id, device_id, area_id, label_id, floor_id)
  const target = getNodeDataObject(node, 'target', {}) as Target;

  // Helper to normalize string | string[] to string[]
  const normalizeToArray = (value: string | string[] | undefined): string[] => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  };

  const targetEntityIdArray = normalizeToArray(target.entity_id);
  const targetDeviceIdArray = normalizeToArray(target.device_id);
  const targetAreaIdArray = normalizeToArray(target.area_id);
  const targetLabelIdArray = normalizeToArray(target.label_id);
  const targetFloorIdArray = normalizeToArray(target.floor_id);

  // Check if we have any device, area, label or floor targets (to show those fields)
  const hasDeviceTargets = targetDeviceIdArray.length > 0;
  const hasAreaTargets = targetAreaIdArray.length > 0;
  const hasLabelTargets = targetLabelIdArray.length > 0;
  const hasFloorTargets = targetFloorIdArray.length > 0;

  if (isDeviceAction) {
    return <DeviceActionFields node={node} onChange={onChange} entities={entities} />;
  }

  if (isRepeatNode) {
    const seqLength = Array.isArray(repeatData!.sequence) ? repeatData!.sequence.length : 0;
    const sequenceSummary = seqLength > 0 && (
      <FormField label={t('nodes:actions.repeatSequenceLabel')}>
        <div className="text-muted-foreground text-sm">
          {t('nodes:actions.repeatActions', { count: seqLength })}
        </div>
      </FormField>
    );

    if (isForEachRepeat) {
      // for_each accepts either a literal list of items (strings or mappings,
      // used as repeat.item / repeat.item.<key>) or a single Jinja2 template
      // string that evaluates to a list — home-assistant.io/docs/scripts/#for-each.
      // Mode is derived from the value's current shape rather than a separate
      // stored flag, so it can never drift out of sync with the actual data.
      const forEachValue = repeatData!.for_each;
      const isTemplateMode = typeof forEachValue === 'string';
      const forEachMode = isTemplateMode ? 'template' : 'list';
      const handleForEachModeChange = (mode: string) => {
        onChange('repeat', {
          ...repeatData,
          for_each: mode === 'template' ? '' : [],
        });
      };
      return (
        <>
          <FormField label={t('nodes:actions.actionTypeLabel')}>
            <div className="rounded-md border border-delay/30 bg-delay/10 px-3 py-2 text-delay text-sm font-medium">
              {t('nodes:actions.repeatForEachLabel')}
            </div>
          </FormField>
          <FormField label={t('nodes:actions.repeatForEachModeLabel')} required>
            <HaSelect
              value={forEachMode}
              onChange={(v) => handleForEachModeChange(String(v))}
              options={[
                { value: 'list', label: t('nodes:actions.repeatForEachModeList') },
                { value: 'template', label: t('nodes:actions.repeatForEachModeTemplate') },
              ]}
              fallback={
                <Select value={forEachMode} onValueChange={handleForEachModeChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="list">
                      {t('nodes:actions.repeatForEachModeList')}
                    </SelectItem>
                    <SelectItem value="template">
                      {t('nodes:actions.repeatForEachModeTemplate')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </FormField>
          {isTemplateMode ? (
            <DynamicFieldRenderer
              field={FOR_EACH_TEMPLATE_FIELD}
              value={forEachValue}
              onChange={(value) => onChange('repeat', { ...repeatData, for_each: value })}
            />
          ) : (
            <DynamicFieldRenderer
              field={FOR_EACH_ITEMS_FIELD}
              value={Array.isArray(forEachValue) ? forEachValue : []}
              onChange={(value) => onChange('repeat', { ...repeatData, for_each: value })}
            />
          )}
          {sequenceSummary}
          <ContinueOnErrorField checked={continueOnError} onChange={handleContinueOnErrorChange} />
        </>
      );
    }

    const countValue =
      typeof repeatData!.count === 'number' || typeof repeatData!.count === 'string'
        ? String(repeatData!.count)
        : '';
    const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const parsed = Number.parseInt(raw, 10);
      const nextCount = raw === '' ? 1 : Number.isNaN(parsed) ? raw : Math.max(1, parsed);
      onChange('repeat', { ...repeatData, count: nextCount });
    };
    return (
      <>
        <FormField label={t('nodes:actions.actionTypeLabel')}>
          <div className="rounded-md border border-delay/30 bg-delay/10 px-3 py-2 text-delay text-sm font-medium">
            {t('nodes:actions.repeatLabel', { n: String(repeatData!.count) })}
          </div>
        </FormField>
        <FormField
          label={t('nodes:actions.repeatCountLabel')}
          description={t('nodes:actions.repeatCountDescription')}
          required
        >
          <Input type="number" min={1} value={countValue} onChange={handleCountChange} />
        </FormField>
        {sequenceSummary}
        <ContinueOnErrorField checked={continueOnError} onChange={handleContinueOnErrorChange} />
      </>
    );
  }

  return (
    <>
      {/* Action type selector */}
      <FormField label={t('nodes:actions.actionTypeLabel')} required>
        <HaSelect
          value={actionType}
          onChange={(v) => handleActionTypeChange(String(v))}
          options={[
            { value: 'service', label: t('nodes:actions.actionTypes.service') },
            { value: 'event', label: t('nodes:actions.actionTypes.event') },
            { value: 'stop', label: t('nodes:actions.actionTypes.stop') },
          ]}
          fallback={
            <Select value={actionType} onValueChange={handleActionTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">{t('nodes:actions.actionTypes.service')}</SelectItem>
                <SelectItem value="event">{t('nodes:actions.actionTypes.event')}</SelectItem>
                <SelectItem value="stop">{t('nodes:actions.actionTypes.stop')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </FormField>

      {actionType === 'stop' ? (
        <>
          {/* Stop action fields */}
          <FormField label={t('nodes:actions.stopMessageLabel')}>
            <Input
              type="text"
              value={stopMessage ?? ''}
              onChange={(e) => onChange('stop', e.target.value)}
              placeholder={t('nodes:actions.stopMessagePlaceholder')}
            />
          </FormField>
          <FormField label={t('nodes:actions.markAsError')}>
            <HaSwitch
              checked={isStopError}
              onChange={(checked) => onChange('error', checked || undefined)}
              fallback={
                <Switch
                  checked={isStopError}
                  onCheckedChange={(checked) => onChange('error', checked || undefined)}
                />
              }
            />
          </FormField>
          {/* response_variable — home-assistant.io/docs/scripts/#stopping-a-script-sequence:
              "To return a response from a script, use the response_variable
              option." No service-metadata detection applies to `stop` (there's
              no service being called), so this always renders in its manual,
              toggle-based form (`response` left undefined). */}
          <ResponseVariableField
            response={undefined}
            responseVariable={responseVariable}
            showResponseVariable={showResponseVariable}
            setShowResponseVariable={setShowResponseVariable}
            onChange={onChange}
            handleResponseVariableChange={handleResponseVariableChange}
          />
          <ContinueOnErrorField checked={continueOnError} onChange={handleContinueOnErrorChange} />
        </>
      ) : actionType === 'event' ? (
        <>
          {/* Fire event fields */}
          <FormField label={t('nodes:actions.eventNameLabel')} required>
            <Input
              type="text"
              value={eventName}
              onChange={(e) => onChange('event', e.target.value || undefined)}
              placeholder={t('nodes:actions.eventNamePlaceholder')}
            />
            <FieldError message={getFieldError('event')} />
          </FormField>
          <DynamicFieldRenderer
            field={EVENT_DATA_FIELD}
            value={getNodeDataObject(node, 'event_data', {})}
            onChange={(value) => onChange('event_data', value)}
          />
          <ContinueOnErrorField checked={continueOnError} onChange={handleContinueOnErrorChange} />
        </>
      ) : (
        <>
          {/* Call service fields */}
          <FormField label={t('nodes:actions.actionLabel')} required>
            <HaServicePicker
              value={serviceName}
              onChange={handleServiceChange}
              fallback={
                <Combobox
                  options={getAllServices().map(({ domain, service, definition }) => {
                    const translatedDomain = t(`nodes:serviceDomains.${domain}`, {
                      defaultValue: prettify(domain),
                    });
                    const translatedAction = t(`nodes:serviceActions.${service}`, {
                      defaultValue: prettify(service),
                    });
                    return {
                      value: `${domain}.${service}`,
                      label: definition?.name || `${translatedDomain}: ${translatedAction}`,
                    };
                  })}
                  value={serviceName}
                  onChange={handleServiceChange}
                  placeholder={t('nodes:actions.selectAction')}
                  renderOption={(option) => (
                    <div className="flex flex-col gap-0.5">
                      <span>{option.label}</span>
                      {option.label !== option.value && (
                        <span className="font-mono text-muted-foreground text-xs">
                          {option.value as string}
                        </span>
                      )}
                    </div>
                  )}
                  renderValue={(option) =>
                    option ? (
                      <div className="flex flex-col items-start leading-tight">
                        <span>{option.label}</span>
                        {option.label !== option.value && (
                          <span className="font-mono text-muted-foreground text-xs">
                            {option.value}
                          </span>
                        )}
                      </div>
                    ) : null
                  }
                />
              }
            />
            <FieldError message={getFieldError('service')} />
          </FormField>

          {/* Target Entities */}
          {(serviceDefinition?.target || targetEntityIdArray.length > 0) && (
            <FormField label={t('nodes:actions.targetEntities')}>
              <HaSelector
                selector={{ entity: { multiple: true } }}
                value={targetEntityIdArray}
                onChange={(v) => handleEntityTargetChange(toStringArray(v))}
                fallback={
                  <MultiEntitySelector
                    value={targetEntityIdArray}
                    onChange={handleEntityTargetChange}
                    entities={getTargetEntities(serviceName, entities)}
                    placeholder={t('nodes:actions.selectTargetEntities')}
                  />
                }
              />
            </FormField>
          )}

          {/* Target Devices - show if we have device targets or service supports targets */}
          {(hasDeviceTargets || serviceDefinition?.target) && (
            <FormField
              label={t('nodes:actions.targetDevices')}
              description={t('nodes:actions.targetDevicesDescription')}
            >
              <HaSelector
                selector={{ device: { multiple: true } }}
                value={targetDeviceIdArray}
                onChange={(v) => handleDeviceTargetChange(toStringArray(v))}
                fallback={
                  <IdList
                    values={targetDeviceIdArray}
                    onChange={handleDeviceTargetChange}
                    placeholder={t('nodes:actions.addDeviceId')}
                  />
                }
              />
            </FormField>
          )}

          {/* Target Areas - show if we have area targets or service supports targets */}
          {(hasAreaTargets || serviceDefinition?.target) && (
            <FormField
              label={t('nodes:actions.targetAreas')}
              description={t('nodes:actions.targetAreasDescription')}
            >
              <HaSelector
                selector={{ area: { multiple: true } }}
                value={targetAreaIdArray}
                onChange={(v) => handleAreaTargetChange(toStringArray(v))}
                fallback={
                  <IdList
                    values={targetAreaIdArray}
                    onChange={handleAreaTargetChange}
                    placeholder={t('nodes:actions.addAreaId')}
                  />
                }
              />
            </FormField>
          )}

          {/* Target Labels - show if we have label targets or service supports targets */}
          {(hasLabelTargets || serviceDefinition?.target) && (
            <FormField
              label={t('nodes:actions.targetLabels')}
              description={t('nodes:actions.targetLabelsDescription')}
            >
              <HaSelector
                selector={{ label: { multiple: true } }}
                value={targetLabelIdArray}
                onChange={(v) => handleLabelTargetChange(toStringArray(v))}
                fallback={
                  <IdList
                    values={targetLabelIdArray}
                    onChange={handleLabelTargetChange}
                    placeholder={t('nodes:actions.addLabelId')}
                  />
                }
              />
            </FormField>
          )}

          {/* Target Floors - show if we have floor targets or service supports targets */}
          {(hasFloorTargets || serviceDefinition?.target) && (
            <FormField
              label={t('nodes:actions.targetFloors')}
              description={t('nodes:actions.targetFloorsDescription')}
            >
              <HaSelector
                selector={{ floor: { multiple: true } }}
                value={targetFloorIdArray}
                onChange={(v) => handleFloorTargetChange(toStringArray(v))}
                fallback={
                  <IdList
                    values={targetFloorIdArray}
                    onChange={handleFloorTargetChange}
                    placeholder={t('nodes:actions.addFloorId')}
                  />
                }
              />
            </FormField>
          )}

          {/* Dynamic service fields */}
          <ServiceDataFields
            serviceFields={serviceFields}
            currentData={currentData}
            onChange={handleDataFieldChange}
          />

          {/* Response Variable — HA's YAML doesn't require the service to be
              "known" to accept response_variable (it's just a name the user
              picks for wherever the response ends up), so this is always
              available rather than gated behind service metadata. When the
              live service registry *does* declare `response`, that's passed
              through as a smart hint/default (auto-shown, or a note that the
              action returns data) rather than a hard requirement to show
              the field at all. */}
          <ResponseVariableField
            response={serviceDefinition?.response}
            responseVariable={responseVariable}
            showResponseVariable={showResponseVariable}
            setShowResponseVariable={setShowResponseVariable}
            onChange={onChange}
            handleResponseVariableChange={handleResponseVariableChange}
          />
          <ContinueOnErrorField checked={continueOnError} onChange={handleContinueOnErrorChange} />
        </>
      )}
    </>
  );
}
