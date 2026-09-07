import type { TFunction } from 'i18next';
import { Clipboard } from 'lucide-react';
import { cloneNodesIntoCanvas, pasteEdgesOnly } from './clipboardHelpers';
import type { NodeAction } from './NodeAction';
import type { NodeActionContext } from './NodeActionContext';

export function getPasteAction(t: TFunction): NodeAction {
  return {
    name: 'paste',
    icon: Clipboard,
    tooltip: t('toolbar.paste'),
    shortcut: 'ctrl+v',
    group: 'clipboard',
    isEnabled: (context: NodeActionContext) =>
      !!(context.clipboard && context.clipboard.length > 0),

    execute: (context: NodeActionContext) => {
      if (!context.clipboard) return;

      try {
        const clipboardData = JSON.parse(context.clipboard);
        const clipboardNodes = clipboardData.nodes || [];
        const clipboardEdges = clipboardData.edges || [];

        if (!Array.isArray(clipboardNodes)) return;

        if (clipboardNodes.length === 0) {
          // A right-click "Copy" on a bare connecting line (no nodes
          // involved — see CanvasContextMenu.tsx) puts just an edge in the
          // clipboard. Reconnect it directly rather than falling through to
          // cloneNodesIntoCanvas, which is a no-op with zero source nodes.
          if (Array.isArray(clipboardEdges) && clipboardEdges.length > 0) {
            pasteEdgesOnly(clipboardEdges, context);
          }
          return;
        }

        cloneNodesIntoCanvas(clipboardNodes, clipboardEdges, context);
      } catch (e) {
        console.warn('Invalid clipboard data, cannot paste.', e);
      }
    },
  };
}
