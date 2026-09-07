"""Panel for Circuitry."""
import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig

from .const import DOMAIN, PANEL_TITLE, PANEL_ICON

_LOGGER = logging.getLogger(__name__)

PANEL_NAME = f"{DOMAIN}-panel"


async def async_register_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register the Circuitry panel."""
    www_path = Path(__file__).parent / "www"

    await hass.http.async_register_static_paths([
        StaticPathConfig("/circuitry-hass", str(www_path), False)
    ])

    wrapper_path = www_path / "assets" / "panel-wrapper.js"
    # Path.exists() is a blocking filesystem syscall — must not be called
    # directly in this coroutine, which runs on HA's event loop and would
    # stall all other event processing while it waits on the filesystem
    # (worse on a slow/network-mounted config directory). Run both checks
    # in the executor instead, same as any other blocking I/O in a HA
    # integration.
    wrapper_exists, assets_exist = await hass.async_add_executor_job(
        lambda: (wrapper_path.exists(), (www_path / "assets").exists())
    )
    if not wrapper_exists:
        _LOGGER.error("panel-wrapper.js not found in assets directory")
        _LOGGER.error(f"www path: {www_path}, assets exist: {assets_exist}")
        return

    import time
    cache_bust = int(time.time())
    module_url = f"/circuitry-hass/assets/panel-wrapper.js?v={cache_bust}"

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_NAME,
        frontend_url_path=DOMAIN,
        module_url=module_url,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=True,
        config={"language": entry.options.get("language", "auto")},
    )

    _LOGGER.info("Circuitry panel registered successfully")


def async_unregister_panel(hass: HomeAssistant) -> None:
    """Unregister the Circuitry panel."""
    frontend.async_remove_panel(hass, DOMAIN)
    _LOGGER.info("Circuitry panel unregistered")
