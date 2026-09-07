/**
 * Stateful fuzzer for flow-store.ts's undo/redo stack (Phase B "maximal
 * integration stress test", round 2, 2026-09-06).
 *
 * flow-store.ts (1700+ lines) had exactly one test file before this one --
 * undo-redo.test.ts, 4 targeted example tests covering the debounced-burst
 * commit mechanism (handleSet's 300ms coalescing window) in isolation. This
 * file generalizes that coverage: it drives the REAL store through long
 * random sequences of its own public actions (add/remove nodes and edges,
 * move, rename, select) interleaved with random undo()/redo() calls and
 * random fake-timer advances (landing some operations in the same
 * debounced burst and others in separate history steps, matching how a
 * real user's pauses actually shape history entries), and checks after
 * every single step:
 *
 *   1. No operation, in any order, ever throws -- the same baseline
 *      crash-freedom contract every other fuzzer in this codebase holds
 *      its layer to.
 *   2. Edge referential integrity: every edge's source/target must name a
 *      node that currently exists. removeNode/removeNodes explicitly
 *      maintain this going forward; undo/redo restore a whole past
 *      TemporalFlowState object (nodes+edges together, from the SAME
 *      partialize snapshot), so it should hold there too -- if some future
 *      change to the burst/partialize wiring ever let undo/redo apply a
 *      stale edges array against a newer nodes array (or vice versa), this
 *      is what would catch it.
 *   3. undo(n) immediately followed by redo(n), with no set() in between,
 *      always restores the exact tracked fields (nodes/edges/flowName/
 *      flowDescription/flowMetadata/userVariables/userTriggerVariables --
 *      precisely temporal.ts's own TemporalFlowState) to what they were
 *      right before the undo. Verified against zundo's source
 *      (node_modules/zundo/dist/index.js): undo/redo apply state via the
 *      RAW pre-temporal setState, bypassing the debounced handleSet
 *      wrapper entirely, so this is a synchronous round trip with no
 *      timer-advance needed -- exactly how the existing undo-redo.test.ts
 *      already exercises it.
 */

import type { Connection, Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FlowNodeData, useFlowStore } from '../flow-store';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNode(id: string, rand: () => number): Node<FlowNodeData> {
  const kinds: Array<{ type: string; data: Record<string, unknown> }> = [
    { type: 'trigger', data: { trigger: 'state', entity_id: 'sensor.a' } },
    { type: 'condition', data: { condition: 'state', entity_id: 'sensor.a', state: 'on' } },
    { type: 'action', data: { service: 'light.turn_on' } },
  ];
  const kind = kinds[Math.floor(rand() * kinds.length)];
  return {
    id,
    type: kind.type,
    position: { x: Math.floor(rand() * 500), y: Math.floor(rand() * 500) },
    data: kind.data as FlowNodeData,
  };
}

function snapshotTracked(): string {
  const s = useFlowStore.getState();
  return JSON.stringify({
    nodes: s.nodes,
    edges: s.edges,
    flowName: s.flowName,
    flowDescription: s.flowDescription,
    flowMetadata: s.flowMetadata,
    userVariables: s.userVariables,
    userTriggerVariables: s.userTriggerVariables,
  });
}

function checkEdgeIntegrity(): string | null {
  const { nodes, edges } = useFlowStore.getState();
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.source)) return `edge ${e.id} source "${e.source}" missing from nodes`;
    if (!ids.has(e.target)) return `edge ${e.id} target "${e.target}" missing from nodes`;
  }
  return null;
}

describe('FUZZ: flow-store undo/redo under long random operation sequences (maximal integration stress test)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    useFlowStore.getState().reset();
    useFlowStore.temporal.getState().clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('runs N random sessions of random store operations + undo/redo, looking for crashes and referential-integrity breaks', () => {
    const N_SESSIONS = 40;
    const STEPS_PER_SESSION = 60;
    const crashes: string[] = [];
    const integrityFailures: string[] = [];
    const roundTripFailures: string[] = [];
    let nodeCounter = 0;

    for (let session = 0; session < N_SESSIONS; session++) {
      useFlowStore.getState().reset();
      useFlowStore.temporal.getState().clear();
      const rand = mulberry32(session * 104729 + 7);

      for (let step = 0; step < STEPS_PER_SESSION; step++) {
        const label = `session ${session} step ${step}`;
        try {
          const state = useFlowStore.getState();
          const nodeIds = state.nodes.map((n) => n.id);
          const edgeIds = state.edges.map((e) => e.id);
          const roll = rand();

          if (roll < 0.28 || nodeIds.length === 0) {
            const id = `n${nodeCounter++}`;
            state.addNode(makeNode(id, rand));
          } else if (roll < 0.45 && nodeIds.length >= 2) {
            const source = nodeIds[Math.floor(rand() * nodeIds.length)];
            const target = nodeIds[Math.floor(rand() * nodeIds.length)];
            const conn: Connection = {
              source,
              target,
              sourceHandle: rand() < 0.3 ? (rand() < 0.5 ? 'true' : 'false') : null,
              targetHandle: null,
            };
            state.onConnect(conn);
          } else if (roll < 0.55 && nodeIds.length > 0) {
            const id = nodeIds[Math.floor(rand() * nodeIds.length)];
            state.updateNodeData(id, { alias: `alias-${Math.floor(rand() * 1000)}` } as Partial<FlowNodeData>);
          } else if (roll < 0.65 && nodeIds.length > 0) {
            const id = nodeIds[Math.floor(rand() * nodeIds.length)];
            state.removeNode(id);
          } else if (roll < 0.72 && edgeIds.length > 0) {
            const id = edgeIds[Math.floor(rand() * edgeIds.length)];
            state.removeEdge(id);
          } else if (roll < 0.78 && nodeIds.length > 0) {
            const id = nodeIds[Math.floor(rand() * nodeIds.length)];
            state.moveNodes([{ id, position: { x: rand() * 999, y: rand() * 999 } }]);
          } else if (roll < 0.82) {
            // UI-only -- should never create a history entry (see
            // undo-redo.test.ts's own dedicated coverage of this).
            state.selectNode(nodeIds.length > 0 ? nodeIds[Math.floor(rand() * nodeIds.length)] : null);
          } else if (roll < 0.86) {
            // Advance time enough to flush a pending debounced burst.
            vi.advanceTimersByTime(350);
          } else if (roll < 0.93) {
            const before = snapshotTracked();
            const hadPast = useFlowStore.temporal.getState().pastStates.length > 0;
            const steps = 1 + Math.floor(rand() * 2);
            useFlowStore.temporal.getState().undo(steps);
            if (hadPast) {
              useFlowStore.temporal.getState().redo(steps);
              const after = snapshotTracked();
              if (after !== before) {
                roundTripFailures.push(
                  `${label}: undo(${steps})+redo(${steps}) did not round-trip.\nBEFORE: ${before}\nAFTER:  ${after}`
                );
              }
            }
          } else {
            useFlowStore.temporal.getState().redo(1 + Math.floor(rand() * 2));
          }

          const integrityIssue = checkEdgeIntegrity();
          if (integrityIssue) {
            integrityFailures.push(`${label}: ${integrityIssue}`);
          }
        } catch (err) {
          crashes.push(`${label}: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
        }
      }
    }

    if (crashes.length > 0) {
      console.log(`=== ${crashes.length} CRASH(ES) ===`);
      for (const c of crashes.slice(0, 5)) console.log(c);
    }
    if (integrityFailures.length > 0) {
      console.log(`=== ${integrityFailures.length} INTEGRITY FAILURE(S) ===`);
      for (const f of integrityFailures.slice(0, 5)) console.log(f);
    }
    if (roundTripFailures.length > 0) {
      console.log(`=== ${roundTripFailures.length} ROUND-TRIP FAILURE(S) ===`);
      for (const f of roundTripFailures.slice(0, 3)) console.log(f);
    }
    console.log(
      `flow-store fuzz summary: ${N_SESSIONS} sessions x ${STEPS_PER_SESSION} steps, ${crashes.length} crashed, ${integrityFailures.length} integrity failures, ${roundTripFailures.length} round-trip failures.`
    );

    expect(crashes, crashes.slice(0, 3).join('\n\n')).toHaveLength(0);
    expect(integrityFailures, integrityFailures.slice(0, 3).join('\n\n')).toHaveLength(0);
    expect(roundTripFailures, roundTripFailures.slice(0, 3).join('\n\n')).toHaveLength(0);
  });
});
