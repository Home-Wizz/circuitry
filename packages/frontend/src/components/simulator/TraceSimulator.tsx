import { Play, RotateCcw, Square } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HaSelect } from '@/ha';
import { tracePath } from '@/lib/trace-path';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

interface ConditionOverrideSelectProps {
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}

/** "random" / "true" / "false" override picker for a single condition node in the simulator panel. */
function ConditionOverrideSelect({ value, onChange }: ConditionOverrideSelectProps) {
  const { t } = useTranslation(['simulator']);
  const currentValue = value === true ? 'true' : value === false ? 'false' : 'random';
  const handleChange = (val: string) => {
    onChange(val === 'random' ? undefined : val === 'true');
  };

  return (
    <HaSelect
      value={currentValue}
      onChange={(v) => handleChange(String(v))}
      options={[
        { value: 'random', label: t('simulator:trace.random') },
        { value: 'true', label: t('simulator:trace.true') },
        { value: 'false', label: t('simulator:trace.false') },
      ]}
      fallback={
        <Select value={currentValue} onValueChange={handleChange}>
          <SelectTrigger className="h-7 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="random">{t('simulator:trace.random')}</SelectItem>
            <SelectItem value="true">{t('simulator:trace.true')}</SelectItem>
            <SelectItem value="false">{t('simulator:trace.false')}</SelectItem>
          </SelectContent>
        </Select>
      }
    />
  );
}

export function TraceSimulator() {
  const { t } = useTranslation(['simulator']);
  const {
    nodes,
    toFlowGraph,
    isSimulating,
    startSimulation,
    stopSimulation,
    setActiveNode,
    addToExecutionPath,
    clearExecutionPath,
    executionPath,
    simulationSpeed,
  } = useFlowStore();

  const [conditionResults, setConditionResults] = useState<Record<string, boolean>>({});

  const simulate = useCallback(async () => {
    if (nodes.length === 0) return;

    try {
      // The nodes the saved automation would run, in order, and the edges
      // it goes down (lib/trace-path.ts: the transpiler's own walk of the
      // graph, not just the first edge).
      const { nodeIds, edgeIds } = tracePath(toFlowGraph(), conditionResults);
      startSimulation(edgeIds);
      for (const nodeId of nodeIds) {
        // The Stop button ends the animation.
        if (!useFlowStore.getState().isSimulating) break;
        // Highlight current node
        setActiveNode(nodeId);
        addToExecutionPath(nodeId);
        // Wait for visualization
        await new Promise((r) => setTimeout(r, simulationSpeed));
      }

      // Clear active node when done
      setActiveNode(null);
    } catch (error) {
      console.error('Simulation error:', error);
    }

    stopSimulation();
  }, [
    nodes,
    toFlowGraph,
    startSimulation,
    stopSimulation,
    setActiveNode,
    addToExecutionPath,
    simulationSpeed,
    conditionResults,
  ]);

  const handleStop = useCallback(() => {
    stopSimulation();
    setActiveNode(null);
  }, [stopSimulation, setActiveNode]);

  const handleReset = useCallback(() => {
    clearExecutionPath();
    setConditionResults({});
  }, [clearExecutionPath]);

  // Get condition nodes for manual override
  const conditionNodes = nodes.filter((n) => n.type === 'condition');

  return (
    <div className="h-full space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground text-sm">{t('simulator:trace.heading')}</h3>
        <div className="flex gap-1">
          {!isSimulating ? (
            <Button
              variant="outline"
              size="sm"
              onClick={simulate}
              disabled={nodes.length === 0}
              className={cn(
                'h-8 w-8 p-0',
                nodes.length === 0
                  ? 'text-muted-foreground'
                  : 'border-green-200 text-green-600 hover:bg-green-50'
              )}
            >
              <Play className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              className="h-8 w-8 border-red-200 p-0 text-red-600 hover:bg-red-50"
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 w-8 p-0">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Condition overrides */}
      {conditionNodes.length > 0 && (
        <div className="space-y-2">
          <Label className="font-medium text-muted-foreground text-xs">
            {t('simulator:trace.conditionOverrides')}
          </Label>
          <div className="space-y-2">
            {conditionNodes.map((node) => (
              <div key={node.id} className="flex items-center justify-between text-xs">
                <span className="mr-2 flex-1 truncate text-muted-foreground">
                  {(node.data as { alias?: string }).alias || node.id}
                </span>
                <ConditionOverrideSelect
                  value={conditionResults[node.id]}
                  onChange={(val) => {
                    if (val === undefined) {
                      setConditionResults((prev) => {
                        const { [node.id]: _, ...rest } = prev;
                        return rest;
                      });
                    } else {
                      setConditionResults((prev) => ({ ...prev, [node.id]: val }));
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution path */}
      {executionPath.length > 0 && (
        <div className="space-y-2">
          <Label className="font-medium text-muted-foreground text-xs">
            {t('simulator:trace.executionPath')}
          </Label>
          <ol className="list-inside list-decimal space-y-1 text-xs">
            {executionPath.map((nodeId, i) => {
              const node = nodes.find((n) => n.id === nodeId);
              const alias = (node?.data as { alias?: string })?.alias;
              return (
                <li
                  // A node a loop runs again appears again.
                  key={`${i}-${nodeId}`}
                  className={cn(
                    'py-0.5',
                    i === executionPath.length - 1 && isSimulating
                      ? 'font-medium text-green-600'
                      : 'text-muted-foreground'
                  )}
                >
                  {alias || nodeId}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
