"""Uploading, serving and removing the plan images people trace over."""

from http import HTTPStatus
from pathlib import Path

from homeassistant.core import HomeAssistant
import pytest

from custom_components.diorama.http import find_trace, image_type, trace_folder

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture
async def setup(hass: HomeAssistant, config_entry, built_frontend, tmp_path: Path):
    """Diorama set up, with uploads going to a temporary folder."""
    hass.config.config_dir = str(tmp_path)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()


def test_image_type_goes_by_the_bytes() -> None:
    assert image_type(PNG) == ("png", "image/png")
    assert image_type(JPEG) == ("jpg", "image/jpeg")
    assert image_type(WEBP) == ("webp", "image/webp")
    assert image_type(b"RIFF\x24\x00\x00\x00WAVEfmt ") is None
    assert image_type(b"<svg xmlns='http://www.w3.org/2000/svg'/>") is None
    assert image_type(b"") is None


async def test_upload_serve_and_delete(hass: HomeAssistant, setup, hass_client) -> None:
    client = await hass_client()

    response = await client.post("/api/diorama/trace", data=PNG)
    assert response.status == HTTPStatus.OK
    trace_id = (await response.json())["id"]
    assert trace_id.startswith("t_")
    assert len(trace_id) == 18
    assert (trace_folder(hass) / f"{trace_id}.png").read_bytes() == PNG

    served = await client.get(f"/api/diorama/trace/{trace_id}")
    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"] == "image/png"
    assert await served.read() == PNG

    deleted = await client.delete(f"/api/diorama/trace/{trace_id}")
    assert deleted.status == HTTPStatus.OK
    assert not (trace_folder(hass) / f"{trace_id}.png").exists()
    assert (
        await client.get(f"/api/diorama/trace/{trace_id}")
    ).status == HTTPStatus.NOT_FOUND
    assert (await client.delete(f"/api/diorama/trace/{trace_id}")).status == (
        HTTPStatus.NOT_FOUND
    )


@pytest.mark.parametrize(
    ("body", "status"),
    [
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>",
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
        ),
        (b"GIF89a" + b"\x00" * 32, HTTPStatus.UNSUPPORTED_MEDIA_TYPE),
        (b"", HTTPStatus.UNSUPPORTED_MEDIA_TYPE),
        (PNG + b"\x00" * (10 * 1024 * 1024), HTTPStatus.REQUEST_ENTITY_TOO_LARGE),
    ],
)
async def test_bad_uploads_are_refused(
    hass: HomeAssistant, setup, hass_client, body: bytes, status: HTTPStatus
) -> None:
    client = await hass_client()
    response = await client.post("/api/diorama/trace", data=body)
    assert response.status == status
    folder = trace_folder(hass)
    assert not folder.exists() or list(folder.iterdir()) == []


async def test_images_need_a_signed_in_user(
    hass: HomeAssistant, setup, hass_client, hass_client_no_auth
) -> None:
    trace_id = (
        await (await (await hass_client()).post("/api/diorama/trace", data=JPEG)).json()
    )["id"]
    anonymous = await hass_client_no_auth()
    assert (
        await anonymous.get(f"/api/diorama/trace/{trace_id}")
    ).status == HTTPStatus.UNAUTHORIZED
    assert (
        await anonymous.post("/api/diorama/trace", data=PNG)
    ).status == HTTPStatus.UNAUTHORIZED
    assert (await anonymous.delete(f"/api/diorama/trace/{trace_id}")).status == (
        HTTPStatus.UNAUTHORIZED
    )


async def test_only_admins_upload_and_delete_but_anyone_signed_in_can_look(
    hass: HomeAssistant, setup, hass_client, hass_admin_user
) -> None:
    admin = await hass_client()
    trace_id = (await (await admin.post("/api/diorama/trace", data=WEBP)).json())["id"]

    hass_admin_user.groups = []
    assert (
        await admin.post("/api/diorama/trace", data=PNG)
    ).status == HTTPStatus.UNAUTHORIZED
    assert (await admin.delete(f"/api/diorama/trace/{trace_id}")).status == (
        HTTPStatus.UNAUTHORIZED
    )
    served = await admin.get(f"/api/diorama/trace/{trace_id}")
    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"] == "image/webp"


@pytest.mark.parametrize(
    "trace_id",
    ["nope", "t_123", "t_" + "g" * 16, "..%2F..%2Fsecrets", "t_0123456789abcdef.png"],
)
async def test_odd_ids_find_nothing(
    hass: HomeAssistant, setup, hass_client, trace_id: str
) -> None:
    client = await hass_client()
    # Home Assistant turns a path traversal away itself, before it gets here.
    response = await client.get(f"/api/diorama/trace/{trace_id}")
    assert response.status in (HTTPStatus.NOT_FOUND, HTTPStatus.BAD_REQUEST)


def test_find_trace_never_leaves_its_folder(tmp_path: Path) -> None:
    (tmp_path / "secret.png").write_bytes(PNG)
    folder = tmp_path / "trace"
    folder.mkdir()
    assert find_trace(folder, "../secret") is None
    assert find_trace(folder, "t_0123456789abcdef") is None
    (folder / "t_0123456789abcdef.jpg").write_bytes(JPEG)
    assert find_trace(folder, "t_0123456789abcdef") == (
        folder / "t_0123456789abcdef.jpg",
        "image/jpeg",
    )
