"""Where the house is kept.

One document for the house (its settings and the list of floors) and one per
floor, each in its own file under .storage so that a card showing one room
loads one floor. Home Assistant backs these files up with everything else.

Every document carries a revision that goes up by one with each save. A save
has to say which revision it was based on, so two people editing at once
cannot silently overwrite each other.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
import voluptuous as vol

from .const import DOMAIN
from .schema import (
    EXPORT_VERSION,
    SCHEMA_VERSION,
    describe,
    empty_floor,
    validate_export,
    validate_floor,
    validate_house,
)

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
HOUSE_KEY = f"{DOMAIN}.house"

type Listener = Callable[[dict[str, Any]], None]


class RevisionConflict(HomeAssistantError):
    """The save was based on a revision that is no longer the latest."""

    def __init__(self, what: str, current: int) -> None:
        super().__init__(
            f"{what} has changed since it was loaded (it is now at revision {current})"
        )
        self.current = current


class FloorNotFound(HomeAssistantError):
    """There is no floor with this id in the house."""

    def __init__(self, floor_id: str) -> None:
        super().__init__(f"There is no floor '{floor_id}'")


class StoredDataInvalid(HomeAssistantError):
    """A stored document does not pass validation, so it is not handed out."""


def floor_key(floor_id: str) -> str:
    """Return the storage key of a floor."""
    return f"{DOMAIN}.floor.{floor_id}"


class DioramaStore:
    """Loads, checks and saves the house and its floors."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._house_store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, HOUSE_KEY
        )
        self._house: dict[str, Any] = _stamp(validate_house({}), 0)
        self._floors: dict[str, dict[str, Any]] = {}
        self._listeners: list[Listener] = []
        # Saves read, check and then write, with awaits in between.
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Read the house. Floors are read when they are first asked for."""
        stored = await self._house_store.async_load()
        if stored is None:
            return
        try:
            self._house = _stamp(validate_house(stored), _revision(stored))
        except vol.Invalid as err:
            raise StoredDataInvalid(
                f"The stored house is not valid ({describe(err)}). "
                f"Restore .storage/{HOUSE_KEY} from a backup"
            ) from err

    @property
    def house(self) -> dict[str, Any]:
        """The house document: settings, floor list, revision."""
        return self._house

    @callback
    def async_subscribe(self, listener: Listener) -> CALLBACK_TYPE:
        """Call listener with a small event whenever something is saved."""
        self._listeners.append(listener)

        @callback
        def unsubscribe() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsubscribe

    async def async_get_floor(self, floor_id: str) -> dict[str, Any]:
        """Return one floor of the house."""
        self._require_floor(floor_id)
        if floor_id not in self._floors:
            self._floors[floor_id] = await self._async_read_floor(floor_id)
        return self._floors[floor_id]

    async def async_save_house(self, data: Any, revision: int) -> dict[str, Any]:
        """Replace the settings and the floor list.

        The list can rename, reorder and add floors. Leaving one out is refused:
        deleting a floor deletes everything drawn on it, so that has its own
        call.
        """
        house = validate_house(data)
        async with self._lock:
            if revision != self._house["revision"]:
                raise RevisionConflict("The house", self._house["revision"])
            new_ids = {meta["id"] for meta in house["floors"]}
            for meta in self._house["floors"]:
                if meta["id"] not in new_ids:
                    raise vol.Invalid(
                        f"floor '{meta['id']}' is missing; delete a floor with "
                        "diorama/floor/delete",
                        path=["floors"],
                    )
            await self._async_write_house(house, revision + 1)
        self._notify({"type": "house", "revision": self._house["revision"]})
        return self._house

    async def async_save_floor(
        self, floor_id: str, data: Any, revision: int
    ) -> dict[str, Any]:
        """Replace everything on one floor."""
        floor = validate_floor(data)
        if floor["id"] != floor_id:
            raise vol.Invalid(
                f"this document is for floor '{floor['id']}'", path=["id"]
            )
        async with self._lock:
            current = await self.async_get_floor(floor_id)
            if revision != current["revision"]:
                raise RevisionConflict("The floor", current["revision"])
            await self._async_write_floor(floor, revision + 1)
        self._notify({"type": "floor", "floor_id": floor_id, "revision": revision + 1})
        return self._floors[floor_id]

    async def async_delete_floor(self, floor_id: str) -> dict[str, Any]:
        """Take a floor out of the house and delete what was drawn on it."""
        async with self._lock:
            self._require_floor(floor_id)
            house = {
                "settings": self._house["settings"],
                "floors": [m for m in self._house["floors"] if m["id"] != floor_id],
            }
            await self._async_write_house(house, self._house["revision"] + 1)
            await self._floor_store(floor_id).async_remove()
            self._floors.pop(floor_id, None)
        self._notify({"type": "floor_deleted", "floor_id": floor_id})
        self._notify({"type": "house", "revision": self._house["revision"]})
        return self._house

    async def async_export(self) -> dict[str, Any]:
        """Return the whole house as one document."""
        floors = {
            meta["id"]: await self.async_get_floor(meta["id"])
            for meta in self._house["floors"]
        }
        return {
            "diorama_export": EXPORT_VERSION,
            "house": self._house,
            "floors": floors,
        }

    async def async_import(self, data: Any) -> dict[str, Any]:
        """Replace the whole house with an exported one."""
        house, floors = validate_export(data)
        async with self._lock:
            # Above every revision anyone can be holding, so nothing saved
            # from before the import can land on top of it.
            revisions = [self._house["revision"]]
            for meta in self._house["floors"]:
                try:
                    revisions.append(
                        (await self.async_get_floor(meta["id"]))["revision"]
                    )
                except StoredDataInvalid:
                    # An import is how a broken floor gets replaced.
                    continue
            revision = max(revisions) + 1
            for meta in self._house["floors"]:
                if meta["id"] not in floors:
                    await self._floor_store(meta["id"]).async_remove()
            self._floors.clear()
            await self._async_write_house(house, revision)
            for floor in floors.values():
                await self._async_write_floor(floor, revision)
        self._notify({"type": "reset", "revision": revision})
        return self._house

    def _require_floor(self, floor_id: str) -> None:
        if not any(meta["id"] == floor_id for meta in self._house["floors"]):
            raise FloorNotFound(floor_id)

    def _floor_store(self, floor_id: str) -> Store[dict[str, Any]]:
        return Store(self._hass, STORAGE_VERSION, floor_key(floor_id))

    async def _async_read_floor(self, floor_id: str) -> dict[str, Any]:
        stored = await self._floor_store(floor_id).async_load()
        if stored is None:
            # Listed in the house but never saved: nothing on it yet.
            return _stamp(empty_floor(floor_id), 0)
        try:
            floor = validate_floor(stored)
            if floor["id"] != floor_id:
                raise vol.Invalid(f"it says it is floor '{floor['id']}'", path=["id"])
        except vol.Invalid as err:
            raise StoredDataInvalid(
                f"The stored floor '{floor_id}' is not valid ({describe(err)}). "
                f"Restore .storage/{floor_key(floor_id)} from a backup"
            ) from err
        return _stamp(floor, _revision(stored))

    async def _async_write_house(self, house: dict[str, Any], revision: int) -> None:
        document = _stamp(house, revision)
        await self._house_store.async_save(document)
        self._house = document

    async def _async_write_floor(self, floor: dict[str, Any], revision: int) -> None:
        document = _stamp(floor, revision)
        await self._floor_store(floor["id"]).async_save(document)
        self._floors[floor["id"]] = document

    @callback
    def _notify(self, event: dict[str, Any]) -> None:
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception:
                _LOGGER.exception("A Diorama listener failed")


def _stamp(document: dict[str, Any], revision: int) -> dict[str, Any]:
    """Return a validated document with the two keys the store owns."""
    return {"schema_version": SCHEMA_VERSION, "revision": revision, **document}


def _revision(stored: dict[str, Any]) -> int:
    revision = stored.get("revision", 0)
    return revision if isinstance(revision, int) and revision >= 0 else 0
