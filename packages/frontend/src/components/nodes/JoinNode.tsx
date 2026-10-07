import type { NodeProps } from '@xyflow/react';
import { Ban } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { JoinModeChoice, pathCountForm } from '@/components/panels/node-fields/JoinModeChoice';
import { nodeTypes } from '@/config/nodeTypeCatalog';
import { useIncomingPathCount } from '@/hooks/useIncomingPathCount';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { useTraceNodeState } from '@/hooks/useTraceNodeState';
import { getTraceStateClass } from '@/lib/node-colors';
import type { JoinNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { EditPill, PILL_TEXT } from './EditPill';
import { StepFrame } from './StepCard';

interface JoinNodeProps extends NodeProps {
  data: JoinNodeData;
}

/**
 * The join card — an explicit, visible convergence point for parallel
 * branches, reading "Wait for [all paths]" with what it waits for set on
 * the card itself, rather than relying on implicit graph-shape inference. Metadata-only under the hood: HA's native `parallel:` action
 * (already emitted by the existing convergence-detection codegen) already
 * *is* All-join semantics, so this node contributes no YAML step of its own.
 */
export const JoinNode = memo(function JoinNode({ id, data, selected }: JoinNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages, warningMessages } = useNodeErrors(id);
  const traceState = useTraceNodeState(id);
  const isActive = activeNodeId === id;
  const stepNumber = getExecutionStepNumber(id);
  const isDisabled = data.enabled === false;
  const mode = data.mode ?? 'all';
  // Looked up from the shared catalog rather than a second hardcoded icon
  // reference, so this card and the Add Node panel/sidebar never drift.
  const JoinIcon = nodeTypes.find((n) => n.type === 'join')?.icon ?? Ban;

  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const pathCount = useIncomingPathCount(id);

  // What it waits for, set on the card: "Wait for [both paths]" (counted
  // from the paths coming in; "all paths" until two are connected).
  const waitFor = (
    <>
      {t('nodes:joinFields.waitFor')}{' '}
      <EditPill
        tone="join"
        testId="join-mode-pill"
        ariaLabel={t('nodes:joinFields.editMode')}
        contentClassName="w-80 p-1.5"
        editor={() => (
          <JoinModeChoice
            mode={mode}
            pathCount={pathCount}
            onChange={(next) => updateNodeData(id, { mode: next })}
          />
        )}
      >
        <span className={PILL_TEXT}>
          {mode === 'any'
            ? t('nodes:joinFields.pathsAny')
            : t(`nodes:joinFields.pathsAll.${pathCountForm(pathCount)}`, { count: pathCount })}
        </span>
      </EditPill>
    </>
  );

  return (
    <StepFrame
      nodeId={id}
      tone="join"
      icon={JoinIcon}
      iconKey="join"
      kind={t('nodes:types.join')}
      sentence={data.alias || waitFor}
      stepNumber={stepNumber}
      selected={selected ?? false}
      isActive={isActive}
      isDisabled={isDisabled}
      hasErrors={hasErrors}
      errorMessages={errorMessages}
      warningMessages={warningMessages}
      traceClass={getTraceStateClass(traceState)}
      roleLabel={null}
      hasSourceHandle
    >
      {data.alias && <div className="text-foreground text-sm">{waitFor}</div>}
    </StepFrame>
  );
});
