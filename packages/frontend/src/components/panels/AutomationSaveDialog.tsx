import type { ChooseFallThrough } from '@circuitry/transpiler';
import { AlertTriangle, Check, Copy, Loader2, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useHass } from '@/contexts/HassContext';
import {
  CategoryFallback,
  HaAreaPicker,
  HaCategoryPicker,
  HaIconPicker,
  HaLabelsPicker,
} from '@/ha';
import { currentChooseFallThroughs } from '@/hooks/useConventionMarkers';
import { useHassConnection } from '@/hooks/useHassConnection';
import { ChangedElsewhereError } from '@/lib/changed-elsewhere';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { showWarningToast } from '@/lib/haToast';
import {
  hasRegistryChoices,
  type RegistryMetadata,
  applyRegistryMetadata as setRegistryMetadata,
} from '@/lib/registryMetadata';
import {
  type SaveBlocker,
  SaveBlockedError,
  selectIsSaving,
  useFlowStore,
} from '@/store/flow-store';
import { ChooseGatesNothingDialog } from './ChooseGatesNothingDialog';
import { SaveBlockersList } from './SaveBlockersList';

const EMPTY_METADATA: RegistryMetadata = { icon: '', category: '', labels: [], area: '' };

interface AutomationSaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (automationId: string) => void;
}

export function AutomationSaveDialog({ isOpen, onClose, onSaved }: AutomationSaveDialogProps) {
  const { t } = useTranslation(['common', 'dialogs', 'errors']);
  const {
    flowName,
    flowDescription,
    automationId,
    keptElsewhere,
    setFlowName,
    setFlowDescription,
    saveAutomation,
    saveAsNewAutomation,
    updateAutomation,
  } = useFlowStore();
  // The active tab's own save (bug #239).
  const isSaving = useFlowStore(selectIsSaving);

  const { hass } = useHass();

  const [localDescription, setLocalDescription] = useState(flowDescription);
  const [error, setError] = useState<string | null>(null);
  // What Home Assistant would refuse, card by card (Phase 4): shown as a
  // list in place of the one-line error.
  const [blockers, setBlockers] = useState<SaveBlocker[] | null>(null);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<RegistryMetadata>(EMPTY_METADATA);
  const touchedFields = useRef<Set<keyof RegistryMetadata>>(new Set());
  // Whether the automation's area, labels, ... were read from HA: until
  // then only what the user sets is written (bug #238).
  const loadedFromHa = useRef(false);
  // Set once an Update was held back for a change made in Home Assistant
  // since the tab opened it: the next Update, now knowing, replaces it.
  const replaceOutsideChanges = useRef(false);

  const isUpdate = !!automationId;

  const setMetadataField = <K extends keyof RegistryMetadata>(
    field: K,
    value: RegistryMetadata[K]
  ) => {
    touchedFields.current.add(field);
    setMetadata((prev) => ({ ...prev, [field]: value }));
  };

  // Reads the latest `hass` without being keyed on it (a new object every
  // few seconds): keyed on `hass`, this ran again while the dialog was open
  // and put back the description being typed (bug #183).
  const { getHass } = useHassConnection(hass);

  // Sync local description with store when dialog opens
  useEffect(() => {
    const hass = getHass();
    if (isOpen) {
      setLocalDescription(flowDescription);
      setError(null);
      setBlockers(null);
      setSuggestedName(null);
      touchedFields.current = new Set();
      loadedFromHa.current = false;

      if (isUpdate && automationId && hass) {
        const api = getHomeAssistantAPI(hass);
        const entityId = api.findAutomationEntityId(automationId);
        if (entityId) {
          api.getEntityRegistryEntry(entityId).then((entry) => {
            if (!entry) return;
            loadedFromHa.current = true;
            setMetadata((prev) => ({
              icon: touchedFields.current.has('icon') ? prev.icon : entry.icon || '',
              category: touchedFields.current.has('category')
                ? prev.category
                : entry.categories?.automation || '',
              labels: touchedFields.current.has('labels') ? prev.labels : entry.labels || [],
              area: touchedFields.current.has('area') ? prev.area : entry.area_id || '',
            }));
          });
        }
      } else {
        setMetadata(EMPTY_METADATA);
      }
    }
  }, [isOpen, automationId, getHass, flowDescription, isUpdate]);

  // Check for name conflicts when name changes
  const checkNameConflict = async (name: string) => {
    if (!name.trim()) {
      setSuggestedName(null);
      return;
    }

    try {
      const exists = await getHomeAssistantAPI(hass).automationExistsByAlias(name);
      if (exists && !isUpdate) {
        const uniqueName = await getHomeAssistantAPI(hass).getUniqueAutomationAlias(name);
        setSuggestedName(uniqueName);
      } else {
        setSuggestedName(null);
      }
    } catch (err) {
      console.warn('Failed to check name conflict:', err);
      setSuggestedName(null);
    }
  };

  // Registry metadata is a nice-to-have on top of the automation itself — a
  // failure here shouldn't surface as a save failure the user has to retry,
  // but it is said (bug #214). Returns the resolved entity_id (if any) so the
  // caller can also fire the `circuitry_automation_saved` bus event against it.
  const applyRegistryMetadata = async (
    resultId: string,
    isNewAutomation: boolean
  ): Promise<string | undefined> => {
    if (!hass) return undefined;
    const { entityId, applied } = await setRegistryMetadata(
      getHomeAssistantAPI(hass),
      resultId,
      isNewAutomation,
      metadata,
      isNewAutomation || loadedFromHa.current ? undefined : touchedFields.current
    );
    if (!applied && hasRegistryChoices(metadata)) {
      showWarningToast(t('dialogs:save.registryNotSet'));
    }
    return entityId;
  };

  // Lets other automations/scripts react to Circuitry saves. Best-effort, same
  // as the registry metadata above — never blocks or fails the save itself.
  const notifyAutomationSaved = async (entityId: string | undefined) => {
    if (!hass || !entityId) return;
    try {
      await getHomeAssistantAPI(hass).fireBusEvent('circuitry_automation_saved', {
        entity_id: entityId,
      });
    } catch (err) {
      console.warn('Failed to fire circuitry_automation_saved event:', err);
    }
  };

  const handleSave = async () => {
    if (!hass) {
      setError(t('errors:connection.notConnected'));
      return;
    }

    if (!flowName.trim()) {
      setError(t('errors:form.nameRequired'));
      return;
    }

    setError(null);
    setBlockers(null);

    try {
      // Update the flow store with the description
      setFlowDescription(localDescription.trim());

      let resultId: string;
      if (isUpdate) {
        await updateAutomation(hass, { replaceOutsideChanges: replaceOutsideChanges.current });
        resultId = automationId || '';
      } else {
        resultId = await saveAutomation(hass);
      }

      const entityId = await applyRegistryMetadata(resultId, !isUpdate);
      await notifyAutomationSaved(entityId);

      replaceOutsideChanges.current = false;
      onSaved?.(resultId);
      onClose();
    } catch (err) {
      if (err instanceof ChangedElsewhereError) replaceOutsideChanges.current = true;
      showSaveError(err);
    }
  };

  // A Choose that gates nothing is asked about first (the maintainer,
  // 2026-10-25): the save waits for "Save anyway".
  const [gatesNothing, setGatesNothing] = useState<{
    fallThrough: ChooseFallThrough;
    save: () => Promise<void>;
  } | null>(null);
  const checkedFirst = (save: () => Promise<void>) => () => {
    const fallThrough = currentChooseFallThroughs().find((f) => f.gatesNothing);
    if (fallThrough) setGatesNothing({ fallThrough, save });
    else void save();
  };
  const saveChecked = checkedFirst(handleSave);

  const showSaveError = (err: unknown) => {
    if (err instanceof SaveBlockedError) {
      setBlockers(err.blockers);
      setError(null);
      return;
    }
    setBlockers(null);
    setError(err instanceof Error ? err.message : t('errors:api.unknownError'));
  };

  const handleClose = () => {
    // Stays open while saving, as its Cancel button does: closed then,
    // HA's refusal was shown in a dialog no longer there (bug #241).
    if (isSaving) return;
    replaceOutsideChanges.current = false;
    setError(null);
    setBlockers(null);
    setSuggestedName(null);
    onClose();
  };

  const handleNameChange = (name: string) => {
    setFlowName(name);
    checkNameConflict(name);
  };

  const useSuggestedName = () => {
    if (suggestedName) {
      setFlowName(suggestedName);
      setSuggestedName(null);
    }
  };

  const handleSaveAsCopy = async () => {
    if (!hass) {
      setError(t('errors:connection.notConnected'));
      return;
    }

    setError(null);
    setBlockers(null);

    try {
      // Get a unique name for the copy
      const copyName = await getHomeAssistantAPI(hass).getUniqueAutomationAlias(flowName);
      setFlowDescription(localDescription.trim());

      // Save as a new automation; the tab becomes the copy (or stays as it
      // was if the save fails).
      const resultId = await saveAsNewAutomation(hass, copyName);

      const entityId = await applyRegistryMetadata(resultId, true);
      await notifyAutomationSaved(entityId);

      onSaved?.(resultId);
      onClose();
    } catch (err) {
      showSaveError(err);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            {isUpdate ? t('dialogs:save.titleUpdate') : t('dialogs:save.title')}
          </DialogTitle>
          <DialogDescription>
            {isUpdate ? t('dialogs:save.descriptionUpdate') : t('dialogs:save.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="automation-name">{t('dialogs:save.nameLabel')}</Label>
            <Input
              id="automation-name"
              value={flowName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('placeholders.enterAutomationName')}
              disabled={isSaving}
            />
          </div>

          {suggestedName && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>{t('dialogs:save.nameConflict', { suggestedName })}</span>
                <Button variant="outline" size="sm" onClick={useSuggestedName} disabled={isSaving}>
                  {t('buttons.use')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="automation-description">{t('dialogs:save.descriptionLabel')}</Label>
            <Textarea
              id="automation-description"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              placeholder={t('placeholders.describeAutomation')}
              rows={3}
              disabled={isSaving}
            />
          </div>

          <HaIconPicker
            label={t('dialogs:save.iconLabel')}
            value={metadata.icon}
            onChange={(value) => setMetadataField('icon', value)}
            disabled={isSaving}
          />

          <HaCategoryPicker
            label={t('dialogs:save.categoryLabel')}
            scope="automation"
            value={metadata.category}
            onChange={(value) => setMetadataField('category', value)}
            disabled={isSaving}
            fallback={
              <CategoryFallback
                label={t('dialogs:save.categoryLabel')}
                value={metadata.category}
                onChange={(value) => setMetadataField('category', value)}
                disabled={isSaving}
              />
            }
          />

          <HaLabelsPicker
            label={t('dialogs:save.labelsLabel')}
            value={metadata.labels}
            onChange={(value) => setMetadataField('labels', value)}
            disabled={isSaving}
          />

          <HaAreaPicker
            label={t('dialogs:save.areaLabel')}
            value={metadata.area}
            onChange={(value) => setMetadataField('area', value)}
            disabled={isSaving}
          />

          {blockers ? (
            <SaveBlockersList blockers={blockers} onShowCard={handleClose} />
          ) : (
            error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
              </Alert>
            )
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              {t('buttons.cancel')}
            </Button>
            {(isUpdate || keptElsewhere) && (
              <Button
                variant="outline"
                onClick={checkedFirst(handleSaveAsCopy)}
                disabled={isSaving || !flowName.trim()}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {t('buttons.saveAsCopy')}
              </Button>
            )}
            {keptElsewhere ? (
              // Kept outside automations.yaml (bug #226): Save stays in
              // view, greyed, saying why; Save as Copy beside it works.
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a disabled button takes no focus or hover, so its tooltip hangs on this wrapper (Radix's own advice) */}
                  <span tabIndex={0}>
                    <Button
                      onClick={saveChecked}
                      disabled={isSaving || !flowName.trim() || Boolean(keptElsewhere)}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {isUpdate ? t('status.updating') : t('status.saving')}
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          {isUpdate ? t('buttons.update') : t('buttons.save')}
                        </>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {keptElsewhere === 'readingDiffers'
                    ? t('dialogs:save.readingDiffers')
                    : t('dialogs:save.keptElsewhere')}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button onClick={saveChecked} disabled={isSaving || !flowName.trim()}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isUpdate ? t('status.updating') : t('status.saving')}
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    {isUpdate ? t('buttons.update') : t('buttons.save')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
      <ChooseGatesNothingDialog
        fallThrough={gatesNothing?.fallThrough ?? null}
        onSaveAnyway={() => {
          const save = gatesNothing?.save;
          setGatesNothing(null);
          if (save) void save();
        }}
        onClose={() => setGatesNothing(null)}
      />
    </Dialog>
  );
}
