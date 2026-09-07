import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { verifyNativeOutput } from '../verification/verifyNativeOutput';

/**
 * Diagnostic / validation pass for the new behavioral-equivalence gate
 * (see verifyNativeOutput.ts's doc comment, and project memory's Phase B
 * notes -- "the maintainer chose option (b)"). Runs the gate against every real YAML
 * fixture already used across this package's test suite, for every case
 * where NativeStrategy is the strategy that actually gets used -- these
 * fixtures accumulated over the project's history specifically to pin down
 * NativeStrategy's real canonicalization behavior (AND-folding,
 * choose-chains, OR-convergence, root-condition promotion, ...), so they
 * are exactly the right corpus to check the new gate doesn't produce false
 * mismatches against known-correct native output.
 *
 * This file is NOT wired into FlowTranspiler.transpile() -- it's a
 * standalone check of the extraction/comparison logic's accuracy against
 * real fixtures, run before any decision to wire the gate into production.
 *
 * History: this diagnostic once caught a genuine native.ts bug on
 * 03-multiple-conditions.yaml (Phase B task #12) -- two independent
 * sequential conditions were misclassified as a mutually-exclusive elif
 * chain by buildSequenceFromNode's `isChooseChain` detector because it
 * never checked whether the false-path's target condition was ALSO
 * reachable via the true path, letting findConvergencePoint hoist the
 * second condition's gated action out as an unconditional step. Fixed in
 * native.ts (see its own inline comment on `falseTargetReachableViaTruePath`
 * for the full account) and confirmed via this suite before the fix was
 * accepted -- kept here as a record of what this gate is actually for.
 */
const FIXTURES_DIR = join(__dirname, '../../../../__tests__/yaml-automation-fixtures');

function listFixtures(): string[] {
  try {
    return readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.yaml'));
  } catch {
    return [];
  }
}

describe('behavioral-equivalence gate vs. real fixtures (diagnostic)', () => {
  const fixtures = listFixtures();
  expect(fixtures.length).toBeGreaterThan(0);

  for (const filename of fixtures) {
    it(`${filename}: native output (when selected) passes behavioral verification`, async () => {
      const yaml = readFileSync(join(FIXTURES_DIR, filename), 'utf8');
      const parser = new YamlParser();
      const transpiler = new FlowTranspiler();

      const parsed = await parser.parse(yaml);
      if (!parsed.success || !parsed.graph) {
        // Not every fixture in this directory is guaranteed parseable on
        // its own (some exist for other purposes, e.g. deliberately
        // malformed inputs) -- skip rather than fail on those.
        return;
      }

      const analysis = transpiler.analyzeTopology(parsed.graph);
      if (analysis.recommendedStrategy !== 'native') {
        // Only native-strategy output is in scope for this gate.
        return;
      }

      const result = transpiler.transpile(parsed.graph, { forceStrategy: 'native' });
      if (!result.success || !result.yaml) {
        // A fixture native can't actually render is out of scope here too
        // (that's FlowTranspiler's own forceStrategy error path, already
        // covered elsewhere).
        return;
      }

      const verification = verifyNativeOutput(parsed.graph, result.yaml);
      expect(verification.valid, verification.reason).toBe(true);
    });
  }
});
