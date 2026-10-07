import type { WaitNode } from '@circuitry/shared';
import { useTranslation } from 'react-i18next';
import { WaitTimeoutFields } from '@/components/panels/node-fields/WaitFields';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { durationUnits, formatDuration } from './formatDuration';

/**
 * A wait's timeout, in its card's sentence: ", up to [1 min]". It opens the
 * property panel's own timeout fields (whether it carries on when time
 * runs out included). Without one, a selected card's "+ more" sets it
 * (StepSettingsPill).
 */
export function WaitTimeoutPill({ nodeId, data }: { nodeId: string; data: WaitNode['data'] }) {
  const { t } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const timeout = data.timeout;
  if (timeout === undefined || timeout === null) return null;
  return (
    <>
      {`, ${t('nodes:pill.upTo')} `}
      <EditPill
        tone="wait"
        testId="wait-timeout-pill"
        ariaLabel={t('nodes:wait.timeoutLabel')}
        contentClassName="w-80"
        editor={() => (
          <div className="flex flex-col gap-3">
            <WaitTimeoutFields
              data={data}
              onChange={(key, value) => updateNodeData(nodeId, { [key]: value })}
            />
          </div>
        )}
      >
        <span className={PILL_TEXT}>{formatDuration(timeout, durationUnits(t))}</span>
      </EditPill>
    </>
  );
}
