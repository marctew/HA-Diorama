"""What a valid house and floor look like.

Everything a client sends is checked here before it is stored, and stored
documents are checked again when they are loaded. SPEC.md section 5 describes
the model: units are metres and degrees, x and y are plan coordinates on the
floor, z is height.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
import json
import math
from typing import Any

import voluptuous as vol

SCHEMA_VERSION = 1
EXPORT_VERSION = 1

FIXTURE_KINDS = (
    "light",
    "switch",
    "cover",
    "opening",
    "climate",
    "presence",
    "media",
    "lock",
    "label",
)
OPENING_TYPES = ("door", "window")

DEFAULT_WALL_HEIGHT = 2.4
DEFAULT_WALL_THICKNESS = 0.1
DEFAULT_WALL_COLOUR = "#e8e4dc"
DEFAULT_FLOOR_STYLE = "default"
DEFAULT_HOUSE_NAME = "Home"

MAX_FLOORS = 50
MAX_VERTICES = 2000
MAX_WALLS = 2000
MAX_OPENINGS = 1000
MAX_ROOMS = 200
MAX_ITEMS = 2000
MAX_FIXTURES = 1000
MAX_OPTIONS_BYTES = 4096

# No plan is bigger than a kilometre from its origin; this mostly catches
# nonsense such as coordinates sent in millimetres.
MAX_COORDINATE = 1000.0
MAX_HEIGHT = 100.0


def number(minimum: float, maximum: float) -> Callable[[Any], float | int]:
    """Accept a finite number in a range. True and False are not numbers."""

    def validate(value: Any) -> float | int:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise vol.Invalid("expected a number")
        if not math.isfinite(value):
            raise vol.Invalid("expected a finite number")
        if not minimum <= value <= maximum:
            raise vol.Invalid(f"must be between {minimum:g} and {maximum:g}")
        return value

    return validate


def text(maximum: int, *, minimum: int = 0) -> Callable[[Any], str]:
    """Accept a string of a sensible length, without surrounding space."""

    def validate(value: Any) -> str:
        if not isinstance(value, str):
            raise vol.Invalid("expected text")
        value = value.strip()
        if not minimum <= len(value) <= maximum:
            raise vol.Invalid(f"must be {minimum} to {maximum} characters long")
        return value

    return validate


def options(value: Any) -> dict[str, Any]:
    """Accept a small JSON object of per-fixture options."""
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise vol.Invalid("expected an object")
    try:
        size = len(json.dumps(value, allow_nan=False))
    except (TypeError, ValueError) as err:
        raise vol.Invalid("must be plain JSON") from err
    if size > MAX_OPTIONS_BYTES:
        raise vol.Invalid(f"must be at most {MAX_OPTIONS_BYTES} bytes of JSON")
    return value


# Ids are made by the client. Floor ids end up in file names, so keep them tame.
ID = vol.All(str, vol.Match(r"^[a-z0-9_]{1,32}$", msg="expected an id (a-z, 0-9, _)"))
MODEL = vol.All(
    str,
    vol.Length(max=100),
    vol.Match(r"^[a-z0-9_]+/[a-z0-9_\-]+$", msg="expected a model id like kit/name"),
)
ENTITY_ID = vol.All(
    str,
    vol.Length(max=255),
    vol.Match(r"^[a-z0-9_]+\.[a-z0-9_]+$", msg="expected an entity id"),
)
COLOUR = vol.All(
    str, vol.Match(r"^#[0-9a-fA-F]{6}$", msg="expected a colour like #a1b2c3")
)
STYLE = vol.All(str, vol.Match(r"^[a-z0-9_]{1,40}$", msg="expected a style name"))

COORDINATE = number(-MAX_COORDINATE, MAX_COORDINATE)
HEIGHT = number(-MAX_HEIGHT, MAX_HEIGHT)

# Clients send back what they were given, so these two are accepted on the way
# in. The store sets them itself.
_SERVER_KEYS = {
    vol.Optional("schema_version"): object,
    vol.Optional("revision"): object,
}

VERTEX = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Required("x"): COORDINATE,
        vol.Required("y"): COORDINATE,
    }
)
WALL = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Required("a"): ID,
        vol.Required("b"): ID,
        vol.Optional("thickness", default=DEFAULT_WALL_THICKNESS): number(0.02, 1),
        vol.Optional("height", default=None): vol.Any(None, number(0.1, 6)),
    }
)
OPENING = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Required("wall"): ID,
        vol.Required("type"): vol.In(OPENING_TYPES),
        vol.Required("offset"): number(0, MAX_COORDINATE),
        vol.Required("width"): number(0.1, 20),
        vol.Required("height"): number(0.1, 6),
        vol.Optional("sill", default=0): number(0, 6),
        vol.Optional("entity_id", default=None): vol.Any(None, ENTITY_ID),
    }
)
ROOM = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Optional("name", default=""): text(100),
        vol.Optional("area_id", default=None): vol.Any(None, text(255, minimum=1)),
        vol.Required("boundary"): vol.All([ID], vol.Length(min=3, max=200)),
        vol.Optional("floor_style", default=DEFAULT_FLOOR_STYLE): STYLE,
        vol.Optional("wall_colour", default=DEFAULT_WALL_COLOUR): COLOUR,
    }
)
ITEM = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Required("model"): MODEL,
        vol.Required("x"): COORDINATE,
        vol.Required("y"): COORDINATE,
        vol.Optional("z", default=0): HEIGHT,
        vol.Optional("rotation", default=0): number(-360, 360),
        vol.Optional("scale", default=1): number(0.05, 20),
        vol.Optional("room", default=None): vol.Any(None, ID),
    }
)
FIXTURE = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Required("entity_id"): ENTITY_ID,
        vol.Required("kind"): vol.In(FIXTURE_KINDS),
        vol.Required("x"): COORDINATE,
        vol.Required("y"): COORDINATE,
        vol.Optional("z", default=0): HEIGHT,
        vol.Optional("room", default=None): vol.Any(None, ID),
        vol.Optional("item", default=None): vol.Any(None, ID),
        vol.Optional("model", default=None): vol.Any(None, MODEL),
        vol.Optional("options", default=dict): options,
    }
)
TRACE = vol.Schema(
    {
        vol.Required("image"): ID,
        vol.Required("scale"): number(0.00001, 10),
        vol.Optional("x", default=0): COORDINATE,
        vol.Optional("y", default=0): COORDINATE,
        vol.Optional("opacity", default=0.4): number(0, 1),
    }
)

_FLOOR = vol.Schema(
    {
        **_SERVER_KEYS,
        vol.Required("id"): ID,
        vol.Optional("wall_height", default=DEFAULT_WALL_HEIGHT): number(1.5, 6),
        vol.Optional("vertices", default=list): vol.All(
            [VERTEX], vol.Length(max=MAX_VERTICES)
        ),
        vol.Optional("walls", default=list): vol.All([WALL], vol.Length(max=MAX_WALLS)),
        vol.Optional("openings", default=list): vol.All(
            [OPENING], vol.Length(max=MAX_OPENINGS)
        ),
        vol.Optional("rooms", default=list): vol.All([ROOM], vol.Length(max=MAX_ROOMS)),
        vol.Optional("items", default=list): vol.All([ITEM], vol.Length(max=MAX_ITEMS)),
        vol.Optional("fixtures", default=list): vol.All(
            [FIXTURE], vol.Length(max=MAX_FIXTURES)
        ),
        vol.Optional("trace", default=None): vol.Any(None, TRACE),
    }
)

FLOOR_META = vol.Schema(
    {
        vol.Required("id"): ID,
        vol.Required("name"): text(100, minimum=1),
        vol.Optional("elevation", default=0): HEIGHT,
        vol.Optional("ha_floor_id", default=None): vol.Any(None, text(255, minimum=1)),
    }
)
HOUSE_SETTINGS = vol.Schema(
    {vol.Optional("name", default=DEFAULT_HOUSE_NAME): text(100, minimum=1)}
)
_HOUSE = vol.Schema(
    {
        **_SERVER_KEYS,
        vol.Optional("settings", default=dict): HOUSE_SETTINGS,
        vol.Optional("floors", default=list): vol.All(
            [FLOOR_META], vol.Length(max=MAX_FLOORS)
        ),
    }
)
_EXPORT = vol.Schema(
    {
        vol.Required("diorama_export"): EXPORT_VERSION,
        vol.Required("house"): dict,
        vol.Optional("floors", default=dict): {str: dict},
    }
)


def _unique_ids(kind: str, entries: Iterable[dict[str, Any]]) -> set[str]:
    """Return the ids of a list of entries, refusing duplicates."""
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        if entry["id"] in seen:
            raise vol.Invalid(f"duplicate id '{entry['id']}'", path=[kind, index, "id"])
        seen.add(entry["id"])
    return seen


def _known(
    value: str | None, known: set[str], what: str, path: list[str | int]
) -> None:
    if value is not None and value not in known:
        raise vol.Invalid(f"there is no {what} '{value}'", path=path)


def validate_floor(data: Any) -> dict[str, Any]:
    """Check one floor and fill in defaults.

    Returns the floor without schema_version and revision; the store adds them.
    Raises vol.Invalid.
    """
    floor = _FLOOR(data)
    floor.pop("schema_version", None)
    floor.pop("revision", None)

    vertices = _unique_ids("vertices", floor["vertices"])
    walls = _unique_ids("walls", floor["walls"])
    _unique_ids("openings", floor["openings"])
    rooms = _unique_ids("rooms", floor["rooms"])
    items = _unique_ids("items", floor["items"])
    _unique_ids("fixtures", floor["fixtures"])

    spans: set[frozenset[str]] = set()
    for index, wall in enumerate(floor["walls"]):
        _known(wall["a"], vertices, "vertex", ["walls", index, "a"])
        _known(wall["b"], vertices, "vertex", ["walls", index, "b"])
        if wall["a"] == wall["b"]:
            raise vol.Invalid("a wall needs two different ends", path=["walls", index])
        span = frozenset((wall["a"], wall["b"]))
        if span in spans:
            raise vol.Invalid(
                "there is already a wall between these two vertices",
                path=["walls", index],
            )
        spans.add(span)

    for index, opening in enumerate(floor["openings"]):
        _known(opening["wall"], walls, "wall", ["openings", index, "wall"])

    for index, room in enumerate(floor["rooms"]):
        boundary = room["boundary"]
        if len(set(boundary)) != len(boundary):
            raise vol.Invalid(
                "a boundary cannot use a vertex twice",
                path=["rooms", index, "boundary"],
            )
        for position, vertex in enumerate(boundary):
            _known(vertex, vertices, "vertex", ["rooms", index, "boundary", position])

    for index, item in enumerate(floor["items"]):
        _known(item["room"], rooms, "room", ["items", index, "room"])

    for index, fixture in enumerate(floor["fixtures"]):
        _known(fixture["room"], rooms, "room", ["fixtures", index, "room"])
        _known(fixture["item"], items, "item", ["fixtures", index, "item"])

    return floor


def validate_house(data: Any) -> dict[str, Any]:
    """Check the house settings and floor list, and fill in defaults.

    Returns the house without schema_version and revision. Raises vol.Invalid.
    """
    house = _HOUSE(data)
    house.pop("schema_version", None)
    house.pop("revision", None)
    _unique_ids("floors", house["floors"])
    return house


def validate_export(data: Any) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Check a whole exported house. Returns the house and its floors by id.

    A floor that is listed but has no document comes back empty. A document for
    a floor that is not listed is refused. Raises vol.Invalid.
    """
    export = _EXPORT(data)
    try:
        house = validate_house(export["house"])
    except vol.Invalid as err:
        err.prepend(["house"])
        raise
    listed = {meta["id"] for meta in house["floors"]}

    floors: dict[str, dict[str, Any]] = {}
    for floor_id, document in export["floors"].items():
        if floor_id not in listed:
            raise vol.Invalid(
                f"floor '{floor_id}' is not in the house's floor list",
                path=["floors", floor_id],
            )
        try:
            floor = validate_floor(document)
        except vol.Invalid as err:
            err.prepend(["floors", floor_id])
            raise
        if floor["id"] != floor_id:
            raise vol.Invalid(
                f"the document's id is '{floor['id']}'", path=["floors", floor_id, "id"]
            )
        floors[floor_id] = floor
    for floor_id in listed - floors.keys():
        floors[floor_id] = empty_floor(floor_id)
    return house, floors


def empty_floor(floor_id: str) -> dict[str, Any]:
    """Return a floor with nothing on it."""
    return validate_floor({"id": floor_id})


def describe(err: vol.Invalid) -> str:
    """Turn a validation error into one line that says where the problem is."""
    where = ".".join(str(part) for part in err.path)
    return f"{where}: {err.error_message}" if where else err.error_message
