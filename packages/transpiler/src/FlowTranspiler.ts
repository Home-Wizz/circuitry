import type { FlowGraph } from '@circuitry/shared';
import { dump as yamlDump } from 'js-yaml';
import { analyzeTopology, type TopologyAnalysis } from './analyzer/topology';
import { type ValidationResult, validateFlowGraph } from './analyzer/validator';
import { type ParseResult, YamlParser } from './parser/YamlParser';
import type { HAYamlOutput, TranspilerStrategy } from './strategies/base';
import { NativeStrategy } from './strategies/native';
import { StateMachineStrategy } from './strategies/state-machine';
import { verifyNativeOutput } from './verification/verifyNativeOutput';
import { verifyStateMachineOutput } from './verification/verifyStateMachineOutput';

/**
 * Options for YAML generation
 */
export interface YamlOptions {
  /**
   * Indentation level (default: 2)
   */
  indent?: number;
  /**
   * Line width for wrapping (-1 for no wrapping)
   */
  lineWidth?: number;
  /**
   * Force a specific strategy instead of auto-selecting
   */
  forceStrategy?: 'native' | 'state-machine';
}

/**
 * Result of transpilation
 */
export interface TranspileResult {
  /**
   * Whether transpilation succeeded
   */
  success: boolean;
  /**
   * Generated YAML string
   */
  yaml?: string;
  /**
   * Parsed YAML object (automation or script)
   */
  output?: HAYamlOutput;
  /**
   * Topology analysis results
   */
  analysis?: TopologyAnalysis;
  /**
   * Validation errors (if any)
   */
  errors?: string[];
  /**
   * Warnings from transpilation
   */
  warnings: string[];
}

/**
 * Main transpiler class for converting React Flow graphs to Home Assistant YAML
 */
export class FlowTranspiler {
  private strategies: TranspilerStrategy[] = [new NativeStrategy(), new StateMachineStrategy()];

  /**
   * Validate a flow graph input
   */
  validate(input: unknown): ValidationResult {
    return validateFlowGraph(input);
  }

  /**
   * Analyze the topology of a validated flow graph
   */
  analyzeTopology(flow: FlowGraph): TopologyAnalysis {
    return analyzeTopology(flow);
  }

  /**
   * Transpile a flow graph to Home Assistant YAML
   */
  transpile(input: unknown, options: YamlOptions = {}): TranspileResult {
    const warnings: string[] = [];

    // Step 1: Validate the input
    const validation = this.validate(input);
    if (!validation.success || !validation.graph) {
      return {
        success: false,
        errors: validation.errors.map((e) => e.message),
        warnings,
      };
    }

    const flow = validation.graph;

    // Step 2: Analyze topology
    const analysis = this.analyzeTopology(flow);

    // Step 3: Select strategy
    let strategy: TranspilerStrategy;

    if (options.forceStrategy) {
      const forced = this.strategies.find((s) => s.name === options.forceStrategy);
      if (!forced) {
        return {
          success: false,
          errors: [`Unknown strategy: ${options.forceStrategy}`],
          warnings,
        };
      }
      strategy = forced;

      // A forced strategy that can't actually handle this topology isn't
      // merely "suboptimal" -- for NativeStrategy specifically, canHandle()
      // is `analysis.isTree`, and every one of the flags that can make that
      // false (cycles, cross-links, converging paths, divergent trigger
      // paths, a branching repeat body, convergence at a loop condition)
      // marks a shape its tree-walker is structurally unable to represent.
      // Forcing it on anyway used to just push a warning and generate the
      // YAML regardless, which for a converging-paths graph produced
      // *silently* broken output (actions vanishing into `sequence: []`
      // with no error at all) rather than something merely non-optimal --
      // found via empirical audit, 2026-09-06, from a user-reachable path
      // (the YAML preview panel's manual strategy selector). Since forced
      // output is otherwise handed straight to the user (copy-to-clipboard,
      // or previewed as if it were valid), a strategy mismatch here must
      // fail loudly instead of returning corrupted YAML.
      if (!strategy.canHandle(analysis)) {
        return {
          success: false,
          errors: [
            `Strategy "${strategy.name}" cannot represent this flow's structure ` +
              `(it would silently drop actions or produce invalid YAML). ` +
              `Use the recommended strategy instead: ${analysis.recommendedStrategy}.`,
          ],
          analysis,
          warnings,
        };
      }
    } else {
      // Auto-select based on topology
      const suitable = this.strategies.find((s) => s.canHandle(analysis));
      if (!suitable) {
        // Fall back to state-machine which handles everything
        strategy = new StateMachineStrategy();
      } else {
        strategy = suitable;
      }
    }

    // Steps 4-6: Generate YAML output, inject _circuitry_metadata, serialize.
    let { output, yaml } = this.generateAndSerialize(flow, strategy, analysis, options, warnings);

    // Step 7: Behavioral-equivalence verification gate for NativeStrategy
    // output (Phase B task #10 -- see verification/verifyNativeOutput.ts's
    // own doc comment for the full design rationale). NativeStrategy's
    // tree-walking shape-recognition code (choose-chain detection,
    // AND-chain folding, OR-convergence, loop classification, ...) is the
    // most structurally complex strategy in this file, and the one most
    // prone to silently mis-rendering a graph's actual behavior -- see
    // native.ts's own inline comment on `falseTargetReachableViaTruePath`
    // for a real, previously-undetected example this exact gate caught
    // (Phase B task #12) before this gate was wired in here.
    // StateMachineStrategy's per-node choose/current_node walker has a much
    // simpler, more mechanical shape-recognition step than NativeStrategy's
    // -- but "simpler" turned out not to mean "trustworthy without
    // checking": the StateMachineStrategy audit (2026-09-06) found three
    // real fidelity bugs in its own construction code via direct source
    // comparison against NativeStrategy's already-hardened equivalents (see
    // Step 8 below for the fix history and the gate that now catches
    // regressions of this kind). It is still this file's fallback when no
    // strategy's canHandle() matches (Step 3 above) and the target this
    // gate falls back to on a native verification failure -- but its own
    // output is no longer given a free pass; Step 8 verifies it too.
    if (strategy.name === 'native') {
      const verification = verifyNativeOutput(flow, yaml);
      if (!verification.valid) {
        if (options.forceStrategy === 'native') {
          // The caller explicitly asked for native output -- per this
          // file's existing forced-strategy principle above ("forced
          // output is handed straight to the user ... must fail loudly
          // instead of returning corrupted YAML"), a behavioral mismatch
          // here must fail loudly too, rather than silently substituting a
          // strategy the caller didn't ask for.
          return {
            success: false,
            errors: [
              `Native strategy produced output that does not behaviorally match the flow graph ` +
                `(${verification.reason ?? 'unspecified mismatch'}). Use the recommended strategy ` +
                `instead: ${analysis.recommendedStrategy}.`,
            ],
            analysis,
            warnings,
          };
        }

        // Auto-selected native output failed verification -- fall back to
        // StateMachineStrategy. This is a real automation headed for a
        // real Home Assistant instance; silently keeping output that's
        // been shown not to match the graph's actual behavior would be
        // strictly worse than a less compact but behaviorally faithful
        // fallback.
        warnings.push(
          `Native strategy output failed behavioral verification ` +
            `(${verification.reason ?? 'unspecified mismatch'}); fell back to the state-machine strategy.`
        );
        strategy = this.strategies.find((s) => s.name === 'state-machine') ?? new StateMachineStrategy();
        ({ output, yaml } = this.generateAndSerialize(flow, strategy, analysis, options, warnings));
      }
    }

    // Step 8: Behavioral-equivalence verification gate for StateMachineStrategy
    // output. Unlike NativeStrategy above, this always fails loudly on a
    // mismatch -- forced or auto-selected alike, and regardless of whether
    // state-machine was the original strategy selection or a fallback from
    // a failed native verification just above -- because there is no
    // further fallback strategy after state-machine
    // (StateMachineStrategy.canHandle() is unconditionally true), so there
    // is nowhere else to hand a behaviorally-wrong automation off to. See
    // verifyStateMachineOutput.ts's own doc comment for why this comparison
    // is shaped differently from verifyNativeOutput's (a per-node
    // transition-table comparison, not a single BProgram diff). Wired in
    // 2026-09-06 after the StateMachineStrategy audit found three real
    // fidelity bugs in state-machine.ts's own construction code (an empty
    // `data: {}` spuriously kept on service calls, an `id` field HA's
    // action-step schema rejects kept on delay/wait/set_variables nodes,
    // and a condition's `enabled: false` field silently dropped) -- all
    // fixed before this gate was wired in, but confirming
    // StateMachineStrategy's shape-recognition code needs the same "never
    // trust blindly" treatment as NativeStrategy's, not a free pass as the
    // universal fallback.
    if (strategy.name === 'state-machine') {
      const smVerification = verifyStateMachineOutput(flow, yaml);
      if (!smVerification.valid) {
        return {
          success: false,
          errors: [
            `State-machine strategy produced output that does not behaviorally match the flow graph ` +
              `(${smVerification.reason ?? 'unspecified mismatch'}). This is the fallback strategy with ` +
              `nowhere further to fall back to -- please report this flow so the underlying bug can be fixed.`,
          ],
          analysis,
          warnings,
        };
      }
    }

    return {
      success: true,
      yaml,
      output,
      analysis,
      warnings,
    };
  }

  /**
   * Runs a strategy's generate() and serializes the result to a YAML string
   * with _circuitry_metadata injected -- factored out of transpile() so the
   * behavioral-verification gate (Step 7) can re-run it against
   * StateMachineStrategy on fallback without duplicating the metadata/
   * serialization logic. `warnings` is mutated in place (matching
   * transpile()'s own original behavior of collecting output.warnings as
   * it goes).
   */
  private generateAndSerialize(
    flow: FlowGraph,
    strategy: TranspilerStrategy,
    analysis: TopologyAnalysis,
    options: YamlOptions,
    warnings: string[]
  ): { output: HAYamlOutput; yaml: string } {
    const output = strategy.generate(flow, analysis);
    warnings.push(...output.warnings);

    // Inject _circuitry_metadata with node positions. Only this key is ever
    // written going forward — YamlParser.ts's extractMetadata still reads
    // the older _flode_metadata/_cafe_metadata keys on the way in, so an
    // automation saved before this rebrand keeps its layout, but every
    // save from here on writes the current key.
    const yamlContent = output.automation ?? output.script;
    let yaml: string;

    if (yamlContent && typeof yamlContent === 'object') {
      const metadata = this.generateCircuitryMetadata(flow, strategy, output.nodeOrder);
      const contentWithMetadata = {
        ...yamlContent,
        variables: {
          // First, include user-defined variables from the flow graph
          ...(flow.userVariables || {}),
          // Then include any variables from the generated YAML (e.g., state machine vars)
          ...(yamlContent.variables || {}),
          // Finally, add _circuitry_metadata
          _circuitry_metadata: metadata,
        },
      };

      yaml = yamlDump(contentWithMetadata, {
        indent: options.indent ?? 2,
        lineWidth: options.lineWidth ?? -1,
        quotingType: '"',
        forceQuotes: false,
      });
    } else {
      // Serialize without metadata
      yaml = yamlDump(yamlContent, {
        indent: options.indent ?? 2,
        lineWidth: options.lineWidth ?? -1,
        quotingType: '"',
        forceQuotes: false,
      });
    }

    return { output, yaml };
  }

  /**
   * Transpile to YAML string directly
   */
  toYaml(input: unknown, options: YamlOptions = {}): string {
    const result = this.transpile(input, options);

    if (!result.success) {
      throw new Error(`Transpilation failed: ${result.errors?.join(', ')}`);
    }

    return result.yaml!;
  }

  /**
   * Force native strategy (for tree-shaped flows)
   */
  toNativeYaml(input: unknown, options: YamlOptions = {}): string {
    return this.toYaml(input, { ...options, forceStrategy: 'native' });
  }

  /**
   * Force state machine strategy (for complex flows)
   */
  toStateMachineYaml(input: unknown, options: YamlOptions = {}): string {
    return this.toYaml(input, { ...options, forceStrategy: 'state-machine' });
  }

  /**
   * Parse Home Assistant YAML back into FlowGraph
   */
  fromYaml(yamlString: string): Promise<ParseResult> {
    const parser = new YamlParser();
    return parser.parse(yamlString);
  }

  /**
   * Get available strategies
   */
  getStrategies(): Array<{ name: string; description: string }> {
    return this.strategies.map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  /**
   * Add a custom strategy
   */
  addStrategy(strategy: TranspilerStrategy): void {
    this.strategies.unshift(strategy); // Add at beginning for priority
  }

  /**
   * Generate Circuitry metadata for position persistence
   *
   * Note: We only store node positions in metadata. Node data and edges are already
   * encoded in the YAML structure itself:
   * - Node data is in each choose block's sequence
   * - Edges are in the variables transitions (current_node assignments)
   * - Node IDs are in the choose block conditions
   *
   * `nodePositions`' key order matters, not just its contents: on reload,
   * YamlParser.ts's parseAutomationStructure (native strategy) re-derives
   * fresh node IDs by walking the generated YAML and consuming saved
   * metadata IDs *positionally* — the Nth key here gets handed to the Nth
   * node it structurally re-encounters. If we wrote keys in flow.nodes'
   * raw array order (basically edit history) that position wouldn't line
   * up with the parser's structural walk order, and saved positions would
   * silently land on the wrong nodes — the "nodes chaotically placed on
   * reopen" bug. `nodeOrder` (from NativeStrategy's generate(), when
   * present) is the exact order the strategy just materialized nodes into
   * this YAML, i.e. exactly the order the parser will re-encounter them —
   * so we write keys in that order instead. Any node missing from
   * `nodeOrder` (trigger/start entry markers, which the parser matches via
   * a separate self-consistent mechanism; and purely transparent nodes
   * like paired sequence markers or a count-repeat's init/increment nodes,
   * which never get individually re-created from metadata at all) is
   * appended afterward in flow.nodes order as a safe fallback. Falls back
   * to plain flow.nodes order entirely when `nodeOrder` isn't provided
   * (StateMachineStrategy: its parser matches condition/action/delay/wait
   * nodes by literal ID embedded in choose-block templates, not by
   * position, so it was never exposed to this bug).
   */
  private generateCircuitryMetadata(
    flow: FlowGraph,
    strategy: TranspilerStrategy,
    nodeOrder?: string[]
  ): Record<string, unknown> {
    const nodePositions: Record<string, { x: number; y: number }> = {};
    const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
    const written = new Set<string>();

    for (const nodeId of nodeOrder ?? []) {
      const node = nodesById.get(nodeId);
      if (!node || written.has(nodeId)) continue;
      nodePositions[nodeId] = { x: node.position.x, y: node.position.y };
      written.add(nodeId);
    }

    // Fallback: any node not covered above (all nodes, when nodeOrder wasn't
    // provided at all) — in flow.nodes' own order.
    for (const node of flow.nodes) {
      if (written.has(node.id)) continue;
      nodePositions[node.id] = { x: node.position.x, y: node.position.y };
      written.add(node.id);
    }

    return {
      version: 1,
      nodes: nodePositions,
      graph_id: flow.id,
      graph_version: flow.version,
      strategy: strategy.name,
    };
  }
}

// Export singleton instance
export const transpiler = new FlowTranspiler();
