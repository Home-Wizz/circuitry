import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHass } from '@/contexts/HassContext';

interface DeviceSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

/**
 * DeviceSelector: Dropdown for device selection with fallback to manual input.
 * Shows the raw device ID in red if value doesn't match any known device.
 */
export function DeviceSelector({
  value,
  onChange,
  label = '',
  required = false,
  placeholder = '',
}: DeviceSelectorProps) {
  const { t } = useTranslation(['common']);
  const { hass } = useHass();
  const [inputValue, setInputValue] = useState(value);

  // Keep inputValue in sync with value prop
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const devices = hass?.devices ?? {};
  const hasDevices = Object.keys(devices).length > 0;
  // Sort alphabetically by display name — matches real HA's own device
  // picker (Object.values(devices) is otherwise in registry insertion
  // order, not alphabetical).
  const sortedDevices = Object.values(devices).sort((a, b) =>
    (a.name_by_user || a.name || a.id).localeCompare(b.name_by_user || b.name || b.id)
  );

  // Check if the current value matches any known device
  const isUnknownDevice = value && hasDevices && !devices[value];

  // Get display name for the current value
  const getDisplayValue = () => {
    if (!value) return undefined;
    const device = devices[value];
    if (device) {
      return device.name_by_user || device.name || device.id;
    }
    // Unknown device - return raw ID
    return value;
  };

  return (
    <FormField label={label || t('labels.device')} required={required}>
      {hasDevices ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className={isUnknownDevice ? 'font-mono text-destructive' : undefined}>
            <SelectValue placeholder={placeholder || t('placeholders.selectDevice')}>
              {getDisplayValue()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortedDevices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name_by_user || device.name || device.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <Input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              onChange(e.target.value);
            }}
            placeholder={t('deviceSelector.enterId')}
          />
          <p className="text-muted-foreground text-xs">{t('deviceSelector.noDevices')}</p>
        </>
      )}
    </FormField>
  );
}
