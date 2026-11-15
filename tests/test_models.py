"""Uploading, listing, serving and removing people's own models."""

from http import HTTPStatus
import json
from pathlib import Path
import struct

from homeassistant.core import HomeAssistant
import pytest

from custom_components.diorama.models import (
    find_model_file,
    is_glb,
    model_folder,
)

DETAILS = {"name": " Piano ", "width": "1.5", "depth": "0.6", "height": "1.2"}


def glb(document: dict | None = None) -> bytes:
    """A small but well-formed binary glTF file."""
    text = json.dumps(document or {"asset": {"version": "2.0"}}).encode()
    text += b" " * (-len(text) % 4)
    chunk = struct.pack("<I4s", len(text), b"JSON") + text
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunk)) + chunk


@pytest.fixture
async def setup(hass: HomeAssistant, config_entry, built_frontend, tmp_path: Path):
    """Diorama set up, with uploads going to a temporary folder."""
    hass.config.config_dir = str(tmp_path)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()


def test_is_glb_goes_by_the_bytes() -> None:
    good = glb()
    assert is_glb(good)
    assert not is_glb(b"")
    assert not is_glb(b"glTF")
    assert not is_glb(good[:-1])  # the length it states is not its length
    assert not is_glb(good + b"\x00")
    assert not is_glb(b"GLTF" + good[4:])
    assert not is_glb(good[:4] + struct.pack("<I", 1) + good[8:])  # glTF 1
    assert not is_glb(good[:16] + b"BIN\x00" + good[20:])
    assert not is_glb(b'{"asset": {"version": "2.0"}}')


async def catalogue(hass_ws_client, hass: HomeAssistant) -> dict:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "diorama/catalogue/get"})
    return (await client.receive_json())["result"]["catalogue"]


async def test_upload_list_serve_and_delete(
    hass: HomeAssistant, setup, hass_client, hass_ws_client
) -> None:
    client = await hass_client()
    before = await catalogue(hass_ws_client, hass)
    assert all(model["source"] != "user" for model in before["models"])
    assert all(source["id"] != "user" for source in before["sources"])

    events = await hass_ws_client(hass)
    await events.send_json_auto_id({"type": "diorama/subscribe"})
    assert (await events.receive_json())["success"]

    body = glb()
    response = await client.post("/api/diorama/models", data=body, params=DETAILS)
    assert response.status == HTTPStatus.OK
    model = (await response.json())["model"]
    file_id = model["id"].removeprefix("user/")
    assert model == {
        "id": f"user/{file_id}",
        "name": "Piano",
        "category": "My models",
        "tags": [],
        "source": "user",
        "file": "",
        "url": f"/api/diorama/models/{file_id}",
        "width": 1.5,
        "depth": 0.6,
        "height": 1.2,
        "centre": [0.0, 0.0],
        "against_wall": False,
    }
    assert len(file_id) == 18
    assert (model_folder(hass) / f"{file_id}.glb").read_bytes() == body
    assert (await events.receive_json())["event"] == {"type": "catalogue"}

    after = await catalogue(hass_ws_client, hass)
    assert after["models"][: len(before["models"])] == before["models"]
    assert after["models"][-1] == model
    assert after["sources"][-1]["id"] == "user"
    assert after["base_url"] == before["base_url"]

    served = await client.get(model["url"])
    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"] == "model/gltf-binary"
    assert await served.read() == body

    deleted = await client.delete(model["url"])
    assert deleted.status == HTTPStatus.OK
    assert (await events.receive_json())["event"] == {"type": "catalogue"}
    assert not (model_folder(hass) / f"{file_id}.glb").exists()
    assert (await client.get(model["url"])).status == HTTPStatus.NOT_FOUND
    assert (await client.delete(model["url"])).status == HTTPStatus.NOT_FOUND
    assert await catalogue(hass_ws_client, hass) == before


async def test_models_are_still_there_after_a_restart(
    hass: HomeAssistant, setup, config_entry, hass_client, hass_ws_client
) -> None:
    client = await hass_client()
    params = {**DETAILS, "against_wall": "true"}
    response = await client.post("/api/diorama/models", data=glb(), params=params)
    model = (await response.json())["model"]
    assert model["against_wall"] is True

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert (await catalogue(hass_ws_client, hass))["models"][-1] == model


@pytest.mark.parametrize(
    ("body", "params", "status"),
    [
        (b"not a model", DETAILS, HTTPStatus.UNSUPPORTED_MEDIA_TYPE),
        (b"", DETAILS, HTTPStatus.UNSUPPORTED_MEDIA_TYPE),
        (
            glb() + b"\x00" * (10 * 1024 * 1024),
            DETAILS,
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        ),
        (glb(), {}, HTTPStatus.BAD_REQUEST),
        (glb(), {**DETAILS, "name": "  "}, HTTPStatus.BAD_REQUEST),
        (glb(), {**DETAILS, "name": "x" * 61}, HTTPStatus.BAD_REQUEST),
        (glb(), {**DETAILS, "width": "0"}, HTTPStatus.BAD_REQUEST),
        (glb(), {**DETAILS, "height": "31"}, HTTPStatus.BAD_REQUEST),
        (glb(), {**DETAILS, "depth": "wide"}, HTTPStatus.BAD_REQUEST),
        (glb(), {**DETAILS, "path": "../../secrets"}, HTTPStatus.BAD_REQUEST),
    ],
)
async def test_bad_uploads_are_refused(
    hass: HomeAssistant,
    setup,
    hass_client,
    hass_ws_client,
    body: bytes,
    params: dict,
    status: HTTPStatus,
) -> None:
    client = await hass_client()
    response = await client.post("/api/diorama/models", data=body, params=params)
    assert response.status == status
    folder = model_folder(hass)
    assert not folder.exists() or list(folder.iterdir()) == []
    models = (await catalogue(hass_ws_client, hass))["models"]
    assert all(model["source"] != "user" for model in models)


async def test_there_is_a_limit_to_how_many(
    hass: HomeAssistant, setup, hass_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("custom_components.diorama.models.MODEL_LIMIT", 2)
    client = await hass_client()
    for _ in range(2):
        response = await client.post("/api/diorama/models", data=glb(), params=DETAILS)
        assert response.status == HTTPStatus.OK
    response = await client.post("/api/diorama/models", data=glb(), params=DETAILS)
    assert response.status == HTTPStatus.CONFLICT
    assert len(list(model_folder(hass).iterdir())) == 2


async def test_models_need_a_signed_in_user(
    hass: HomeAssistant, setup, hass_client, hass_client_no_auth
) -> None:
    response = await (await hass_client()).post(
        "/api/diorama/models", data=glb(), params=DETAILS
    )
    url = (await response.json())["model"]["url"]
    anonymous = await hass_client_no_auth()
    assert (await anonymous.get(url)).status == HTTPStatus.UNAUTHORIZED
    assert (await anonymous.delete(url)).status == HTTPStatus.UNAUTHORIZED
    assert (
        await anonymous.post("/api/diorama/models", data=glb(), params=DETAILS)
    ).status == HTTPStatus.UNAUTHORIZED


async def test_only_admins_add_and_remove_but_anyone_signed_in_can_load(
    hass: HomeAssistant, setup, hass_client, hass_admin_user
) -> None:
    client = await hass_client()
    response = await client.post("/api/diorama/models", data=glb(), params=DETAILS)
    url = (await response.json())["model"]["url"]

    hass_admin_user.groups = []
    assert (
        await client.post("/api/diorama/models", data=glb(), params=DETAILS)
    ).status == HTTPStatus.UNAUTHORIZED
    assert (await client.delete(url)).status == HTTPStatus.UNAUTHORIZED
    assert (await client.get(url)).status == HTTPStatus.OK


@pytest.mark.parametrize(
    "model_id", ["nope", "m_123", "m_" + "g" * 16, "m_0123456789abcdef.glb"]
)
async def test_odd_ids_find_nothing(
    hass: HomeAssistant, setup, hass_client, model_id: str
) -> None:
    client = await hass_client()
    assert (
        await client.get(f"/api/diorama/models/{model_id}")
    ).status == HTTPStatus.NOT_FOUND
    assert (
        await client.delete(f"/api/diorama/models/{model_id}")
    ).status == HTTPStatus.NOT_FOUND


def test_find_model_file_never_leaves_its_folder(tmp_path: Path) -> None:
    (tmp_path / "secret.glb").write_bytes(glb())
    folder = tmp_path / "models"
    folder.mkdir()
    assert find_model_file(folder, "../secret") is None
    assert find_model_file(folder, "m_0123456789abcdef") is None
    (folder / "m_0123456789abcdef.glb").write_bytes(glb())
    assert find_model_file(folder, "m_0123456789abcdef") == (
        folder / "m_0123456789abcdef.glb"
    )


async def test_a_spoiled_list_does_not_stop_diorama_loading(
    hass: HomeAssistant, config_entry, built_frontend, hass_storage, hass_ws_client
) -> None:
    good = {
        "id": "m_0123456789abcdef",
        "name": "Piano",
        "width": 1.5,
        "depth": 0.6,
        "height": 1.2,
        "against_wall": False,
    }
    hass_storage["diorama.models"] = {
        "version": 1,
        "key": "diorama.models",
        "data": {"models": [good, {"id": "../etc", "name": "x"}, "nonsense"]},
    }
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    added = [
        model
        for model in (await catalogue(hass_ws_client, hass))["models"]
        if model["source"] == "user"
    ]
    assert [model["id"] for model in added] == ["user/m_0123456789abcdef"]


async def test_a_model_can_be_said_to_be_a_light(
    hass: HomeAssistant, setup, hass_client, hass_ws_client
) -> None:
    client = await hass_client()
    lamp = await client.post(
        "/api/diorama/models", data=glb(), params={**DETAILS, "kind": "light"}
    )
    assert (await lamp.json())["model"]["kind"] == "light"
    # Said to be nothing in particular, or not said: plain furniture.
    for params in (DETAILS, {**DETAILS, "kind": ""}):
        plain = await client.post("/api/diorama/models", data=glb(), params=params)
        assert plain.status == HTTPStatus.OK
        assert "kind" not in (await plain.json())["model"]
    odd = await client.post(
        "/api/diorama/models", data=glb(), params={**DETAILS, "kind": "lock"}
    )
    assert odd.status == HTTPStatus.BAD_REQUEST
    models = (await catalogue(hass_ws_client, hass))["models"]
    assert [m.get("kind") for m in models if m["source"] == "user"] == [
        "light",
        None,
        None,
    ]
