import { useTranslation } from 'react-i18next';
import { FieldHeading } from '@/components/ui/field-heading';
import { Segmented } from '@/components/ui/segmented';

/**
 * How a purpose-specific trigger fires (Each / The first / The last), or a
 * condition passes (Any / All), when it watches several targets: a row of
 * buttons with a line saying what the chosen one does. The short form the
 * card's "+ more" shows; the property panel keeps its full list.
 */
export function BehaviorSegment({
  kind,
  values,
  value,
  onChange,
}: {
  kind: 'trigger' | 'condition';
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const label = (v: string) => t(`nodes:more.behavior.${kind}.${v}`, { defaultValue: v });
  return (
    <FieldHeading label={t(`nodes:more.behavior.${kind}.label`)}>
      <Segmented
        tone="primary"
        className="self-start"
        value={value}
        options={values.map((v) => ({ value: v, label: label(v) }))}
        onChange={onChange}
      />
      <span className="text-muted-foreground text-xs">
        {t(`nodes:more.behavior.${kind}.hints.${value}`, { defaultValue: '' })}
      </span>
    </FieldHeading>
  );
}
