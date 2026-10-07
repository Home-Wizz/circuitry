import { type FlowNode, isOpaqueStepData } from '@circuitry/shared';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getHandledProperties } from '@/config/handledProperties';
import { useHass } from '@/contexts/HassContext';
import { HaSwitch } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import { clearedToUnset } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { AutomationSettingsPanel } from './AutomationSettingsPanel';
import { NodeFields } from './NodeFields';
import { PanelSection, PanelSections, PanelTargetsSection } from './PanelSection';
import { StepPreview } from './StepPreview';
import { PropertyEditor } from './PropertyEditor';

/**
 * Refactored PropertyPanel component.
 * Reduced from 1,248 lines to ~80 lines by extracting components and logic.
 */
export function PropertyPanel() {
  const { t } = useTranslation(['common', 'nodes']);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const removeNode = useFlowStore((s) => s.removeNode);
  const effectiveEntities = useResolvedEntities();
  const { getServiceDefinition } = useHass();

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  // Get handled properties for this node type - must be before early return
  // For device triggers/conditions, we need to exclude ALL current node properties to prevent duplicates
  // since device field components handle them dynamically based on API metadata
  const handledProperties = useMemo(() => {
    if (!selectedNode) {
      return getHandledProperties('trigger', []);
    }

    const baseHandled = getHandledProperties(selectedNode.type || 'trigger', []);
    const nodeData = selectedNode.data;

    // Check if this is a device-based node (trigger or condition with device_id)
    const triggerType = typeof nodeData.trigger === 'string' ? nodeData.trigger : '';
    const deviceId = typeof nodeData.device_id === 'string' ? nodeData.device_id : '';
    const isDeviceNode = triggerType === 'device' || deviceId;

    // For device nodes, exclude ALL properties to prevent duplicates with API-driven fields.
    // Same for a step kept exactly as written (bug #57): OpaqueStepFields
    // shows it read-only, so no per-key editor for it either.
    if (
      (isDeviceNode && (selectedNode.type === 'trigger' || selectedNode.type === 'condition')) ||
      isOpaqueStepData(nodeData)
    ) {
      const allNodeProperties = Object.keys(nodeData);
      const handledSet = new Set([...baseHandled, ...allNodeProperties]);
      return handledSet;
    }

    return baseHandled;
  }, [selectedNode]);

  // Must be before early return — hooks can't be called conditionally.
  const { warningMessages } = useNodeErrors(selectedNode?.id ?? '');

  if (!selectedNode) {
    return <AutomationSettingsPanel />;
  }

  const service = typeof selectedNode.data.service === 'string' ? selectedNode.data.service : '';
  const actionName =
    selectedNode.type === 'action' && service ? getServiceDefinition(service)?.name : undefined;

  const handleChange = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, { [key]: value });
  };

  const handleDeleteProperty = (key: string) => {
    updateNodeData(selectedNode.id, { [key]: undefined });
  };

  const nodeFields = (
    // Keyed by node id so switching the selected node always starts fresh
    // — some field components (e.g. TriggerFields' By target/By type
    // picker) intentionally stay mounted-but-hidden while toggling within
    // a single node so their navigation state survives a "back" press;
    // without this key that state would otherwise leak across different
    // nodes when a different node is selected instead.
    <NodeFields
      key={selectedNode.id}
      node={selectedNode as FlowNode}
      onChange={handleChange}
      entities={effectiveEntities}
    />
  );

  return (
    <PanelSections>
      <div className="h-full flex-1 space-y-3 overflow-y-auto p-3.5">
        {/* The step's own card, then whether it runs and Delete. */}
        <StepPreview node={selectedNode as FlowNode} />
        <div className="flex items-center gap-2.5">
          <Label htmlFor="node-enabled" className="flex-1 text-muted-foreground text-sm">
            {t('labels.enabled')}
          </Label>
          <HaSwitch
            checked={selectedNode.data.enabled !== false}
            onChange={(checked) => handleChange('enabled', checked ? undefined : false)}
            fallback={
              <Switch
                id="node-enabled"
                checked={selectedNode.data.enabled !== false}
                onCheckedChange={(checked) => handleChange('enabled', checked ? undefined : false)}
              />
            }
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeNode(selectedNode.id)}
            aria-label={t('buttons.delete')}
            className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {/* `enabled:` given as a template (HA renders it when it gets there;
            bugs #64, #69, #70): shown, since the switch alone reads "on". */}
        {typeof selectedNode.data.enabled === 'string' && (
          <div className="space-y-1 text-muted-foreground text-xs">
            <p>{t('help.enabledTemplate')}</p>
            <code className="block overflow-x-auto whitespace-pre rounded bg-muted px-2 py-1 font-mono">
              {selectedNode.data.enabled}
            </code>
          </div>
        )}

        {/* Warnings (bug #65): Home Assistant accepts these, so they don't
            block saving; errors are shown next to their fields. */}
        {warningMessages.length > 0 && (
          <div
            role="status"
            className="space-y-1 rounded-xl border border-warning/60 bg-warning/10 px-3 py-2 text-foreground text-xs"
          >
            <p className="font-medium">{t('help.nodeWarnings')}</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {warningMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* What it acts on: the step's target fields move up here
            (PanelTargets); the rest are its settings, an action's under its
            name. */}
        <PanelTargetsSection title={t('nodes:panel.sections.targets')}>
          <PanelSection title={t('nodes:panel.sections.settings')} aside={actionName || undefined}>
            {nodeFields}
          </PanelSection>

          <PanelSection title={t('nodes:panel.sections.name')} aside={t('nodes:more.optional')}>
            <Input
              type="text"
              aria-label={t('labels.alias')}
              value={typeof selectedNode.data.alias === 'string' ? selectedNode.data.alias : ''}
              onChange={(e) => handleChange('alias', clearedToUnset(e.target.value))}
              placeholder={t('placeholders.optionalDisplayName')}
            />
            {/* ID field — triggers only. Home Assistant's action-step schemas
              (service call, delay, wait, set_variables, ...) don't support a
              per-step `id:` at all, only triggers do (for `trigger.id`
              templating and `choose:`/`condition: trigger` routing) — real HA
              rejects it outright ("extra keys not allowed") on any other step
              type, it's not just ignored. */}
            {selectedNode.type === 'trigger' && (
              <TriggerIdField node={selectedNode as FlowNode} onChange={handleChange} />
            )}
          </PanelSection>

          <PanelSection title={t('nodes:panel.sections.advanced')}>
            <PropertyEditor
              node={selectedNode as FlowNode}
              handledProperties={handledProperties}
              onChange={handleChange}
              onDelete={handleDeleteProperty}
            />
            <div className="text-muted-foreground text-xs">
              {t('nodes:panel.nodeId', { id: selectedNode.id })}
            </div>
          </PanelSection>
        </PanelTargetsSection>
      </div>
    </PanelSections>
  );
}

/**
 * A trigger's ID (`trigger.id` in templates, "Triggered by" conditions).
 * Triggers only: HA rejects an `id:` on any other step. The property
 * panel's field, shared with the card's settings pill (nodes/
 * StepSettingsPill.tsx).
 */
export function TriggerIdField({
  node,
  onChange,
  plain = false,
}: {
  node: FlowNode;
  onChange: (key: string, value: unknown) => void;
  /** In words, for the card's "+ more": "Name for 'Triggered by'", what
   * it's for, an example, the normal font. */
  plain?: boolean;
}) {
  const { t } = useTranslation(['common', 'nodes']);
  const { getFieldError } = useNodeErrors(node.id);
  return (
    <FormField
      label={plain ? t('nodes:more.triggerName') : t('labels.id')}
      description={plain ? t('nodes:more.triggerNameHint') : undefined}
    >
      <Input
        type="text"
        value={typeof node.data.id === 'string' ? node.data.id : ''}
        onChange={(e) => onChange('id', e.target.value || undefined)}
        placeholder={
          plain ? t('nodes:more.triggerNamePlaceholder') : t('placeholders.optionalUniqueId')
        }
        className={plain ? undefined : 'font-mono'}
      />
      <FieldError message={getFieldError('id')} />
    </FormField>
  );
}
