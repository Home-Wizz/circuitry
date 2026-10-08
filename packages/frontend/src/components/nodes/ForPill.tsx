import { useTranslation } from 'react-i18next';
import { DurationInput, hasMilliseconds } from '@/components/panels/node-fields/DurationField';
import type { NodeColorToken } from '@/lib/node-colors';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { durationUnits, formatDuration } from './formatDuration';
import { holdForPatch, holdForValue } from './holdFor';

/**
 * How long a trigger's or condition's state must hold, as a pill in its
 * card's sentence ("for [5m]"), edited with the property panel's duration
 * editor and written where the panel writes it: a native type's
 * `options.for`, a State one's `for`. Emptied, it's dropped (holdFor.tsx).
 */
export function ForPill({
  nodeId,
  data,
  kind,
  tone,
}: {
  nodeId: string;
  data: Readonly<Record<string, unknown>>;
  kind: 'trigger' | 'condition';
  tone: NodeColorToken;
}) {
  const { t } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const value = holdForValue(kind, data);
  if (value === undefined) return null;
  return (
    <>
      {` ${t('nodes:pill.for')} `}
      <EditPill
        tone={tone}
        testId="for-pill"
        ariaLabel={t('nodes:pill.editFor')}
        contentClassName="w-80"
        editor={() => (
          <DurationInput
            value={value}
            onChange={(next) => updateNodeData(nodeId, holdForPatch(kind, data, next))}
            milliseconds={hasMilliseconds(value)}
          />
        )}
      >
        <span className={PILL_TEXT}>{formatDuration(value, durationUnits(t))}</span>
      </EditPill>
    </>
  );
}
