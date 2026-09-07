import { transpiler } from '@circuitry/transpiler';
import { useReactFlow } from '@xyflow/react';
import { dump as yamlDump } from 'js-yaml';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  DiamondPlus,
  Download,
  Layers,
  PlusSquare,
  Search,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { HaSwitch } from '@/ha';
import {
  type AutomationCatalogSortColumn,
  type AutomationCatalogSortDirection,
  useAutomationCatalog,
} from '@/hooks/useAutomationCatalog';
import { useLoadAutomation } from '@/hooks/useLoadAutomation';
import { mergeAutomationGraphs } from '@/lib/automation-merge';
import { deleteGraph } from '@/lib/graph-storage';
import type { AutomationCatalogItem } from '@/lib/ha-api';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { showErrorToast, showSuccessToast } from '@/lib/haToast';
import { useFlowStore } from '@/store/flow-store';
import { useHass } from '../../contexts/HassContext';

interface AutomationImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AutomationImportDialog({ isOpen, onClose }: AutomationImportDialogProps) {
  const { t } = useTranslation(['common', 'dialogs', 'errors']);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<AutomationCatalogSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<AutomationCatalogSortDirection>('asc');
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  // Separate from showConfirmDialog/pendingAction above — that mechanism
  // guards against discarding unsaved canvas changes when opening a
  // different automation, an unrelated concern from confirming a
  // permanent, irreversible delete of an automation from Home Assistant.
  const [automationPendingDelete, setAutomationPendingDelete] =
    useState<AutomationCatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { hass, config: hassConfig, entities } = useHass();
  const { setFlowName, setAutomationId, reset, fromFlowGraph, hasRealChanges } = useFlowStore();
  const { fitView } = useReactFlow();
  const loadAutomation = useLoadAutomation();

  const { catalogByArea, sortedCatalogItems } = useAutomationCatalog({
    isOpen,
    hass,
    hassConfig,
    entities,
    searchTerm,
    sortColumn,
    sortDirection,
    labels: {
      noArea: t('dialogs:import.noArea'),
      otherArea: t('dialogs:import.otherArea'),
    },
  });

  useEffect(() => {
    if (!isOpen) {
      setSelectedEntityIds(new Set());
      setSearchTerm('');
    }
  }, [isOpen]);

  const selectedAutomations = useMemo(() => {
    return sortedCatalogItems.filter((item) => selectedEntityIds.has(item.entity_id));
  }, [sortedCatalogItems, selectedEntityIds]);

  const allVisibleSelected = useMemo(() => {
    if (sortedCatalogItems.length === 0) return false;
    return sortedCatalogItems.every((item) => selectedEntityIds.has(item.entity_id));
  }, [sortedCatalogItems, selectedEntityIds]);

  const hasVisibleResults = sortedCatalogItems.length > 0;

  const confirmAction = (action: () => void) => {
    if (hasRealChanges()) {
      setPendingAction(() => action);
      setShowConfirmDialog(true);
      return;
    }
    action();
  };

  const handleConfirm = () => {
    if (pendingAction) {
      pendingAction();
    }
    setShowConfirmDialog(false);
    setPendingAction(null);
  };

  const handleCancelConfirm = () => {
    setShowConfirmDialog(false);
    setPendingAction(null);
  };

  const handleSort = (column: AutomationCatalogSortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (column: AutomationCatalogSortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  const toggleSelection = (entityId: string) => {
    setSelectedEntityIds((current) => {
      const next = new Set(current);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  };

  const handleToggleAutomationEnabled = async (
    automation: AutomationCatalogItem,
    checked: boolean
  ) => {
    try {
      const api = getHomeAssistantAPI(hass, hassConfig);
      await api.setAutomationState(automation.entity_id, checked);
      showSuccessToast(
        checked ? t('dialogs:import.automationEnabled') : t('dialogs:import.automationDisabled')
      );
    } catch {
      showErrorToast(t('dialogs:import.updateStateFailed'));
    }
  };

  // The catalog list itself needs no manual refetch after a successful
  // delete — sortedCatalogItems derives from useHass()'s live `entities`
  // (see useAutomationCatalog.ts), same reactive mechanism
  // handleToggleAutomationEnabled above already relies on, so the deleted
  // automation's entity disappearing from HA's state is what removes its row.
  const handleDeleteAutomation = async () => {
    if (!automationPendingDelete) return;
    const automation = automationPendingDelete;
    setIsDeleting(true);
    try {
      const api = getHomeAssistantAPI(hass, hassConfig);
      await api.deleteAutomation(automation.automation_id);
      // Option 1: clean up the canonical graph alongside the automation
      // itself. Best-effort -- see deleteGraph's doc comment.
      void deleteGraph(api, automation.automation_id);
      showSuccessToast(
        t('dialogs:import.automationDeleted', { name: automation.friendly_name })
      );
      setSelectedEntityIds((current) => {
        if (!current.has(automation.entity_id)) return current;
        const next = new Set(current);
        next.delete(automation.entity_id);
        return next;
      });
      setAutomationPendingDelete(null);
    } catch (error) {
      showErrorToast(
        t('dialogs:import.deleteFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectAllVisible = () => {
    setSelectedEntityIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const item of sortedCatalogItems) {
          next.delete(item.entity_id);
        }
      } else {
        for (const item of sortedCatalogItems) {
          next.add(item.entity_id);
        }
      }
      return next;
    });
  };

  const handleImportAutomation = async (
    automation: AutomationCatalogItem,
    openMode: 'current' | 'new' = 'current'
  ) => {
    const success = await loadAutomation(automation, openMode);
    if (success) {
      onClose();
    }
  };

  // "Open all in a single tab" — one selected automation replaces the active
  // tab (existing single-open behavior); more than one merges into the
  // active tab's canvas (existing "Open together" behavior). Both discard
  // whatever's currently in the active tab, so both go through confirmAction.
  const handleOpenAsSingleTab = () => {
    if (selectedAutomations.length === 0) return;
    if (selectedAutomations.length === 1) {
      confirmAction(() => {
        handleImportAutomation(selectedAutomations[0]);
      });
    } else {
      confirmAction(() => void handleMergeSelection());
    }
  };

  // "Open each as its own tab" — every selected automation gets backgrounded
  // into its own new tab, one openInNewTab() per automation, leaving the
  // last one active. Never touches the active tab's existing contents, so
  // (unlike handleOpenAsSingleTab) no confirmAction wrapper is needed.
  const handleOpenAsTabs = async () => {
    if (selectedAutomations.length === 0) return;
    for (const automation of selectedAutomations) {
      await loadAutomation(automation, 'new');
    }
    onClose();
  };

  const buildMergedFlowName = (sources: AutomationCatalogItem[]): string => {
    const aliases = sources.map((source) => source.friendly_name).filter(Boolean);
    if (aliases.length === 0) {
      return t('dialogs:import.defaultMergedName');
    }
    if (aliases.length <= 2) {
      return aliases.join(' + ');
    }
    return `${aliases[0]} + ${aliases.length - 1} more`;
  };

  const handleMergeSelection = async () => {
    if (selectedAutomations.length < 2) return;

    try {
      const api = getHomeAssistantAPI(hass, hassConfig);
      if (!api.isConnected()) {
        throw new Error(t('errors:connection.noConnection'));
      }

      const configByAutomationId = await api.getAutomationConfigsBatch(
        selectedAutomations.map((automation) => automation.automation_id)
      );

      const mergeSources = [];
      for (const automation of selectedAutomations) {
        let config = configByAutomationId[automation.automation_id];
        if (!config) {
          config = await api.getAutomationConfigWithFallback(
            automation.automation_id,
            automation.friendly_name
          );
        }

        if (!config) {
          throw new Error(
            t('dialogs:import.mergeFailedMissingConfig', {
              name: automation.friendly_name,
            })
          );
        }

        const yamlString = yamlDump(config, {
          indent: 2,
          lineWidth: -1,
          quotingType: '"',
          forceQuotes: false,
        });

        const parsed = await transpiler.fromYaml(yamlString);
        if (!parsed.success || !parsed.graph) {
          throw new Error(
            t('dialogs:import.mergeFailedInvalidYaml', {
              name: automation.friendly_name,
            })
          );
        }

        mergeSources.push({
          graph: parsed.graph,
          automationId: automation.automation_id,
          entityId: automation.entity_id,
          alias: automation.friendly_name || automation.automation_id,
        });
      }

      const mergedGraph = mergeAutomationGraphs(mergeSources);
      fromFlowGraph(mergedGraph);
      setFlowName(buildMergedFlowName(selectedAutomations));
      setAutomationId(null);
      setSelectedEntityIds(new Set());

      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300, maxZoom: 0.75 });
      }, 150);

      showSuccessToast(
        t('dialogs:import.mergeSuccess', {
          count: selectedAutomations.length,
        })
      );
      onClose();
    } catch (error) {
      console.error('Circuitry: Failed to merge automations:', error);
      showErrorToast(t('dialogs:import.mergeFailed', { message: (error as Error).message }));
    }
  };

  const formatLastTriggered = (timestamp?: string) => {
    if (!timestamp) return t('dialogs:import.never');
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('dialogs:import.justNow');
    if (diffMins < 60) return t('dialogs:import.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('dialogs:import.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('dialogs:import.daysAgo', { count: diffDays });
    return date.toLocaleDateString();
  };

  // Extracted from the old inline `automations.map((automation) => ...)` so
  // it can render both the default area-grouped view AND -- see the
  // sortColumn branch below -- a flat, ungrouped list when the user has
  // explicitly picked a sort column. A single row's markup never depended
  // on which area it's in, so nothing else about it changes.
  const renderAutomationRow = (automation: AutomationCatalogItem) => {
    const isSelected = selectedEntityIds.has(automation.entity_id);

    return (
      <div
        key={automation.entity_id}
        className={`flex border-b last:border-0 ${isSelected ? 'bg-accent/40' : ''}`}
        onDoubleClick={() => confirmAction(() => void handleImportAutomation(automation))}
      >
        <div
          className="flex w-[44px] shrink-0 items-center justify-center px-2 py-2"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleSelection(automation.entity_id)}
            title={isSelected ? t('dialogs:import.unselect') : t('dialogs:import.select')}
          />
        </div>
        <div className="min-w-0 flex-1 px-3 py-2 align-top">
          <div className="max-w-[180px] font-medium">{automation.friendly_name}</div>
          {automation.description && (
            <div className="mt-1 max-w-[180px] truncate text-muted-foreground text-xs">
              {automation.description}
            </div>
          )}
          {automation.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {automation.tags.map((tag) => (
                <Badge key={`${automation.entity_id}-${tag}`} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {t('dialogs:import.ID', { id: automation.automation_id })}
          </div>
          {automation.mode && (
            <div className="text-muted-foreground text-xs">
              {t('dialogs:import.mode', { mode: automation.mode })}
            </div>
          )}
        </div>
        <div className="w-[120px] max-w-[120px] shrink-0 px-3 py-2 align-top">
          {automation.last_triggered ? (
            <span className="whitespace-nowrap text-xs">
              {formatLastTriggered(automation.last_triggered)}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">{t('dialogs:import.never')}</span>
          )}
        </div>
        <div
          className="w-[80px] shrink-0 px-3 py-2 text-center align-top"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <HaSwitch
            checked={automation.enabled}
            onChange={(checked) => handleToggleAutomationEnabled(automation, checked)}
            fallback={
              <Switch
                checked={automation.enabled}
                onCheckedChange={(checked) => handleToggleAutomationEnabled(automation, checked)}
                aria-label={
                  automation.enabled ? t('dialogs:import.columns.enabled') : t('dialogs:import.disabled')
                }
              />
            }
          />
        </div>
        <div
          className="flex w-[136px] shrink-0 items-center justify-center gap-1 px-3 py-2 align-top"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={() => confirmAction(() => void handleImportAutomation(automation))}
            title={t('dialogs:import.importAutomation')}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void handleImportAutomation(automation, 'new')}
            title={t('dialogs:import.openInNewTab')}
          >
            <PlusSquare className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setAutomationPendingDelete(automation)}
            title={t('dialogs:import.deleteAutomation')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader className="space-y-3">
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle>{t('dialogs:import.title')}</DialogTitle>
              <DialogDescription>{t('dialogs:import.descriptionFull')}</DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={selectedAutomations.length === 0}>
                    {selectedAutomations.length > 1 ? (
                      <Layers className="mr-2 h-4 w-4" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    {t('dialogs:import.openSingle')}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => void handleOpenAsTabs()}>
                    <PlusSquare className="mr-2 h-4 w-4" />
                    {t('dialogs:import.openAsTabs')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleOpenAsSingleTab}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('dialogs:import.openAsSingleTab')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={() => {
                  confirmAction(() => {
                    reset();
                    setFlowName(t('defaults.newAutomation'));
                    onClose();
                  });
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <DiamondPlus className="mr-2 h-4 w-4" />
                {t('dialogs:import.createNew')}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative mb-4 shrink-0">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('dialogs:import.searchPlaceholder')}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-10"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-t-md">
            <div className="min-w-full">
              <div className="sticky top-0 z-20 bg-background before:absolute before:-top-px before:right-0 before:left-0 before:h-px before:bg-background">
                <div className="flex">
                  <div className="flex w-[44px] shrink-0 items-center justify-center border-b bg-muted px-2 py-2">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAllVisible}
                      title={
                        allVisibleSelected
                          ? t('dialogs:import.unselectAll')
                          : t('dialogs:import.selectAll')
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSort('name')}
                    className="min-w-0 flex-1 cursor-pointer whitespace-nowrap border-b bg-muted px-3 py-2 text-left font-semibold text-muted-foreground text-xs hover:bg-muted/80"
                  >
                    {t('dialogs:import.columns.name')}
                    {getSortIcon('name')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSort('lastTriggered')}
                    className="w-[120px] shrink-0 cursor-pointer whitespace-nowrap border-b bg-muted px-3 py-2 text-left font-semibold text-muted-foreground text-xs hover:bg-muted/80"
                  >
                    {t('dialogs:import.columns.lastTriggered')}
                    {getSortIcon('lastTriggered')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSort('enabled')}
                    className="w-[80px] shrink-0 cursor-pointer whitespace-nowrap border-b bg-muted px-3 py-2 text-center font-semibold text-muted-foreground text-xs hover:bg-muted/80"
                  >
                    {t('dialogs:import.columns.enabled')}
                    {getSortIcon('enabled')}
                  </button>
                  <div className="w-[136px] shrink-0 border-b bg-muted px-3 py-2 text-center font-semibold text-muted-foreground text-xs">
                    {t('dialogs:import.columns.action')}
                  </div>
                </div>
              </div>

              <div>
                {sortColumn
                  ? // An explicit sort column is active: honor it literally with one
                    // flat, fully-ordered list. Area grouping below preserves each
                    // area's internal sort order, but the area *groups* themselves
                    // only ever appear in "whichever area's automation the sort
                    // happened to put first" order (a plain object's key order is
                    // first-insertion order, not alphabetical) -- so with more than
                    // one area, clicking "Name" visibly failed to produce an
                    // alphabetical list (e.g. Apple/AreaB, Zebra/AreaB, Banana/AreaA
                    // -- correctly sorted *within* each area, but "Apple, Zebra,
                    // Banana" top-to-bottom is not alphabetical). Reported by user:
                    // sorting the "open automation" dialog alphabetically by name
                    // "does not work." Bypassing area grouping entirely once a sort
                    // is picked is what actually delivers the flat order the Name/
                    // Last Triggered/Enabled column headers promise.
                    sortedCatalogItems.map((automation) => renderAutomationRow(automation))
                  : Object.entries(catalogByArea).flatMap(([areaName, automations]) => {
                      if (automations.length === 0) {
                        return [];
                      }

                      const areaHeader = (
                        <div
                          key={areaName}
                          className="sticky top-[32px] z-10 -mt-1 flex border-b bg-accent"
                        >
                          <div className="flex-1 px-3 py-2 font-bold text-accent-foreground text-xs">
                            {areaName}
                          </div>
                        </div>
                      );

                      const rows = automations.map((automation) => renderAutomationRow(automation));

                      return [
                        <React.Fragment key={areaName}>
                          {areaHeader}
                          {rows}
                        </React.Fragment>,
                      ];
                    })}


                {!hasVisibleResults && (
                  <div className="flex">
                    <div className="flex-1 py-8 text-center text-muted-foreground">
                      {t('dialogs:import.noAutomations')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t bg-muted/20 p-6">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">{t('dialogs:import.openingWarning')}</p>
            <Button onClick={onClose} variant="ghost">
              {t('buttons.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>

      <Dialog open={showConfirmDialog} onOpenChange={handleCancelConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogs:import.discardTitle')}</DialogTitle>
            <DialogDescription>{t('dialogs:import.discardDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCancelConfirm}>
              {t('buttons.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              {t('dialogs:import.confirmDiscard')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={automationPendingDelete !== null}
        onOpenChange={(open) => !open && setAutomationPendingDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogs:import.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('dialogs:import.deleteDescription', {
                name: automationPendingDelete?.friendly_name ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setAutomationPendingDelete(null)}
              disabled={isDeleting}
            >
              {t('buttons.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteAutomation()}
              disabled={isDeleting}
            >
              {t('dialogs:import.confirmDelete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
