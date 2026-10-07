import { Handle, Position } from '@xyflow/react';
import {
  type ComponentType,
  type CSSProperties,
  createContext,
  type MouseEventHandler,
  type ReactNode,
  useContext,
} from 'react';
import { BlockRoleBadge } from './BlockRoleBadge';
import { StepStopsHere } from './ConventionMarkers';
import { NodeStatusBadge } from './NodeStatusBadge';
import { getPickerIcon, StepIcon } from './StepIcon';
import { StepSettingsPill } from './StepSettingsPill';
import {
  NODE_COLORS,
  NODE_STATE_CLASSES,
  type NodeColorToken,
  SELECTED_NODE_STYLE,
  toneStyle,
} from '@/lib/node-colors';
import { cn } from '@/lib/utils';

export interface StepCardProps {
  /** The step's colour: its round icon and its kind word. */
  tone: NodeColorToken;
  /** Its line icon, where its key has no colour icon (StepIcon.tsx). */
  icon: ComponentType<{ className?: string }>;
  /** What the step is, for its colour icon (lib/emojiIcons.ts). */
  iconKey?: string;
  /** A kind word on the line above the sentence ("Join", "Group"). */
  kind?: string;
  /** The word the sentence starts with ("When", "And", "Then"), in the
   * step's colour: "When [Front door] opens". Until the step is set up it
   * stays on the line above, as the sentence is then a prompt. */
  lead?: string;
  /** Where the step is: its entity's area. */
  place?: string;
  /** What the step does, as a sentence with its pills. */
  sentence: ReactNode;
  stepNumber?: number | null;
  selected?: boolean;
  isActive?: boolean;
  isDisabled?: boolean;
  hasErrors?: boolean;
  /** A placeholder still to be configured: a dashed outline. */
  isUnconfigured?: boolean;
  traceClass?: string;
  /** Badges and handles, placed on the card's edge. */
  edge?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  /** The step's node, for its settings: a selected card offers them all
   * after its sentence ("+ more", StepSettingsPill). */
  settingsFor?: string;
  /** Lines under the sentence (details, inline editors). */
  children?: ReactNode;
}

/**
 * Set where a step's card is shown off the canvas (the side panel's header,
 * StepPreview.tsx): no handles or badges there, as there is nothing to
 * connect to.
 */
export const StepCardPreview = createContext(false);

/**
 * Every step's card on the canvas: a round icon in the step's colour, a
 * small line saying what kind of step it is and where, and the step as a
 * sentence, its values as pills. Badges, handles and the selection and
 * run states are the same on every card.
 */
export function StepCard({
  tone,
  icon,
  iconKey,
  kind: kindWord,
  lead,
  place,
  sentence,
  stepNumber,
  selected,
  isActive,
  isDisabled,
  hasErrors,
  isUnconfigured,
  traceClass,
  edge,
  className,
  style,
  onDoubleClick,
  settingsFor,
  children,
}: StepCardProps) {
  const colors = NODE_COLORS[tone];
  const preview = useContext(StepCardPreview);
  const leadInline = lead !== undefined && !isUnconfigured;
  const kind = kindWord ?? (leadInline ? undefined : lead);
  return (
    <div
      data-testid="step-card"
      onDoubleClick={onDoubleClick}
      // See node-colors.ts's SELECTED_NODE_STYLE doc comment.
      style={{ ...toneStyle(tone), ...(selected ? SELECTED_NODE_STYLE : undefined), ...style }}
      className={cn(
        // A pill edged in the step's colour (.step-pill, index.css); the
        // round icon sits in its rounded left end. Wide enough that a
        // sentence fits on two lines rather than three; the import layout
        // lays cards out at this width.
        'step-pill group relative min-w-[200px] max-w-[400px] bg-card py-2.5 pr-5 pl-2.5',
        'transition-all duration-200',
        isActive && NODE_STATE_CLASSES.active,
        isDisabled && 'border-dashed opacity-50 grayscale',
        hasErrors && NODE_STATE_CLASSES.error,
        isUnconfigured && !isDisabled && 'border-muted-foreground/50 border-dashed',
        traceClass,
        className
      )}
    >
      {!preview && edge}
      <div className="flex items-start gap-2.5">
        {/* Centred on the card's height, however many lines it has. */}
        <div data-testid="step-icon-slot" className="shrink-0 self-center">
          <StepIcon tone={tone} icon={getPickerIcon(iconKey, icon)} size="lg" look="soft" />
        </div>
        <div className="min-w-0 flex-1">
          {(kind || place) && (
            <div className="truncate text-[10px] leading-4">
              {kind && (
                <span className={cn('font-semibold uppercase tracking-wide', colors.text)}>
                  {kind}
                </span>
              )}
              {kind && place && <span className="text-muted-foreground">{' · '}</span>}
              {place && <span className="text-muted-foreground">{place}</span>}
            </div>
          )}
          <div
            data-testid="step-sentence"
            className={cn(
              'break-words font-medium text-sm leading-snug',
              isUnconfigured ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {leadInline && (
              <span data-testid="step-lead" className={cn('font-semibold', colors.text)}>
                {`${lead} `}
              </span>
            )}
            {sentence}
            {selected && settingsFor && !isUnconfigured && (
              <StepSettingsPill nodeId={settingsFor} tone={tone} />
            )}
          </div>
          {children && (
            <div className="mt-0.5 space-y-0.5 text-muted-foreground text-xs">{children}</div>
          )}
        </div>
        {stepNumber ? (
          <div
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-xs',
              colors.badge
            )}
          >
            {stepNumber}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface StepFrameProps {
  tone: NodeColorToken;
  selected: boolean;
  isActive: boolean;
  isDisabled: boolean;
  hasErrors: boolean;
  errorMessages: string[];
  warningMessages: string[];
  traceClass: string | undefined;
  roleLabel: string | null | undefined;
  icon: ComponentType<{ className?: string }>;
  iconKey?: string;
  kind?: string;
  lead?: string;
  place?: string;
  sentence: ReactNode;
  stepNumber: number | null | undefined;
  /** False for a step nothing follows (Stop). */
  hasSourceHandle: boolean;
  /** For the "Stops here" badge (H4.4). */
  nodeId: string;
  isUnconfigured?: boolean;
  className?: string;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  children?: ReactNode;
}

/**
 * A step in a sequence on its card: its badges, a handle in and (but for a
 * Stop) a handle out with the "Stops here" mark. One copy for every action,
 * delay, wait and variables card, so they can't drift apart.
 */
export function StepFrame({
  tone,
  roleLabel,
  errorMessages,
  warningMessages,
  isDisabled,
  hasSourceHandle,
  nodeId,
  traceClass,
  ...card
}: StepFrameProps) {
  const colors = NODE_COLORS[tone];
  return (
    <StepCard
      {...card}
      settingsFor={nodeId}
      tone={tone}
      isDisabled={isDisabled}
      traceClass={traceClass}
      edge={
        <>
          {roleLabel && <BlockRoleBadge label={roleLabel} />}
          <NodeStatusBadge
            errorMessages={errorMessages}
            warningMessages={warningMessages}
            isDisabled={isDisabled}
          />
          <Handle
            type="target"
            position={Position.Left}
            className={cn('w-3! h-3!', colors.handle)}
          />
          {hasSourceHandle && (
            <Handle
              type="source"
              position={Position.Right}
              className={cn('w-3! h-3!', colors.handle)}
            />
          )}
          {hasSourceHandle && <StepStopsHere nodeId={nodeId} />}
        </>
      }
    />
  );
}

/**
 * A phrase that follows a name in a card's sentence ("[Front door] opened"):
 * in English it starts in lower case, as mid-sentence; other languages keep
 * it as written (German nouns keep their capital). An acronym ("UV index")
 * is left alone.
 */
export function phraseAfterName(phrase: string, language: string): string {
  return language.startsWith('en') ? startLower(phrase) : phrase;
}

/** A phrase starting in lower case, in any language: for words that are
 * never nouns, as a threshold's "above"/"über". An acronym is left alone. */
export function startLower(phrase: string): string {
  const [first, second] = phrase;
  if (!first || (second && second !== second.toLowerCase())) return phrase;
  return first.toLowerCase() + phrase.slice(1);
}
