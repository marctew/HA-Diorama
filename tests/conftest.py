"""Fixtures for the Diorama tests."""

from pathlib import Path

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.diorama.const import CARD_FILE, DOMAIN, PANEL_FILE


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load the integration from custom_components."""
    return


@pytest.fixture
def built_frontend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Stand in for a built frontend, so tests do not need npm."""
    (tmp_path / PANEL_FILE).write_text("// panel")
    (tmp_path / CARD_FILE).write_text("// card")
    monkeypatch.setattr("custom_components.diorama.FRONTEND_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def config_entry() -> MockConfigEntry:
    """A Diorama config entry that is not added yet."""
    return MockConfigEntry(domain=DOMAIN, title="Diorama", data={})
