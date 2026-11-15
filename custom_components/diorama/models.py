"""The models people add themselves: "My models".

Each is a .glb file kept under the configuration folder (an update replaces
the integration's own folder) and an entry saying what it is called and how
big it is. The browser prepares the file before sending it: one mesh, real
size, standing on the floor, like the bundled models.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import re
import secrets
import struct
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
import voluptuous as vol

from .const import MODEL_FOLDER, MODEL_LIMIT, MODELS_KEY, USER_SOURCE

MODEL_FILE_ID = re.compile(r"^m_[0-9a-f]{16}$")
STORAGE_VERSION = 1

# What a .glb file starts with: "glTF", the version, the length of the file.
GLB_HEADER = struct.Struct("<4sII")
GLB_JSON_CHUNK = b"JSON"

_SIZE = vol.All(vol.Coerce(float), vol.Range(min=0.01, max=30))
MODEL_KINDS = ("light", "switch", "media")

MODEL_DETAILS = vol.Schema(
    {
        vol.Required("name"): vol.All(str, vol.Strip, vol.Length(min=1, max=60)),
        vol.Required("width"): _SIZE,
        vol.Required("depth"): _SIZE,
        vol.Required("height"): _SIZE,
        vol.Optional("against_wall", default=False): vol.Boolean(),
        # What it is, if it is something a device can be: a light dropped on
        # it then becomes it. Nothing, or empty, for plain furniture.
        vol.Optional("kind", default=None): vol.Any(
            None, vol.All("", lambda _: None), vol.In(MODEL_KINDS)
        ),
    }
)

STORED_MODEL = MODEL_DETAILS.extend(
    {vol.Required("id"): vol.Match(MODEL_FILE_ID)}, extra=vol.REMOVE_EXTRA
)


class TooManyModels(Exception):
    """There is no room for another model."""


def is_glb(data: bytes) -> bool:
    """Whether these bytes are a whole binary glTF 2 file."""
    if len(data) < GLB_HEADER.size + 8:
        return False
    magic, version, length = GLB_HEADER.unpack_from(data)
    if magic != b"glTF" or version != 2 or length != len(data):
        return False
    return data[GLB_HEADER.size + 4 : GLB_HEADER.size + 8] == GLB_JSON_CHUNK


def model_folder(hass: HomeAssistant) -> Path:
    """Return the folder uploaded models are kept in."""
    return Path(hass.config.path(MODEL_FOLDER))


def find_model_file(folder: Path, file_id: str) -> Path | None:
    """Return the file of an uploaded model, if it exists."""
    if not MODEL_FILE_ID.match(file_id):
        return None
    path = folder / f"{file_id}.glb"
    return path if path.is_file() else None


def catalogue_entry(model: dict[str, Any]) -> dict[str, Any]:
    """Describe an uploaded model the way the catalogue describes its own."""
    return {
        "id": f"{USER_SOURCE}/{model['id']}",
        "name": model["name"],
        "category": "My models",
        "tags": [],
        "source": USER_SOURCE,
        "file": "",
        # Not under the catalogue's public folder: fetched signed in.
        "url": f"/api/diorama/models/{model['id']}",
        "width": model["width"],
        "depth": model["depth"],
        "height": model["height"],
        "centre": [0.0, 0.0],
        "against_wall": model["against_wall"],
        **({"kind": model["kind"]} if model.get("kind") else {}),
    }


def _write(folder: Path, name: str, data: bytes) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)


class ModelLibrary:
    """Keeps the uploaded models and the list of them."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, MODELS_KEY)
        self._models: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Read the list. An entry that makes no sense is left out, not fatal."""
        stored = await self._store.async_load()
        models = []
        for entry in (stored or {}).get("models", []):
            try:
                models.append(STORED_MODEL(entry))
            except vol.Invalid:
                continue
        self._models = models

    @property
    def models(self) -> list[dict[str, Any]]:
        """The uploaded models, oldest first."""
        return self._models

    def catalogue_models(self) -> list[dict[str, Any]]:
        """The uploaded models as catalogue entries."""
        return [catalogue_entry(model) for model in self._models]

    async def async_add(self, data: bytes, details: Any) -> dict[str, Any]:
        """Keep a model. Raises vol.Invalid if the details are not valid."""
        checked = MODEL_DETAILS(details)
        async with self._lock:
            if len(self._models) >= MODEL_LIMIT:
                raise TooManyModels
            # The name is ours: nothing from the upload is used as a path.
            model = {"id": f"m_{secrets.token_hex(8)}", **checked}
            await self._hass.async_add_executor_job(
                _write, model_folder(self._hass), f"{model['id']}.glb", data
            )
            self._models = [*self._models, model]
            await self._store.async_save({"models": self._models})
        return model

    async def async_delete(self, file_id: str) -> bool:
        """Remove a model and its file. False if there is no such model."""
        async with self._lock:
            if not any(model["id"] == file_id for model in self._models):
                return False
            self._models = [m for m in self._models if m["id"] != file_id]
            await self._store.async_save({"models": self._models})
            path = await self._hass.async_add_executor_job(
                find_model_file, model_folder(self._hass), file_id
            )
            if path is not None:
                await self._hass.async_add_executor_job(path.unlink)
        return True
