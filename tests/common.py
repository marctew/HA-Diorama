"""Shared test data."""

from typing import Any


def sample_floor(floor_id: str = "f1") -> dict[str, Any]:
    """A 4 by 3 metre kitchen with a door, a sofa and a light, as a client sends it."""
    return {
        "id": floor_id,
        "vertices": [
            {"id": "v1", "x": 0, "y": 0},
            {"id": "v2", "x": 4, "y": 0},
            {"id": "v3", "x": 4, "y": 3},
            {"id": "v4", "x": 0, "y": 3},
        ],
        "walls": [
            {"id": "w1", "a": "v1", "b": "v2"},
            {"id": "w2", "a": "v2", "b": "v3"},
            {"id": "w3", "a": "v3", "b": "v4"},
            {"id": "w4", "a": "v4", "b": "v1"},
        ],
        "openings": [
            {
                "id": "o1",
                "wall": "w1",
                "type": "door",
                "offset": 1.2,
                "width": 0.8,
                "height": 2.0,
            }
        ],
        "rooms": [
            {
                "id": "r1",
                "name": "Kitchen",
                "area_id": "kitchen",
                "boundary": ["v1", "v2", "v3", "v4"],
            }
        ],
        "items": [
            {"id": "i1", "model": "kenney/sofa_long", "x": 2.1, "y": 2.5, "room": "r1"}
        ],
        "fixtures": [
            {
                "id": "x1",
                "entity_id": "light.kitchen_pendant",
                "kind": "light",
                "x": 2.0,
                "y": 1.5,
                "z": 2.2,
                "room": "r1",
            }
        ],
    }
