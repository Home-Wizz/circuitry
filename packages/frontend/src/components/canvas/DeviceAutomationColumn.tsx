import { useTranslation } from 'react-i18next';
import { NavColumnList } from '@/components/canvas/PickerColumns';
import {
  deviceGroupColor,
  deviceGroupIcon,
  type PickerPlaces,
  type PushPlaceColumn,
} from '@/components/canvas/pickerPlaces';
import { type DeviceAutomationKind, useDevicesWithAutomations } from '@/hooks/useDeviceAutomation';

/**
 * Generic > Device in the pickers, as HA's own Device type: the devices
 * that have their own triggers, conditions or actions (a remote's button
 * press, a device's own "is on"), and picking one lists only those -- not
 * its entities' types, which the Devices row (and a room) already offer.
 */
export function DeviceAutomationColumn({
  kind,
  places,
  atIndex,
  push,
  selectedKey,
  emptyLabel,
}: {
  kind: DeviceAutomationKind;
  places: PickerPlaces;
  atIndex: number;
  push: PushPlaceColumn;
  selectedKey?: string | null;
  emptyLabel: string;
}) {
  const { t } = useTranslation(['nodes']);
  const groups = places.allDeviceGroups;
  const withAny = useDevicesWithAutomations(
    kind,
    groups.map((g) => g.deviceId)
  );
  const rows = (withAny ? groups.filter((g) => withAny.has(g.deviceId)) : []).map((group) => ({
    key: group.deviceId,
    label: group.name,
    icon: deviceGroupIcon(group),
    color: deviceGroupColor(group),
    onSelect: () =>
      push(
        atIndex,
        {
          kind: 'targetResults',
          scope: {
            key: `deviceAutomations::${group.deviceId}`,
            label: group.name,
            deviceIds: [group.deviceId],
            entityIds: group.entities.map((e) => e.entity_id),
            deviceAutomationsOnly: true,
          },
        },
        group.deviceId
      ),
  }));
  return (
    <NavColumnList
      title={t('nodes:picker.groups.device')}
      rows={rows}
      selectedKey={selectedKey}
      emptyLabel={withAny ? emptyLabel : t('nodes:picker.loadingDevices')}
    />
  );
}
