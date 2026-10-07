import type { NodeProps } from '@xyflow/react';
import { Hourglass } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { WaitTimeoutPill } from './WaitTimeoutPill';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { useTriggerCardDisplay } from '@/hooks/useTriggerCardDisplay';
import { getTraceStateClass } from '@/lib/node-colors';
import type { WaitNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { phraseAfterName, StepFrame } from './StepCard';
import { TemplateLine } from './TemplateLine';

const MAX_VISIBLE_TRIGGERS = 3;

interface WaitNodeProps extends NodeProps {
  data: WaitNodeData;
}

export const WaitNode = memo(function WaitNode({ id, data, selected }: WaitNodeProps) {
  const { t, i18n } = useTranslation(['common', 'nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const { getTriggerDisplayInfo } = useTriggerCardDisplay();
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const waitTriggers = data.wait_for_trigger ?? [];
  const visibleWaitTriggers = waitTriggers.slice(0, MAX_VISIBLE_TRIGGERS);
  const hiddenWaitTriggerCount = waitTriggers.length - visibleWaitTriggers.length;
  // One trigger to wait for reads as a sentence: "wait until [Hallway
  // motion] is clear"; several are listed under "wait for".
  const [onlyTrigger] = waitTriggers.length === 1 ? waitTriggers : [];
  const only = onlyTrigger ? getTriggerDisplayInfo(onlyTrigger) : undefined;
  const untilSentence =
    only?.phrase && only.title
      ? `${t('nodes:cardVerbs.waitUntil')} ${only.title} ${phraseAfterName(only.phrase, i18n.language)}`
      : undefined;
  const sentence =
    data.alias ||
    untilSentence ||
    t(data.wait_template ? 'nodes:cardVerbs.waitUntil' : 'nodes:cardVerbs.waitFor');

  return (
    <StepFrame
      nodeId={id}
      tone="wait"
      icon={Hourglass}
      iconKey="wait"
      lead={t('nodes:picker.kinds.then')}
      sentence={
        <>
          {sentence}
          <WaitTimeoutPill nodeId={id} data={data} />
        </>
      }
      stepNumber={stepNumber}
      selected={selected ?? false}
      isActive={isActive}
      isDisabled={isDisabled}
      hasErrors={hasErrors}
      errorMessages={errorMessages}
      warningMessages={warningMessages}
      traceClass={getTraceStateClass(traceState)}
      roleLabel={null}
      hasSourceHandle
    >
      {data.wait_template && <TemplateLine template={data.wait_template} />}
      {waitTriggers.length > 0 && !untilSentence && (
        <div className="mt-2 space-y-1">
          {visibleWaitTriggers.map((trigger, idx) => {
            const info = getTriggerDisplayInfo(trigger);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: wait_for_trigger entries have no stable id of their own (see TriggerNodeData) — index is the only available key, matching ConditionNode.tsx's identical nested-condition list pattern.
                key={idx}
                className="rounded border border-wait/30 bg-card px-2 py-1"
              >
                <TruncatedTooltip content={info.title}>
                  <div className="truncate font-semibold text-[11px] text-wait">{info.title}</div>
                </TruncatedTooltip>
                {info.subtitle && (
                  <TruncatedTooltip content={info.subtitle}>
                    <div className="truncate text-[10px] text-wait/70">{info.subtitle}</div>
                  </TruncatedTooltip>
                )}
              </div>
            );
          })}
          {hiddenWaitTriggerCount > 0 && (
            <div className="truncate text-[10px] opacity-75">
              {t('nodes:wait.nMoreTriggers', { count: hiddenWaitTriggerCount })}
            </div>
          )}
        </div>
      )}
    </StepFrame>
  );
});
