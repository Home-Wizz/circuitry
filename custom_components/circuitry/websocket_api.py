"""Custom websocket_api commands backing Circuitry's canonical graph storage.

Registered once via `async_register_websocket_commands`, called from
`async_setup` (not `async_setup_entry`) per Home Assistant convention:
websocket commands should exist as soon as the integration module is
loaded, independent of config-entry lifecycle, since there is no public
API to unregister one later.

These three commands are Circuitry's entire custom backend surface for
Option 1. Everything else about saving/loading an automation still goes
through Home Assistant's own stock `config/automation/config` REST
endpoint (see packages/frontend/src/lib/ha-api.ts) -- this only adds a
side channel for the canonical FlowGraph JSON that produced that YAML.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .storage import GraphStore

_LOGGER = logging.getLogger(__name__)


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register Circuitry's save_graph/load_graph/delete_graph commands."""
    websocket_api.async_register_command(hass, websocket_save_graph)
    websocket_api.async_register_command(hass, websocket_load_graph)
    websocket_api.async_register_command(hass, websocket_delete_graph)


def _get_store(hass: HomeAssistant) -> GraphStore:
    return hass.data[DOMAIN]["graph_store"]


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_graph",
        vol.Required("automation_id"): str,
        vol.Required("graph"): dict,
        vol.Required("source_hash"): str,
    }
)
@websocket_api.async_response
async def websocket_save_graph(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist the canonical FlowGraph JSON for one automation.

    The frontend calls this right after a successful
    `config/automation/config/<id>` save, passing the exact FlowGraph it
    just transpiled and a hash of the generated automation config (see
    `computeSourceHash` in graph-storage.ts). Nothing here validates the
    graph's structure -- that already happened via Zod on the frontend
    before transpilation was even attempted -- this is pure storage.
    """
    store = _get_store(hass)
    saved_at = datetime.now(timezone.utc).isoformat()
    await store.async_save(msg["automation_id"], msg["graph"], msg["source_hash"], saved_at)
    connection.send_result(msg["id"], {"saved_at": saved_at})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/load_graph",
        vol.Required("automation_id"): str,
    }
)
@websocket_api.async_response
async def websocket_load_graph(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the stored {graph, source_hash, saved_at} for one automation, or null.

    The frontend is responsible for deciding whether the returned
    `source_hash` still matches the automation's current live config
    before trusting `graph` -- see `loadGraphIfFresh` in
    graph-storage.ts. A mismatch means the automation was edited outside
    Circuitry since this was saved (hand-edited YAML, the native HA UI,
    another tool), so this command always returns what it has and lets
    the caller make that call.
    """
    store = _get_store(hass)
    entry = await store.async_get(msg["automation_id"])
    connection.send_result(msg["id"], entry)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/delete_graph",
        vol.Required("automation_id"): str,
    }
)
@websocket_api.async_response
async def websocket_delete_graph(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove the stored graph for one automation (called when it's deleted)."""
    store = _get_store(hass)
    await store.async_delete(msg["automation_id"])
    connection.send_result(msg["id"])
