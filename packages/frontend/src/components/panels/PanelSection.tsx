import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SectionsOn = createContext(false);

interface TargetsSlot {
  /** The "What it acts on" section's body, once it's on the page. */
  container: HTMLElement | null;
  /** How many PanelTargets fill it: the section shows only when one does. */
  setCount: (update: (count: number) => number) => void;
}
const TargetsContext = createContext<TargetsSlot | null>(null);

/** The side panel's fields, grouped into its sections (PanelSection). */
export function PanelSections({ children }: { children: ReactNode }) {
  return <SectionsOn.Provider value>{children}</SectionsOn.Provider>;
}

/**
 * The side panel's "What it acts on" section, first among them: whatever
 * the step's fields put in PanelTargets (its entities, places...) shows here,
 * and the section stays hidden while nothing does.
 */
export function PanelTargetsSection({
  title,
  children,
}: {
  title: string;
  /** The rest of the panel, whose fields may fill the section. */
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);
  return (
    <TargetsContext.Provider value={{ container, setCount }}>
      <div hidden={count === 0}>
        <PanelSection title={title}>
          <div ref={setContainer} className="flex flex-col gap-3" />
        </PanelSection>
      </div>
      {children}
    </TargetsContext.Provider>
  );
}

/**
 * A step's target fields: in the side panel they move up into "What it acts
 * on" (PanelTargetsSection); anywhere else (a card's "+ more") they stay
 * where they are.
 */
export function PanelTargets({ children }: { children: ReactNode }) {
  const slot = useContext(TargetsContext);
  const setCount = slot?.setCount;
  useEffect(() => {
    if (!setCount) return;
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [setCount]);
  if (!slot) return <>{children}</>;
  return slot.container ? createPortal(children, slot.container) : null;
}

/**
 * One of the side panel's sections: a rounded box with a heading like a
 * picker column's ("What it acts on", "Settings"...). The same field
 * components also fill a card's "+ more" popover, where there are no
 * sections: outside PanelSections it renders just its fields.
 */
export function PanelSection({
  title,
  aside,
  children,
}: {
  title: string;
  /** A short note on the heading's right ("optional", the action's name). */
  aside?: string;
  children: ReactNode;
}) {
  const on = useContext(SectionsOn);
  if (!on) return <>{children}</>;
  return (
    <section
      data-testid="panel-section"
      className="overflow-hidden rounded-xl border border-foreground/15"
    >
      <div className="flex items-baseline justify-between gap-2 border-foreground/15 border-b bg-muted/40 px-3 py-2">
        <h4 className="font-bold text-[11px] text-muted-foreground uppercase tracking-[0.07em]">
          {title}
        </h4>
        {aside && <span className="min-w-0 truncate text-muted-foreground text-xs">{aside}</span>}
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </section>
  );
}
