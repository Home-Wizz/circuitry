import { useTranslation } from 'react-i18next';

/**
 * Inline Above/Below threshold editor for `numeric_state` trigger AND
 * condition cards (e.g. "Light brightness crossed threshold" trigger,
 * "Temperature between 17 and 25" condition) — same nodrag/stopPropagation
 * pattern as DelayNode.tsx's inline Sec/Min editor, generalizing that
 * approach to a second field shape (two optional numbers instead of one
 * amount+unit) rather than duplicating the drag-prevention wiring.
 * `onChange` takes a partial patch rather than the raw store setter so this
 * component doesn't need to know FlowNodeData's shape — shared verbatim
 * between TriggerNode.tsx and ConditionNode.tsx per CLAUDE.md's DRY mandate
 * (both cards need the identical above/below number-pair editor; before this
 * was extracted, ConditionNode.tsx had no inline editor at all for
 * numeric_state's above/below, only read-only "> X"/"< X" text — the only
 * way to set them was the property panel).
 */
export function NumericStateInlineEditor({
  above,
  below,
  onChange,
}: {
  above: number | undefined;
  below: number | undefined;
  onChange: (patch: { above?: number; below?: number }) => void;
}) {
  const { t } = useTranslation(['nodes']);

  const handleNumberChange = (field: 'above' | 'below', raw: string) => {
    onChange({ [field]: raw === '' ? undefined : Number(raw) });
  };

  return (
    <div
      className="nodrag flex items-center gap-2 pt-0.5"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">{t('nodes:fieldLabels.short.above')}</span>
        <input
          type="number"
          value={above ?? ''}
          onChange={(e) => handleNumberChange('above', e.target.value)}
          placeholder="—"
          className="h-6 w-14 rounded border bg-background px-1.5 text-xs"
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">{t('nodes:fieldLabels.short.below')}</span>
        <input
          type="number"
          value={below ?? ''}
          onChange={(e) => handleNumberChange('below', e.target.value)}
          placeholder="—"
          className="h-6 w-14 rounded border bg-background px-1.5 text-xs"
        />
      </label>
    </div>
  );
}
