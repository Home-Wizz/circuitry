// @vitest-environment jsdom
//
// Focused, fully-mocked unit test for the JSON-canonical-store staleness-gap
// fix (Phase B): when the stored canonical graph is missing/invalid/stale,
// useLoadAutomation falls back to decompiling the live YAML -- and must now
// re-persist that freshly decompiled graph via saveGraph() so the canonical
// store re-syncs itself instead of staying stale indefinitely.
//
// Every module useLoadAutomation.ts touches is mocked here so this test
// exercises ONLY this hook's own control flow (which branch runs, what gets
// persisted afterward and with what arguments) -- no real HA websocket
// connection, zustand store, i18n resources, or React Flow instance is
// needed. This is the first renderHook-based test in this package; jsdom and
// @testing-library/react were added specifically to make this possible (see
// the accompanying commit message for how they were installed, since `yarn`
// itself can't run in this sandbox).
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFitView,
  mockReset,
  mockOpenInNewTab,
  mockFromFlowGraph,
  mockSetFlowName,
  mockSetAutomationId,
  mockFromYaml,
  mockComputeSourceHash,
  mockLoadGraphIfFresh,
  mockSaveGraph,
  mockIsConnected,
  mockGetAutomationConfigWithFallback,
  mockReportImportIssue,
} = vi.hoisted(() => ({
  mockFitView: vi.fn(),
  mockReset: vi.fn(),
  mockOpenInNewTab: vi.fn(),
  mockFromFlowGraph: vi.fn(),
  mockSetFlowName: vi.fn(),
  mockSetAutomationId: vi.fn(),
  mockFromYaml: vi.fn(),
  mockComputeSourceHash: vi.fn(),
  mockLoadGraphIfFresh: vi.fn(),
  mockSaveGraph: vi.fn(),
  mockIsConnected: vi.fn(),
  mockGetAutomationConfigWithFallback: vi.fn(),
  mockReportImportIssue: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ fitView: mockFitView }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/contexts/HassContext', () => ({
  useHass: () => ({ hass: {}, config: {} }),
}));

vi.mock('@/store/flow-store', () => ({
  useFlowStore: () => ({
    reset: mockReset,
    openInNewTab: mockOpenInNewTab,
    fromFlowGraph: mockFromFlowGraph,
    setFlowName: mockSetFlowName,
    setAutomationId: mockSetAutomationId,
  }),
}));

vi.mock('@/lib/haToast', () => ({
  showSuccessToast: vi.fn(),
  showWarningToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock('@circuitry/transpiler', () => ({
  transpiler: { fromYaml: mockFromYaml },
}));

vi.mock('@/lib/graph-storage', () => ({
  computeSourceHash: mockComputeSourceHash,
  loadGraphIfFresh: mockLoadGraphIfFresh,
  saveGraph: mockSaveGraph,
}));

vi.mock('@/lib/ha-api', () => ({
  getHomeAssistantAPI: () => ({
    isConnected: mockIsConnected,
    getAutomationConfigWithFallback: mockGetAutomationConfigWithFallback,
    reportImportIssue: mockReportImportIssue,
  }),
}));

// Imported after the mocks above (vi.mock calls are hoisted by Vitest above
// every import in this file regardless of source order, so this resolves
// against the mocked modules).
import { useLoadAutomation } from '../useLoadAutomation';

describe('useLoadAutomation -- JSON-canonical-store staleness gap (Phase B)', () => {
  const FAKE_CONFIG = { triggers: [], conditions: [], actions: [], mode: 'single' };
  const FAKE_HASH = 'deadbeef';
  const FAKE_DECOMPILED_GRAPH = { id: 'g1', nodes: [], edges: [] };
  const AUTOMATION = { automation_id: 'automation.foo' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
    mockGetAutomationConfigWithFallback.mockResolvedValue(FAKE_CONFIG);
    mockComputeSourceHash.mockReturnValue(FAKE_HASH);
  });

  it('does NOT call saveGraph on the fast path (a fresh canonical graph is found)', async () => {
    mockLoadGraphIfFresh.mockResolvedValue({ id: 'stored', nodes: [], edges: [] });

    const { result } = renderHook(() => useLoadAutomation());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current(AUTOMATION);
    });

    expect(ok).toBe(true);
    expect(mockFromYaml).not.toHaveBeenCalled();
    expect(mockSaveGraph).not.toHaveBeenCalled();
  });

  it('re-persists the freshly decompiled graph via saveGraph when the canonical graph is stale/missing/invalid', async () => {
    // loadGraphIfFresh returning null covers all three real causes
    // identically (no stored entry at all, a hash mismatch from an external
    // edit, or a stored entry that failed schema validation) -- the
    // decompile-then-repersist behavior under test is the same for all of
    // them, since this hook has no way to distinguish which one occurred.
    mockLoadGraphIfFresh.mockResolvedValue(null);
    mockFromYaml.mockResolvedValue({ success: true, graph: FAKE_DECOMPILED_GRAPH, warnings: [] });

    const { result } = renderHook(() => useLoadAutomation());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current(AUTOMATION);
    });

    expect(ok).toBe(true);
    expect(mockFromYaml).toHaveBeenCalledTimes(1);
    expect(mockFromFlowGraph).toHaveBeenCalledWith(FAKE_DECOMPILED_GRAPH);
    // The critical assertion for this fix: saveGraph is called with the
    // SAME sourceHash that was computed (once) from the live config at the
    // top of the function -- that's what makes the next load's freshness
    // check treat this newly-stored graph as fresh instead of stale again.
    expect(mockSaveGraph).toHaveBeenCalledTimes(1);
    expect(mockSaveGraph).toHaveBeenCalledWith(
      expect.anything(),
      AUTOMATION.automation_id,
      FAKE_DECOMPILED_GRAPH,
      FAKE_HASH
    );
  });

  it('still succeeds the load if saveGraph itself rejects (best-effort, matches flow-store.ts save path)', async () => {
    mockLoadGraphIfFresh.mockResolvedValue(null);
    mockFromYaml.mockResolvedValue({ success: true, graph: FAKE_DECOMPILED_GRAPH, warnings: [] });
    mockSaveGraph.mockRejectedValue(new Error('websocket unavailable'));

    const { result } = renderHook(() => useLoadAutomation());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current(AUTOMATION);
    });

    expect(ok).toBe(true);
    expect(mockFromFlowGraph).toHaveBeenCalledWith(FAKE_DECOMPILED_GRAPH);
  });

  it('re-persists even when the decompile is lossy (warnings present) -- it is still the best available canonical copy', async () => {
    mockLoadGraphIfFresh.mockResolvedValue(null);
    mockFromYaml.mockResolvedValue({
      success: true,
      graph: FAKE_DECOMPILED_GRAPH,
      warnings: ['some lossy bit'],
    });

    const { result } = renderHook(() => useLoadAutomation());
    await act(async () => {
      await result.current({ ...AUTOMATION, entity_id: 'automation.foo' });
    });

    expect(mockSaveGraph).toHaveBeenCalledTimes(1);
    expect(mockReportImportIssue).toHaveBeenCalledWith('automation.foo', ['some lossy bit']);
  });

  it('does not call saveGraph at all if the decompile itself fails', async () => {
    mockLoadGraphIfFresh.mockResolvedValue(null);
    mockFromYaml.mockResolvedValue({ success: false, graph: null, errors: ['bad yaml'] });

    const { result } = renderHook(() => useLoadAutomation());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current(AUTOMATION);
    });

    expect(ok).toBe(false);
    expect(mockSaveGraph).not.toHaveBeenCalled();
  });
});
