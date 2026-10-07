import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { IdList } from '@/components/ui/IdList';
import { HaSelector } from '@/ha';
import { isRecord } from '@/lib/utils';

/** The places an action's target can name besides its entities. */
export type TargetKind = 'device' | 'area' | 'floor' | 'label';
export const TARGET_KINDS: readonly TargetKind[] = ['area', 'device', 'floor', 'label'];

const KEY: Record<TargetKind, string> = {
  device: 'device_id',
  area: 'area_id',
  floor: 'floor_id',
  label: 'label_id',
};
const TEXTS = {
  device: {
    label: 'nodes:actions.targetDevices',
    description: 'nodes:actions.targetDevicesDescription',
    placeholder: 'nodes:actions.addDeviceId',
  },
  area: {
    label: 'nodes:actions.targetAreas',
    description: 'nodes:actions.targetAreasDescription',
    placeholder: 'nodes:actions.addAreaId',
  },
  floor: {
    label: 'nodes:actions.targetFloors',
    description: 'nodes:actions.targetFloorsDescription',
    placeholder: 'nodes:actions.addFloorId',
  },
  label: {
    label: 'nodes:actions.targetLabels',
    description: 'nodes:actions.targetLabelsDescription',
    placeholder: 'nodes:actions.addLabelId',
  },
} as const;

/** A target's ids of one kind, one or several. */
export function targetIds(target: unknown, kind: TargetKind): string[] {
  const raw = isRecord(target) ? target[KEY[kind]] : undefined;
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  return typeof raw === 'string' && raw ? [raw] : [];
}

/** The target with its ids of one kind replaced: none drops the key, and
 * an empty target is no target. */
export function withTargetIds(
  target: unknown,
  kind: TargetKind,
  ids: string[]
): Record<string, unknown> | undefined {
  const { [KEY[kind]]: _old, ...rest } = isRecord(target) ? target : {};
  const next = ids.length > 0 ? { ...rest, [KEY[kind]]: ids } : rest;
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The devices, areas, floors or labels an action acts on, picked with HA's
 * own pickers (an id list outside HA).
 */
export function TargetKindField({
  kind,
  values,
  onChange,
  label,
}: {
  kind: TargetKind;
  values: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const { t } = useTranslation(['nodes']);
  const toIds = (v: unknown) =>
    Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
  return (
    <FormField
      label={label ?? t(TEXTS[kind].label)}
      description={label ? undefined : t(TEXTS[kind].description)}
    >
      <HaSelector
        selector={{ [kind]: { multiple: true } }}
        value={values}
        onChange={(v) => onChange(toIds(v))}
        fallback={
          <IdList values={values} onChange={onChange} placeholder={t(TEXTS[kind].placeholder)} />
        }
      />
    </FormField>
  );
}
