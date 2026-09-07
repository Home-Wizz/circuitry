import type { AutomationMode, MaxExceeded } from '@circuitry/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HaSelect, HaSelector, HaSwitch } from '@/ha';
import { useFlowStore } from '@/store/flow-store';

const AUTOMATION_MODES: AutomationMode[] = ['single', 'restart', 'queued', 'parallel'];
const MAX_EXCEEDED_OPTIONS: MaxExceeded[] = ['silent', 'critical', 'error', 'warning', 'info', 'debug'];
const MODES_WITH_MAX = new Set<AutomationMode>(['queued', 'parallel']);

export function AutomationSettingsPanel() {
  const { t } = useTranslation('common');
  const flowName = useFlowStore((s) => s.flowName);
  const flowDescription = useFlowStore((s) => s.flowDescription);
  const setFlowName = useFlowStore((s) => s.setFlowName);
  const setFlowDescription = useFlowStore((s) => s.setFlowDescription);
  const flowMetadata = useFlowStore((s) => s.flowMetadata);
  const setFlowMetadata = useFlowStore((s) => s.setFlowMetadata);
  const userVariables = useFlowStore((s) => s.userVariables) ?? {};
  const setUserVariables = useFlowStore((s) => s.setUserVariables);
  const variableEntries = Object.entries(userVariables);

  const mode = flowMetadata.mode ?? 'single';
  const showMaxFields = MODES_WITH_MAX.has(mode);

  const handleModeChange = (value: string) => {
    const newMode = value as AutomationMode;
    const updates: Partial<typeof flowMetadata> = { mode: newMode };

    // Clear max/max_exceeded when switching to a mode that doesn't support them
    if (!MODES_WITH_MAX.has(newMode)) {
      updates.max = undefined;
      updates.max_exceeded = undefined;
    }

    setFlowMetadata(updates);
  };

  const handleMaxChange = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (value === '' || Number.isNaN(parsed)) {
      setFlowMetadata({ max: undefined });
    } else if (parsed > 0) {
      setFlowMetadata({ max: parsed });
    }
  };

  const handleMaxExceededChange = (value: string) => {
    if (value === 'none') {
      setFlowMetadata({ max_exceeded: undefined });
    } else {
      setFlowMetadata({ max_exceeded: value as MaxExceeded });
    }
  };

  const handleInitialStateChange = (checked: boolean) => {
    setFlowMetadata({ initial_state: checked });
  };

  const handleStoredTracesChange = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (value === '' || Number.isNaN(parsed)) {
      setFlowMetadata({ trace: undefined });
    } else if (parsed >= 0) {
      setFlowMetadata({ trace: { stored_traces: parsed } });
    }
  };

  const handleAddVariable = () => {
    const existingKeys = Object.keys(userVariables);
    let newKey = 'variable';
    let counter = 1;
    while (existingKeys.includes(newKey)) {
      newKey = `variable_${counter}`;
      counter++;
    }
    setUserVariables({ ...userVariables, [newKey]: '' });
  };

  const handleVariableKeyChange = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey.trim()) return;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(userVariables)) {
      next[key === oldKey ? newKey : key] = value;
    }
    setUserVariables(next);
  };

  const handleVariableValueChange = (key: string, value: string) => {
    setUserVariables({ ...userVariables, [key]: value });
  };

  const handleDeleteVariable = (keyToDelete: string) => {
    const next = { ...userVariables };
    delete next[keyToDelete];
    setUserVariables(next);
  };

  return (
    <div className="h-full flex-1 space-y-4 overflow-y-auto p-4">
      <h3 className="mt-1.5 font-semibold text-foreground text-sm">
        {t('automationSettings.title')}
      </h3>

      <FormField label={t('labels.automationName')}>
        <Input
          type="text"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder={t('placeholders.enterAutomationName')}
        />
      </FormField>

      <FormField label={t('automationSettings.description')}>
        <Textarea
          value={flowDescription}
          onChange={(e) => setFlowDescription(e.target.value)}
          placeholder={t('placeholders.describeAutomation')}
          rows={3}
        />
      </FormField>

      <FormField
        label={t('automationSettings.initialState')}
        description={t('automationSettings.initialStateDescription')}
      >
        <HaSwitch
          checked={flowMetadata.initial_state ?? true}
          onChange={handleInitialStateChange}
          fallback={
            <Switch
              checked={flowMetadata.initial_state ?? true}
              onCheckedChange={handleInitialStateChange}
            />
          }
        />
      </FormField>

      <Separator />

      <FormField
        label={t('automationSettings.mode')}
        description={t('automationSettings.modeDescription')}
      >
        <HaSelect
          value={mode}
          onChange={(v) => handleModeChange(String(v))}
          options={AUTOMATION_MODES.map((m) => ({ value: m, label: t(`automationSettings.modes.${m}`) }))}
          fallback={
            <Select value={mode} onValueChange={handleModeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`automationSettings.modes.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <p className="text-muted-foreground text-xs">
          {t(`automationSettings.modeDescriptions.${mode}`)}
        </p>
      </FormField>

      {showMaxFields && (
        <>
          <FormField
            label={t('automationSettings.max')}
            description={t('automationSettings.maxDescription')}
          >
            <Input
              type="number"
              min={1}
              value={flowMetadata.max ?? ''}
              onChange={(e) => handleMaxChange(e.target.value)}
              placeholder="10"
            />
          </FormField>

          {flowMetadata.max != null && (
            <FormField
              label={t('automationSettings.maxExceeded')}
              description={t('automationSettings.maxExceededDescription')}
            >
              <HaSelect
                value={flowMetadata.max_exceeded ?? 'none'}
                onChange={(v) => handleMaxExceededChange(String(v))}
                options={[
                  { value: 'none', label: t('placeholders.none') },
                  ...MAX_EXCEEDED_OPTIONS.map((opt) => ({
                    value: opt,
                    label: t(`automationSettings.maxExceededOptions.${opt}`),
                  })),
                ]}
                fallback={
                  <Select
                    value={flowMetadata.max_exceeded ?? 'none'}
                    onValueChange={handleMaxExceededChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('placeholders.none')}</SelectItem>
                      {MAX_EXCEEDED_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {t(`automationSettings.maxExceededOptions.${opt}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </FormField>
          )}
        </>
      )}

      <Separator />

      <FormField
        label={t('automationSettings.storedTraces')}
        description={t('automationSettings.storedTracesDescription')}
      >
        <Input
          type="number"
          min={0}
          value={flowMetadata.trace?.stored_traces ?? ''}
          onChange={(e) => handleStoredTracesChange(e.target.value)}
          placeholder="5"
        />
      </FormField>

      <Separator />

      {/* Automation-level `variables:` block — distinct from the mid-sequence
          "Set variables" action node. Values here are computed once when the
          automation is triggered and available to every trigger/condition/
          action via {{ variable_name }}. The transpiler already fully
          round-trips flow.userVariables (native.ts/YamlParser.ts); this was
          previously only reachable by importing YAML that already had one —
          there was no way to add or edit it from a flow built fresh here. */}
      <div>
        <h4 className="mb-1 font-medium text-foreground text-xs">
          {t('automationSettings.variables')}
        </h4>
        <p className="mb-2 text-muted-foreground text-xs">
          {t('automationSettings.variablesDescription')}
        </p>
        <div className="space-y-3">
          {variableEntries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('automationSettings.variablesEmpty')}
            </p>
          ) : (
            variableEntries.map(([key, value], index) => (
              <div
                key={`${key}-${index}`}
                className="rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-muted-foreground text-xs">
                    {t('automationSettings.variableLabel', { index: index + 1 })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteVariable(key)}
                    className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-3">
                  <FormField label={t('automationSettings.variableName')}>
                    <Input
                      value={key}
                      onChange={(e) => handleVariableKeyChange(key, e.target.value)}
                      placeholder={t('automationSettings.variableNamePlaceholder')}
                      className="font-mono text-sm"
                    />
                  </FormField>
                  <FormField label={t('automationSettings.variableValue')}>
                    <HaSelector
                      selector={{ template: {} }}
                      value={String(value ?? '')}
                      onChange={(v) =>
                        handleVariableValueChange(key, typeof v === 'string' ? v : '')
                      }
                      fallback={
                        <Textarea
                          value={String(value ?? '')}
                          onChange={(e) => handleVariableValueChange(key, e.target.value)}
                          placeholder={t('automationSettings.variableValuePlaceholder')}
                          className="font-mono text-sm"
                        />
                      }
                    />
                  </FormField>
                </div>
              </div>
            ))
          )}
          <Button variant="outline" onClick={handleAddVariable} className="w-full gap-2" size="sm">
            <Plus className="h-4 w-4" />
            {t('automationSettings.addVariable')}
          </Button>
        </div>
      </div>
    </div>
  );
}
