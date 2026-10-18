import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useOptionalHass } from '@/contexts/HassContext';
import { cn } from '@/lib/utils';
import { PICKER_LINE } from './PickerColumns';

/**
 * What the pickers say when a list is empty or short because Home Assistant
 * didn't answer, rather than showing nothing, as if there were nothing
 * (bug #228). Quiet: no colour of alarm, a Try again that asks again.
 */

function TryAgain({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation(['nodes']);
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-primary text-sm hover:underline"
    >
      {t('nodes:picker.tryAgain')}
    </button>
  );
}

/** A column's empty state: what it means, in one or two lines. */
export function PickerEmpty({
  title,
  text,
  onRetry,
}: {
  title?: string;
  text: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 p-3 text-center text-sm">
      {title && <div className="font-medium">{title}</div>}
      <div className="text-muted-foreground">{text}</div>
      {onRetry && (
        <div className="mt-1.5">
          <TryAgain onClick={onRetry} />
        </div>
      )}
    </div>
  );
}

/** At the top of a picker's first column when the registries didn't load. */
export function RegistryLoadNote() {
  const { t } = useTranslation(['nodes']);
  const hassContext = useOptionalHass();
  if (!hassContext?.registriesFailed) return null;
  const retry = hassContext.retryRegistries;
  return (
    <div
      role="status"
      className={cn('m-1 mb-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm', PICKER_LINE)}
    >
      <div className="font-medium">{t('nodes:picker.registriesFailedTitle')}</div>
      <div className="mt-0.5 text-muted-foreground">{t('nodes:picker.registriesFailedText')}</div>
      {retry && (
        <div className="mt-1.5">
          <TryAgain onClick={retry} />
        </div>
      )}
    </div>
  );
}

/** A search that matches nothing: said, not an empty column (bug #255). */
export function SearchEmpty() {
  const { t } = useTranslation(['nodes']);
  return <PickerEmpty text={t('nodes:picker.searchEmpty')} />;
}

/** The Devices column with no device in it: the registries didn't load, or
 * no device is in a room (those are under Unassigned). */
export function DevicesEmpty() {
  const { t } = useTranslation(['nodes']);
  const hassContext = useOptionalHass();
  if (hassContext?.registriesFailed) {
    return (
      <PickerEmpty
        title={t('nodes:picker.devicesFailedTitle')}
        text={t('nodes:picker.devicesFailedText')}
        onRetry={hassContext.retryRegistries}
      />
    );
  }
  const place = `${t('nodes:picker.sections.homeAssistant')} › ${t('nodes:picker.rows.unassigned')}`;
  return (
    <PickerEmpty
      text={
        <>
          {t('nodes:picker.noRoomDevices')}
          <br />
          {t('nodes:picker.noRoomDevicesWhere', { place })}
        </>
      }
    />
  );
}

/** Above a list some devices didn't answer for. */
export function UnansweredNote({ count, onRetry }: { count: number; onRetry: () => void }) {
  const { t } = useTranslation(['nodes']);
  if (count === 0) return null;
  return (
    <div role="status" className={cn('mx-1 mb-2 border-b px-1 pt-1 pb-2 text-sm', PICKER_LINE)}>
      <span className="text-muted-foreground">
        {t('nodes:picker.devicesUnanswered', { count })}
      </span>{' '}
      <TryAgain onClick={onRetry} />
    </div>
  );
}
