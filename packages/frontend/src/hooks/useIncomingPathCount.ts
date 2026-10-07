import { useFlowStore } from '@/store/flow-store';

/** How many connections come into a node (the paths a join waits for). */
export function useIncomingPathCount(nodeId: string): number {
  return useFlowStore((s) => s.edges.filter((edge) => edge.target === nodeId).length);
}
