import { FormField } from '@/components/forms/FormField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HaSelect } from '@/ha';

interface OptionSelectFieldProps {
  label: string;
  /** Unset shows no choice (a required option not picked yet). */
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/**
 * One option of a purpose-specific trigger or condition picked from a fixed
 * list (a moon phase, a golden/blue hour period): HA's own select inside
 * HA, a plain one outside it.
 */
export function OptionSelectField({ label, value, options, onChange }: OptionSelectFieldProps) {
  return (
    <FormField label={label}>
      <HaSelect
        value={value ?? ''}
        onChange={(v) => onChange(String(v))}
        options={options}
        fallback={
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger aria-label={label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </FormField>
  );
}
