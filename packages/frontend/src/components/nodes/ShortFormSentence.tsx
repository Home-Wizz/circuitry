import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { TriggerShortForm } from '@/components/canvas/fillInForms';
import { useShortFormSentence } from '@/components/canvas/fillInSentence';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { startLower } from './StepCard';

/**
 * A time, sun, zone, template... trigger's card sentence, in the Fill in
 * column's words ("When it's [7:00 AM] on [weekdays]", "When the sun
 * [sets], [15 min before]"), its values pills that open the same short
 * form. The card's own "When" leads it, so the sentence's is left off.
 */
export function ShortFormSentence({
  nodeId,
  data,
}: {
  nodeId: string;
  data: Readonly<Record<string, unknown>>;
}) {
  const { t, i18n } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const parts = useShortFormSentence(data) ?? [];
  const lead = t('nodes:picker.kinds.when');
  const shown = parts
    .map((part, i) => {
      if (i !== 0 || part.role !== 'words') return part;
      if (part.text === lead) return { ...part, text: '' };
      return part.text.startsWith(`${lead} `)
        ? { ...part, text: part.text.slice(lead.length + 1) }
        : { ...part, text: i18n.language.startsWith('de') ? part.text : startLower(part.text) };
    })
    .filter((part) => part.text);
  return (
    <>
      {shown.map((part, i) => (
        <Fragment key={`${part.role}:${part.text}`}>
          {i > 0 && !/^[,.;:]/.test(part.text) && ' '}
          {part.role === 'value' ? (
            <EditPill
              tone="trigger"
              testId="short-form-pill"
              ariaLabel={t('nodes:pill.moreSettings')}
              contentClassName="flex w-80 flex-col gap-4"
              editor={() => (
                <TriggerShortForm data={data} onPatch={(patch) => updateNodeData(nodeId, patch)} />
              )}
            >
              <span className={PILL_TEXT}>{part.text}</span>
            </EditPill>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}
