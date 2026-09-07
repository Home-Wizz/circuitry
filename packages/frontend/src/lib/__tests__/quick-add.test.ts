import { describe, expect, it } from 'vitest';
import { buildQuickAddConnections, getAvailableQuickAddTypes } from '../quick-add';

describe('getAvailableQuickAddTypes', () => {
  it('forward: excludes trigger (no target handle to satisfy a forward drag)', () => {
    const { simple } = getAvailableQuickAddTypes('forward');
    expect(simple.some((c) => c.type === 'trigger')).toBe(false);
    expect(simple.map((c) => c.type)).toEqual(
      expect.arrayContaining(['condition', 'action', 'delay', 'wait', 'set_variables'])
    );
  });

  it('forward: includes all compound blocks', () => {
    const { compound } = getAvailableQuickAddTypes('forward');
    // Kept in sync with config/nodeTypeCatalog.ts's compoundTypes — last
    // updated when repeat_until and sequence joined choose/if_else/parallel/
    // repeat_count/repeat_while as real compound block types.
    expect(compound.map((c) => c.key).sort()).toEqual(
      ['choose', 'if_else', 'parallel', 'repeat_count', 'repeat_until', 'repeat_while', 'sequence'].sort()
    );
  });

  it('backward: includes trigger (a trigger only has a source handle)', () => {
    const { simple } = getAvailableQuickAddTypes('backward');
    expect(simple.some((c) => c.type === 'trigger')).toBe(true);
    // Kept in sync with config/nodeTypeCatalog.ts's nodeTypes — last updated
    // when 'start' and 'join' joined the other 6 simple node types.
    expect(simple).toHaveLength(8);
  });

  it('backward: excludes all compound blocks (no well-defined single exit point)', () => {
    const { compound } = getAvailableQuickAddTypes('backward');
    expect(compound).toHaveLength(0);
  });
});

describe('buildQuickAddConnections', () => {
  it('forward: wires fromNode -> newNode, preserving the dragged handle id', () => {
    const connections = buildQuickAddConnections('forward', 'cond-1', 'true', ['action-1']);
    expect(connections).toEqual([
      { source: 'cond-1', sourceHandle: 'true', target: 'action-1', targetHandle: null },
    ]);
  });

  it('backward: wires newNode -> fromNode', () => {
    const connections = buildQuickAddConnections('backward', 'action-1', null, ['trigger-1']);
    expect(connections).toEqual([
      { source: 'trigger-1', sourceHandle: null, target: 'action-1', targetHandle: null },
    ]);
  });

  it('forward: produces one connection per target id (parallel block entry fan-out)', () => {
    const connections = buildQuickAddConnections('forward', 'trigger-1', null, ['a1', 'a2']);
    expect(connections).toEqual([
      { source: 'trigger-1', sourceHandle: null, target: 'a1', targetHandle: null },
      { source: 'trigger-1', sourceHandle: null, target: 'a2', targetHandle: null },
    ]);
  });
});
