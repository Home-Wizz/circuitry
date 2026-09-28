import { useTranslation } from 'react-i18next';
import { useConventionMarkers } from '@/hooks/useConventionMarkers';

/**
 * Meaning the canvas used to carry only by shape, shown on the node. The
 * transpiler decides both
 * (`conventionMarkers` in @circuitry/transpiler); these only draw them.
 */

/** A condition chained into the one before it (the list convention): when it
 * fails, the first condition's else runs. Sits on the "yes" link from that
 * condition, just above where it comes in, clear of the handle. */
export function AndChip() {
  const { t } = useTranslation(['nodes']);
  return (
    <div
      className="pointer-events-auto absolute top-1/2 left-[-44px] -translate-y-[140%] rounded-full bg-primary px-1.5 py-0.5 font-semibold text-[9px] text-primary-foreground shadow-sm"
      title={t('nodes:conventions.andHint')}
    >
      {t('nodes:conventions.and')}
    </div>
  );
}

/** A path that just ends here and stops the automation (decision D1):
 * next to the handle it would have gone on from. */
export function StopsHereBadge({ top = '50%' }: { top?: string }) {
  const { t } = useTranslation(['nodes']);
  return (
    <div
      className="pointer-events-auto absolute right-[-92px] flex -translate-y-1/2 items-center gap-1 rounded-full border border-destructive bg-card px-2 py-0.5 font-medium text-[10px] text-destructive shadow-sm"
      style={{ top }}
      title={t('nodes:conventions.stopsHereHint')}
    >
      <span className="inline-block h-2 w-2 rounded-[2px] bg-destructive" />
      {t('nodes:conventions.stopsHere')}
    </div>
  );
}

/** The "Stops here" badge on a step (action, delay, wait, variables, Join)
 * whose path ends there, when it does. */
export function StepStopsHere({ nodeId }: { nodeId: string }) {
  const { stopsAt } = useConventionMarkers(nodeId);
  return stopsAt.includes('out') ? <StopsHereBadge /> : null;
}
