"""Diorama: lay out your house in 3D and control it from there."""

from __future__ import annotations

from dataclasses import dataclass
import logging

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError
from homeassistant.loader import async_get_integration
from homeassistant.util.hass_dict import HassKey

from . import websocket_api
from .const import (
    CARD_FILE,
    DOMAIN,
    FRONTEND_DIR,
    PANEL_ELEMENT,
    PANEL_FILE,
    PANEL_ICON,
    PANEL_URL_PATH,
    STATIC_URL,
    TITLE,
)
from .store import DioramaStore, StoredDataInvalid

_LOGGER = logging.getLogger(__name__)

# Static paths cannot be removed again, so remember that they are registered
# for as long as Home Assistant runs, across reloads of the config entry.
DATA_STATIC_REGISTERED: HassKey[bool] = HassKey(f"{DOMAIN}_static_registered")


@dataclass
class DioramaData:
    """What a loaded config entry holds."""

    card_url: str
    store: DioramaStore


type DioramaConfigEntry = ConfigEntry[DioramaData]


async def async_setup_entry(hass: HomeAssistant, entry: DioramaConfigEntry) -> bool:
    """Load the house, serve the frontend, add the panel and load the card."""
    store = DioramaStore(hass)
    try:
        await store.async_load()
    except StoredDataInvalid as err:
        raise ConfigEntryError(str(err)) from err
    websocket_api.async_register(hass)

    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version)

    if not await hass.async_add_executor_job(_frontend_is_built):
        _LOGGER.error(
            "The Diorama frontend is missing from %s. Install a release, "
            "or run 'npm run build' in the frontend folder",
            FRONTEND_DIR,
        )

    if not hass.data.get(DATA_STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    frontend_url(version), str(FRONTEND_DIR), cache_headers=True
                )
            ]
        )
        hass.data[DATA_STATIC_REGISTERED] = True

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=versioned_url(PANEL_FILE, version),
        require_admin=True,
        config={"version": version},
    )

    card_url = versioned_url(CARD_FILE, version)
    frontend.add_extra_js_url(hass, card_url)
    entry.runtime_data = DioramaData(card_url=card_url, store=store)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: DioramaConfigEntry) -> bool:
    """Take the panel and the card out again."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    frontend.remove_extra_js_url(hass, entry.runtime_data.card_url)
    return True


def frontend_url(version: str) -> str:
    """Return where this version's frontend files are served.

    The version is part of the path, not a query string. The files import each
    other by relative path, which drops a query string: the browser would then
    see the entry file under two addresses and run it twice.
    """
    return f"{STATIC_URL}/{version}"


def versioned_url(filename: str, version: str) -> str:
    """Return the URL of a frontend file, changing with every release."""
    return f"{frontend_url(version)}/{filename}"


def _frontend_is_built() -> bool:
    return all((FRONTEND_DIR / name).is_file() for name in (PANEL_FILE, CARD_FILE))
