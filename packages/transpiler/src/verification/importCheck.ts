import type { FlowGraph } from '@circuitry/shared';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { runGraph } from '../simulation/graph-interpreter';
import { type Inputs, type RunResult, runAutomation } from '../simulation/sm-interpreter';

/**
 * The import check: does the graph the parser
 * built mean what the YAML it came from means?
 *
 * The gate checks every save (output against graph), but the parser was
 * outside it: a graph read wrongly is saved faithfully, and the gate
 * agrees (7 of the 18 shipped-wrong bugs of the reliability campaign came
 * in this way). A first attempt compared the graph with the YAML as
 * programs and raised false alarms on YAML Circuitry didn't write
 * (`service:` against `action:`, per-trigger routes the program form
 * can't express). This one runs both instead, by a different method from
 * anything the parser or the strategies do: the YAML in the step
 * interpreter (sm-interpreter.ts, checked against a real Home
 * Assistant), the graph by following its edges
 * (graph-interpreter.ts, which recognizes no shape), on the same fixed
 * entity states, for each trigger, with and without some entities
 * missing. The same actions must run.
 *
 * A difference is a difference; an automation the interpreters can't run
 * (an unsupported step, a template) proves nothing and is reported as
 * such, never as a difference. A run the YAML doesn't finish (a loop on
 * fixed states) is skipped.
 */
export interface ImportCheck {
  /** 'same': every run agreed; 'different': a run didn't; 'unchecked': the interpreters couldn't run it. */
  verdict: 'same' | 'different' | 'unchecked';
  /** For 'different' and 'unchecked': what was seen, for the warning and the log. */
  detail?: string;
  /** How many runs agreed. */
  runs: number;
}

export function checkImport(sourceYaml: string, graph: FlowGraph, seeds = [1, 2, 3]): ImportCheck {
  const source = firstAutomation(sourceYaml);
  const triggers = Math.max(1, countTriggers(source));
  let runs = 0;
  for (let triggerIdx = 0; triggerIdx < triggers; triggerIdx++) {
    for (const missing of [false, true]) {
      for (const seed of seeds) {
        const inputs: Inputs = { ...fixedStatesFor(source, seed, missing), triggerIdx };
        let expected: RunResult;
        try {
          expected = runAutomation(source, inputs, 20000);
        } catch (e) {
          return { verdict: 'unchecked', detail: `the YAML: ${String(e).slice(0, 200)}`, runs };
        }
        let actual: RunResult;
        try {
          // A graph run takes about as many steps as the YAML's (each node
          // one), which finished within 20000: twice that is ample, and
          // bounds the time an automation takes to open (a looping graph ran
          // ten times as long for nothing).
          // A YAML that didn't finish: a short graph run tells whether the
          // canvas finishes (a long loop on both sides isn't compared).
          actual = runGraph(graph, inputs, expected.finished ? 40000 : 1000);
        } catch (e) {
          return { verdict: 'unchecked', detail: `the graph: ${String(e).slice(0, 200)}`, runs };
        }
        // A YAML that goes on where the canvas finishes differs too (#285's
        // class search: the run was skipped, so a saved state machine going
        // round for ever passed). Both going on can't be compared.
        if (!expected.finished) {
          if (!actual.finished) continue;
          try {
            expected = runAutomation(source, inputs, 400000);
          } catch (e) {
            return { verdict: 'unchecked', detail: `the YAML: ${String(e).slice(0, 200)}`, runs };
          }
          if (!expected.finished) {
            return {
              verdict: 'different',
              detail: `trigger ${triggerIdx + 1}, states ${seed}${missing ? ' with entities missing' : ''}: the automation never finished, the canvas ran ${actual.trace.length} step(s)`,
              runs,
            };
          }
        }
        const a = JSON.stringify([...expected.trace].sort());
        const b = JSON.stringify([...actual.trace].sort());
        if (!actual.finished || a !== b) {
          return {
            verdict: 'different',
            detail: `trigger ${triggerIdx + 1}, states ${seed}${missing ? ' with entities missing' : ''}: the automation ran ${expected.trace.length} step(s), the canvas ${actual.finished ? actual.trace.length : 'never finished'}`,
            runs,
          };
        }
        runs++;
      }
    }
  }
  return { verdict: 'same', runs };
}

/**
 * Fixed states for every entity the automation names, picked by `seed`: a
 * sensor gets a number from 5 to 45, anything else on or off. With
 * `missing`, about a third of them are left out, so a condition on one
 * can't be evaluated (HA: an unknown entity, or a sensor that's
 * unavailable for numeric_state): the case HA's own if/else sends to the
 * else, and a condition step, `and`/`or`/`not` and a top-level condition
 * each treat their own way.
 */
export function fixedStatesFor(
  yamlText: string,
  seed: number,
  missing = false
): Record<string, string> {
  let x = (seed * 2654435761) >>> 0;
  const next = () => {
    x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    return x / 4294967296;
  };
  const states: Record<string, string> = {};
  for (const entity of [...new Set(yamlText.match(/\b[a-z_]+\.[a-z0-9_]+\b/g) ?? [])].sort()) {
    if (!/^(input_boolean|binary_sensor|sensor|switch|light)\./.test(entity)) continue;
    states[entity] = entity.startsWith('sensor.')
      ? String(5 + Math.floor(next() * 41))
      : next() < 0.5
        ? 'on'
        : 'off';
    if (missing && next() < 1 / 3) delete states[entity];
  }
  return states;
}

/** An automations.yaml-style list is read as its first automation, as YamlParser does. */
export function firstAutomation(yamlText: string): string {
  try {
    const parsed = yamlLoad(yamlText);
    return Array.isArray(parsed) && parsed.length > 0
      ? yamlDump(parsed[0], { lineWidth: -1 })
      : yamlText;
  } catch {
    return yamlText;
  }
}

/** How many triggers an automation's YAML lists (`triggers:` or the legacy `trigger:`). */
export function countTriggers(yamlText: string): number {
  try {
    const config = yamlLoad(yamlText) as Record<string, unknown> | null;
    const list = config?.triggers ?? config?.trigger;
    return Array.isArray(list) ? list.length : list ? 1 : 0;
  } catch {
    return 0;
  }
}
