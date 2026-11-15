"""Uploads: the plan images people trace over, and their own models.

These are a user's own files, so unlike the bundled furniture they are not
served from a public folder: every request has to be signed in, and only
administrators can add or remove them.
"""

from __future__ import annotations

from pathlib import Path
import re
import secrets

from aiohttp import web
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
import voluptuous as vol

from .const import DOMAIN, MODEL_MAX_BYTES, TRACE_FOLDER, TRACE_MAX_BYTES
from .models import (
    TooManyModels,
    catalogue_entry,
    find_model_file,
    is_glb,
    model_folder,
)

TRACE_ID = re.compile(r"^t_[0-9a-f]{16}$")

# How each accepted kind of image starts, and what it is served as.
IMAGE_TYPES: tuple[tuple[str, str, bytes], ...] = (
    ("png", "image/png", b"\x89PNG\r\n\x1a\n"),
    ("jpg", "image/jpeg", b"\xff\xd8\xff"),
    ("webp", "image/webp", b"RIFF"),
)


def image_type(data: bytes) -> tuple[str, str] | None:
    """Return the extension and content type of an image, going by its bytes."""
    for extension, content_type, start in IMAGE_TYPES:
        if not data.startswith(start):
            continue
        if extension == "webp" and data[8:12] != b"WEBP":
            continue
        return extension, content_type
    return None


def trace_folder(hass: HomeAssistant) -> Path:
    """Return the folder uploaded plan images are kept in."""
    return Path(hass.config.path(TRACE_FOLDER))


def find_trace(folder: Path, trace_id: str) -> tuple[Path, str] | None:
    """Return the file of an uploaded image and its content type, if it exists."""
    if not TRACE_ID.match(trace_id):
        return None
    for extension, content_type, _ in IMAGE_TYPES:
        path = folder / f"{trace_id}.{extension}"
        if path.is_file():
            return path, content_type
    return None


def _write(folder: Path, name: str, data: bytes) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)


class TraceUploadView(HomeAssistantView):
    """Take a plan image and keep it under a new id."""

    url = "/api/diorama/trace"
    name = "api:diorama:trace"

    async def post(self, request: web.Request) -> web.Response:
        """Store the image in the body of the request."""
        hass = request.app[KEY_HASS]
        if not request["hass_user"].is_admin:
            raise Unauthorized
        data = await _read_body(request, TRACE_MAX_BYTES)
        if data is None:
            return self.json_message("The image is too large.", 413)
        kind = image_type(data)
        if kind is None:
            return self.json_message("Only PNG, JPEG and WebP images can be used.", 415)
        # The name is ours: nothing from the upload is used as a path.
        trace_id = f"t_{secrets.token_hex(8)}"
        await hass.async_add_executor_job(
            _write, trace_folder(hass), f"{trace_id}.{kind[0]}", data
        )
        return self.json({"id": trace_id})


class TraceView(HomeAssistantView):
    """Serve or remove one uploaded plan image."""

    url = "/api/diorama/trace/{trace_id}"
    name = "api:diorama:trace:image"

    async def get(self, request: web.Request, trace_id: str) -> web.StreamResponse:
        """Return the image to anyone who is signed in."""
        hass = request.app[KEY_HASS]
        found = await hass.async_add_executor_job(
            find_trace, trace_folder(hass), trace_id
        )
        if found is None:
            return self.json_message("There is no such image.", 404)
        path, content_type = found
        return web.FileResponse(
            path,
            headers={
                "Content-Type": content_type,
                "Cache-Control": "private, max-age=3600",
            },
        )

    async def delete(self, request: web.Request, trace_id: str) -> web.Response:
        """Remove the image."""
        hass = request.app[KEY_HASS]
        if not request["hass_user"].is_admin:
            raise Unauthorized
        found = await hass.async_add_executor_job(
            find_trace, trace_folder(hass), trace_id
        )
        if found is None:
            return self.json_message("There is no such image.", 404)
        await hass.async_add_executor_job(found[0].unlink)
        return self.json({"deleted": trace_id})


class ModelUploadView(HomeAssistantView):
    """Take a model and keep it under a new id."""

    url = "/api/diorama/models"
    name = "api:diorama:models"

    async def post(self, request: web.Request) -> web.Response:
        """Store the .glb in the body; what it is goes in the query string."""
        hass = request.app[KEY_HASS]
        if not request["hass_user"].is_admin:
            raise Unauthorized
        data = _loaded(hass)
        if data is None:
            return self.json_message("Diorama is not set up.", 404)
        body = await _read_body(request, MODEL_MAX_BYTES)
        if body is None:
            return self.json_message("The model is too large.", 413)
        if not is_glb(body):
            return self.json_message("Only .glb models can be used.", 415)
        try:
            model = await data.library.async_add(body, dict(request.query))
        except vol.Invalid as err:
            return self.json_message(f"The model's details are not valid: {err}", 400)
        except TooManyModels:
            return self.json_message("There is no room for another model.", 409)
        data.store.async_catalogue_changed()
        return self.json({"model": catalogue_entry(model)})


class ModelView(HomeAssistantView):
    """Serve or remove one uploaded model."""

    url = "/api/diorama/models/{model_id}"
    name = "api:diorama:models:file"

    async def get(self, request: web.Request, model_id: str) -> web.StreamResponse:
        """Return the model to anyone who is signed in."""
        hass = request.app[KEY_HASS]
        path = await hass.async_add_executor_job(
            find_model_file, model_folder(hass), model_id
        )
        if path is None:
            return self.json_message("There is no such model.", 404)
        return web.FileResponse(
            path,
            headers={
                "Content-Type": "model/gltf-binary",
                # A model never changes: a new upload gets a new id.
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        )

    async def delete(self, request: web.Request, model_id: str) -> web.Response:
        """Remove the model. Furniture made from it is left where it is."""
        hass = request.app[KEY_HASS]
        if not request["hass_user"].is_admin:
            raise Unauthorized
        data = _loaded(hass)
        if data is None or not await data.library.async_delete(model_id):
            return self.json_message("There is no such model.", 404)
        data.store.async_catalogue_changed()
        return self.json({"deleted": model_id})


async def _read_body(request: web.Request, limit: int) -> bytes | None:
    """Read the body of a request, or return None if it is over the limit."""
    if (request.content_length or 0) > limit:
        return None
    data = await request.content.read(limit + 1)
    while len(data) <= limit and not request.content.at_eof():
        data += await request.content.read(limit + 1 - len(data))
    return data if len(data) <= limit else None


def _loaded(hass: HomeAssistant):
    """Return what the loaded config entry holds, if there is one."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data
    return None


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the upload endpoints. Call once per run of Home Assistant."""
    hass.http.register_view(TraceUploadView())
    hass.http.register_view(TraceView())
    hass.http.register_view(ModelUploadView())
    hass.http.register_view(ModelView())
