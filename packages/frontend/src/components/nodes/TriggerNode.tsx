import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { hasShortForm } from '@/components/canvas/fillInForms';
import { TruncatedTooltip } from '@/components/ui/truncated-tooltip';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { useEditableTargets, useWholeArea } from '@/hooks/useStepTargets';
import { useTriggerCardDisplay } from '@/hooks/useTriggerCardDisplay';
import { getDomainIcon } from '@/lib/domain-icons';
import { stepIconKey } from '@/lib/emojiIcons';
import { getTraceStateClass, NODE_COLORS } from '@/lib/node-colors';
import { cn } from '@/lib/utils';
import type { TriggerNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { NodeStatusBadge } from './NodeStatusBadge';
import { ForPill } from './ForPill';
import { ShortFormSentence } from './ShortFormSentence';
import { StatePill } from './StatePill';
import { ThresholdPill } from './ThresholdPill';
import { pluralPhrase } from './cardWording';
import { phraseAfterName, StepCard } from './StepCard';
import { CardTargetLine, CardTitle, titleIsTarget } from './TargetPill';

const COLORS = NODE_COLORS.trigger;

interface TriggerNodeProps extends NodeProps {
  data: TriggerNodeData;
}

export const TriggerNode = memo(function TriggerNode({ id, data, selected }: TriggerNodeProps) {
  const { t, i18n } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const { getTriggerDisplayInfo } = useTriggerCardDisplay();
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;

  const displayInfo = getTriggerDisplayInfo(data);
  // Its entities, edited on the card (TargetPill.tsx).
  const pillProps = {
    nodeId: id,
    nodeType: 'trigger',
    data,
    targets: useEditableTargets('trigger', data),
  };
  const Icon = getDomainIcon(displayInfo.iconDomain, Zap);
  // A time, sun, zone, template... trigger reads in the Fill in column's
  // words, its values pills ("When it's [7:00 AM] on [weekdays]").
  const shortForm = !data.alias && hasShortForm(data);

  // The card's sentence: "[Front door] opened" when its title is its
  // entity, "[2 entities] turned on" for several, else its own name with
  // what it does on the line below; "for [5m]" when it must hold.
  const titleIsPill = !data.alias && titleIsTarget(data, pillProps.targets);
  // "Anything in Hallway opened": a whole area as its target.
  const wholeArea = useWholeArea(data.target);
  const areaSentence = !data.alias && wholeArea !== undefined;
  const countIsPill =
    !data.alias &&
    !titleIsPill &&
    pillProps.targets !== null &&
    (displayInfo.phrase !== undefined || data.trigger === 'state');
  const phrase = displayInfo.subtitle;
  // What it waits for, its threshold and how long it must hold, as pills.
  const what = (text: string | undefined) =>
    data.trigger === 'state' ? (
      <>
        {' '}
        <StatePill nodeId={id} data={data} phrase={text} tone="trigger" />
      </>
    ) : (
      text && ` ${phraseAfterName(text, i18n.language)}`
    );
  const holds = (
    <>
      <ThresholdPill nodeId={id} data={data} kind="trigger" tone="trigger" />
      <ForPill nodeId={id} data={data} kind="trigger" tone="trigger" />
    </>
  );
  // What it does and how long, after its subject: "[Front door] stays open
  // for [5m]"; German puts the verb last ("[Haustür] für [5m] offen bleibt").
  const verbLast = i18n.language.startsWith('de');
  const does = (text: string | undefined) =>
    verbLast ? (
      <>
        {holds}
        {what(text)}
      </>
    ) : (
      <>
        {what(text)}
        {holds}
      </>
    );

  return (
    <StepCard
      settingsFor={id}
      tone="trigger"
      icon={Icon}
      iconKey={stepIconKey(
        displayInfo.iconDomain,
        typeof data.trigger === 'string' ? data.trigger.split('.')[0] : undefined,
        'trigger'
      )}
      lead={t('nodes:picker.kinds.when')}
      place={wholeArea?.place ?? displayInfo.place}
      sentence={
        shortForm ? (
          <ShortFormSentence nodeId={id} data={data} />
        ) : areaSentence && wholeArea ? (
          <>
            {phraseAfterName(wholeArea.label, i18n.language)}
            {does(displayInfo.phrase)}
          </>
        ) : titleIsPill ? (
          <>
            <CardTitle {...pillProps} tone="trigger" title={displayInfo.title} />
            {does(displayInfo.phrase ?? (data.trigger === 'state' ? undefined : phrase))}
          </>
        ) : countIsPill ? (
          <>
            <CardTargetLine {...pillProps} tone="trigger" inline />
            {does(
              displayInfo.phrase === undefined
                ? undefined
                : pluralPhrase(phraseAfterName(displayInfo.phrase, i18n.language), i18n.language)
            )}
          </>
        ) : (
          <>
            {displayInfo.title}
            {holds}
          </>
        )
      }
      stepNumber={stepNumber}
      selected={selected}
      isActive={isActive}
      isDisabled={isDisabled}
      hasErrors={hasErrors}
      traceClass={getTraceStateClass(traceState)}
      edge={
        <>
          <NodeStatusBadge
            errorMessages={errorMessages}
            warningMessages={warningMessages}
            isDisabled={isDisabled}
          />
          <Handle
            type="source"
            position={Position.Right}
            className={cn('w-3! h-3!', COLORS.handle)}
          />
        </>
      }
    >
      {!countIsPill && !shortForm && <CardTargetLine {...pillProps} tone="trigger" />}
      {!shortForm && !titleIsPill && !countIsPill && !areaSentence && phrase && (
        <TruncatedTooltip content={phrase}>
          <div className="line-clamp-2 truncate whitespace-pre-line">{phrase}</div>
        </TruncatedTooltip>
      )}
      {!shortForm && !areaSentence && displayInfo.detail != null && displayInfo.detail !== '' && (
        <TruncatedTooltip content={String(displayInfo.detail)}>
          <div className="truncate">{String(displayInfo.detail)}</div>
        </TruncatedTooltip>
      )}
    </StepCard>
  );
});
