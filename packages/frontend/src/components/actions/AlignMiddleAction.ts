import type { TFunction } from 'i18next';
import { AlignCenterHorizontal } from 'lucide-react';
import type { NodeAction } from './NodeAction';
import type { NodeActionContext } from './NodeActionContext';

/** A node's drawn height (React Flow's measurement), 0 until it's drawn. */
function heightOf(node: NodeActionContext['nodes'][number]): number {
  return node.measured?.height ?? node.height ?? 0;
}

/**
 * Lines the selected steps up in a row: their middles on the leftmost one's,
 * so their connection dots (at each card's middle) sit on one line and the
 * wires between them run level, whatever each card's height.
 */
export function getAlignMiddleAction(t: TFunction): NodeAction {
  return {
    name: 'align-middle',
    icon: AlignCenterHorizontal,
    tooltip: t('toolbar.lineUpRow'),
    shortcut: 'ctrl+shift+m',
    group: 'align',
    isEnabled: (context: NodeActionContext) => context.selectedNodes.length >= 2,
    execute: (context: NodeActionContext) => {
      const [first, ...rest] = context.selectedNodes;
      if (!first) return;
      const leftmost = rest.reduce((a, n) => (n.position.x < a.position.x ? n : a), first);
      const middle = leftmost.position.y + heightOf(leftmost) / 2;
      const selected = new Set(context.selectedNodes.map((n) => n.id));
      context.setNodes(
        context.nodes.map((n) =>
          selected.has(n.id)
            ? { ...n, position: { ...n.position, y: middle - heightOf(n) / 2 } }
            : n
        )
      );
    },
  };
}
