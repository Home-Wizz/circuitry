import { Check, Info, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getEntityName } from '@/components/panels/node-fields/TriggerTargetPicker';
import { useMoreInfo } from '@/hooks/useMoreInfo';
import { useNodeCardDisplay } from '@/hooks/useNodeCardDisplay';
import { useOfferedEntities } from '@/hooks/useStepTargets';
import type { NodeColorToken } from '@/lib/node-colors';
import { type EditableTargets, withTargets } from '@/lib/stepTargets';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { countNoun } from './cardWording';
import { EditPill, PILL_TEXT } from './EditPill';

interface TargetPillProps {
  nodeId: string;
  nodeType: string | undefined;
  data: Readonly<Record<string, unknown>>;
  targets: EditableTargets;
  /** What the pill shows: the card's own text for its target. */
  children: ReactNode;
  /** Tinted in the step's colour, as a value in its card's sentence. */
  tone: NodeColorToken;
}

/**
 * The step's entities as a pill on its card: a click opens a small
 * searchable list of the entities its pickers offer (useOfferedEntities),
 * and each tick changes the step at once, through the store as the
 * property panel does (validated, undoable). An entity the step names that
 * isn't offered (one HA ignores for it, #166) is listed too, marked, so it
 * can be taken off.
 */
export function TargetPill({ nodeId, nodeType, data, targets, children, tone }: TargetPillProps) {
  const { t } = useTranslation(['nodes']);
  const empty = targets.entityIds.length === 0;
  return (
    <EditPill
      tone={tone}
      testId="target-pill"
      ariaLabel={t('nodes:pill.editTargets')}
      empty={empty}
      contentClassName="w-80 p-0"
      editor={() => (
        <TargetPillEditor nodeId={nodeId} nodeType={nodeType} data={data} targets={targets} />
      )}
    >
      <span className={PILL_TEXT}>{empty ? t('nodes:pill.chooseTargets') : children}</span>
    </EditPill>
  );
}

function TargetPillEditor({
  nodeId,
  nodeType,
  data,
  targets,
}: Omit<TargetPillProps, 'children' | 'tone'>) {
  const { t } = useTranslation(['nodes']);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const openMoreInfo = useMoreInfo();
  const offered = useOfferedEntities(nodeType, data);
  const { entityNames } = useNodeCardDisplay();
  const [query, setQuery] = useState('');

  const selected = new Set(targets.entityIds);
  const offeredIds = new Set(offered.map((e) => e.entity_id));
  const q = query.trim().toLowerCase();
  const matches = (id: string, name: string) =>
    q === '' || id.toLowerCase().includes(q) || name.toLowerCase().includes(q);

  // The step's own entities first (those not offered marked), then the rest.
  const rows = [
    ...targets.entityIds.map((id) => {
      return { id, name: entityNames([id]), offered: offeredIds.has(id) };
    }),
    ...offered
      .filter((e) => !selected.has(e.entity_id))
      .map((e) => ({ id: e.entity_id, name: getEntityName(e), offered: true }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ].filter((row) => matches(row.id, row.name));

  const toggle = (id: string) => {
    const next = selected.has(id)
      ? targets.entityIds.filter((e) => e !== id)
      : [...targets.entityIds, id];
    updateNodeData(nodeId, withTargets(data, targets.field, next));
  };

  return (
    <div className="flex max-h-80 flex-col">
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the list opens to be searched, as the pickers' search does.
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('nodes:pill.searchEntities')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.length === 0 && (
          <p className="p-3 text-center text-muted-foreground text-sm">
            {t('nodes:pill.noEntities')}
          </p>
        )}
        {rows.map((row) => {
          const isSelected = selected.has(row.id);
          return (
            <div key={row.id} className="flex items-center gap-1 rounded hover:bg-muted">
              {/* biome-ignore lint/a11y/useSemanticElements: a whole-row toggle with its own check mark, as the pickers' target lists (MultiTargetPanel). */}
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                onClick={() => toggle(row.id)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40'
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.name}</span>
                  {!row.offered && (
                    <span className="block truncate text-destructive text-xs">
                      {t('nodes:pill.notActedOn')}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={t('nodes:pill.moreInfo')}
                onClick={() => openMoreInfo(row.id)}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-background"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Whether a card's title is its one target's name (no alias of its own):
 * the title is then the pill. */
export function titleIsTarget(
  data: Readonly<Record<string, unknown>>,
  targets: EditableTargets | null
): boolean {
  return targets !== null && targets.entityIds.length === 1 && !data.alias;
}

interface CardTargetProps {
  nodeId: string;
  nodeType: string | undefined;
  data: Readonly<Record<string, unknown>>;
  targets: EditableTargets | null;
  tone: NodeColorToken;
}

/** A card's title: its target pill when the title is its one target's name. */
export function CardTitle({ title, ...props }: CardTargetProps & { title: ReactNode }) {
  if (!props.targets || !titleIsTarget(props.data, props.targets)) return <>{title}</>;
  return (
    <TargetPill {...props} targets={props.targets}>
      {title}
    </TargetPill>
  );
}

/** A card's target line, when its title isn't the target: the pill with
 * what and how many it names ("lights · 2", countNoun). */
export function CardTargetLine({ inline, ...props }: CardTargetProps & { inline?: boolean }) {
  const { t } = useTranslation(['nodes']);
  const { resolveEntityTarget } = useNodeCardDisplay();
  if (!props.targets || titleIsTarget(props.data, props.targets)) return null;
  const { entityIds } = props.targets;
  const pill = (
    <TargetPill {...props} targets={props.targets}>
      {entityIds.length === 0
        ? t('nodes:pill.entities', { count: 0 })
        : entityIds.length === 1
          ? (resolveEntityTarget(entityIds[0])?.label ?? '')
          : countNoun(t, entityIds.map(resolveEntityTarget))}
    </TargetPill>
  );
  // Inline: in the card's sentence ("turn on [lights · 2]").
  return inline ? pill : <div className="pt-0.5">{pill}</div>;
}
