"""Canonical graph storage for Circuitry (Option 1 architecture).

Circuitry's visual editor state (node positions, edges, and everything
needed to redraw the canvas exactly as it was) is stored here as plain
JSON, keyed by the Home Assistant automation `id`, using HA's own
`Store` helper -- the same mechanism HA itself uses for `.storage/*`
files (e.g. `core.entity_registry`).

This exists so that loading an automation Circuitry itself saved never
has to go through the heuristic YAML-decompiler in
`@circuitry/transpiler`'s `YamlParser.ts`. That decompiler stays in
place as a fallback for automations Circuitry did not save (or that
were hand-edited since), but the common case is now a plain JSON load
with Zod-schema validation on the frontend -- see
packages/frontend/src/lib/graph-storage.ts.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

STORAGE_VERSION = 1
STORAGE_KEY = "circuitry_graphs"


class GraphStore:
    """Thin wrapper around a single `Store` holding every saved graph.

    Data shape on disk (`.storage/circuitry_graphs`)::

        {
          "<automation_id>": {
            "graph": <FlowGraph JSON -- validated by the frontend's Zod
                      schema before it ever reaches here; this layer
                      does not interpret its contents>,
            "source_hash": "<hash the frontend computed over the
                      generated automation config, excluding
                      _circuitry_metadata>",
            "saved_at": "<ISO 8601 timestamp>"
          },
          ...
        }

    One `GraphStore` is created per Home Assistant instance in
    `async_setup` and shared by every websocket command via
    `hass.data[DOMAIN]["graph_store"]`.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] | None = None

    async def _async_load(self) -> dict[str, Any]:
        if self._data is None:
            self._data = await self._store.async_load() or {}
        return self._data

    async def async_get(self, automation_id: str) -> dict[str, Any] | None:
        """Return the stored entry for one automation, or None."""
        data = await self._async_load()
        return data.get(automation_id)

    async def async_save(
        self,
        automation_id: str,
        graph: dict[str, Any],
        source_hash: str,
        saved_at: str,
    ) -> None:
        """Persist (overwrite) the graph entry for one automation."""
        data = await self._async_load()
        data[automation_id] = {
            "graph": graph,
            "source_hash": source_hash,
            "saved_at": saved_at,
        }
        await self._store.async_save(data)

    async def async_delete(self, automation_id: str) -> None:
        """Remove the graph entry for one automation, if present."""
        data = await self._async_load()
        if automation_id in data:
            del data[automation_id]
            await self._store.async_save(data)
