import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useHass } from '@/contexts/HassContext';
import { getHomeAssistantAPI } from '@/lib/ha-api';

export interface CategoryFallbackProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Fallback for `HaCategoryPicker` when `ha-category-picker` isn't registered
 * — unlike every other native component Circuitry wraps, HA never loads this one
 * as a side effect of anything Circuitry itself renders (no lovelace card or
 * `ha-selector` type pulls it in — see haComponentLoader.ts). Talks to the
 * category registry directly: type a name, an existing category is matched
 * by name or a new one is created on blur. Styled to match HA's own filled
 * text field (label inside a shaded box) so it doesn't stick out next to the
 * real native pickers around it.
 *
 * Shared by AutomationSaveDialog.tsx and AutomationToolsMenu.tsx's Assign
 * Category dialog rather than defined twice, per CLAUDE.md's DRY rule —
 * originally lived only in AutomationSaveDialog.tsx.
 */
export function CategoryFallback({ label, value, onChange, disabled }: CategoryFallbackProps) {
  const { t } = useTranslation(['dialogs']);
  const { hass } = useHass();
  const [categories, setCategories] = useState<{ category_id: string; name: string }[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!hass) return;
    getHomeAssistantAPI(hass).getCategories('automation').then(setCategories);
  }, [hass]);

  useEffect(() => {
    setText(categories.find((c) => c.category_id === value)?.name ?? '');
  }, [value, categories]);

  const commit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      onChange('');
      return;
    }
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange(existing.category_id);
      return;
    }
    if (!hass) return;
    const created = await getHomeAssistantAPI(hass).createCategory('automation', trimmed);
    setCategories((prev) => [...prev, created]);
    onChange(created.category_id);
  };

  return (
    <div className="rounded-t-md border-input border-b bg-secondary px-3 pt-1.5 pb-1">
      <span className="block text-muted-foreground text-xs">{label}</span>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        placeholder={t('dialogs:save.categoryPlaceholder')}
        disabled={disabled}
        list="circuitry-category-options"
        className="h-auto rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
      />
      <datalist id="circuitry-category-options">
        {categories.map((c) => (
          <option key={c.category_id} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}
