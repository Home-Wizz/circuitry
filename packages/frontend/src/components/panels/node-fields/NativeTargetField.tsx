import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { IdList } from '@/components/ui/IdList';
import { HaSelector } from '@/ha';
import { cn } from '@/lib/utils';

export type TargetValue = {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
  floor_id?: string | string[];
  label_id?: string | string[];
};

const toArray = (v: string | string[] | undefined): string[] =>
  !v ? [] : Array.isArray(v) ? v : [v];

interface NativeTargetFieldProps {
  target: TargetValue;
  onChange: (target: TargetValue) => void;
}

/**
 * The `target: { entity_id/device_id/area_id/floor_id/label_id }` picker
 * shared by both HA's purpose-specific triggers and conditions (see
 * NativeTriggerFields.tsx and NativeConditionFields.tsx) — extracted out of
 * NativeTriggerFields.tsx so the condition-side editor can reuse the exact
 * same collapsible target picker instead of duplicating it (CLAUDE.md's DRY
 * mandate).
 *
 * Deliberately a single unified `target` selector (`ha-selector` with
 * `{ target: {} }`) rather than ActionFields.tsx's five separate entity/
 * device/area/label/floor selectors — this mirrors how native HA's own
 * "Add trigger"/"Add condition" dialogs show ONE "Targets" field for these,
 * and `ha-selector`'s target type already combines all five kinds into one
 * widget.
 */
export function NativeTargetField({ target, onChange }: NativeTargetFieldProps) {
  const { t } = useTranslation(['nodes']);
  // Closed by default: most triggers/conditions arrive here already scoped
  // (picked via WhenTriggerDialog.tsx's "By target" flow, or its "By type"
  // flow's entity column), so re-showing the full target editor open by
  // default just repeats what the user already chose. Collapsed to a
  // one-line summary chip instead.
  const [open, setOpen] = useState(false);

  const updateTarget = (patch: Partial<TargetValue>) => onChange({ ...target, ...patch });

  const targetCount =
    toArray(target.entity_id).length +
    toArray(target.device_id).length +
    toArray(target.area_id).length +
    toArray(target.floor_id).length +
    toArray(target.label_id).length;

  return (
    <FormField
      label={t('nodes:triggers.native.targetLabel')}
      description={t('nodes:triggers.native.targetDescription')}
      required
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
          >
            <span className={cn(targetCount === 0 && 'text-muted-foreground')}>
              {targetCount === 0
                ? t('nodes:triggers.native.targetEmpty')
                : t('nodes:triggers.native.targetCount', { count: targetCount })}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <HaSelector
            selector={{ target: {} }}
            value={target}
            onChange={(v) => onChange((v as TargetValue) ?? {})}
            fallback={
              <div className="space-y-2">
                <IdList
                  values={toArray(target.entity_id)}
                  onChange={(ids) => updateTarget({ entity_id: ids })}
                  placeholder={t('nodes:actions.addEntityId')}
                />
                <IdList
                  values={toArray(target.device_id)}
                  onChange={(ids) => updateTarget({ device_id: ids })}
                  placeholder={t('nodes:actions.addDeviceId')}
                />
                <IdList
                  values={toArray(target.area_id)}
                  onChange={(ids) => updateTarget({ area_id: ids })}
                  placeholder={t('nodes:actions.addAreaId')}
                />
              </div>
            }
          />
        </CollapsibleContent>
      </Collapsible>
    </FormField>
  );
}
