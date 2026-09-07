import type { WaitNode } from '@circuitry/shared';
import { Trash2Icon, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WhenTriggerDialog } from '@/components/canvas/WhenTriggerDialog';
import { FieldError } from '@/components/forms/FieldError';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HaSelect, HaSelector, HaSwitch } from '@/ha';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import { getDomainIcon } from '@/lib/domain-icons';
import type { TriggerNodeData } from '@/store/flow-store';
import { getNodeData, getNodeDataString } from '@/utils/nodeData';
import { ContinueOnErrorField } from './ContinueOnErrorField';
import { DurationField, hasMeaningfulDuration } from './DurationField';

interface WaitFieldsProps {
  node: WaitNode;
  onChange: (key: string, value: unknown) => void;
}

export function WaitFields({ node, onChange }: WaitFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const { getFieldError, getRootError } = useNodeErrors(node.id);
  const entities = useResolvedEntities();
  const [addTriggerOpen, setAddTriggerOpen] = useState(false);
  const waitTemplate = getNodeDataString(node, 'wait_template');
  const waitForTrigger = getNodeData<TriggerNodeData[]>(node, 'wait_for_trigger');

  const waitType = waitForTrigger !== undefined ? 'trigger' : 'template';
  const rootError = getRootError();

  const handleWaitTypeChange = (type: 'template' | 'trigger') => {
    if (type === 'template') {
      onChange('wait_for_trigger', undefined);
      onChange('wait_template', '');
    } else {
      onChange('wait_template', undefined);
      onChange('wait_for_trigger', []);
      setAddTriggerOpen(true);
    }
  };

  const removeTrigger = (index: number) => {
    if (!waitForTrigger) return;
    const newTriggers = waitForTrigger.filter((_, i) => i !== index);
    onChange('wait_for_trigger', newTriggers);
  };

  return (
    <>
      {/* Root-level error (cross-field validation) */}
      <FieldError message={rootError} />

      <FormField label={t('nodes:wait.waitType')} description={t('nodes:wait.waitTypeDescription')}>
        <HaSelect
          value={waitType}
          onChange={(v) => handleWaitTypeChange(String(v) as 'template' | 'trigger')}
          options={[
            { value: 'template', label: t('nodes:wait.types.template') },
            { value: 'trigger', label: t('nodes:wait.types.triggers') },
          ]}
          fallback={
            <Select value={waitType} onValueChange={handleWaitTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="template">{t('nodes:wait.types.template')}</SelectItem>
                <SelectItem value="trigger">{t('nodes:wait.types.triggers')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </FormField>

      {waitType === 'template' && (
        <FormField
          label={t('nodes:wait.waitTemplate')}
          required
          description={t('nodes:wait.waitTemplateDescription')}
        >
          <HaSelector
            selector={{ template: {} }}
            value={waitTemplate || ''}
            onChange={(v) => onChange('wait_template', typeof v === 'string' ? v : '')}
            required
            fallback={
              <Textarea
                value={waitTemplate || ''}
                onChange={(e) => onChange('wait_template', e.target.value)}
                className="font-mono"
                rows={3}
                placeholder={t('nodes:placeholders.waitTemplate')}
              />
            }
          />
          <FieldError message={getFieldError('wait_template')} />
        </FormField>
      )}

      {waitType === 'trigger' && (
        <div className="space-y-4">
          <FieldError message={getFieldError('wait_for_trigger')} />
          <div className="space-y-2">
            <h3 className="font-medium">{t('nodes:wait.triggersHeading')}</h3>
            {waitForTrigger?.map((trigger, index) => {
              const entity = Array.isArray(trigger.entity_id)
                ? trigger.entity_id[0]
                : trigger.entity_id;
              const Icon = getDomainIcon(entity?.split('.')[0], Zap);
              // Same platform-label lookup TriggerNode.tsx uses for its card
              // title, minus the rich per-platform detail formatting —
              // wait_for_trigger entries are a short list summarized in one
              // line, not a full canvas card.
              const platformLabel = t(`nodes:triggers.platforms.${trigger.trigger}`, {
                defaultValue: trigger.trigger,
              });
              const summary = entity ? `${platformLabel} · ${entity}` : platformLabel;
              return (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <TruncatedTooltip content={summary}>
                      <span className="truncate text-sm">{summary}</span>
                    </TruncatedTooltip>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTrigger(index)}
                    className="h-8 w-8 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
            {(!waitForTrigger || waitForTrigger.length === 0) && (
              <p className="text-muted-foreground text-xs">{t('nodes:wait.noTriggers')}</p>
            )}
          </div>
          <Button onClick={() => setAddTriggerOpen(true)} variant="outline" size="sm">
            {t('nodes:wait.addTrigger')}
          </Button>

          {/* Same Miller-column trigger picker as +Add > When (see
              WhenTriggerDialog.tsx) — every wait_for_trigger entry is a full
              native HA trigger config (HATriggerSchema), so it gets the same
              picker real triggers use instead of a separate, narrower form. */}
          <WhenTriggerDialog
            open={addTriggerOpen}
            onOpenChange={setAddTriggerOpen}
            entities={entities}
            onCommit={(data) => {
              onChange('wait_for_trigger', [...(waitForTrigger ?? []), data]);
            }}
          />
        </div>
      )}

      <DurationField
        label={t('nodes:wait.timeoutLabel')}
        description={t('nodes:wait.timeoutDescription')}
        value={node.data.timeout ?? ''}
        // hasMeaningfulDuration, not a bare truthy check — HA's native
        // duration picker widget reports its untouched/default state as an
        // all-zero object (e.g. {hours:0,minutes:0,seconds:0,
        // milliseconds:0}), which is truthy in JS, so a plain `val ||
        // undefined` was persisting a real "0-second timeout" onto the node
        // even when the user never touched this field at all. HA treats an
        // explicit zero timeout as "give up instantly," not "no limit" (see
        // DurationField.tsx's hasMeaningfulDuration doc comment) — so this
        // was silently turning every Wait-for-trigger step that left
        // Timeout unset into one that never actually waited.
        onChange={(val) => onChange('timeout', hasMeaningfulDuration(val) ? val : undefined)}
      />

      {hasMeaningfulDuration(node.data.timeout) && (
        <FormField
          label={t('nodes:wait.continueOnTimeout')}
          description={t('nodes:wait.continueOnTimeoutDescription')}
        >
          <HaSwitch
            checked={node.data.continue_on_timeout ?? true}
            onChange={(checked) => onChange('continue_on_timeout', checked)}
            fallback={
              <Switch
                checked={node.data.continue_on_timeout ?? true}
                onCheckedChange={(checked) => onChange('continue_on_timeout', checked)}
              />
            }
          />
        </FormField>
      )}

      {/* `continue_on_error` — "available on all actions", including
          wait_template/wait_for_trigger — was previously wired into
          ActionFields.tsx's branches only, missing here. Distinct from
          `continue_on_timeout` above: that governs what happens when the
          wait's own timeout elapses; this governs what happens if the step
          itself errors (e.g. an invalid template). */}
      <ContinueOnErrorField
        checked={node.data.continue_on_error === true}
        onChange={(checked) => onChange('continue_on_error', checked || undefined)}
      />
    </>
  );
}
