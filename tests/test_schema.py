"""Validation of houses and floors, without Home Assistant."""

import copy

import pytest
import voluptuous as vol

from custom_components.diorama.schema import (
    describe,
    empty_floor,
    validate_export,
    validate_floor,
    validate_house,
)

from .common import sample_floor


def test_empty_floor_has_every_key() -> None:
    assert empty_floor("f1") == {
        "id": "f1",
        "wall_height": 2.4,
        "vertices": [],
        "walls": [],
        "openings": [],
        "rooms": [],
        "items": [],
        "fixtures": [],
        "trace": None,
    }


def test_valid_floor_gets_defaults() -> None:
    floor = validate_floor(sample_floor())

    assert floor["walls"][0] == {
        "id": "w1",
        "a": "v1",
        "b": "v2",
        "thickness": 0.1,
        "height": None,
    }
    assert floor["rooms"][0]["floor_style"] == "default"
    assert floor["rooms"][0]["wall_colour"] == "#e8e4dc"
    assert floor["items"][0]["scale"] == 1
    assert floor["fixtures"][0]["options"] == {}
    assert floor["openings"][0]["sill"] == 0


def test_validating_twice_changes_nothing() -> None:
    once = validate_floor(sample_floor())
    assert validate_floor(copy.deepcopy(once)) == once


def test_server_keys_are_accepted_and_dropped() -> None:
    floor = validate_floor({**sample_floor(), "schema_version": 1, "revision": 9})
    assert "revision" not in floor
    assert "schema_version" not in floor


def _broken(change) -> dict:
    floor = sample_floor()
    change(floor)
    return floor


@pytest.mark.parametrize(
    ("change", "where"),
    [
        (lambda f: f.update(id="Ground Floor"), "id"),
        (lambda f: f.update(colour="red"), "colour"),
        (lambda f: f.update(wall_height=0.5), "wall_height"),
        (lambda f: f["vertices"][0].update(x=float("nan")), "vertices.0.x"),
        (lambda f: f["vertices"][0].update(x=float("inf")), "vertices.0.x"),
        (lambda f: f["vertices"][0].update(x=250000), "vertices.0.x"),
        (lambda f: f["vertices"][0].update(x=True), "vertices.0.x"),
        (lambda f: f["vertices"][0].update(x="1"), "vertices.0.x"),
        (lambda f: f["vertices"].append({"id": "v1", "x": 9, "y": 9}), "vertices.4.id"),
        (lambda f: f["walls"][0].update(b="v9"), "walls.0.b"),
        (lambda f: f["walls"][0].update(b="v1"), "walls.0"),
        (lambda f: f["walls"].append({"id": "w9", "a": "v2", "b": "v1"}), "walls.4"),
        (lambda f: f["walls"][0].update(thickness=5), "walls.0.thickness"),
        (lambda f: f["openings"][0].update(wall="w9"), "openings.0.wall"),
        (lambda f: f["openings"][0].update(type="hatch"), "openings.0.type"),
        (lambda f: f["openings"][0].update(width=0), "openings.0.width"),
        (
            lambda f: f["openings"][0].update(entity_id="Front Door"),
            "openings.0.entity_id",
        ),
        (lambda f: f["rooms"][0].update(boundary=["v1", "v2"]), "rooms.0.boundary"),
        (
            lambda f: f["rooms"][0].update(boundary=["v1", "v2", "v1"]),
            "rooms.0.boundary",
        ),
        (
            lambda f: f["rooms"][0].update(boundary=["v1", "v2", "v9"]),
            "rooms.0.boundary.2",
        ),
        (lambda f: f["rooms"][0].update(wall_colour="red"), "rooms.0.wall_colour"),
        (lambda f: f["rooms"][0].update(name="x" * 101), "rooms.0.name"),
        (lambda f: f["items"][0].update(room="r9"), "items.0.room"),
        (lambda f: f["items"][0].update(model="../../etc/passwd"), "items.0.model"),
        (lambda f: f["items"][0].update(scale=0), "items.0.scale"),
        (lambda f: f["fixtures"][0].update(kind="toaster"), "fixtures.0.kind"),
        (lambda f: f["fixtures"][0].update(item="i9"), "fixtures.0.item"),
        (lambda f: f["fixtures"][0].update(entity_id="light"), "fixtures.0.entity_id"),
        (
            lambda f: f["fixtures"][0].update(options={"k": "x" * 5000}),
            "fixtures.0.options",
        ),
        (lambda f: f["fixtures"][0].update(options=[1]), "fixtures.0.options"),
        (lambda f: f.update(trace={"image": "t1", "scale": 0}), "trace"),
    ],
)
def test_invalid_floor_is_refused(change, where: str) -> None:
    with pytest.raises(vol.Invalid) as raised:
        validate_floor(_broken(change))
    assert describe(raised.value).startswith(where)


def test_text_is_trimmed() -> None:
    floor = sample_floor()
    floor["rooms"][0]["name"] = "  Kitchen  "
    assert validate_floor(floor)["rooms"][0]["name"] == "Kitchen"


def test_house_defaults() -> None:
    assert validate_house({}) == {
        "settings": {"name": "Home"},
        "floors": [],
        "cameras": [],
    }


def test_house_floor_defaults() -> None:
    house = validate_house({"floors": [{"id": "f1", "name": "Ground"}]})
    assert house["floors"] == [
        {"id": "f1", "name": "Ground", "elevation": 0, "ha_floor_id": None}
    ]


@pytest.mark.parametrize(
    "house",
    [
        {"floors": [{"id": "f1", "name": ""}]},
        {"floors": [{"id": "f1"}]},
        {"floors": [{"id": "f1", "name": "A"}, {"id": "f1", "name": "B"}]},
        {"floors": [{"id": "../x", "name": "A"}]},
        {"floors": [{"id": "f1", "name": "A", "elevation": 5000}]},
        {"settings": {"name": ""}},
        {"settings": {"theme": "dark"}},
        {"floors": [{"id": f"f{n}", "name": "A"} for n in range(51)]},
    ],
)
def test_invalid_house_is_refused(house) -> None:
    with pytest.raises(vol.Invalid):
        validate_house(house)


def test_export_fills_in_missing_floors() -> None:
    house, floors = validate_export(
        {
            "diorama_export": 1,
            "house": {
                "floors": [{"id": "f1", "name": "Ground"}, {"id": "f2", "name": "Up"}]
            },
            "floors": {"f1": sample_floor("f1")},
        }
    )
    assert [meta["id"] for meta in house["floors"]] == ["f1", "f2"]
    assert floors["f1"]["rooms"][0]["name"] == "Kitchen"
    assert floors["f2"] == empty_floor("f2")


@pytest.mark.parametrize(
    ("export", "where"),
    [
        ({"house": {}}, "diorama_export"),
        ({"diorama_export": 2, "house": {}}, "diorama_export"),
        ({"diorama_export": 1, "house": {"floors": [{"id": "f1"}]}}, "house.floors.0"),
        (
            {"diorama_export": 1, "house": {}, "floors": {"f1": sample_floor("f1")}},
            "floors.f1",
        ),
        (
            {
                "diorama_export": 1,
                "house": {"floors": [{"id": "f1", "name": "Ground"}]},
                "floors": {"f1": sample_floor("f2")},
            },
            "floors.f1.id",
        ),
        (
            {
                "diorama_export": 1,
                "house": {"floors": [{"id": "f1", "name": "Ground"}]},
                "floors": {"f1": {"id": "f1", "wall_height": 99}},
            },
            "floors.f1.wall_height",
        ),
    ],
)
def test_invalid_export_is_refused(export, where: str) -> None:
    with pytest.raises(vol.Invalid) as raised:
        validate_export(export)
    assert describe(raised.value).startswith(where)


CAMERA = {
    "id": "c1",
    "name": "From the door",
    "position": [1, 2, 3],
    "target": [0, 1, 0],
}


def test_house_cameras() -> None:
    house = validate_house(
        {
            "floors": [{"id": "f1", "name": "Ground"}],
            "cameras": [CAMERA, {**CAMERA, "id": "c2", "floor": "f1"}],
        }
    )
    assert house["cameras"][0] == {**CAMERA, "floor": None}
    assert house["cameras"][1]["floor"] == "f1"


def test_camera_on_a_floor_that_is_gone_falls_back_to_the_ground() -> None:
    house = validate_house({"cameras": [{**CAMERA, "floor": "f_gone"}]})
    assert house["cameras"][0]["floor"] is None


@pytest.mark.parametrize(
    "camera",
    [
        {**CAMERA, "name": ""},
        {**CAMERA, "position": [1, 2]},
        {**CAMERA, "position": [1, 2, float("nan")]},
        {**CAMERA, "target": [1, 2, 3, 4]},
        {**CAMERA, "position": "1,2,3"},
        {k: v for k, v in CAMERA.items() if k != "target"},
        {**CAMERA, "fov": 50},
    ],
)
def test_invalid_camera_is_refused(camera) -> None:
    with pytest.raises(vol.Invalid):
        validate_house({"cameras": [camera]})


def test_cameras_need_unique_ids_and_have_a_limit() -> None:
    with pytest.raises(vol.Invalid):
        validate_house({"cameras": [CAMERA, CAMERA]})
    with pytest.raises(vol.Invalid):
        validate_house({"cameras": [{**CAMERA, "id": f"c{n}"} for n in range(31)]})
