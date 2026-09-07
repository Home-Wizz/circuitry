/**
 * Structural fuzzer for automation-merge.ts (Phase B "maximal integration
 * stress test", round 2, 2026-09-06).
 *
 * automation-merge.ts had 3 hand-written example tests, all built from a
 * single well-formed two-node/one-edge graph template with distinct
 * aliases. This file generalizes that coverage by feeding
 * `mergeAutomationGraphs` randomly-shaped source lists: 2-6 sources, each
 * with a random node count (including zero), duplicate node ids WITHIN one
 * source (a real possibility for a decompiled/imported automation that
 * never passed through the frontend's own duplicate-id validation),
 * dangling edges referencing node ids that don't exist in that source's
 * own node list, identical/empty/unicode/symbols-only aliases across
 * sources, and userVariables sets deliberately engineered to collide (same
 * key/same value, same key/different value, disjoint keys) across sources.
 *
 * Every real `node.position` in this codebase is guaranteed numeric by
 * FlowNode's type AND by the one production call site
 * (AutomationImportDialog.tsx, via `transpiler.fromYaml` ->
 * packages/transpiler/src/parser/layout.ts, which always assigns a
 * computed-or-placeholder numeric position to every node) -- so malformed
 * positions are a type-system-enforced non-issue for real callers and are
 * deliberately NOT fuzzed here, matching this codebase's convention of
 * restricting coverage to what's actually reachable rather than inputs
 * that can't occur without bypassing TypeScript entirely.
 *
 * Checks, matching every other fuzzer's contract in this codebase:
 *   1. No crash for any sources.length >= 2 input (mergeAutomationGraphs
 *      intentionally throws for < 2 sources -- that's documented, expected
 *      behavior, not a crash, and is excluded from the crash count).
 *   2. Merged-node-id uniqueness: every source gets copies of its OWN
 *      node ids under a per-source-index-suffixed prefix
 *      (`sanitizeSourcePrefix` always appends `_${index + 1}`, so
 *      cross-source collisions are structurally impossible regardless of
 *      alias) -- but a duplicate id WITHIN one source's own node list used
 *      to still collide after prefixing.
 *   3. Merged-edge referential integrity: every merged edge's source/
 *      target must name a node that exists in the merged node list --
 *      already defended in the source (an edge whose endpoint isn't in
 *      that source's own nodeIdMap is dropped), so this fuzzer is
 *      confirming that defense actually holds under adversarial input,
 *      not assuming it from reading the code once.
 *
 * First run (2026-09-06): 0 crashes, 0 dangling merged edges (invariant 3
 * held immediately), but 65/300 iterations (a source with duplicate node
 * ids, ~25% of generated sources) produced duplicate merged node ids --
 * invariant 2 failing for real. Fixed in automation-merge.ts the same day
 * (see its own comment at the fix site): every occurrence of a repeated
 * original id after the first now gets a `__dupN` suffix, so merge itself
 * never introduces a NEW id collision on top of whatever ambiguity already
 * existed in a malformed source. Re-run after the fix: 300/300, 0 crashes,
 * 0 id collisions, 0 dangling edges.
 */

import type { FlowGraph, FlowNode } from '@circuitry/shared';
import { describe, expect, it } from 'vitest';
import { type MergeAutomationSource, mergeAutomationGraphs } from '../automation-merge';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIRD_ALIASES = ['', '   ', '???', '日本語', '🔥🔥🔥', 'a'.repeat(200), 'Same Name', 'SAME NAME'];

function makeRandomGraph(rand: () => number, sourceIndex: number): FlowGraph {
  const nodeCount = Math.floor(rand() * 5); // 0..4, including zero-node graphs
  const nodes: FlowNode[] = [];
  const allowDuplicateIds = rand() < 0.25; // simulate a malformed/decompiled duplicate-id graph
  const sharedId = 'dup_node';

  for (let i = 0; i < nodeCount; i++) {
    const id = allowDuplicateIds && rand() < 0.5 ? sharedId : `node_${i}`;
    const kinds = ['trigger', 'condition', 'action'] as const;
    nodes.push({
      id,
      type: kinds[Math.floor(rand() * kinds.length)],
      position: { x: Math.floor(rand() * 400), y: Math.floor(rand() * 400) },
      data: { service: 'light.turn_on' } as unknown as FlowNode['data'],
    } as FlowNode);
  }

  const edgeCount = Math.floor(rand() * 4);
  const edges: FlowGraph['edges'] = [];
  const nodeIds = nodes.map((n) => n.id);
  for (let i = 0; i < edgeCount; i++) {
    // Sometimes wire a real pair, sometimes a dangling reference to an id
    // that doesn't exist in this source's own node list at all.
    const useRealSource = nodeIds.length > 0 && rand() < 0.75;
    const useRealTarget = nodeIds.length > 0 && rand() < 0.75;
    edges.push({
      id: `edge_${i}`,
      source: useRealSource ? nodeIds[Math.floor(rand() * nodeIds.length)] : `ghost_${i}`,
      target: useRealTarget ? nodeIds[Math.floor(rand() * nodeIds.length)] : `ghost_${i}_t`,
    });
  }

  const varSetChoice = Math.floor(rand() * 4);
  let userVariables: Record<string, unknown> | undefined;
  if (varSetChoice === 0) userVariables = undefined;
  else if (varSetChoice === 1) userVariables = { shared: 'same-value' };
  else if (varSetChoice === 2) userVariables = { shared: `distinct-${sourceIndex}` };
  else userVariables = { [`only_${sourceIndex}`]: sourceIndex };

  return {
    id: `graph-${sourceIndex}`,
    name: `Graph ${sourceIndex}`,
    description: '',
    version: 1,
    metadata: rand() < 0.5 ? { mode: 'single', initial_state: true } : undefined,
    nodes,
    edges,
    userVariables,
  };
}

describe('FUZZ: automation-merge structural robustness (maximal integration stress test)', () => {
  it('runs N random multi-source merges, looking for crashes and broken invariants', () => {
    const N = 300;
    const crashes: string[] = [];
    const idCollisions: string[] = [];
    const danglingEdges: string[] = [];

    for (let i = 0; i < N; i++) {
      const rand = mulberry32(500000 + i);
      const sourceCount = 2 + Math.floor(rand() * 5); // 2..6

      const sources: MergeAutomationSource[] = [];
      for (let s = 0; s < sourceCount; s++) {
        const aliasChoice = rand();
        const alias =
          aliasChoice < 0.3
            ? WEIRD_ALIASES[Math.floor(rand() * WEIRD_ALIASES.length)]
            : `Automation ${s}`;
        sources.push({
          graph: makeRandomGraph(rand, s),
          automationId: `auto_${s}`,
          entityId: `automation.auto_${s}`,
          alias,
          importedAt: rand() < 0.5 ? new Date(2026, 0, 1 + s).toISOString() : undefined,
        });
      }

      const label = `iteration ${i} (sources=${sourceCount})`;
      try {
        const merged = mergeAutomationGraphs(sources);

        const nodeIds = merged.nodes.map((n) => n.id);
        if (new Set(nodeIds).size !== nodeIds.length) {
          idCollisions.push(`${label}: duplicate merged node ids -- ${JSON.stringify(nodeIds)}`);
        }

        const nodeIdSet = new Set(nodeIds);
        for (const edge of merged.edges) {
          if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
            danglingEdges.push(
              `${label}: merged edge ${edge.id} references missing node (source=${edge.source}, target=${edge.target})`
            );
          }
        }
      } catch (err) {
        crashes.push(`${label}: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
      }
    }

    if (crashes.length > 0) {
      console.log(`=== ${crashes.length} CRASH(ES) ===`);
      for (const c of crashes.slice(0, 5)) console.log(c);
    }
    if (idCollisions.length > 0) {
      console.log(`=== ${idCollisions.length} ID COLLISION(S) ===`);
      for (const c of idCollisions.slice(0, 5)) console.log(c);
    }
    if (danglingEdges.length > 0) {
      console.log(`=== ${danglingEdges.length} DANGLING MERGED EDGE(S) ===`);
      for (const d of danglingEdges.slice(0, 5)) console.log(d);
    }
    console.log(
      `automation-merge fuzz summary: ${N} total, ${crashes.length} crashed, ${idCollisions.length} id collisions, ${danglingEdges.length} dangling merged edges.`
    );

    expect(crashes, crashes.slice(0, 3).join('\n\n')).toHaveLength(0);
    expect(danglingEdges, danglingEdges.slice(0, 3).join('\n\n')).toHaveLength(0);
    // FIXED as part of round 2: the first run of this fuzzer found 65/300
    // iterations producing duplicate merged node ids (a source with two
    // nodes sharing the same original id used to collapse into two merged
    // nodes with the IDENTICAL merged id -- a bug the merge step itself
    // introduced, not merely inherited from the malformed input). Fixed in
    // automation-merge.ts by suffixing every occurrence of a repeated
    // original id after the first with `__dupN` -- see that file's own
    // comment at the fix site. Now asserted directly rather than only
    // logged.
    expect(idCollisions, idCollisions.slice(0, 3).join('\n\n')).toHaveLength(0);
  });
});
