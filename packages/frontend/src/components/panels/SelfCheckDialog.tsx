import type { TFunction } from 'i18next';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useHass } from '@/contexts/HassContext';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { showErrorToast, showSuccessToast } from '@/lib/haToast';
import {
  type AutomationOutcome,
  byOutcome,
  OLDEST_SUPPORTED_HA,
  runSelfCheck,
  type SelfCheckResult,
  TESTED_HA_RELEASES,
} from '@/lib/self-check';
import { copyToClipboard } from '@/utils/copy-to-clipboard';

/** One line of the result: fine, or something to know. */
interface ResultLine {
  ok: boolean;
  text: string;
  /** Per automation, why (read-only, unreadable): in the copied report. */
  details?: string[];
}

const VERSION_KEYS = {
  tested: 'selfCheck.versionTested',
  newer: 'selfCheck.versionNewer',
  older: 'selfCheck.versionOlder',
  unsupported: 'selfCheck.versionUnsupported',
  unknown: 'selfCheck.versionUnknown',
} as const;

/** The outcomes said as a line each, in this order, when any automation has one. */
const OUTCOME_LINES = [
  { outcome: 'readOnly', key: 'selfCheck.readOnly' },
  { outcome: 'keptElsewhere', key: 'selfCheck.keptElsewhere' },
  { outcome: 'unreadable', key: 'selfCheck.unreadable' },
  { outcome: 'unchecked', key: 'selfCheck.unchecked' },
  { outcome: 'leftOver', key: 'selfCheck.leftOver' },
] as const satisfies readonly { outcome: AutomationOutcome; key: string }[];

/** The result as lines, shown in the dialog and copied as the report. */
export function selfCheckLines(result: SelfCheckResult, t: TFunction): ResultLine[] {
  const lines: ResultLine[] = [
    {
      ok: result.standing === 'tested',
      text: t(VERSION_KEYS[result.standing], {
        version: result.haVersion ?? '',
        tested: TESTED_HA_RELEASES.join(', '),
        oldest: OLDEST_SUPPORTED_HA,
      }),
    },
    {
      ok: result.integration,
      text: t(result.integration ? 'selfCheck.integrationOk' : 'selfCheck.integrationMissing'),
    },
  ];
  const total = result.automations.filter((a) => a.outcome !== 'leftOver').length;
  if (total === 0) {
    lines.push({ ok: true, text: t('selfCheck.none') });
  } else {
    lines.push({
      ok: byOutcome(result, 'exact').length === total,
      text: t('selfCheck.exact', { count: byOutcome(result, 'exact').length, total }),
    });
  }
  for (const { outcome, key } of OUTCOME_LINES) {
    const found = byOutcome(result, outcome);
    if (found.length === 0) continue;
    lines.push({
      // Not run on test values is no fault of the automation's; a left-over
      // entity is only untidy.
      ok: outcome === 'unchecked' || outcome === 'leftOver',
      text: t(key, { count: found.length, names: found.map((a) => a.name).join(', ') }),
      details: found.filter((a) => a.detail).map((a) => `${a.name} (${a.entityId}): ${a.detail}`),
    });
  }
  if (result.stopped) {
    lines.push({ ok: false, text: t('selfCheck.stopped', { done: result.automations.length }) });
  }
  return lines;
}

/** The copied report: the lines, then the details behind them. */
export function selfCheckReport(result: SelfCheckResult, t: TFunction): string {
  const lines = selfCheckLines(result, t);
  return [
    t('selfCheck.title'),
    '',
    ...lines.map((line) => `${line.ok ? '✓' : '!'} ${line.text}`),
    ...lines.flatMap((line) => (line.details ?? []).map((d) => `  - ${d}`)),
  ].join('\n');
}

/**
 * Check my setup: every automation opened the way the editor opens one,
 * nothing written. Starts when opened; Stop ends it after the automation
 * being checked.
 */
export function SelfCheckDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['common']);
  const { hass } = useHass();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<SelfCheckResult | null>(null);
  const stop = useRef(false);
  const running = progress !== null && result === null;

  // Started once per opening; `hass` changes every few seconds, so it is
  // read when the check starts, not depended on.
  const hassRef = useRef(hass);
  hassRef.current = hass;
  useEffect(() => {
    const current = hassRef.current;
    if (!open || !current) return;
    let cancelled = false;
    stop.current = false;
    setResult(null);
    setProgress({ done: 0, total: 0 });
    runSelfCheck(getHomeAssistantAPI(current), current.config?.version, {
      onProgress: (done, total) => {
        if (!cancelled) setProgress({ done, total });
      },
      shouldStop: () => stop.current || cancelled,
    })
      .then((checked) => {
        if (!cancelled) setResult(checked);
      })
      .catch((error) => {
        if (!cancelled) {
          showErrorToast(error instanceof Error ? error.message : String(error));
          onOpenChange(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, onOpenChange]);

  const copy = async () => {
    if (!result) return;
    await copyToClipboard(selfCheckReport(result, t));
    showSuccessToast(t('selfCheck.copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('selfCheck.title')}</DialogTitle>
          <DialogDescription>{t('selfCheck.description')}</DialogDescription>
        </DialogHeader>

        {running && progress && (
          <div className="grid gap-2" aria-live="polite">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('selfCheck.progress', { done: progress.done, total: progress.total })}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {result && (
          <ul className="grid gap-2 text-sm">
            {selfCheckLines(result, t).map((line) => (
              <li key={line.text} className="flex gap-2">
                {line.ok ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                )}
                <span className="min-w-0 break-words">{line.text}</span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => (stop.current = true)}>
              {t('selfCheck.stop')}
            </Button>
          ) : (
            <Button variant="outline" onClick={copy} disabled={!result}>
              {t('selfCheck.copy')}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>{t('buttons.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
