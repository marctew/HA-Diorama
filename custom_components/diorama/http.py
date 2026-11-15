"""Uploads: the plan images people trace over.

These are a user's own files, so unlike the bundled furniture they are not
served from a public folder: every request has to be signed in, and only
administrators can add or remove them.
"""

from __future__ import annotations

from pathlib import Path
import re
import secrets

from aiohttp import web
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .const import TRACE_FOLDER, TRACE_MAX_BYTES

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
        if (request.content_length or 0) > TRACE_MAX_BYTES:
            return self.json_message("The image is too large.", 413)
        data = await request.content.read(TRACE_MAX_BYTES + 1)
        while len(data) <= TRACE_MAX_BYTES and not request.content.at_eof():
            data += await request.content.read(TRACE_MAX_BYTES + 1 - len(data))
        if len(data) > TRACE_MAX_BYTES:
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


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the upload endpoints. Call once per run of Home Assistant."""
    hass.http.register_view(TraceUploadView())
    hass.http.register_view(TraceView())
