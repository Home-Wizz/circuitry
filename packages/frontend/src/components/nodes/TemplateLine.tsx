import { Braces } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A template on a card, in words ("Its template is true"), the code itself
 * in a tooltip: the code can name entities by id, and a card never shows
 * an id. Shared by the condition and wait cards.
 */
export function TemplateLine({ template }: { template: string }) {
  const { t } = useTranslation(['nodes']);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="inline-flex max-w-full items-center gap-1 opacity-75"
          data-testid="template-line"
        >
          <Braces className="h-3 w-3 shrink-0" />
          <span className="truncate">{t('nodes:templateLine')}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-pre-wrap font-mono text-[11px]">
        {template}
      </TooltipContent>
    </Tooltip>
  );
}
