import { Copy, Loader2, Pencil, Play, Power, Tags, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useHass } from '@/contexts/HassContext';
import { CategoryFallback, HaCategoryPicker } from '@/ha';
import { deleteGraph } from '@/lib/graph-storage';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { showErrorToast, showSuccessToast } from '@/lib/haToast';
import { useFlowStore } from '@/store/flow-store';

/**
 * Whole-automation actions — Rename/Assign category/Run/Enable-disable/
 * Duplicate — mirroring the entries Home Assistant's own automation editor
 * puts in its top-right "more options" menu (per user-provided screenshot),
 * scoped to the subset that makes sense as a *toolbar* action here: More
 * info and Settings don't apply (Circuitry has no separate "more info" concept,
 * and the existing gear button already owns "Settings" for the properties
 * panel — see App.tsx's RightPanelState doc comment), Traces is already one
 * click away via the Debug tab, and Delete isn't something to offer as a
 * quick dropdown action.
 *
 * Every action here operates on the automation *already saved to HA*
 * (`automationId`/its resolved `entity_id`) rather than the in-progress
 * canvas edit — Run/Enable-Disable/Assign category are all disabled until
 * there's something in HA to act on. Rename is the one exception: it always
 * works, persisting immediately via updateAutomation() if there's already a
 * saved automation, or just updating the local flowName (picked up by the
 * next Save) if there isn't yet.
 */
export function AutomationToolsMenu() {
  const { t } = useTranslation(['common', 'dialogs', 'errors']);
  const { hass } = useHass();
  const { flowName, automationId, setFlowName, setAutomationId, saveAutomation, closeTab, flowId } =
    useFlowStore();

  const [renameOpen, setRenameOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'run' | 'toggle' | 'duplicate' | 'delete' | null>(null);

  const api = hass ? getHomeAssistantAPI(hass) : null;
  // Resolved fresh on every render from `hass.states` (reactive, no extra
  // round-trip) rather than cached in local state — so Enable/Disable's
  // label and the menu's disabled states stay correct if the automation's
  // state changes from outside Circuitry (HA's own UI, another automation, ...).
  const entityId = automationId && api ? api.findAutomationEntityId(automationId) : null;
  const entityState = entityId && api ? api.getState(entityId) : null;
  const isEnabled = entityState ? entityState.state !== 'off' : true;
  const hasTarget = Boolean(entityId && api);

  const handleRun = async () => {
    if (!api || !entityId) return;
    setBusyAction('run');
    try {
      await api.triggerAutomation(entityId);
      showSuccessToast(t('common:toolsMenu.ranToast', { name: flowName }));
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : t('errors:api.unknownError'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleEnabled = async () => {
    if (!api || !entityId) return;
    setBusyAction('toggle');
    try {
      await api.setAutomationState(entityId, !isEnabled);
      showSuccessToast(
        isEnabled ? t('common:toolsMenu.disabledToast') : t('common:toolsMenu.enabledToast')
      );
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : t('errors:api.unknownError'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDuplicate = async () => {
    if (!hass || !api || !automationId) return;
    setBusyAction('duplicate');
    try {
      const copyName = await api.getUniqueAutomationAlias(flowName);
      setFlowName(copyName);
      setAutomationId(null);
      await saveAutomation(hass);
      showSuccessToast(t('common:toolsMenu.duplicatedToast', { name: copyName }));
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : t('errors:api.unknownError'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!api || !automationId) return;
    setBusyAction('delete');
    try {
      await api.deleteAutomation(automationId);
      // Option 1: clean up the canonical graph alongside the automation
      // itself. Best-effort -- see deleteGraph's doc comment.
      void deleteGraph(api, automationId);
      showSuccessToast(t('common:toolsMenu.deletedToast', { name: flowName }));
      setDeleteOpen(false);
      // The automation this tab pointed at no longer exists in HA — closing
      // the tab (rather than just clearing automationId/blanking the
      // canvas) matches what "delete" should mean now that multiple
      // automations can be open at once: this tab specifically is done,
      // same as the user closing it by hand. closeTab already handles both
      // "other tabs are open" (switches to a neighbor) and "this was the
      // only tab" (opens a fresh blank one) — see flow-store.ts.
      closeTab(flowId);
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : t('errors:api.unknownError'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Wrench className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('common:titles.automationTools')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t('common:toolsMenu.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasTarget} onClick={() => setCategoryOpen(true)}>
            <Tags className="mr-2 h-4 w-4" />
            {t('common:toolsMenu.assignCategory')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasTarget || busyAction === 'run'} onClick={handleRun}>
            {busyAction === 'run' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {t('common:toolsMenu.runActions')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasTarget || busyAction === 'toggle'}
            onClick={handleToggleEnabled}
          >
            {busyAction === 'toggle' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Power className="mr-2 h-4 w-4" />
            )}
            {isEnabled ? t('common:toolsMenu.disable') : t('common:toolsMenu.enable')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!automationId || busyAction === 'duplicate'} onClick={handleDuplicate}>
            {busyAction === 'duplicate' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            {t('common:toolsMenu.duplicate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!automationId || busyAction === 'delete'}
            onClick={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            {busyAction === 'delete' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {t('common:toolsMenu.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameAutomationDialog open={renameOpen} onOpenChange={setRenameOpen} />
      <DeleteAutomationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        flowName={flowName}
        busy={busyAction === 'delete'}
        onConfirm={handleDelete}
      />
      {hasTarget && entityId && (
        <AssignCategoryDialog open={categoryOpen} onOpenChange={setCategoryOpen} entityId={entityId} />
      )}
    </>
  );
}

/**
 * Renaming here (vs. the Name field inside AutomationSaveDialog) persists
 * immediately when there's already a saved automation, matching HA's own
 * instant-rename behavior — the Save dialog's field only takes effect on
 * that dialog's own Save/Update click, which reads as "did nothing" for a
 * dedicated Rename action.
 */
function RenameAutomationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['common', 'dialogs', 'errors']);
  const { hass } = useHass();
  const { flowName, automationId, setFlowName, updateAutomation } = useFlowStore();
  const [name, setName] = useState(flowName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(flowName);
      setError(null);
    }
  }, [open, flowName]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('errors:form.nameRequired'));
      return;
    }
    setFlowName(trimmed);
    if (!automationId || !hass) {
      // Nothing saved yet — the new name is just local state now, picked up
      // by whichever Save the user runs next.
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateAutomation(hass);
      showSuccessToast(t('common:toolsMenu.renamedToast', { name: trimmed }));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors:api.unknownError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('common:toolsMenu.renameDialogTitle')}</DialogTitle>
          <DialogDescription>{t('common:toolsMenu.renameDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="automation-rename">{t('dialogs:save.nameLabel')}</Label>
          <Input
            id="automation-rename"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common:buttons.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Assigns the automation's HA category registry entry — same picker (and
 * fallback) AutomationSaveDialog.tsx uses, just scoped to a single field
 * committed immediately rather than bundled into the full save form. */
function AssignCategoryDialog({
  open,
  onOpenChange,
  entityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
}) {
  const { t } = useTranslation(['common', 'dialogs', 'errors']);
  const { hass } = useHass();
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !hass) return;
    setError(null);
    getHomeAssistantAPI(hass)
      .getEntityRegistryEntry(entityId)
      .then((entry) => setCategory(entry?.categories?.automation ?? ''));
  }, [open, hass, entityId]);

  const handleSave = async () => {
    if (!hass) return;
    setSaving(true);
    setError(null);
    try {
      await getHomeAssistantAPI(hass).updateEntityRegistryEntry(entityId, {
        categories: { automation: category || null },
      });
      showSuccessToast(t('common:toolsMenu.categoryAssignedToast'));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors:api.unknownError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('common:toolsMenu.assignCategory')}</DialogTitle>
          <DialogDescription>{t('common:toolsMenu.assignCategoryDialogDescription')}</DialogDescription>
        </DialogHeader>

        <HaCategoryPicker
          label={t('dialogs:save.categoryLabel')}
          scope="automation"
          value={category}
          onChange={setCategory}
          disabled={saving}
          fallback={
            <CategoryFallback
              label={t('dialogs:save.categoryLabel')}
              value={category}
              onChange={setCategory}
              disabled={saving}
            />
          }
        />
        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common:buttons.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Destructive confirmation for the Tools menu's Delete action — mirrors the
 * discard-confirmation dialog AutomationImportDialog.tsx already uses for
 * "opening will replace your work" (same red destructive Button styling),
 * except this one deletes the automation from Home Assistant entirely
 * rather than just discarding local canvas edits. */
function DeleteAutomationDialog({
  open,
  onOpenChange,
  flowName,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowName: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation(['common']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('common:toolsMenu.deleteDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('common:toolsMenu.deleteDialogDescription', { name: flowName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common:buttons.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common:buttons.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
