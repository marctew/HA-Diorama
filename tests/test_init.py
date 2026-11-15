"""Setting up and unloading: the panel, the card and the static files."""

from http import HTTPStatus
import logging

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration
import pytest

from custom_components.diorama import frontend_url, versioned_url
from custom_components.diorama.const import (
    CARD_FILE,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_FILE,
    PANEL_URL_PATH,
)


async def _version(hass: HomeAssistant) -> str:
    return str((await async_get_integration(hass, DOMAIN)).version)


def _extra_modules(hass: HomeAssistant) -> set[str]:
    return set(hass.data[frontend.DATA_EXTRA_MODULE_URL].urls)


async def test_setup_registers_panel_and_card(
    hass: HomeAssistant, config_entry, built_frontend
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.state is ConfigEntryState.LOADED
    version = await _version(hass)

    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]
    assert panel.require_admin is True
    assert panel.sidebar_title == "Diorama"
    custom = panel.config["_panel_custom"]
    assert custom["name"] == PANEL_ELEMENT
    assert custom["module_url"] == versioned_url(PANEL_FILE, version)
    assert custom["embed_iframe"] is False

    assert versioned_url(CARD_FILE, version) in _extra_modules(hass)


async def test_frontend_files_are_served(
    hass: HomeAssistant, config_entry, built_frontend, hass_client_no_auth
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    version = await _version(hass)
    client = await hass_client_no_auth()
    for filename, body in ((CARD_FILE, "// card"), (PANEL_FILE, "// panel")):
        response = await client.get(versioned_url(filename, version))
        assert response.status == HTTPStatus.OK
        assert await response.text() == body

    response = await client.get(f"{frontend_url(version)}/missing.js")
    assert response.status == HTTPStatus.NOT_FOUND


async def test_frontend_urls_carry_the_version_in_the_path(hass: HomeAssistant) -> None:
    # A query string would be dropped when one file imports another by
    # relative path, and the entry file would then be run twice.
    url = versioned_url(PANEL_FILE, "1.2.3")
    assert url == "/diorama_static/1.2.3/diorama-panel.js"
    assert "?" not in url


async def test_unload_removes_panel_and_card(
    hass: HomeAssistant, config_entry, built_frontend
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    card_url = versioned_url(CARD_FILE, await _version(hass))

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.state is ConfigEntryState.NOT_LOADED
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]
    assert card_url not in _extra_modules(hass)


async def test_reload_sets_everything_up_again(
    hass: HomeAssistant, config_entry, built_frontend
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH in hass.data[frontend.DATA_PANELS]
    assert versioned_url(CARD_FILE, await _version(hass)) in _extra_modules(hass)


async def test_missing_frontend_is_logged(
    hass: HomeAssistant,
    config_entry,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr("custom_components.diorama.FRONTEND_DIR", tmp_path / "nowhere")
    config_entry.add_to_hass(hass)

    with caplog.at_level(logging.ERROR, logger="custom_components.diorama"):
        assert await hass.config_entries.async_setup(config_entry.entry_id)
        await hass.async_block_till_done()

    assert "frontend is missing" in caplog.text


async def test_broken_stored_house_stops_setup(
    hass: HomeAssistant,
    config_entry,
    built_frontend,
    hass_storage,
    caplog: pytest.LogCaptureFixture,
) -> None:
    hass_storage["diorama.house"] = {
        "version": 1,
        "minor_version": 1,
        "key": "diorama.house",
        "data": {"floors": [{"id": "Not An Id", "name": "Ground"}]},
    }
    config_entry.add_to_hass(hass)

    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.state is ConfigEntryState.SETUP_ERROR
    assert "The stored house is not valid" in caplog.text
    assert hass_storage["diorama.house"]["data"]["floors"][0]["id"] == "Not An Id"
