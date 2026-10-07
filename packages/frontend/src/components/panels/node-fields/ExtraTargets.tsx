import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldHeading } from '@/components/ui/field-heading';
import {
  TARGET_KINDS,
  TargetKindField,
  type TargetKind,
  targetIds,
  withTargetIds,
} from './TargetKindField';

/**
 * An action's places besides its entities: the ones it has, and the rest as
 * "+ Room", "+ Device"... to add. Under a heading in a card's "+ more"; in
 * the side panel its section names it.
 */
export function ExtraTargets({
  target,
  onChange,
  heading,
}: {
  target: unknown;
  onChange: (key: string, value: unknown) => void;
  heading?: string;
}) {
  const { t } = useTranslation(['nodes']);
  const [opened, setOpened] = useState<TargetKind[]>([]);
  const shown = TARGET_KINDS.filter((k) => targetIds(target, k).length > 0 || opened.includes(k));
  const toAdd = TARGET_KINDS.filter((k) => !shown.includes(k));
  const fields = (
    <>
      {shown.map((kind) => (
        <TargetKindField
          key={kind}
          kind={kind}
          label={t(`nodes:more.places.${kind}`)}
          values={targetIds(target, kind)}
          onChange={(ids) => onChange('target', withTargetIds(target, kind, ids))}
        />
      ))}
      {toAdd.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {toAdd.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setOpened((prev) => [...prev, kind])}
              className="rounded-full border border-foreground/20 border-dashed px-2.5 py-0.5 text-muted-foreground text-xs hover:bg-muted"
            >
              {`+ ${t(`nodes:more.places.${kind}`)}`}
            </button>
          ))}
        </div>
      )}
    </>
  );
  return heading ? <FieldHeading label={heading}>{fields}</FieldHeading> : fields;
}
