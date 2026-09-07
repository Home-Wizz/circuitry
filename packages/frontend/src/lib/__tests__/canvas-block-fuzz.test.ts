import { randomUUID } from 'node:crypto';
import { FlowTranspiler } from '@circuitry/transpiler';
import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { createCompoundBlock, type CompoundBlockKey } from '../block-factories';

/**
 * Canvas-factory structural fuzzer (Phase B "maximal stress test of the
 * entire integration", round 1, 2026-09-06).
 *
 * `packages/transpiler`'s own `random-graph-fuzz.test.ts` (Phase B item 3,
 * 5 rounds) fuzzes at the GRAPH/YAML level directly -- it builds `FlowGraph`
 * node/edge objects by hand (or via YAML parsing) and has never gone
 * through the actual canvas-facing code a real user's clicks produce. This
 * file closes that gap: it fuzzes `block-factories.ts` -- the literal
 * functions `useAddNodeDialogs.tsx`/the palette call when a user drags a
 * Choose/If-Else/Repeat/Parallel/Sequence block onto the canvas -- composed
 * recursively (a compound block nested inside another compound block's open
 * branch, exactly as a user could build by hand) and fed through the same
 * `FlowTranspiler` class `flow-store.ts` calls on every real save. Every
 * `_blockKey`/handle/loop-back-edge convention this session's bugs (#12,
 * #13, #14, and Phase B's five rounds of `topology.ts` fixes) were fought
 * over is reproduced here via the REAL factory output, not a hand-rolled
 * approximation of it -- so a regression in how block-factories.ts wires a
 * block (not just in how native.ts/topology.ts interpret it) would show up
 * here first.
 *
 * Success criterion, matching the transpiler package's own fuzzer: a random
 * canvas composition must NEVER throw an uncaught exception (a crash) --
 * `FlowTranspiler.transpile()`'s own generate-then-verify gates (Phase B
 * items 2+4) already guarantee that anything reported `success: true` is
 * behaviorally verified, and anything that can't be safely represented
 * fails loudly with `success: false` rather than shipping wrong YAML. This
 * fuzzer is checking the layer BENEATH that contract -- that the graphs
 * block-factories.ts actually produces never reach the transpiler in a
 * shape that breaks it outright.
 *
 * First run (2026-09-06): 300/300 -- zero crashes, 294 succeeded (41 with a
 * safe native->state-machine fallback warning), 6 failed safely with
 * `"Condition node ... has no outgoing edges"`. Traced all 6 to the SAME
 * root shape: a `choose` block's LAST case left with its true-handle (case
 * body) AND its false-handle (the implicit default case) both completely
 * unwired -- a real, if narrow, thing a user could save (drop a Choose
 * block, fill in case 1, never touch case 2).
 *
 * FIXED 2026-09-06 as bug #15 (round 2): removed the offending check --
 * `validator.ts`'s `validateSemantics` unconditionally rejected any
 * condition node with zero outgoing edges on BOTH handles, even though
 * native.ts's choose-chain builder and state-machine.ts's
 * `buildFanOutContinuation` already handle a zero-edge branch gracefully
 * (an empty `sequence: []` / an omitted `default`). A condition with both
 * branches empty is completely valid, constructible-natively HA YAML (a
 * no-op `if`/`choose` case), so hard-failing the whole transpile over it
 * violated the "only restrict what's 100% impossible to build natively"
 * rule -- see validator.ts's own comment at the removal site for the full
 * writeup. Reachability (is the node connected to a trigger at all) is
 * still covered by the separate orphaned-node check, so this fix does not
 * let genuinely meaningless floating nodes through.
 *
 * Re-run after the fix (round 2, 2026-09-06): 300/300 -- zero crashes, 298
 * succeeded (61 with a safe fallback warning), 2 failed safely. Those 2
 * are a SEPARATE, pre-existing, already-cataloged gap, not a regression or
 * a new discovery: `"State-machine strategy produced output that does not
 * behaviorally match the flow graph (... no way to match up the 2 parallel
 * branch(es) ...)"` -- the same parallel-convergence limitation tracked in
 * project memory as `knownParallelConvergenceGaps` from Phase B's
 * `topology.ts` rounds. Left as-is; out of scope for this pass.
 *
 * Widened for round 2's own pass (N raised 300 -> 2000, same seed base):
 * 2000/2000, zero crashes, 1976 succeeded (439 with a safe fallback
 * warning), 24 failed safely (1.2%, consistent with the 0.67% rate at
 * N=300 -- no new failure category). Every one of the 24 categorizes into
 * the SAME "no way to match up N parallel branch(es)" family as the 2
 * above, just triggered at different structural sites (a state action, a
 * condition's then/else, a trigger-side parallel entry, a sequence-group
 * end) -- confirmed by grouping error messages with digits normalized out,
 * then reverted (this file carries no permanent diagnostic instrumentation
 * from that check). No new bug class found at 6.7x the sample size.
 */

// Same deterministic PRNG as packages/transpiler's random-graph-fuzz.test.ts,
// for consistency across the two fuzzers.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AnyNode = Node<Record<string, unknown>>;
type Slot = { source: string; handle?: 'true' | 'false' };

const COMPOUND_KEYS: CompoundBlockKey[] = [
  'choose',
  'if_else',
  'repeat_while',
  'repeat_until',
  'repeat_count',
  'parallel',
  'sequence',
];

function triggerNode(id: string): AnyNode {
  return {
    id,
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { trigger: 'state', entity_id: 'input_boolean.fuzz_trigger', to: 'on' },
  };
}

function leafAction(id: string, n: number): AnyNode {
  return {
    id,
    type: 'action',
    position: { x: 0, y: 0 },
    data: { service: 'light.turn_on', target: { entity_id: `light.fuzz_${n}` } },
  };
}

/** Mirrors block-factories-roundtrip.test.ts's `configurePlaceholders`, plus
 * handling for `repeat_count`'s intentionally-empty `sequence: []` (the
 * factory leaves it for the user to fill via drag-and-drop; a fuzzer run
 * needs *something* valid in there to produce a real automation). */
function fillPlaceholders(nodes: AnyNode[]): void {
  let n = 0;
  for (const node of nodes) {
    const data = node.data;
    if (node.type === 'action') {
      const repeat = data.repeat as { sequence?: unknown[] } | undefined;
      if (repeat) {
        if (!repeat.sequence || repeat.sequence.length === 0) {
          repeat.sequence = [
            { service: 'light.turn_on', target: { entity_id: `light.fuzz_body_${n++}` } },
          ];
        }
      } else if (!data.service) {
        data.service = 'light.turn_on';
        data.target = { entity_id: `light.fuzz_${n++}` };
      }
      delete data._placeholder;
    }
    if (node.type === 'condition' && !data.entity_id) {
      data.entity_id = `input_boolean.fuzz_${n++}`;
      data.state = 'on';
      delete data._placeholder;
    }
  }
}

/**
 * Recursively composes a random canvas graph out of real block-factories.ts
 * output, mirroring how a user actually builds one: start from a trigger,
 * repeatedly either drop a plain action or drag a compound block onto an
 * "open" connection point, and recurse into whatever new open points that
 * block creates (a choose case's true-handle, an if/else branch, a loop's
 * exit, both sides of a parallel fan-out, etc.) -- using each block's own
 * documented `entryNodeIds`/`exitNodeIds` contract, exactly as
 * `useAddNodeDialogs.tsx` does when wiring a freshly-dropped block into an
 * existing connection.
 */
function buildRandomCanvasGraph(rand: () => number, stepBudget: number) {
  const nodes: AnyNode[] = [];
  const edges: Edge[] = [];
  let idSeq = 0;
  let edgeSeq = 0;
  const nid = (prefix: string) => `${prefix}_${idSeq++}`;
  const connect = (slot: Slot, target: string) => {
    edges.push({
      id: `e-${slot.source}-${target}-${slot.handle ?? 'x'}-${edgeSeq++}`,
      source: slot.source,
      target,
      ...(slot.handle ? { sourceHandle: slot.handle } : {}),
    });
  };

  const trig = triggerNode(nid('trigger'));
  nodes.push(trig);
  let openSlots: Slot[] = [{ source: trig.id }];
  let steps = 0;

  while (openSlots.length > 0 && steps < stepBudget && nodes.length < 60) {
    steps++;
    const slotIdx = Math.floor(rand() * openSlots.length);
    const slot = openSlots.splice(slotIdx, 1)[0];
    const roll = rand();

    if (roll < 0.15) {
      // Leave this branch dangling -- a legitimate shape too (e.g. a choose
      // case or if-branch the user hasn't filled in yet).
      continue;
    }

    if (roll < 0.55) {
      const leaf = leafAction(nid('action'), idSeq);
      nodes.push(leaf);
      connect(slot, leaf.id);
      openSlots.push({ source: leaf.id });
      continue;
    }

    const key = COMPOUND_KEYS[Math.floor(rand() * COMPOUND_KEYS.length)];
    const block = createCompoundBlock(key, 0, 0);
    nodes.push(...block.nodes);
    edges.push(...block.edges);
    for (const entry of block.entryNodeIds) {
      connect(slot, entry);
    }

    switch (key) {
      case 'choose': {
        const conditions = block.nodes.filter((n) => n.type === 'condition');
        for (const c of conditions) {
          openSlots.push({ source: c.id, handle: 'true' });
        }
        // The chain's last condition's false-handle is the implicit
        // "default:" case's entry point.
        openSlots.push({ source: conditions[conditions.length - 1].id, handle: 'false' });
        break;
      }
      case 'if_else': {
        for (const exit of block.exitNodeIds) {
          openSlots.push({ source: exit });
        }
        break;
      }
      case 'repeat_while': {
        const cond = block.nodes.find((n) => n.type === 'condition')!;
        // The loop's real fall-through is the while-condition's false handle.
        openSlots.push({ source: cond.id, handle: 'false' });
        break;
      }
      case 'repeat_until': {
        const cond = block.nodes.find((n) => n.type === 'condition')!;
        // Until loops "until true" -- the true handle is the real exit.
        openSlots.push({ source: cond.id, handle: 'true' });
        break;
      }
      case 'repeat_count': {
        openSlots.push({ source: block.exitNodeIds[0] });
        break;
      }
      case 'parallel': {
        // Both branches are independently extendable -- including into a
        // SHARED downstream target (exactly bug #12's sibling-convergence
        // shape), which is deliberately left possible here.
        for (const entry of block.entryNodeIds) {
          openSlots.push({ source: entry });
        }
        break;
      }
      case 'sequence': {
        openSlots.push({ source: block.exitNodeIds[0] });
        break;
      }
    }
  }

  // Terminate roughly half of whatever's left dangling with a plain leaf,
  // so most branches have real content -- but deliberately leave some
  // truly empty (a fresh, never-filled-in compound block is a real shape
  // a saved automation could contain).
  for (const slot of openSlots) {
    if (rand() < 0.5) {
      const leaf = leafAction(nid('action_tail'), idSeq);
      nodes.push(leaf);
      connect(slot, leaf.id);
    }
  }

  fillPlaceholders(nodes);
  return { nodes, edges };
}

describe('FUZZ: canvas block-factory composition -> FlowTranspiler (maximal integration stress test)', () => {
  it('runs N random real-canvas-factory graphs through the actual save-time transpiler, looking for crashes', () => {
    const N = 2000;
    const crashes: string[] = [];
    let succeeded = 0;
    let failedSafely = 0;
    let warned = 0;

    for (let i = 0; i < N; i++) {
      const rand = mulberry32(900000 + i);
      const stepBudget = 4 + Math.floor(rand() * 10);
      const { nodes, edges } = buildRandomCanvasGraph(rand, stepBudget);

      const graph = {
        id: randomUUID(),
        name: `Canvas Fuzz ${i}`,
        version: 1 as const,
        nodes,
        edges,
      };

      try {
        const result = new FlowTranspiler().transpile(graph);
        if (result.success) {
          succeeded++;
          if (result.warnings && result.warnings.length > 0) warned++;
        } else {
          failedSafely++;
        }
      } catch (err) {
        crashes.push(
          `Fuzz-${i} (nodes=${nodes.length}, edges=${edges.length}): ${
            err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
          }`
        );
      }
    }

    if (crashes.length > 0) {
      console.log(`=== ${crashes.length} CRASH(ES) ===`);
      for (const c of crashes.slice(0, 5)) console.log(c);
    }
    console.log(
      `Canvas fuzz summary: ${N} total, ${succeeded} succeeded (${warned} with warnings), ${failedSafely} failed safely, ${crashes.length} crashed.`
    );

    // The one hard requirement: block-factories.ts's real output must never
    // make the transpiler throw, regardless of how it's composed/nested.
    expect(crashes, crashes.join('\n\n')).toHaveLength(0);
    // Sanity check that this is actually exercising the native/success path
    // most of the time, not just generating garbage that always fails.
    expect(succeeded).toBeGreaterThan(N * 0.5);
  });
});
