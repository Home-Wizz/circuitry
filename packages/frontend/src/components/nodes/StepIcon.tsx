import { Layers } from 'lucide-react';
import type { ComponentType } from 'react';
import { EMOJI_ICONS, stepIconKey } from '@/lib/emojiIcons';
import { type NodeColorToken, toneStyle } from '@/lib/node-colors';
import { cn } from '@/lib/utils';

// The bundled colour icons the cards and pickers show, by file name (emojiIcons.ts
// says which; never inlined into the scripts, see vite.config.ts).
const IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../assets/emoji/*.webp', {
      eager: true,
      query: '?url',
      import: 'default',
    })
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url])
);

/** The bundled colour icon for a key, if there is one. */
export function emojiImage(iconKey: string | undefined): string | undefined {
  const codePoint = iconKey ? EMOJI_ICONS[iconKey] : undefined;
  return codePoint ? IMAGES[codePoint] : undefined;
}

/** An icon a card or picker row shows: a colour emoji when one is known
 * for the key (`emoji` is its image, `iconKey` the key), else the line icon. */
export type PickerIcon = ComponentType<{ className?: string }> & {
  emoji?: string;
  iconKey?: string;
};

interface StepIconProps {
  tone: NodeColorToken;
  icon: PickerIcon;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** `solid`: a white line icon on a solid circle of the step's colour (the
   * side panel). `soft`: the colour emoji, where there is one, on a circle
   * tinted in the step's colour (the canvas cards). */
  look?: 'solid' | 'soft';
}

const SIZES = {
  sm: { disc: 'h-6 w-6', line: 'h-3.5 w-3.5', emoji: 'h-4 w-4' },
  md: { disc: 'h-8 w-8', line: 'h-4 w-4', emoji: 'h-5 w-5' },
  lg: { disc: 'h-9 w-9', line: 'h-[18px] w-[18px]', emoji: 'h-6 w-6' },
  xl: { disc: 'h-10 w-10', line: 'h-5 w-5', emoji: 'h-7 w-7' },
} as const;

/** A step's round icon (`.node-neon` / `.node-neon-soft`, index.css). */
export function StepIcon({ tone, icon: Icon, size = 'md', look = 'solid' }: StepIconProps) {
  const sizes = SIZES[size];
  const emoji = look === 'soft' && Icon.emoji !== undefined;
  return (
    <span
      data-testid="step-icon"
      data-icon={emoji ? Icon.iconKey : undefined}
      className={cn(
        look === 'soft' ? 'node-neon-soft' : 'node-neon',
        'flex shrink-0 items-center justify-center rounded-full',
        sizes.disc
      )}
      style={toneStyle(tone)}
    >
      <Icon className={emoji ? sizes.emoji : sizes.line} />
    </span>
  );
}

const pickerIcons = new Map<string, PickerIcon>();

/**
 * The icon for a key (a domain, a device class, a type) on a card or a
 * picker row: the colour emoji where there is one, else `fallback`. One component per key,
 * so a row keeps the same component across renders.
 */
export function getPickerIcon(
  key: string | undefined,
  fallback: ComponentType<{ className?: string }>
): PickerIcon {
  const src = emojiImage(key);
  if (!key || !src) return fallback;
  const cached = pickerIcons.get(key);
  if (cached) return cached;
  const Emoji: PickerIcon = ({ className }) => (
    <img src={src} alt="" draggable={false} className={cn(className, 'select-none')} />
  );
  Emoji.displayName = `PickerIcon(${key})`;
  Emoji.emoji = src;
  Emoji.iconKey = key;
  pickerIcons.set(key, Emoji);
  return Emoji;
}

/** A picker row's icon for an entity: its device class's colour emoji (a
 * door, motion), else its domain's, else `fallback`. */
export function entityPickerIcon(
  entity: { entity_id: string; attributes: Record<string, unknown> } | undefined,
  fallback: ComponentType<{ className?: string }> = Layers
): PickerIcon {
  const deviceClass = entity?.attributes.device_class;
  return getPickerIcon(
    stepIconKey(
      typeof deviceClass === 'string' ? deviceClass : undefined,
      entity?.entity_id.split('.')[0]
    ),
    fallback
  );
}

const BADGE_SIZES = {
  sm: { disc: 'h-6 w-6', line: 'h-3.5 w-3.5', emoji: 'h-[18px] w-[18px]' },
  md: { disc: 'h-7 w-7', line: 'h-4 w-4', emoji: 'h-5 w-5' },
  lg: { disc: 'h-10 w-10', line: 'h-5 w-5', emoji: 'h-7 w-7' },
} as const;

/**
 * A picker row's round icon: a colour emoji on a neutral circle, or a line
 * icon on its domain's colour (lib/domain-colors.ts).
 */
export function PickerIconBadge({
  icon: Icon,
  color,
  size,
}: {
  icon: PickerIcon;
  color: { bg: string; fg: string };
  size: keyof typeof BADGE_SIZES;
}) {
  const sizes = BADGE_SIZES[size];
  return (
    <span
      data-testid="picker-icon"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        sizes.disc,
        Icon.emoji ? 'bg-muted' : color.bg
      )}
    >
      <Icon className={Icon.emoji ? sizes.emoji : cn(sizes.line, color.fg)} />
    </span>
  );
}
