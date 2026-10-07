import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** How far the pointer moves before a right-press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** How long after a drag a right-click menu is still that drag's (Windows
 * sends it after the button comes up). */
const MENU_AFTER_DRAG_MS = 400;

/** Elements on the pane a right-press belongs to rather than the pane. */
const NOT_PANE =
  '.react-flow__node, .react-flow__edge, .react-flow__panel, .react-flow__controls, .react-flow__minimap, .react-flow__nodesselection';

export interface Point {
  x: number;
  y: number;
}

interface Gesture {
  start: Point;
  dragging: boolean;
  /** A right-click menu that arrived while the button was down (macOS and
   * Linux send it then): opened on release if this was no drag. */
  pendingMenu: (() => void) | null;
}

/**
 * Right-drag on empty canvas draws a box that selects the nodes it touches;
 * a right-click with no drag still opens the menu it always did. The menu
 * event comes at the press on macOS and Linux and at the release on
 * Windows, so every canvas menu goes through `openMenu`, which holds a menu
 * until the press ends and drops the one a drag caused.
 *
 * `box` is the box to draw, relative to the wrapper; `onBox` gets the
 * box's two corners in client coordinates when the drag ends.
 */
export function useRightDragSelect(
  wrapperRef: RefObject<HTMLElement | null>,
  onBox: (a: Point, b: Point) => void
) {
  const gesture = useRef<Gesture | null>(null);
  const dropMenusUntil = useRef(0);
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const toBox = (a: Point, b: Point) => {
      const origin = wrapper.getBoundingClientRect();
      return {
        left: Math.min(a.x, b.x) - origin.left,
        top: Math.min(a.y, b.y) - origin.top,
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
      };
    };

    const finish = (here: Point) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      setBox(null);
      if (g.dragging) {
        dropMenusUntil.current = performance.now() + MENU_AFTER_DRAG_MS;
        onBoxRef.current(g.start, here);
      } else {
        g.pendingMenu?.();
      }
    };

    const onMove = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const here = { x: event.clientX, y: event.clientY };
      // The button came up without a pointerup reaching us (a menu or
      // another window took it): the press is over.
      if ((event.buttons & 2) === 0) {
        finish(here);
        return;
      }
      if (!g.dragging && Math.hypot(here.x - g.start.x, here.y - g.start.y) < DRAG_THRESHOLD)
        return;
      g.dragging = true;
      setBox(toBox(g.start, here));
    };

    const end = (event: PointerEvent) => {
      if (event.button === 2) finish({ x: event.clientX, y: event.clientY });
    };

    const cancel = () => {
      gesture.current = null;
      setBox(null);
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 2 || !(event.target instanceof Element)) return;
      if (!event.target.closest('.react-flow__pane') || event.target.closest(NOT_PANE)) return;
      gesture.current = {
        start: { x: event.clientX, y: event.clientY },
        dragging: false,
        pendingMenu: null,
      };
    };

    wrapper.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      wrapper.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [wrapperRef]);

  /** Opens a canvas menu, unless a right-drag is under way or just made it. */
  const openMenu = useCallback((open: () => void) => {
    const g = gesture.current;
    if (g) {
      if (!g.dragging) g.pendingMenu = open;
      return;
    }
    if (performance.now() < dropMenusUntil.current) {
      dropMenusUntil.current = 0;
      return;
    }
    open();
  }, []);

  return { box, openMenu };
}
