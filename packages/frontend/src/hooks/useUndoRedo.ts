import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { flushPendingHistoryCommit, useFlowStore } from '@/store/flow-store';

/**
 * After an undo or redo: errors re-checked, and the automation marked
 * touched, so the unsaved mark compares it with what was saved (it skips a
 * tab not marked touched; undo after a save looked saved, bug #201). The
 * flag is outside undo history, so this makes no step of its own.
 */
function afterJump(): void {
  useFlowStore.setState({ hasUnsavedChanges: true });
  useFlowStore.getState().validateAllNodes();
}

/**
 * Undo/redo for the flow canvas, backed by the `temporal` (zundo) store
 * wrapping `useFlowStore` (see store/flow-store.ts). `nodeErrors` isn't part
 * of what undo/redo tracks (it's derived), so it goes stale across a jump —
 * `validateAllNodes()` re-syncs it, the same way `fromFlowGraph()` already
 * does after its own bulk state replacement.
 */
export function useUndoRedo() {
  const {
    undo: temporalUndo,
    redo: temporalRedo,
    canUndo,
    canRedo,
  } = useStore(
    useFlowStore.temporal,
    useShallow((state) => ({
      undo: state.undo,
      redo: state.redo,
      canUndo: state.pastStates.length > 0,
      canRedo: state.futureStates.length > 0,
    }))
  );

  const undo = useCallback(() => {
    flushPendingHistoryCommit();
    temporalUndo();
    afterJump();
  }, [temporalUndo]);

  const redo = useCallback(() => {
    flushPendingHistoryCommit();
    temporalRedo();
    afterJump();
  }, [temporalRedo]);

  return { undo, redo, canUndo, canRedo };
}
