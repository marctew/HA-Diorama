"""Setting up and unloading: the panel, the card and the static files."""

from http import HTTPStatus
import logging

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration
import pytest

from custom_components.diorama import versioned_url
from custom_components.diorama.const import (
    CARD_FILE,
    DOMAIN,
    FRONTEND_URL,
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

    client = await hass_client_no_auth()
    for filename, body in ((CARD_FILE, "// card"), (PANEL_FILE, "// panel")):
        response = await client.get(f"{FRONTEND_URL}/{filename}?v=1")
        assert response.status == HTTPStatus.OK
        assert await response.text() == body

    response = await client.get(f"{FRONTEND_URL}/missing.js")
    assert response.status == HTTPStatus.NOT_FOUND


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
