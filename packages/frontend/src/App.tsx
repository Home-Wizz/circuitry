import { ReactFlowProvider } from '@xyflow/react';
import {
  AlertCircle,
  ArrowLeft,
  BrushCleaning,
  FileDown,
  FileUp,
  Loader2,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Settings,
  Wifi,
  X,
} from 'lucide-react';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import './index.css';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { NodePalette } from '@/components/panels/NodePalette';
import { PropertyPanel } from '@/components/panels/PropertyPanel';
import { SpeedControl } from '@/components/simulator/SpeedControl';
import { AutomationToolsMenu } from '@/components/toolbar/AutomationToolsMenu';
import { TabBar } from '@/components/toolbar/TabBar';
import { Badge } from '@/components/ui/badge';

// Code-split: lazily loaded panels & dialogs (not on the initial critical path).
// Each only loads when its tab is opened or its dialog is triggered.
const YamlPreview = lazy(() =>
  import('@/components/panels/YamlPreview').then((m) => ({ default: m.YamlPreview }))
);
const TraceSimulator = lazy(() =>
  import('@/components/simulator/TraceSimulator').then((m) => ({ default: m.TraceSimulator }))
);
const AutomationTraceViewer = lazy(() =>
  import('@/components/simulator/AutomationTraceViewer').then((m) => ({
    default: m.AutomationTraceViewer,
  }))
);
const HassSettings = lazy(() =>
  import('@/components/panels/HassSettings').then((m) => ({ default: m.HassSettings }))
);
const ImportYamlDialog = lazy(() =>
  import('@/components/panels/ImportYamlDialog').then((m) => ({ default: m.ImportYamlDialog }))
);
const AutomationImportDialog = lazy(() =>
  import('@/components/panels/AutomationImportDialog').then((m) => ({
    default: m.AutomationImportDialog,
  }))
);
const AutomationSaveDialog = lazy(() =>
  import('@/components/panels/AutomationSaveDialog').then((m) => ({
    default: m.AutomationSaveDialog,
  }))
);

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { version } from '../../../custom_components/circuitry/manifest.json';
import { useAppRoot } from './contexts/AppRootContext';
import { useHass } from './contexts/HassContext';
import { useDarkMode } from './hooks/useDarkMode';
import { useHaThemeSync } from './hooks/useHaThemeSync';
import { useLanguage } from './hooks/useLanguage';
import { useLoadAutomation } from './hooks/useLoadAutomation';
import { useFlowStore } from './store/flow-store';

/** Lightweight fallback shown while a lazily-loaded panel chunk is fetched. */
function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

/**
 * Deep-link entry points — `/circuitry?automation=automation.xyz` opens that
 * automation, `/circuitry?new=1` starts blank. Query params only (not HA's
 * `route` property, which carries just prefix/path, no search string).
 * Rendered inside `<ReactFlowProvider>` (see `App`'s return) because loading
 * an automation needs `useReactFlow`'s `fitView` — this hook can't be called
 * from `App` itself, since `App` is the one *creating* that provider, not a
 * descendant of it. Waits for a real `hass` (needed to resolve
 * entity_id -> automation_id) and only ever runs once per mount.
 */
function DeepLinkHandler() {
  const { hass } = useHass();
  const { reset } = useFlowStore();
  const loadAutomation = useLoadAutomation();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !hass) return;

    const params = new URLSearchParams(window.location.search);
    const automationEntityId = params.get('automation');
    const isNew = params.get('new') === '1';
    if (!automationEntityId && !isNew) return;

    handled.current = true;

    if (automationEntityId) {
      const stateObj = hass.states[automationEntityId];
      const rawId = stateObj?.attributes?.id;
      const automationConfigId =
        typeof rawId === 'string' || typeof rawId === 'number'
          ? String(rawId)
          : automationEntityId.replace('automation.', '');
      loadAutomation({
        automation_id: automationConfigId,
        entity_id: automationEntityId,
        friendly_name:
          typeof stateObj?.attributes?.friendly_name === 'string'
            ? stateObj.attributes.friendly_name
            : undefined,
      });
    } else {
      reset();
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('automation');
    url.searchParams.delete('new');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [hass, loadAutomation, reset]);

  return null;
}

type RightPanelTab = 'properties' | 'yaml' | 'simulator';
/**
 * Three states, not two — 'collapsed' is the existing thin strip (just an
 * expand button, everything below stays mounted), 'closed' is new: no strip
 * at all, canvas takes the full width. Reaching 'closed' requires a deliberate
 * click on the new in-panel X button; the header's gear button (see
 * `titles.showPropertiesPanel`) is the way back to 'expanded' from either
 * 'collapsed' or 'closed'.
 */
type RightPanelState = 'expanded' | 'collapsed' | 'closed';

function App() {
  const { t } = useTranslation(['common', 'errors', 'dialogs']);
  const appRoot = useAppRoot();

  // Sidebar toggle button handler — `composed: true` lets the event cross the
  // Shadow DOM boundary so HA's own `hass-toggle-menu` listener catches it.
  const handleSidebarToggle = () => {
    appRoot?.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true }));
  };

  // Navigate back to Home Assistant
  const handleBackToHA = () => {
    window.history.back();
  };

  const {
    hass,
    isRemote: actualIsRemote,
    isLoading: actualIsLoading,
    connectionError: actualConnectionError,
    config,
    setConfig,
    narrow,
  } = useHass();

  const {
    flowName,
    fromFlowGraph,
    reset,
    automationId,
    hasUnsavedChanges,
    isSaving,
    simulationSpeed,
    setSimulationSpeed,
    hasRealChanges,
  } = useFlowStore();
  const [rightTab, setRightTab] = useState<RightPanelTab>('properties');
  // Fully closed (no strip at all) by default per explicit user instruction
  // ("the right panel should be closed by default"). Earlier this defaulted
  // to 'collapsed' (thin strip) because the 'closed' state didn't exist yet
  // — now that it does (see RightPanelState's doc comment), 'closed' is the
  // literal reading of "closed". The header's gear button (see
  // `titles.showPropertiesPanel`) reopens it to 'expanded'.
  const [rightPanelState, setRightPanelState] = useState<RightPanelState>('closed');
  // Double-clicking a node toggles the properties panel: opens it if
  // closed (or collapsed to the thin strip), closes it again on a repeat
  // double-click — per explicit user request. Watches
  // `nodeDoubleClickSignal` (bumped only by xyflow's own onNodeDoubleClick)
  // rather than `selectedNodeId` — `selectedNodeId` also changes on a
  // plain single click or a click-and-drag reposition, neither of which
  // should toggle the panel (a single-click-opens behavior was tried
  // earlier and reported unwanted: "when clicking on the notes to move
  // them the right panel opens automatically which is not something i
  // want"). A single click still updates `selectedNodeId` as normal, so
  // once the panel is open it always reflects whichever node is selected.
  const nodeDoubleClickSignal = useFlowStore((s) => s.nodeDoubleClickSignal);
  useEffect(() => {
    if (nodeDoubleClickSignal === 0) return;
    setRightPanelState((prev) => (prev === 'closed' || prev === 'collapsed' ? 'expanded' : 'closed'));
  }, [nodeDoubleClickSignal]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importYamlOpen, setImportYamlOpen] = useState(false);
  const [automationImportOpen, setAutomationImportOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [parentWidth, setParentWidth] = useState(() => window.innerWidth);
  const forceSettingsOpen = actualIsRemote && (config.url === '' || config.token === '');
  const isDark = useDarkMode();

  // Sync language with Home Assistant
  useLanguage();
  // Sync HA theme colors (custom theme + light/dark fallbacks, or Circuitry's own override) onto our CSS vars
  useHaThemeSync();

  // Version guard: log which HA version we're running against, once —
  // the src/ha/ wrapper layer targets undocumented internal API that can
  // change between releases, so this is the first thing to check when a
  // native component mysteriously stops working. `hass` gets a new object
  // on every entity update, so this only fires once via the ref guard.
  const loggedVersion = useRef(false);
  useEffect(() => {
    if (!loggedVersion.current && hass?.config?.version) {
      loggedVersion.current = true;
      logger.info(`Running against Home Assistant ${hass.config.version}`);
    }
  }, [hass]);

  useEffect(() => {
    appRoot?.classList.toggle('dark', isDark);
  }, [isDark, appRoot]);

  useEffect(() => {
    const handleResize = () => {
      setParentWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const graph = JSON.parse(text);
        fromFlowGraph(graph);
      } catch (error) {
        console.error('Failed to import:', error);
        alert(t('errors:import.fileReadFailed'));
      }
    };
    input.click();
  };

  const handleExport = () => {
    const graph = useFlowStore.getState().toFlowGraph();
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${flowName || 'automation'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Determine connection status display
  const getConnectionStatus = () => {
    if (actualIsLoading) {
      return {
        label: t('status.connecting'),
        className: 'bg-muted text-muted-foreground',
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
      };
    }
    if (actualConnectionError) {
      return {
        label: t('status.connectionError'),
        className: 'bg-red-100 text-red-700',
        icon: <AlertCircle className="h-3 w-3" />,
      };
    }
    if (actualIsRemote && hass?.connected) {
      return {
        label: t('status.connected'),
        className: 'bg-green-100 text-green-700',
        icon: <Wifi className="h-3 w-3" />,
      };
    }
    if (!actualIsRemote) {
      return null;
    }
    return null;
  };

  const status = getConnectionStatus();

  const reloadApp = () => {
    window.location.reload();
  };

  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => {
        const err = error instanceof Error ? error : new Error(String(error));
        return (
          <Dialog open={true} onOpenChange={reloadApp}>
            <DialogContent className="flex w-[90vw] max-w-full flex-col">
              <DialogHeader>
                <DialogTitle>{t('dialogs:error.title')}</DialogTitle>
              </DialogHeader>

              <DialogDescription>{t('dialogs:error.description')}</DialogDescription>

              <div className="space-y-4">
                <pre className="max-h-60 overflow-auto rounded bg-red-100 p-4 text-red-800 text-sm">
                  {err.message}
                  <br />
                  {err.stack}
                </pre>
                <div>{t('dialogs:error.refreshPrompt')}</div>
                <Button onClick={reloadApp}>{t('buttons.refresh')}</Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      }}
    >
      <ReactFlowProvider>
        <DeepLinkHandler />
        <div className="flex h-screen flex-col bg-background">
          {/* Header */}
          <header className="flex h-14 items-center justify-between gap-4 border-border border-b bg-card px-4 shadow-sm">
            <div className="flex flex-1 items-center gap-4">
              {/* Sidebar toggle button — HA's own `narrow` in panel mode, viewport width as a standalone-dev fallback (no real `narrow` there) */}
              {narrow || parentWidth <= 870 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={handleSidebarToggle}
                  aria-label="Toggle sidebar"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              ) : (
                <h1
                  className="whitespace-nowrap font-bold text-foreground text-lg"
                  title={t('titles.appFullName')}
                >
                  {t('titles.appName')}
                </h1>
              )}
              <span className="mx-1 h-5 w-px bg-border" />
              <span className="min-w-32 max-w-96 flex-1 truncate font-semibold text-foreground">
                {flowName || (
                  <span className="font-normal text-muted-foreground">
                    {t('placeholders.automationName')}
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />

              {status && (
                <Badge
                  onClick={() => setSettingsOpen(true)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 transition-opacity hover:opacity-80',
                    status.className
                  )}
                  title={t('titles.clickToConfigure')}
                  variant="outline"
                >
                  {status.icon}
                  {status.label}
                </Badge>
              )}

              {actualIsRemote && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => setSettingsOpen(true)} variant="ghost" size="icon">
                      <Settings className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('titles.settings')}</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setClearConfirmOpen(true)} variant="ghost" size="icon">
                    <BrushCleaning className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('titles.clearAutomation')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setSaveDialogOpen(true)}
                    variant={hasUnsavedChanges ? 'default' : 'ghost'}
                    size="icon"
                    disabled={isSaving}
                    className={cn(
                      hasUnsavedChanges && hasRealChanges() && !isSaving && 'save-button-unsaved'
                    )}
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {automationId ? t('titles.updateAutomation') : t('titles.saveAutomation')}
                </TooltipContent>
              </Tooltip>

              {/* Whole-automation actions (Rename/Assign category/Run/
                  Enable-disable/Duplicate) — mirrors HA's own automation
                  editor "more options" menu. See AutomationToolsMenu.tsx's
                  doc comment for why it's scoped to just these five. */}
              <AutomationToolsMenu />

              {/* Opens/expands the right-side Properties/YAML/Simulator dock
                  — see RightPanelState's doc comment for the collapsed/
                  expanded/closed state machine this drives. Distinct from
                  the actualIsRemote-only Settings button above (Home
                  Assistant connection config) even though both use the same
                  gear glyph per the reference icon this was styled after. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setRightPanelState('expanded')}
                    variant="ghost"
                    size="icon"
                  >
                    <Settings className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('titles.showPropertiesPanel')}</TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* Open-automation tab strip — no-ops (renders nothing) with only
              one automation open, see TabBar.tsx's doc comment. */}
          <TabBar />

          {/* Main content */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left sidebar - Node palette */}
            <aside className="flex h-full min-h-0 w-72 flex-col border-border border-r bg-card">
              {!actualIsRemote && (
                <div className="border-border border-b p-4 pb-2">
                  <Button
                    variant="outline"
                    onClick={() => setExitConfirmOpen(true)}
                    className="h-auto w-full justify-start gap-3 border-transparent bg-muted py-3 text-muted-foreground hover:border-destructive hover:bg-destructive/20 hover:text-destructive"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="font-medium text-sm">{t('titles.exit')}</span>
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                <NodePalette
                  onOpenAutomationImport={() => setAutomationImportOpen(true)}
                  onOpenImportYaml={() => setImportYamlOpen(true)}
                />
                <div className="border-t p-4">
                  <h4 className="mb-2 font-medium text-muted-foreground text-xs">
                    {t('labels.quickHelp')}
                  </h4>
                  <ul className="space-y-1 text-muted-foreground text-xs">
                    <li>{t('help.clickNodesToAdd')}</li>
                    <li>{t('help.dragToConnect')}</li>
                    <li>{t('help.deleteToRemove')}</li>
                    <li>{t('help.backspaceDeleteKey')}</li>
                  </ul>
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t p-4">
                <div className="flex items-center gap-4">
                  {actualIsRemote && config.url && (
                    <span className="text-green-600 text-xs">
                      {t('status.connectedTo', { hostname: new URL(config.url).hostname })}
                    </span>
                  )}
                  {actualConnectionError && (
                    <span className="text-red-600 text-xs">{actualConnectionError}</span>
                  )}
                </div>
                <div className="text-muted-foreground text-xs">
                  <span>
                    {t('titles.appName')} {`v${version}`}
                  </span>
                </div>
              </div>
            </aside>

            {/* Canvas */}
            <main className="flex min-h-0 flex-1 flex-col">
              <FlowCanvas />
            </main>

            {/* Right sidebar - Properties/YAML/Simulator, collapsible per
                user request ("the right panel is not collapsible" — this is
                the whole dock, not to be confused with NativeTriggerFields'
                own separately-collapsible Targets field). Collapsed state
                renders a slim strip with just an expand button rather than
                unmounting anything below — cheap, and means switching tabs/
                node selection isn't lost by toggling. */}
            {rightPanelState === 'closed' ? null : rightPanelState === 'collapsed' ? (
              <div className="flex h-full flex-col items-center border-border border-l bg-card py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRightPanelState('expanded')}
                  className="h-8 w-8"
                  title={t('buttons.expandPanel')}
                >
                  <PanelRightOpen className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <ResizablePanel
                defaultWidth={320}
                minWidth={280}
                maxWidth={600}
                side="right"
                className="border-border border-l bg-card"
              >
                <Tabs
                  value={rightTab}
                  onValueChange={(value) => setRightTab(value as RightPanelTab)}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex items-center border-b">
                    <TabsList className="grid flex-1 grid-cols-3 rounded-none border-b-0">
                      <TabsTrigger value="properties">{t('labels.properties')}</TabsTrigger>
                      <TabsTrigger value="yaml">{t('labels.yaml')}</TabsTrigger>
                      <TabsTrigger value="simulator">{t('labels.debug')}</TabsTrigger>
                    </TabsList>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRightPanelState('collapsed')}
                      className="mx-1 h-8 w-8 shrink-0"
                      title={t('buttons.collapsePanel')}
                    >
                      <PanelRightClose className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRightPanelState('closed')}
                      className="mr-1 h-8 w-8 shrink-0"
                      title={t('buttons.closePanel')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                <div className="flex flex-1 flex-col overflow-hidden">
                  <TabsContent value="properties" className="mt-0 flex-1 overflow-hidden">
                    <PropertyPanel />
                  </TabsContent>
                  <TabsContent value="yaml" className="mt-0 flex-1 overflow-hidden">
                    <Suspense fallback={<PanelLoading />}>
                      <YamlPreview />
                    </Suspense>
                  </TabsContent>
                  <TabsContent value="simulator" className="mt-0 flex-1 overflow-hidden">
                    <div className="flex h-full flex-col">
                      {/* Shared Speed Control */}
                      <div className="border-b p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="font-medium text-muted-foreground text-xs">
                            {t('labels.debugControls')}
                          </h4>
                          <div className="flex gap-1">
                            <Button
                              onClick={handleImport}
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title={t('buttons.importJson')}
                            >
                              <FileUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              onClick={handleExport}
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title={t('titles.exportJson')}
                            >
                              <FileDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <SpeedControl speed={simulationSpeed} onSpeedChange={setSimulationSpeed} />
                      </div>

                      <Suspense fallback={<PanelLoading />}>
                        {/* Simulation Section */}
                        <div className="flex-1 border-b">
                          <TraceSimulator />
                        </div>

                        {/* Trace Section */}
                        <div className="flex-1">
                          <AutomationTraceViewer />
                        </div>
                      </Suspense>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </ResizablePanel>
            )}
          </div>
        </div>

        {/* Settings modal - Only show when not in panel mode */}
        {actualIsRemote && (settingsOpen || forceSettingsOpen) && (
          <Suspense fallback={null}>
            <HassSettings
              isOpen={settingsOpen || forceSettingsOpen}
              onClose={() => setSettingsOpen(false)}
              config={config}
              onSave={setConfig}
            />
          </Suspense>
        )}

        {/* Import YAML dialog */}
        {importYamlOpen && (
          <Suspense fallback={null}>
            <ImportYamlDialog isOpen={importYamlOpen} onClose={() => setImportYamlOpen(false)} />
          </Suspense>
        )}

        {automationImportOpen && (
          <Suspense fallback={null}>
            <AutomationImportDialog
              isOpen={automationImportOpen}
              onClose={() => {
                setAutomationImportOpen(false);
              }}
            />
          </Suspense>
        )}

        {/* Save Automation dialog */}
        {saveDialogOpen && (
          <Suspense fallback={null}>
            <AutomationSaveDialog
              isOpen={saveDialogOpen}
              onClose={() => setSaveDialogOpen(false)}
              onSaved={() => {
                /* dialog closes via onClose */
              }}
            />
          </Suspense>
        )}

        {/* Clear confirm dialog */}
        <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('dialogs:import.discardTitle')}</DialogTitle>
              <DialogDescription>{t('dialogs:import.discardDescription')}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>
                {t('buttons.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  reset();
                  setClearConfirmOpen(false);
                }}
              >
                {t('dialogs:import.confirmDiscard')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Exit confirm dialog */}
        <Dialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('dialogs:exit.confirmTitle')}</DialogTitle>
              <DialogDescription>{t('dialogs:exit.confirmDescription')}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setExitConfirmOpen(false)}>
                {t('buttons.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setExitConfirmOpen(false);
                  handleBackToHA();
                }}
              >
                {t('dialogs:exit.confirmButton')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Toaster />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}

export default App;
