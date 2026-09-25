"""Circuitry - Visual automation editor for Home Assistant."""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv, issue_registry as ir
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .panel import async_register_panel, async_unregister_panel
from .storage import GraphStore
from .websocket_api import async_register_websocket_commands

_LOGGER = logging.getLogger(__name__)

SERVICE_REPORT_IMPORT_ISSUE = "report_import_issue"

REPORT_IMPORT_ISSUE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): str,
        vol.Required("warnings"): [str],
    }
)

# Circuitry has no YAML configuration -- it's set up entirely via a config
# entry (the UI). async_setup() below only wires up websocket commands and
# canonical graph storage, it doesn't accept or parse YAML options. This
# tells hassfest (and HA's YAML loader) that explicitly, per
# homeassistant.helpers.config_validation.config_entry_only_config_schema's
# own docstring: "Use this when an integration's __init__.py defines setup
# or async_setup but setup from yaml is not supported."
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up Circuitry's websocket commands and canonical graph storage.

    Runs once when the integration module is loaded, independent of
    whether/how many config entries exist -- HA guarantees this runs
    before `async_setup_entry`. Websocket commands live here (not in
    `async_setup_entry`) per HA convention, since there's no public API
    to unregister one and they should exist as soon as the integration
    is loaded.
    """
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["graph_store"] = GraphStore(hass)
    async_register_websocket_commands(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Circuitry from a config entry."""
    await async_register_panel(hass, entry)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    async def _handle_report_import_issue(call: ServiceCall) -> None:
        """Create a Repair issue for an automation Circuitry couldn't round-trip losslessly."""
        entity_id = call.data["entity_id"]
        warnings = call.data["warnings"]
        ir.async_create_issue(
            hass,
            DOMAIN,
            f"lossy_import_{entity_id}",
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key="lossy_import",
            translation_placeholders={
                "entity_id": entity_id,
                "details": "\n".join(f"- {warning}" for warning in warnings),
            },
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_REPORT_IMPORT_ISSUE,
        _handle_report_import_issue,
        schema=REPORT_IMPORT_ISSUE_SCHEMA,
    )

    _LOGGER.info("Circuitry integration set up successfully")
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Re-register the panel so option changes (e.g. language) take effect."""
    async_unregister_panel(hass)
    await async_register_panel(hass, entry)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    async_unregister_panel(hass)
    hass.services.async_remove(DOMAIN, SERVICE_REPORT_IMPORT_ISSUE)
    return True
