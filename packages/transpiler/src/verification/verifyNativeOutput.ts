import type { FlowGraph } from '@circuitry/shared';
import { load as yamlLoad } from 'js-yaml';
import { normalizeGraph } from '../analyzer/normalize';
import { programsEquivalent } from './behaviorProgram';
import { extractFromGraph, type FlowSettings } from './extractFromGraph';
import { extractFromYamlConfig } from './extractFromYaml';

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Phase B's core correctness mechanism.
 *
 * `NativeStrategy`'s structural pattern-matching (topology.ts's `isTree`
 * classifier plus native.ts's shape-specific builders -- AND-chains,
 * choose-chains, OR-pattern detection, leading-condition promotion to the
 * root `conditions:` block, ...) is never trusted blindly: every candidate
 * conversion it produces is compared, behaviorally, against the graph the
 * user actually drew, before being accepted. If they don't match, the
 * caller (FlowTranspiler.transpile) discards the native output and falls
 * back to StateMachineStrategy instead, which needs no shape recognition
 * and is therefore not subject to this entire class of bug.
 *
 * This is a from-scratch redesign, not the original graph-diff
 * implementation this file used to contain (see git history / project
 * memory's Phase B notes for the full account). That version decompiled
 * the candidate YAML back into a FlowGraph (via YamlParser) and compared
 * node-for-node/edge-for-edge against the original -- which cannot tell
 * NativeStrategy's legitimate semantic canonicalizations (folding
 * sequential single-path conditions into one `and:`, promoting a
 * false-handle-only condition to `not:`, folding two conditions that
 * converge into one `or:`, promoting leading conditions to the root
 * `conditions:` block, deduplicating identical downstream branches) apart
 * from a real bug that silently changes behavior -- both produce a
 * differently-shaped decompiled graph, and a raw structural diff can't
 * distinguish them. The maintainer's explicit decision (project memory,
 * "chose option (b)") was to fix this with genuine behavioral/execution-path
 * equivalence instead of teaching the comparator every known
 * transformation (which only chases whatever NativeStrategy does today,
 * and never proves it caught everything).
 *
 * This version instead extracts a normalized "behavior program" --
 * sequential steps, if/then/else, parallel, repeat, with every and/or/not
 * combinator reduced to a truth-table-comparable boolean expression (see
 * boolean.ts) -- independently from the ORIGINAL FlowGraph (extractFromGraph.ts,
 * a fresh graph walk) and from the CANDIDATE YAML's own parsed config
 * (extractFromYaml.ts, a fresh action/condition tree walk), and compares
 * those two programs directly. Neither extractor calls into
 * NativeStrategy's own transform code, and neither decompiles the
 * candidate back into a graph at all -- so a bug in NativeStrategy's shape
 * recognition shows up as a genuine divergence between two independently-
 * built programs, not as a blind spot shared by the comparison and the
 * thing being compared.
 *
 * Deliberately biased toward false positives over false negatives: an
 * unnecessary fallback to StateMachineStrategy costs output prettiness,
 * never correctness. Missing a real mismatch costs correctness. When in
 * doubt, this function says a conversion is NOT valid.
 */
export function verifyNativeOutput(canvasFlow: FlowGraph, candidateYaml: string): VerifyResult {
  // Decision D1 / bug #28: verify against the graph as the strategies read
  // it (a no-op for a graph FlowTranspiler already normalized).
  const originalFlow = normalizeGraph(canvasFlow);
  let config: unknown;
  try {
    config = yamlLoad(candidateYaml);
  } catch (error) {
    return { valid: false, reason: `candidate YAML failed to parse: ${(error as Error).message}` };
  }
  if (!config || typeof config !== 'object') {
    return { valid: false, reason: 'candidate YAML did not parse to an object' };
  }

  let original: ReturnType<typeof extractFromGraph>;
  let candidate: ReturnType<typeof extractFromYamlConfig>;
  try {
    original = extractFromGraph(originalFlow);
    candidate = extractFromYamlConfig(config as Record<string, unknown>);
  } catch (error) {
    return { valid: false, reason: `behavior extraction threw: ${(error as Error).message}` };
  }

  if (original.isScriptMode !== candidate.isScriptMode) {
    return {
      valid: false,
      reason: `script/automation mode changed (isScriptMode: ${original.isScriptMode} -> ${candidate.isScriptMode})`,
    };
  }

  const triggerDiff = compareTriggerSets(original.triggers, candidate.triggers);
  if (triggerDiff) return { valid: false, reason: triggerDiff };

  const programDiff = programsEquivalent(original.program, candidate.program, 'actions');
  if (!programDiff.equal) return { valid: false, reason: programDiff.reason };

  const metaDiff = compareMetadata(original, candidate);
  if (metaDiff) return { valid: false, reason: metaDiff };

  return { valid: true };
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Triggers have no meaningful order (any of them independently fires the
 * automation), so they're compared as a set via permutation matching --
 * same "try every pairing, accept if one works" approach as
 * behaviorProgram.ts's parallel-branch comparison, appropriate here for
 * the same reason (small N in every real automation). */
export function compareTriggerSets(a: Record<string, unknown>[], b: Record<string, unknown>[]): string | null {
  if (a.length !== b.length) {
    return `trigger count changed: ${a.length} -> ${b.length}`;
  }
  const usedB = new Array(b.length).fill(false);
  function tryMatch(i: number): boolean {
    if (i === a.length) return true;
    for (let j = 0; j < b.length; j++) {
      if (usedB[j]) continue;
      if (deepEqualJson(a[i], b[j])) {
        usedB[j] = true;
        if (tryMatch(i + 1)) return true;
        usedB[j] = false;
      }
    }
    return false;
  }
  if (!tryMatch(0)) {
    return `trigger set changed: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`;
  }
  return null;
}

/** Compares the automation-level settings (mode, max, max_exceeded,
 * initial_state, trace, top-level variables, trigger_variables, script
 * fields). Shared with verifyStateMachineOutput, which had no such check
 * until bug #20. */
export function compareMetadata(original: FlowSettings, candidate: FlowSettings): string | null {
  if ((original.mode ?? 'single') !== (candidate.mode ?? 'single')) {
    return `mode changed: ${original.mode} -> ${candidate.mode}`;
  }
  if (!deepEqualJson(original.max, candidate.max)) {
    return `max changed: ${JSON.stringify(original.max)} -> ${JSON.stringify(candidate.max)}`;
  }
  if (!deepEqualJson(original.maxExceeded, candidate.maxExceeded)) {
    return `max_exceeded changed: ${JSON.stringify(original.maxExceeded)} -> ${JSON.stringify(candidate.maxExceeded)}`;
  }
  if (!deepEqualJson(original.initialState, candidate.initialState)) {
    return `initial_state changed: ${JSON.stringify(original.initialState)} -> ${JSON.stringify(candidate.initialState)}`;
  }
  if (!deepEqualJson(original.trace, candidate.trace)) {
    return `trace changed: ${JSON.stringify(original.trace)} -> ${JSON.stringify(candidate.trace)}`;
  }
  if (!deepEqualJson(original.userVariables ?? {}, candidate.userVariables ?? {})) {
    return `user variables changed: ${JSON.stringify(original.userVariables)} -> ${JSON.stringify(candidate.userVariables)}`;
  }
  if (!deepEqualJson(original.triggerVariables, candidate.triggerVariables)) {
    return `trigger_variables changed: ${JSON.stringify(original.triggerVariables)} -> ${JSON.stringify(candidate.triggerVariables)}`;
  }
  if (!deepEqualJson(original.scriptFields, candidate.scriptFields)) {
    return `script fields changed: ${JSON.stringify(original.scriptFields)} -> ${JSON.stringify(candidate.scriptFields)}`;
  }
  return null;
}
