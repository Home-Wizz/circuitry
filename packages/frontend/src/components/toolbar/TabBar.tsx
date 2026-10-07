import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { type FlowTabState, useFlowStore } from '@/store/flow-store';

interface TabSummary {
  flowId: string;
  flowName: string;
  hasUnsavedChanges: boolean;
}

/** Resolves one `tabOrder` entry into display data — the active tab's fields live on the store directly (see flow-store.ts's `tabOrder` doc comment), every other tab's come from its `backgroundTabs` snapshot. */
function resolveTabSummary(
  flowId: string,
  activeTab: TabSummary,
  backgroundTabs: FlowTabState[]
): TabSummary {
  if (flowId === activeTab.flowId) return activeTab;
  const background = backgroundTabs.find((tab) => tab.flowId === flowId);
  return background
    ? { flowId: background.flowId, flowName: background.flowName, hasUnsavedChanges: background.hasUnsavedChanges }
    : { flowId, flowName: '', hasUnsavedChanges: false };
}

/**
 * Browser-tab-style strip for switching between multiple open automations —
 * see flow-store.ts's `tabOrder`/`backgroundTabs` doc comment for the
 * underlying multi-tab model. Rendered directly under the header in
 * App.tsx, styled to match its bg-card/border-border conventions rather
 * than introducing a new visual language.
 *
 * Deliberately renders nothing at all with only one tab open — the
 * single-automation case (still the common one) should look exactly like
 * it did before this feature existed, not gain a permanent single-tab strip
 * with nothing to switch between.
 */
export function TabBar() {
  const { t } = useTranslation(['common']);
  const { flowId, flowName, hasUnsavedChanges, tabOrder, backgroundTabs, switchTab, closeTab, openInNewTab } =
    useFlowStore();

  // A tab with unsaved changes asks before it's closed (closing drops them).
  const [pendingClose, setPendingClose] = useState<TabSummary | null>(null);
  const requestClose = (tab: TabSummary) => {
    if (tab.hasUnsavedChanges) setPendingClose(tab);
    else closeTab(tab.flowId);
  };

  if (tabOrder.length <= 1) return null;

  const activeTab: TabSummary = { flowId, flowName, hasUnsavedChanges };
  const tabs = tabOrder.map((id) => resolveTabSummary(id, activeTab, backgroundTabs));

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-border border-b bg-card px-2 py-1">
      {tabs.map((tab) => {
        const isActive = tab.flowId === flowId;
        return (
          <div
            key={tab.flowId}
            onClick={() => switchTab(tab.flowId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') switchTab(tab.flowId);
            }}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            className={cn(
              'group flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {tab.hasUnsavedChanges && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            )}
            <span className="truncate">{tab.flowName || t('placeholders.automationName')}</span>
            {/* Always shown, not only on hover: a touch screen has no hover. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                requestClose(tab);
              }}
              className="-mr-1 ml-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              title={t('titles.closeTab')}
              aria-label={t('titles.closeTab')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => openInNewTab()}
            aria-label={t('titles.newTab')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('titles.newTab')}</TooltipContent>
      </Tooltip>

      <ConfirmDialog
        open={pendingClose !== null}
        onOpenChange={(open) => !open && setPendingClose(null)}
        title={t('tabs.closeUnsavedTitle', {
          name: pendingClose?.flowName || t('placeholders.automationName'),
        })}
        description={t('tabs.closeUnsavedDescription')}
        confirmLabel={t('tabs.closeUnsavedConfirm')}
        cancelLabel={t('tabs.keepEditing')}
        onConfirm={() => {
          if (pendingClose) closeTab(pendingClose.flowId);
          setPendingClose(null);
        }}
      />
    </div>
  );
}
