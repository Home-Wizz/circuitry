import type { FlowNode } from '@circuitry/shared';
import { ChevronRight } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasShortForm, TriggerShortForm } from '@/components/canvas/fillInForms';
import {
  type SentencePart,
  useFillInSentence,
  useShortFormSentence,
} from '@/components/canvas/fillInSentence';
import { ResultsColumn } from '@/components/canvas/PickerColumns';
import { canHoldFor, HoldForField } from '@/components/nodes/holdFor';
import { useThreshold } from '@/components/nodes/ThresholdPill';
import { NodeFields } from '@/components/panels/NodeFields';
import { TriggerConfigFields } from '@/components/panels/node-fields/TriggerFields';
import { Button } from '@/components/ui/button';
import { FieldHeading } from '@/components/ui/field-heading';
import { useNativeDescriptions } from '@/hooks/useNativeDescriptions';
import { usePickGaps } from '@/hooks/usePickGaps';
import { cn } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';

/**
 * A node that doesn't exist yet, for the field editors (which read only
 * `node.id`, `node.type` and `node.data`). The picker builds its data from
 * a catalog entry before the canvas has a node for it, so the data isn't
 * a checked node's yet: this is the one place it's treated as one.
 */
export function draftFlowNode(type: string, data: Record<string, unknown>): FlowNode {
  return { id: 'draft', type, position: { x: 0, y: 0 }, data } as unknown as FlowNode;
}

/** The node types the pickers' last column sets up. */
export type ConfigurableNodeType =
  | 'trigger'
  | 'condition'
  | 'action'
  | 'delay'
  | 'wait'
  | 'set_variables';

interface NodeConfigColumnProps {
  title: string;
  nodeType: ConfigurableNodeType;
  /** The picked entry's data: what the node starts with. */
  initialData: Record<string, unknown>;
  entities: HassEntity[];
  commitLabel: string;
  onCommit: (data: Record<string, unknown>) => void;
  /** Back to the pick (closes this column). */
  onBack?: () => void;
}

/**
 * The pickers' Fill in column: the
 * picked trigger or step set up before it's added, in a column of its own.
 * It opens only for a pick that still needs something (lib/pickGaps.ts: a
 * time, a template, an action's target or required fields, a threshold).
 * A threshold type asks only for what it needs -- its level (the card's own
 * threshold editor, useThreshold) and an optional "for at least" -- with
 * the sentence it will read as, and the rest of its settings under "More
 * options". Anything else shows its settings with the property panel's
 * editors. The data is a local draft until the button adds the node.
 */
/** The sentence a pick will read as, its values set apart (blue) and the
 * thing it names on a chip. */
function SentenceBox({ parts }: { parts: SentencePart[] }) {
  return (
    <p
      data-testid="fill-in-sentence"
      className="rounded-lg border border-foreground/15 bg-muted/40 px-3 py-2 text-sm leading-relaxed"
    >
      {parts.map((part, i) => (
        <Fragment key={`${part.role}:${part.text}`}>
          {/* Words run on with a space; punctuation sticks to what's before. */}
          {i > 0 && !/^[,.;:]/.test(part.text) && ' '}
          <span
            className={cn(
              part.role === 'subject' && 'rounded bg-muted px-1.5 py-0.5 font-medium',
              part.role === 'value' && 'font-medium text-primary'
            )}
          >
            {part.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** The Fill in column's width: the column of picks beside it takes the rest. */
const FILL_IN_WIDTH = 360;

export function NodeConfigColumn({
  title,
  nodeType,
  initialData,
  entities,
  commitLabel,
  onCommit,
  onBack,
}: NodeConfigColumnProps) {
  const { t } = useTranslation(['nodes']);
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const [moreOpen, setMoreOpen] = useState(false);
  const handleChange = useCallback(
    (key: string, value: unknown) => setData((prev) => ({ ...prev, [key]: value })),
    []
  );
  const patch = useCallback(
    (next: Record<string, unknown>) => setData((prev) => ({ ...prev, ...next })),
    []
  );
  const node = useMemo(() => draftFlowNode(nodeType, data), [nodeType, data]);
  const gapsOf = usePickGaps();
  const missing = useMemo(() => gapsOf(nodeType, data), [gapsOf, nodeType, data]);
  const kind = nodeType === 'trigger' ? 'trigger' : nodeType === 'condition' ? 'condition' : null;
  const threshold = useThreshold(data, kind ?? 'trigger', kind !== null);
  const descriptions = useNativeDescriptions(kind ?? 'trigger');
  const thresholdSentence = useFillInSentence(kind, data, threshold?.text);
  const shortSentence = useShortFormSentence(data);
  // A time, sun, zone or template trigger's own short form.
  const shortForm = nodeType === 'trigger' && hasShortForm(data);
  const sentence = threshold ? thresholdSentence : shortForm ? shortSentence : undefined;
  const canHold = kind !== null && canHoldFor(kind, data, (type) => descriptions[type]);
  // A patch from the card's own editors, with an emptied setting dropped.
  const patchDropping = (next: Record<string, unknown>) =>
    setData((prev) =>
      Object.fromEntries(
        Object.entries({ ...prev, ...next }).filter(([, value]) => value !== undefined)
      )
    );

  const editors =
    nodeType === 'trigger' ? (
      <TriggerConfigFields node={node} onChange={handleChange} entities={entities} />
    ) : (
      <NodeFields node={node} onChange={handleChange} entities={entities} />
    );

  return (
    <ResultsColumn title={t('nodes:pickerConfig.fillIn')} width={FILL_IN_WIDTH}>
      <div className="flex min-h-full flex-col gap-4 p-3" data-testid="fill-in">
        <div className="font-semibold text-sm">{title}</div>
        {threshold || shortForm ? (
          <>
            {sentence && <SentenceBox parts={sentence} />}
            {threshold ? (
              <>
                {threshold.headed ? (
                  threshold.editor(patch, 'wide')
                ) : (
                  <FieldHeading label={t('nodes:pickerConfig.level')}>
                    {threshold.editor(patch, 'wide')}
                  </FieldHeading>
                )}
                {canHold && kind && (
                  <HoldForField kind={kind} data={data} onPatch={patchDropping} />
                )}
              </>
            ) : (
              <TriggerShortForm data={data} onPatch={patchDropping} />
            )}
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              className="flex items-center gap-1 self-start font-medium text-primary text-sm hover:underline"
              aria-expanded={moreOpen}
            >
              {t('nodes:pickerConfig.moreOptions')}
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-90')}
              />
            </button>
            {moreOpen && editors}
          </>
        ) : (
          editors
        )}
        {missing.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <div className="font-medium text-destructive">
              {t('nodes:pickerConfig.stillNeeded')}
            </div>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {missing.map((issue) => (
                <li key={`${issue.path.join('.')}:${issue.message}`}>
                  {t(issue.message, { defaultValue: issue.message })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-auto flex gap-2 pt-1">
          {onBack && (
            <Button variant="outline" className="flex-1" onClick={onBack}>
              {t('nodes:pickerConfig.back')}
            </Button>
          )}
          <Button className="flex-1" onClick={() => onCommit(data)}>
            {commitLabel}
          </Button>
        </div>
      </div>
    </ResultsColumn>
  );
}
