"""The commands the Diorama panel and card use to read and change the house.

Anyone signed in can read; only administrators can change anything. Entity
state and service calls do not come through here: the frontend already has
those from Home Assistant.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
import voluptuous as vol

from .const import DOMAIN
from .schema import ID, describe
from .store import DioramaStore, FloorNotFound, RevisionConflict, StoredDataInvalid

ERR_CONFLICT = "conflict"
ERR_INVALID_STORED_DATA = "invalid_stored_data"

REVISION = vol.All(int, vol.Range(min=0))

type Handler = Callable[
    [HomeAssistant, websocket_api.ActiveConnection, dict[str, Any], DioramaStore],
    Awaitable[None],
]


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register every Diorama command."""
    for command in (
        ws_house_get,
        ws_house_save,
        ws_floor_get,
        ws_floor_save,
        ws_floor_delete,
        ws_subscribe,
        ws_export,
        ws_import,
    ):
        websocket_api.async_register_command(hass, command)


@callback
def _get_store(hass: HomeAssistant) -> DioramaStore | None:
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data.store
    return None


def _with_store(handler: Handler) -> websocket_api.AsyncWebSocketCommandHandler:
    """Give a handler the store, and turn the store's errors into replies."""

    @wraps(handler)
    async def wrapper(
        hass: HomeAssistant,
        connection: websocket_api.ActiveConnection,
        msg: dict[str, Any],
    ) -> None:
        store = _get_store(hass)
        if store is None:
            connection.send_error(
                msg["id"], websocket_api.ERR_NOT_FOUND, "Diorama is not set up"
            )
            return
        try:
            await handler(hass, connection, msg, store)
        except vol.Invalid as err:
            connection.send_error(
                msg["id"], websocket_api.ERR_INVALID_FORMAT, describe(err)
            )
        except RevisionConflict as err:
            connection.send_error(msg["id"], ERR_CONFLICT, str(err))
        except FloorNotFound as err:
            connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, str(err))
        except StoredDataInvalid as err:
            connection.send_error(msg["id"], ERR_INVALID_STORED_DATA, str(err))

    return wrapper


@websocket_api.websocket_command({vol.Required("type"): "diorama/house/get"})
@websocket_api.async_response
@_with_store
async def ws_house_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Return the house: its settings, floor list and revision."""
    connection.send_result(msg["id"], {"house": store.house})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "diorama/house/save",
        vol.Required("revision"): REVISION,
        vol.Required("house"): dict,
    }
)
@websocket_api.async_response
@_with_store
async def ws_house_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Save the settings and the floor list."""
    house = await store.async_save_house(msg["house"], msg["revision"])
    connection.send_result(msg["id"], {"house": house})


@websocket_api.websocket_command(
    {vol.Required("type"): "diorama/floor/get", vol.Required("floor_id"): ID}
)
@websocket_api.async_response
@_with_store
async def ws_floor_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Return everything on one floor."""
    floor = await store.async_get_floor(msg["floor_id"])
    connection.send_result(msg["id"], {"floor": floor})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "diorama/floor/save",
        vol.Required("floor_id"): ID,
        vol.Required("revision"): REVISION,
        vol.Required("floor"): dict,
    }
)
@websocket_api.async_response
@_with_store
async def ws_floor_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Save everything on one floor."""
    floor = await store.async_save_floor(msg["floor_id"], msg["floor"], msg["revision"])
    connection.send_result(msg["id"], {"floor": floor})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "diorama/floor/delete", vol.Required("floor_id"): ID}
)
@websocket_api.async_response
@_with_store
async def ws_floor_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Delete a floor and everything on it."""
    house = await store.async_delete_floor(msg["floor_id"])
    connection.send_result(msg["id"], {"house": house})


@websocket_api.websocket_command({vol.Required("type"): "diorama/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Tell the client whenever the house or a floor is saved."""
    store = _get_store(hass)
    if store is None:
        connection.send_error(
            msg["id"], websocket_api.ERR_NOT_FOUND, "Diorama is not set up"
        )
        return

    @callback
    def forward(event: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], event))

    connection.subscriptions[msg["id"]] = store.async_subscribe(forward)
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "diorama/export"})
@websocket_api.async_response
@_with_store
async def ws_export(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Return the whole house as one document."""
    connection.send_result(msg["id"], {"export": await store.async_export()})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "diorama/import", vol.Required("data"): dict}
)
@websocket_api.async_response
@_with_store
async def ws_import(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    store: DioramaStore,
) -> None:
    """Replace the whole house with an exported one."""
    house = await store.async_import(msg["data"])
    connection.send_result(msg["id"], {"house": house})
