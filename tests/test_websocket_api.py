"""The WebSocket commands, end to end through Home Assistant."""

from typing import Any

from homeassistant.core import HomeAssistant
import pytest

from custom_components.diorama.store import HOUSE_KEY, floor_key

from .common import sample_floor

GROUND = {"id": "f1", "name": "Ground"}
UPSTAIRS = {"id": "f2", "name": "Upstairs", "elevation": 2.6}


@pytest.fixture
async def setup(hass: HomeAssistant, config_entry, built_frontend) -> None:
    """Diorama, set up with an empty house."""
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()


async def _call(client, command: str, **data: Any) -> dict[str, Any]:
    await client.send_json_auto_id({"type": f"diorama/{command}", **data})
    return await client.receive_json()


async def _ok(client, command: str, **data: Any) -> dict[str, Any]:
    response = await _call(client, command, **data)
    assert response["success"], response
    return response["result"]


async def _error(client, command: str, **data: Any) -> dict[str, Any]:
    response = await _call(client, command, **data)
    assert not response["success"], response
    return response["error"]


async def _house_with_floors(client, *floors: dict[str, Any]) -> dict[str, Any]:
    house = (await _ok(client, "house/get"))["house"]
    result = await _ok(
        client,
        "house/save",
        revision=house["revision"],
        house={"floors": [*house["floors"], *floors]},
    )
    return result["house"]


async def test_new_house_is_empty(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)

    assert await _ok(client, "house/get") == {
        "house": {
            "schema_version": 1,
            "revision": 0,
            "settings": {"name": "Home"},
            "floors": [],
        }
    }


async def test_save_house_adds_renames_and_reorders_floors(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)

    house = await _house_with_floors(client, GROUND, UPSTAIRS)
    assert house["revision"] == 1
    assert [meta["id"] for meta in house["floors"]] == ["f1", "f2"]
    assert house["floors"][0] == {**GROUND, "elevation": 0, "ha_floor_id": None}

    result = await _ok(
        client,
        "house/save",
        revision=1,
        house={
            "settings": {"name": "Number 12"},
            "floors": [UPSTAIRS, {**GROUND, "name": "Downstairs", "ha_floor_id": "g"}],
        },
    )
    assert result["house"]["revision"] == 2
    assert result["house"]["settings"] == {"name": "Number 12"}
    assert [meta["name"] for meta in result["house"]["floors"]] == [
        "Upstairs",
        "Downstairs",
    ]
    assert (await _ok(client, "house/get")) == result


async def test_save_house_cannot_drop_a_floor(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND, UPSTAIRS)

    error = await _error(client, "house/save", revision=1, house={"floors": [GROUND]})

    assert error["code"] == "invalid_format"
    assert "floor 'f2' is missing" in error["message"]
    assert len((await _ok(client, "house/get"))["house"]["floors"]) == 2


async def test_new_floor_is_empty(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND)

    floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]

    assert floor["revision"] == 0
    assert floor["id"] == "f1"
    assert floor["vertices"] == []


async def test_save_and_get_floor(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND)

    saved = (
        await _ok(client, "floor/save", floor_id="f1", revision=0, floor=sample_floor())
    )["floor"]

    assert saved["revision"] == 1
    assert saved["schema_version"] == 1
    assert saved["rooms"][0]["name"] == "Kitchen"
    assert saved["walls"][0]["thickness"] == 0.1
    assert (await _ok(client, "floor/get", floor_id="f1"))["floor"] == saved

    # What came back can be sent straight back, revision and all.
    again = (await _ok(client, "floor/save", floor_id="f1", revision=1, floor=saved))[
        "floor"
    ]
    assert again == {**saved, "revision": 2}


async def test_stale_floor_save_is_a_conflict(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    first = await hass_ws_client(hass)
    second = await hass_ws_client(hass)
    await _house_with_floors(first, GROUND)
    await _ok(first, "floor/save", floor_id="f1", revision=0, floor=sample_floor())

    changed = sample_floor()
    changed["rooms"][0]["name"] = "Overwritten"
    error = await _error(second, "floor/save", floor_id="f1", revision=0, floor=changed)

    assert error["code"] == "conflict"
    assert "revision 1" in error["message"]
    floor = (await _ok(second, "floor/get", floor_id="f1"))["floor"]
    assert floor["rooms"][0]["name"] == "Kitchen"
    assert floor["revision"] == 1


async def test_stale_house_save_is_a_conflict(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND)

    error = await _error(client, "house/save", revision=0, house={"floors": [GROUND]})

    assert error["code"] == "conflict"


async def test_invalid_floor_is_refused_and_nothing_changes(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND)
    broken = sample_floor()
    broken["walls"][0]["b"] = "v9"

    error = await _error(client, "floor/save", floor_id="f1", revision=0, floor=broken)

    assert error["code"] == "invalid_format"
    assert error["message"].startswith("walls.0.b: there is no vertex 'v9'")
    assert (await _ok(client, "floor/get", floor_id="f1"))["floor"]["revision"] == 0


async def test_floor_document_must_match_floor_id(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND, UPSTAIRS)

    error = await _error(
        client, "floor/save", floor_id="f2", revision=0, floor=sample_floor("f1")
    )

    assert error["code"] == "invalid_format"


async def test_unknown_floor(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)

    for command, extra in (
        ("floor/get", {}),
        ("floor/delete", {}),
        ("floor/save", {"revision": 0, "floor": sample_floor("nope")}),
    ):
        error = await _error(client, command, floor_id="nope", **extra)
        assert error["code"] == "not_found", command


async def test_delete_floor(
    hass: HomeAssistant, setup, hass_ws_client, hass_storage
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND, UPSTAIRS)
    await _ok(client, "floor/save", floor_id="f1", revision=0, floor=sample_floor())
    assert floor_key("f1") in hass_storage

    house = (await _ok(client, "floor/delete", floor_id="f1"))["house"]

    assert [meta["id"] for meta in house["floors"]] == ["f2"]
    assert house["revision"] == 2
    assert floor_key("f1") not in hass_storage
    assert (await _error(client, "floor/get", floor_id="f1"))["code"] == "not_found"

    # A new floor with the old id starts empty.
    await _house_with_floors(client, GROUND)
    floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]
    assert floor["rooms"] == []
    assert floor["revision"] == 0


async def test_subscribe_reports_saves(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    editor = await hass_ws_client(hass)
    viewer = await hass_ws_client(hass)
    await viewer.send_json_auto_id({"type": "diorama/subscribe"})
    subscription = await viewer.receive_json()
    assert subscription["success"]

    async def event() -> dict[str, Any]:
        message = await viewer.receive_json()
        assert message["id"] == subscription["id"]
        assert message["type"] == "event"
        return message["event"]

    await _house_with_floors(editor, GROUND)
    assert await event() == {"type": "house", "revision": 1}

    await _ok(editor, "floor/save", floor_id="f1", revision=0, floor=sample_floor())
    assert await event() == {"type": "floor", "floor_id": "f1", "revision": 1}

    await _ok(editor, "floor/delete", floor_id="f1")
    assert await event() == {"type": "floor_deleted", "floor_id": "f1"}
    assert await event() == {"type": "house", "revision": 2}

    await viewer.send_json_auto_id(
        {"type": "unsubscribe_events", "subscription": subscription["id"]}
    )
    assert (await viewer.receive_json())["success"]
    await _house_with_floors(editor, GROUND)
    await viewer.send_json_auto_id({"type": "ping"})
    assert (await viewer.receive_json())["type"] == "pong"


async def test_export_then_import_round_trips(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND, UPSTAIRS)
    await _ok(client, "floor/save", floor_id="f1", revision=0, floor=sample_floor())
    export = (await _ok(client, "export"))["export"]
    assert export["diorama_export"] == 1
    assert set(export["floors"]) == {"f1", "f2"}

    # Wreck the house, then put it back.
    await _ok(client, "floor/delete", floor_id="f1")
    await _ok(client, "floor/delete", floor_id="f2")
    house = (await _ok(client, "import", data=export))["house"]

    assert [meta["id"] for meta in house["floors"]] == ["f1", "f2"]
    restored = (await _ok(client, "export"))["export"]
    assert _without_revisions(restored) == _without_revisions(export)


async def test_import_replaces_everything_and_outdates_old_revisions(
    hass: HomeAssistant, setup, hass_ws_client, hass_storage
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND, UPSTAIRS)
    for _ in range(3):
        floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]
        await _ok(
            client,
            "floor/save",
            floor_id="f1",
            revision=floor["revision"],
            floor=sample_floor(),
        )

    house = (
        await _ok(
            client,
            "import",
            data={
                "diorama_export": 1,
                "house": {"floors": [{"id": "f1", "name": "Only floor"}]},
                "floors": {},
            },
        )
    )["house"]

    assert house["revision"] == 4
    assert [meta["name"] for meta in house["floors"]] == ["Only floor"]
    assert floor_key("f2") not in hass_storage
    floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]
    assert floor["rooms"] == []
    assert floor["revision"] == 4
    error = await _error(
        client, "floor/save", floor_id="f1", revision=3, floor=sample_floor()
    )
    assert error["code"] == "conflict"


async def test_invalid_import_changes_nothing(
    hass: HomeAssistant, setup, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND)

    error = await _error(
        client,
        "import",
        data={"diorama_export": 1, "house": {}, "floors": {"f9": sample_floor("f9")}},
    )

    assert error["code"] == "invalid_format"
    assert len((await _ok(client, "house/get"))["house"]["floors"]) == 1


async def test_only_admins_can_change_things(
    hass: HomeAssistant, setup, hass_ws_client, hass_admin_user
) -> None:
    admin = await hass_ws_client(hass)
    await _house_with_floors(admin, GROUND)
    await _ok(admin, "floor/save", floor_id="f1", revision=0, floor=sample_floor())
    hass_admin_user.groups = []
    client = await hass_ws_client(hass)

    for command, data in (
        ("house/save", {"revision": 1, "house": {"floors": [GROUND]}}),
        ("floor/save", {"floor_id": "f1", "revision": 1, "floor": sample_floor()}),
        ("floor/delete", {"floor_id": "f1"}),
        ("export", {}),
        ("import", {"data": {"diorama_export": 1, "house": {}}}),
    ):
        error = await _error(client, command, **data)
        assert error["code"] == "unauthorized", command

    # Reading is for everyone who is signed in.
    assert (await _ok(client, "house/get"))["house"]["revision"] == 1
    floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]
    assert floor["rooms"][0]["name"] == "Kitchen"
    await client.send_json_auto_id({"type": "diorama/subscribe"})
    assert (await client.receive_json())["success"]


async def test_house_survives_a_reload(
    hass: HomeAssistant, setup, config_entry, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    await _house_with_floors(client, GROUND)
    await _ok(client, "floor/save", floor_id="f1", revision=0, floor=sample_floor())

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert (await _ok(client, "house/get"))["house"]["floors"][0]["name"] == "Ground"
    floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]
    assert floor["revision"] == 1
    assert floor["fixtures"][0]["entity_id"] == "light.kitchen_pendant"


async def test_commands_fail_cleanly_when_unloaded(
    hass: HomeAssistant, setup, config_entry, hass_ws_client
) -> None:
    client = await hass_ws_client(hass)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()

    for command in ("house/get", "subscribe", "export"):
        assert (await _error(client, command))["code"] == "not_found", command


async def test_broken_stored_floor_is_reported_not_served(
    hass: HomeAssistant, config_entry, built_frontend, hass_ws_client, hass_storage
) -> None:
    hass_storage[HOUSE_KEY] = _stored(
        HOUSE_KEY,
        {"schema_version": 1, "revision": 3, "settings": {}, "floors": [GROUND]},
    )
    hass_storage[floor_key("f1")] = _stored(
        floor_key("f1"), {"id": "f1", "revision": 2, "walls": [{"id": "w1"}]}
    )
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    error = await _error(client, "floor/get", floor_id="f1")
    assert error["code"] == "invalid_stored_data"
    assert "diorama.floor.f1" in error["message"]
    # The file is left alone for whoever restores it.
    assert hass_storage[floor_key("f1")]["data"]["walls"] == [{"id": "w1"}]

    # Importing over it is the way out.
    await _ok(
        client,
        "import",
        data={
            "diorama_export": 1,
            "house": {"floors": [GROUND]},
            "floors": {"f1": sample_floor()},
        },
    )
    floor = (await _ok(client, "floor/get", floor_id="f1"))["floor"]
    assert floor["rooms"][0]["name"] == "Kitchen"
    assert floor["revision"] == 4


def _stored(key: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"version": 1, "minor_version": 1, "key": key, "data": data}


def _without_revisions(export: dict[str, Any]) -> dict[str, Any]:
    house = {k: v for k, v in export["house"].items() if k != "revision"}
    floors = {
        floor_id: {k: v for k, v in floor.items() if k != "revision"}
        for floor_id, floor in export["floors"].items()
    }
    return {"house": house, "floors": floors}
