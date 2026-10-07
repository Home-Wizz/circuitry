import { useTranslation } from 'react-i18next';
import {
  StateConditionValueFields,
  stateConditionEntityIds,
} from '@/components/panels/node-fields/StateConditionFields';
import { StateTransitionFields } from '@/components/panels/node-fields/StateTriggerFields';
import { useResolvedEntities } from '@/hooks/useResolvedEntities';
import type { NodeColorToken } from '@/lib/node-colors';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { HoldForField } from './holdFor';
import { phraseAfterName } from './StepCard';

/** A State trigger's entities, as its From / To fields suggest states for. */
function entityIdsOf(data: Readonly<Record<string, unknown>>): string[] {
  const raw = data.entity_id;
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  return typeof raw === 'string' && raw ? [raw] : [];
}

/**
 * What a State trigger waits for, as a pill in its card's sentence
 * ("[Front door] [opened]", "[Person] [home]", or "changed" when it has no
 * To): it opens the property panel's own From / To fields and writes what
 * they write, with how long it must hold.
 */
export function StatePill({
  nodeId,
  data,
  phrase,
  tone,
}: {
  nodeId: string;
  data: Readonly<Record<string, unknown>>;
  /** What the card says it waits for ("opened", "turned on", "home"). */
  phrase: string | undefined;
  tone: NodeColorToken;
}) {
  const { t, i18n } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const entities = useResolvedEntities();
  const text = phrase ? phraseAfterName(phrase, i18n.language) : t('nodes:pill.changed');
  return (
    <EditPill
      tone={tone}
      testId="state-pill"
      ariaLabel={t('nodes:pill.editState')}
      contentClassName="w-80"
      editor={() => (
        <div className="flex flex-col gap-3">
          <StateTransitionFields
            data={data}
            entityIds={entityIdsOf(data)}
            entities={entities}
            onChange={(key, value) => updateNodeData(nodeId, { [key]: value })}
          />
          <HoldForField
            kind="trigger"
            data={data}
            onPatch={(patch) => updateNodeData(nodeId, patch)}
          />
        </div>
      )}
    >
      <span className={PILL_TEXT}>{text}</span>
    </EditPill>
  );
}

/**
 * The state a State condition tests for, as a pill in its card's sentence
 * ("[Hallway light] is [on]", "[lights · 2] are [on]"): it opens the
 * property panel's own State (and, for several entities, Match) fields and
 * writes what they write, with how long it must hold. Without a state yet
 * it asks for one.
 */
export function ConditionStatePill({
  nodeId,
  data,
  phrase,
  tone,
}: {
  nodeId: string;
  data: Readonly<Record<string, unknown>>;
  /** The state as the card says it ("on", "open", "home"). */
  phrase: string | undefined;
  tone: NodeColorToken;
}) {
  const { t, i18n } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const entities = useResolvedEntities();
  return (
    <EditPill
      tone={tone}
      testId="condition-state-pill"
      ariaLabel={t('nodes:pill.editConditionState')}
      contentClassName="w-80"
      editor={() => (
        <div className="flex flex-col gap-3">
          <StateConditionValueFields
            data={data}
            entityIds={stateConditionEntityIds(data)}
            entities={entities}
            onChange={(key, value) => updateNodeData(nodeId, { [key]: value })}
          />
          <HoldForField
            kind="condition"
            data={data}
            onPatch={(patch) => updateNodeData(nodeId, patch)}
          />
        </div>
      )}
    >
      <span className={PILL_TEXT}>
        {phrase ? phraseAfterName(phrase, i18n.language) : t('nodes:pill.chooseState')}
      </span>
    </EditPill>
  );
}
