import type { FlowNode, TriggerPlatform } from '@circuitry/shared';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { DynamicFieldRenderer } from '@/components/ui/DynamicFieldRenderer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getTriggerFields, TRIGGER_PLATFORM_FIELDS } from '@/config/triggerFields';
import { HaSelect } from '@/ha';
import type { DeviceTrigger } from '@/hooks/useDeviceAutomation';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { buildTriggerNodeData, type TriggerSelection } from '@/lib/triggerNodeData';
import type { TriggerRecipe } from '@/lib/triggerRecipes';
import type { HassEntity } from '@/types/hass';
import { getNodeDataString } from '@/utils/nodeData';
import { DeviceTriggerFields } from './DeviceTriggerFields';
import { NativeTriggerFields } from './NativeTriggerFields';
import { StateTriggerFields } from './StateTriggerFields';
import { TimeTriggerFields } from './TimeTriggerFields';
import { TriggerAdvancedFields } from './TriggerAdvancedFields';
import { TriggerTypePicker } from './TriggerTypePicker';

const TRIGGER_PLATFORMS: TriggerPlatform[] = [
  'state',
  'numeric_state',
  'time',
  'time_pattern',
  'sun',
  'event',
  'mqtt',
  'webhook',
  'zone',
  'template',
  'homeassistant',
  'device',
  'calendar',
  'tag',
  'geo_location',
  'conversation',
  'persistent_notification',
];

interface TriggerFieldsProps {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
}

/**
 * Trigger node field component.
 * Handles platform selection and renders appropriate field configuration.
 * Extracts trigger rendering logic from PropertyPanel.
 */
export function TriggerFields({ node, onChange, entities }: TriggerFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const { getFieldError } = useNodeErrors(node.id);
  // No fallback to 'state' here — an unset trigger is what tells us to show
  // the By target / By type picker below instead of the normal fields.
  const triggerType = getNodeDataString(node, 'trigger', '');
  const deviceId = getNodeDataString(node, 'device_id');

  // If we have a device_id but trigger isn't 'device', auto-correct it
  const effectiveTriggerType = deviceId && triggerType !== 'device' ? 'device' : triggerType;

  // Auto-correct trigger to 'device' if we detected device_id but trigger type is wrong
  useEffect(() => {
    if (deviceId && triggerType !== 'device') {
      onChange('trigger', 'device');
    }
  }, [deviceId, triggerType, onChange]);

  // Clears every field any trigger platform could have set, so switching
  // platforms/selections never leaks a stale value from the previous one.
  const clearAllTriggerFields = () => {
    const allFieldNames = new Set(
      Object.values(TRIGGER_PLATFORM_FIELDS).flatMap((fields) => fields.map((f) => f.name))
    );
    for (const fieldName of allFieldNames) {
      onChange(fieldName, undefined);
    }
    onChange('device_id', undefined);
  };

  // Single entry point for committing any of the picker's four outcomes (a
  // plain platform, a "By target" entity fallback, a device_automation
  // trigger, or a client-side recipe) onto this node — the actual
  // platform/entity_id/to/from/attribute mapping lives once, in
  // lib/triggerNodeData.ts's buildTriggerNodeData, shared with
  // WhenTriggerDialog.tsx's "+Add > When" modal (which builds a brand new
  // node's data the same way, just in one shot instead of via onChange).
  const applyTriggerSelection = (selection: TriggerSelection) => {
    clearAllTriggerFields();
    const data = buildTriggerNodeData(selection);
    for (const [key, value] of Object.entries(data)) {
      onChange(key, value);
    }
  };

  const handleTriggerTypeChange = (newTriggerType: string) => {
    applyTriggerSelection({ kind: 'platform', platform: newTriggerType as TriggerPlatform });
  };

  // "By target" picker shortcut: jump straight to a `state` trigger pre-filled
  // with the chosen entity, rather than making the user pick "State Change"
  // afterward on the "By type" tab.
  const handleSelectEntityTarget = (entityId: string) => {
    applyTriggerSelection({ kind: 'entityTarget', entityId });
  };

  // "By target" picker's results panel: committing one of the real
  // device_automation-API-driven trigger options it fetched for the selected
  // entity/device. Mirrors DeviceTriggerFields.handleTriggerTypeSelected,
  // since after this the node lands on the normal 'device' trigger fields
  // (which re-fetch the same list themselves for the extra capability
  // fields, e.g. a numeric threshold on a "brightness changed" trigger).
  const handleSelectDeviceTrigger = (trigger: DeviceTrigger) => {
    applyTriggerSelection({ kind: 'deviceTrigger', trigger });
  };

  // "By target" picker's results panel: committing one of the client-side
  // "recipe" rows synthesized from the selected entities' domain/device_class
  // (see lib/triggerRecipes.ts) — the ones matching HA's own Battery/Cover/
  // Fan/... groups. Just sugar over a plain state/numeric_state trigger
  // scoped to every entity in the chosen recipe group at once.
  const handleSelectRecipe = (entityIds: string[], recipe: TriggerRecipe) => {
    applyTriggerSelection({ kind: 'recipe', entityIds, recipe });
  };

  // Lets the user reopen the By target / By type picker after already
  // choosing a trigger, instead of the only way back being to delete the
  // node and drag a fresh one in. Clears the same fields
  // applyTriggerSelection does, but leaves `trigger` unset rather than
  // applying a new platform's defaults, which is what puts TriggerFields
  // back into its "no platform chosen yet" branch below.
  const handleBackToPicker = () => {
    clearAllTriggerFields();
    onChange('trigger', '');
  };

  // Freshly-dropped trigger nodes start with no platform set (see NodePalette's
  // defaultData) — show the By target / By type picker instead of the normal
  // fields until one is chosen, mirroring HA's own Add Trigger dialog.
  //
  // The picker is always mounted (just hidden via CSS once a trigger is
  // chosen) rather than conditionally rendered, so its own navigation state
  // — which area/device is expanded, which By target scope or By type
  // category is selected — survives pressing "Change trigger" to come back
  // to it, instead of resetting to a blank picker every time. (PropertyPanel
  // keys NodeFields by node id, so switching to a *different* node still
  // gets a fresh picker as expected.)
  const hasTrigger = !!effectiveTriggerType;

  return (
    <>
      <div className={hasTrigger ? 'hidden' : undefined}>
        <TriggerTypePicker
          entities={entities}
          onSelectPlatform={handleTriggerTypeChange}
          onSelectEntityTarget={handleSelectEntityTarget}
          onSelectDeviceTrigger={handleSelectDeviceTrigger}
          onSelectRecipe={handleSelectRecipe}
        />
      </div>

      {hasTrigger && (
        <>
          <button
            type="button"
            onClick={handleBackToPicker}
            className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            {t('nodes:triggers.picker.backToPicker')}
          </button>

          {/* Purpose-specific triggers (e.g. `light.turned_on`) are only ever
              reached via the picker's recipes, not this flat platform list
              (which only has the legacy platforms) — showing it would just
              display an unmatched blank value. "Change trigger" above is
              the way back to pick a different one, matching how native HA's
              own dialog doesn't offer a generic platform switcher for these
              either. */}
          {!effectiveTriggerType.includes('.') && (
            <FormField label={t('nodes:triggers.platformLabel')} required>
              <HaSelect
                value={effectiveTriggerType}
                onChange={(v) => handleTriggerTypeChange(String(v))}
                options={TRIGGER_PLATFORMS.map((platform) => ({
                  value: platform,
                  label: t(`nodes:triggers.platforms.${platform}`),
                }))}
                fallback={
                  <Select value={effectiveTriggerType} onValueChange={handleTriggerTypeChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGER_PLATFORMS.map((platform) => (
                        <SelectItem key={platform} value={platform}>
                          {t(`nodes:triggers.platforms.${platform}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </FormField>
          )}

          {/* Dynamic fields based on trigger type */}
          <TriggerDynamicFields
            effectiveTriggerType={effectiveTriggerType}
            deviceId={deviceId}
            node={node}
            onChange={onChange}
            entities={entities}
            getFieldError={getFieldError}
          />

          {/* Universal trigger fields (id/enabled already have dedicated UI in
              PropertyPanel.tsx for every node type — this only adds
              `variables`, which is trigger-specific) — visible for every
              platform, purpose-specific triggers included. */}
          <TriggerAdvancedFields node={node} onChange={onChange} />
        </>
      )}
    </>
  );
}

function TriggerDynamicFields({
  effectiveTriggerType,
  deviceId,
  node,
  onChange,
  entities,
  getFieldError,
}: {
  effectiveTriggerType: string;
  deviceId: string;
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  entities: HassEntity[];
  getFieldError: (fieldPath: string) => string | undefined;
}) {
  // Device triggers use API-driven fields
  if (effectiveTriggerType === 'device' || deviceId) {
    return <DeviceTriggerFields node={node} onChange={onChange} entities={entities} />;
  }

  // State trigger uses a dedicated component for entity-aware state suggestions
  if (effectiveTriggerType === 'state') {
    return <StateTriggerFields node={node} onChange={onChange} entities={entities} />;
  }

  // Time trigger uses a dedicated component: `at` accepts a fixed time, an
  // entity reference, an { entity_id, offset } mapping, or a list mixing
  // those, plus a separate weekday filter — none of which fit the static
  // one-field-one-widget DynamicFieldRenderer system below.
  if (effectiveTriggerType === 'time') {
    return <TimeTriggerFields node={node} onChange={onChange} entities={entities} />;
  }

  // Purpose-specific triggers (dotted domain.event platform, e.g.
  // `light.turned_on`) use the shared target/behavior field editor instead
  // of config/triggerFields.ts's static list — see NativeTriggerFields.tsx.
  if (effectiveTriggerType.includes('.')) {
    return <NativeTriggerFields node={node} onChange={onChange} triggerType={effectiveTriggerType} />;
  }

  // Other trigger types use static field configuration
  const fields = getTriggerFields(effectiveTriggerType);
  return fields.map((field) => (
    <DynamicFieldRenderer
      key={field.name}
      field={field}
      value={(node.data as Record<string, unknown>)[field.name]}
      onChange={(value) => onChange(field.name, value)}
      entities={entities}
      error={getFieldError(field.name)}
    />
  ));
}
