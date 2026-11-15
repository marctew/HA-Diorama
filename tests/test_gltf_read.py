"""Reading the kit's .glb files, and the pieces made from them."""

import json
from pathlib import Path
import struct

import pytest

from tools.catalogue import kenney
from tools.catalogue.glb import Mesh
from tools.catalogue.gltf_read import bounds, quarter_turn, read_triangles


def write_glb(path: Path, nodes: list[dict], scene: list[int]) -> Path:
    """A file with one indexed triangle in a mesh, placed by the nodes given."""
    points = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    order = struct.pack("<3H", 0, 1, 2) + b"\x00\x00"
    binary = points + order
    document = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": scene}],
        "nodes": nodes,
        "meshes": [
            {
                "primitives": [
                    {"attributes": {"POSITION": 0}, "indices": 1, "material": 0}
                ]
            }
        ],
        "materials": [{"name": "wood"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36},
            {"buffer": 0, "byteOffset": 36, "byteLength": 6},
        ],
        "buffers": [{"byteLength": len(binary)}],
    }
    text = json.dumps(document).encode()
    text += b" " * (-len(text) % 4)
    body = (
        struct.pack("<I4s", len(text), b"JSON")
        + text
        + struct.pack("<I4s", len(binary), b"BIN\x00")
        + binary
    )
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)
    return path


def test_reads_a_triangle_where_its_nodes_put_it(tmp_path: Path) -> None:
    path = write_glb(
        tmp_path / "a.glb",
        [
            {"children": [1], "translation": [10, 0, 0], "scale": [2, 2, 2]},
            {"mesh": 0, "translation": [0, 1, 0]},
        ],
        [0],
    )
    (triangle,) = read_triangles(path)
    a, b, c, material = triangle
    assert material == "wood"
    assert a == pytest.approx((10, 2, 0))
    assert b == pytest.approx((12, 2, 0))
    assert c == pytest.approx((10, 4, 0))
    low, high = bounds([triangle])
    assert low == pytest.approx((10, 2, 0))
    assert high == pytest.approx((12, 4, 0))


def test_a_turned_node_turns_the_triangle(tmp_path: Path) -> None:
    half = 2**-0.5  # a quarter turn about the vertical
    path = write_glb(
        tmp_path / "a.glb", [{"mesh": 0, "rotation": [0, half, 0, half]}], [0]
    )
    ((_, b, c, _),) = read_triangles(path)
    assert b == pytest.approx((0, 0, -1), abs=1e-6)
    assert c == pytest.approx((0, 1, 0), abs=1e-6)


def test_a_mirrored_node_keeps_the_triangle_facing_out(tmp_path: Path) -> None:
    path = write_glb(tmp_path / "a.glb", [{"mesh": 0, "scale": [-1, 1, 1]}], [0])
    ((a, b, c, _),) = read_triangles(path)
    # Still counter-clockwise seen from +Z: its normal has not been flipped.
    normal_z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    assert normal_z > 0


def test_nodes_outside_the_scene_are_left_out(tmp_path: Path) -> None:
    path = write_glb(tmp_path / "a.glb", [{"mesh": 0}, {"mesh": 0}], [1])
    assert len(read_triangles(path)) == 1


def test_not_a_glb_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "a.glb"
    path.write_bytes(b"hello there, not a model")
    with pytest.raises(ValueError, match="not a binary glTF"):
        read_triangles(path)


def test_quarter_turns() -> None:
    assert quarter_turn((1, 5, 0), 0) == (1, 5, 0)
    assert quarter_turn((1, 5, 0), 1) == (0, 5, -1)
    assert quarter_turn((1, 5, 0), 2) == (-1, 5, 0)
    assert quarter_turn((1, 5, 0), 4) == (1, 5, 0)
    assert quarter_turn((1, 5, 0), -1) == quarter_turn((1, 5, 0), 3)


def test_every_piece_has_its_file_and_a_name_of_its_own() -> None:
    ids = [piece.id for piece in kenney.PIECES]
    names = [piece.name for piece in kenney.PIECES]
    assert len(set(ids)) == len(ids)
    assert len(set(names)) == len(names)
    for piece in kenney.PIECES:
        assert (kenney.FOLDER / f"{piece.file}.glb").is_file(), piece.file
    # Nothing is kept that is not used, and the licence travels with the files.
    kept = {path.stem for path in kenney.FOLDER.glob("*.glb")}
    assert kept == {piece.file for piece in kenney.PIECES}
    assert "Creative Commons Zero" in (kenney.FOLDER / "License.txt").read_text()


def test_a_piece_is_built_to_the_size_asked_for() -> None:
    piece = next(p for p in kenney.PIECES if p.id == "base_unit_door")
    mesh = Mesh()
    kenney._build(piece, mesh)
    low, high = mesh.bounds()
    assert high[0] - low[0] == pytest.approx(0.6, abs=1e-3)
    assert high[1] == pytest.approx(0.9, abs=1e-3)
    assert high[2] - low[2] == pytest.approx(0.62, abs=1e-3)
    # On the floor, and its middle on the origin.
    assert low[1] == pytest.approx(0, abs=1e-6)
    assert low[0] + high[0] == pytest.approx(0, abs=1e-3)
    assert low[2] + high[2] == pytest.approx(0, abs=1e-3)


def test_a_hanging_piece_reaches_the_ceiling() -> None:
    piece = next(p for p in kenney.PIECES if p.id == "ceiling_fan")
    mesh = Mesh()
    kenney._build(piece, mesh)
    low, high = mesh.bounds()
    assert high[1] == pytest.approx(kenney.CEILING, abs=1e-3)
    assert low[1] > 2
