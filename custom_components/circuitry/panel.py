"""Panel for Circuitry."""
import json
import logging
import re
from http import HTTPStatus
from pathlib import Path

from aiohttp import web

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import KEY_HASS, HomeAssistantView, StaticPathConfig

from .const import DOMAIN, PANEL_TITLE, PANEL_ICON

_LOGGER = logging.getLogger(__name__)

PANEL_NAME = f"{DOMAIN}-panel"


WWW_PATH = Path(__file__).parent / "www"
BUILD_FILE = WWW_PATH / "assets" / "panel-build.json"
# The panel entry's file name as the build writes it: nothing that leaves
# the assets folder.
_ENTRY_NAME = re.compile(r"^panel-app-[A-Za-z0-9_-]+\.js$")


def _read_build() -> dict | None:
    """The current build's entry, from the build's own panel-build.json."""
    try:
        entry = json.loads(BUILD_FILE.read_text(encoding="utf-8")).get("entry")
    except (OSError, ValueError, AttributeError):
        return None
    return {"entry": entry} if isinstance(entry, str) and _ENTRY_NAME.match(entry) else None


class PanelBuildView(HomeAssistantView):
    """Which build of the panel is current, read at every panel load.

    The panel's loader (www/assets/panel-wrapper.js) asks here and loads that
    build's entry, so a new build is used without restarting Home Assistant:
    HA's service worker serves the panel's files from its cache first, but
    never an /api/ request. No sign-in: it names a file anyone can fetch.
    """

    url = "/api/circuitry/panel_build"
    name = "api:circuitry:panel_build"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        build = await request.app[KEY_HASS].async_add_executor_job(_read_build)
        if build is None:
            return self.json_message(
                "Circuitry's panel files are missing; reinstall Circuitry.",
                HTTPStatus.NOT_FOUND,
            )
        response = self.json(build)
        response.headers["Cache-Control"] = "no-store"
        return response


async def async_register_static_path(hass: HomeAssistant) -> None:
    """Serve the panel's files, once: registered with every entry setup and
    options change, it added a duplicate route each time. Only when they're
    there: registered while the folder was missing, HA served the path as
    a single missing file, for good, so the panel stayed blank after the
    files were back and the entry reloaded, until HA restarted (bug #249)."""
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("static_path_registered"):
        return
    await hass.http.async_register_static_paths([
        StaticPathConfig("/circuitry-hass", str(WWW_PATH), False)
    ])
    hass.http.register_view(PanelBuildView())
    data["static_path_registered"] = True


async def async_register_panel(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register the Circuitry panel; False when its files are missing."""
    www_path = WWW_PATH
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
        # Setup fails, so HA shows it: it used to report success with no
        # panel in the sidebar.
        _LOGGER.error(
            "Circuitry's panel files are missing (panel-wrapper.js not found in %s; "
            "assets folder present: %s). Reinstall Circuitry.",
            www_path / "assets",
            assets_exist,
        )
        return False

    await async_register_static_path(hass)

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
    return True


def async_unregister_panel(hass: HomeAssistant) -> None:
    """Unregister the Circuitry panel."""
    frontend.async_remove_panel(hass, DOMAIN)
    _LOGGER.info("Circuitry panel unregistered")
