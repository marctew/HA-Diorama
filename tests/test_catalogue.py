"""The bundled furniture catalogue: its files, and the command that serves it."""

from http import HTTPStatus
import json
from pathlib import Path
import struct

from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration
import pytest
import voluptuous as vol

from custom_components.diorama import assets_url
from custom_components.diorama.const import ASSETS_DIR, CATALOGUE_FILE, DOMAIN
from custom_components.diorama.schema import FIXTURE_KINDS, MODEL
from tools.build_catalogue import build

CATALOGUE = json.loads((ASSETS_DIR / CATALOGUE_FILE).read_text())
MODELS = CATALOGUE["models"]


def _read_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF"
    assert version == 2
    assert length == len(data)
    json_length, json_type = struct.unpack_from("<I4s", data, 12)
    assert json_type == b"JSON"
    document = json.loads(data[20 : 20 + json_length])
    bin_length, bin_type = struct.unpack_from("<I4s", data, 20 + json_length)
    assert bin_type == b"BIN\x00"
    binary = data[28 + json_length : 28 + json_length + bin_length]
    assert len(binary) == bin_length
    return document, binary


def test_committed_assets_are_what_the_tool_builds() -> None:
    built = build()
    on_disk = {
        path.relative_to(ASSETS_DIR).as_posix(): path.read_bytes()
        for path in ASSETS_DIR.rglob("*")
        if path.is_file()
    }
    assert sorted(on_disk) == sorted(built)
    for name, data in built.items():
        assert on_disk[name] == data, f"{name} is stale: run tools/build_catalogue.py"


def test_catalogue_is_well_formed() -> None:
    assert CATALOGUE["version"] == 1
    sources = {source["id"]: source for source in CATALOGUE["sources"]}
    ids = [model["id"] for model in MODELS]
    assert len(ids) == len(set(ids))
    assert len(MODELS) >= 30
    for model in MODELS:
        # An id an item on a floor can carry.
        assert MODEL(model["id"]) == model["id"]
        assert model["name"]
        assert model["category"]
        # Only CC0 models are bundled.
        assert sources[model["source"]]["licence"] == "CC0-1.0"
        assert (ASSETS_DIR / model["file"]).is_file()
        assert model.get("kind") in (None, *FIXTURE_KINDS)
        assert isinstance(model["against_wall"], bool)
        # Furniture, not a dolls' house and not a warehouse.
        assert 0.05 <= model["width"] <= 4
        # A strip of light and a light panel are thinner than that.
        thin = model.get("strip") or model.get("lit")
        assert (0.01 if thin else 0.05) <= model["depth"] <= 4
        assert 0.01 <= model["height"] <= 3


@pytest.mark.parametrize("model", MODELS, ids=lambda model: model["id"])
def test_model_file_is_a_valid_glb_of_the_stated_size(model) -> None:
    path = ASSETS_DIR / model["file"]
    assert path.stat().st_size < 500 * 1024
    document, binary = _read_glb(path.read_bytes())

    primitive = document["meshes"][0]["primitives"][0]
    assert set(primitive["attributes"]) == {"POSITION", "NORMAL", "COLOR_0"}
    accessors = document["accessors"]
    position = accessors[primitive["attributes"]["POSITION"]]
    count = position["count"]
    assert count % 3 == 0
    assert count > 0
    for accessor in accessors:
        assert accessor["count"] == count
        assert accessor["type"] == "VEC3"
    assert len(binary) >= count * 3 * 4 * 3

    numbers = struct.unpack_from(f"<{count * 9}f", binary, 0)
    xs, ys, zs = (
        numbers[0 : count * 3 : 3],
        numbers[1 : count * 3 : 3],
        numbers[2 : count * 3 : 3],
    )
    # Stands on the floor, and is the size the catalogue says.
    if model.get("hanging"):
        assert min(ys) > 1.5
    else:
        assert min(ys) == pytest.approx(0, abs=1e-4)
    assert max(ys) == pytest.approx(model["height"], abs=2e-3)
    assert max(xs) - min(xs) == pytest.approx(model["width"], abs=2e-3)
    assert max(zs) - min(zs) == pytest.approx(model["depth"], abs=2e-3)
    assert position["min"] == pytest.approx([min(xs), min(ys), min(zs)], abs=1e-4)
    assert position["max"] == pytest.approx([max(xs), max(ys), max(zs)], abs=1e-4)

    normals = numbers[count * 3 : count * 6]
    colours = numbers[count * 6 : count * 9]
    for i in range(0, count * 3, 3):
        length = sum(value * value for value in normals[i : i + 3]) ** 0.5
        assert length == pytest.approx(1, abs=1e-3)
    assert all(0 <= value <= 1 for value in colours)


def test_model_ids_in_schema_reject_paths() -> None:
    with pytest.raises(vol.Invalid):
        MODEL("basics/../../secrets")


async def test_catalogue_command_and_files(
    hass: HomeAssistant,
    config_entry,
    built_frontend,
    hass_ws_client,
    hass_client_no_auth,
    hass_admin_user,
) -> None:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    version = str((await async_get_integration(hass, DOMAIN)).version)

    # Anyone signed in can read it: a card needs it to draw furniture.
    hass_admin_user.groups = []
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "diorama/catalogue/get"})
    response = await client.receive_json()
    assert response["success"]
    catalogue = response["result"]["catalogue"]
    assert catalogue["base_url"] == assets_url(version) == f"/diorama_assets/{version}"
    assert [model["id"] for model in catalogue["models"]] == [m["id"] for m in MODELS]

    http = await hass_client_no_auth()
    sofa = next(m for m in catalogue["models"] if m["id"] == "basics/sofa_2")
    served = await http.get(f"{catalogue['base_url']}/{sofa['file']}")
    assert served.status == HTTPStatus.OK
    assert await served.read() == (ASSETS_DIR / sofa["file"]).read_bytes()
    assert (
        await http.get(f"{catalogue['base_url']}/models/basics/nope.glb")
    ).status == (HTTPStatus.NOT_FOUND)
    assert (await http.get(f"{catalogue['base_url']}/../manifest.json")).status in (
        HTTPStatus.NOT_FOUND,
        HTTPStatus.FORBIDDEN,
    )


async def test_missing_catalogue_is_logged_and_empty(
    hass: HomeAssistant,
    config_entry,
    built_frontend,
    hass_ws_client,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr("custom_components.diorama.ASSETS_DIR", tmp_path)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "diorama/catalogue/get"})
    response = await client.receive_json()
    assert response["result"]["catalogue"]["models"] == []
    assert "catalogue could not be read" in caplog.text
