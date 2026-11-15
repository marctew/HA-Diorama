"""Read the triangles out of a .glb file, for models that come from a kit.

Only what the kits need: triangle meshes, node transforms, and the name of
each triangle's material. Textures, skins and animations are ignored.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import struct

from .glb import Vec

Matrix = tuple[tuple[float, float, float, float], ...]
# A triangle: three corners and the name of its material.
Triangle = tuple[Vec, Vec, Vec, str]

IDENTITY: Matrix = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)

# glTF component types: how to unpack them, and how many bytes each takes.
COMPONENTS = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _multiply(a: Matrix, b: Matrix) -> Matrix:
    return tuple(
        tuple(sum(a[row][k] * b[k][col] for k in range(4)) for col in range(4))
        for row in range(4)
    )


def _node_matrix(node: dict) -> Matrix:
    """The transform of a node, from its matrix or its move, turn and scale."""
    if "matrix" in node:
        m = node["matrix"]  # column-major
        return tuple(tuple(m[col * 4 + row] for col in range(4)) for row in range(4))
    tx, ty, tz = node.get("translation", (0, 0, 0))
    x, y, z, w = node.get("rotation", (0, 0, 0, 1))
    sx, sy, sz = node.get("scale", (1, 1, 1))
    return (
        (
            (1 - 2 * (y * y + z * z)) * sx,
            2 * (x * y - z * w) * sy,
            2 * (x * z + y * w) * sz,
            tx,
        ),
        (
            2 * (x * y + z * w) * sx,
            (1 - 2 * (x * x + z * z)) * sy,
            2 * (y * z - x * w) * sz,
            ty,
        ),
        (
            2 * (x * z - y * w) * sx,
            2 * (y * z + x * w) * sy,
            (1 - 2 * (x * x + y * y)) * sz,
            tz,
        ),
        (0.0, 0.0, 0.0, 1.0),
    )


def _apply(m: Matrix, p: Vec) -> Vec:
    return tuple(
        m[row][0] * p[0] + m[row][1] * p[1] + m[row][2] * p[2] + m[row][3]
        for row in range(3)
    )


def _mirrors(m: Matrix) -> bool:
    """Whether a transform turns shapes inside out."""
    return (
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    ) < 0


class _Document:
    def __init__(self, data: bytes) -> None:
        magic, version, _ = struct.unpack_from("<4sII", data)
        if magic != b"glTF" or version != 2:
            raise ValueError("not a binary glTF 2 file")
        length, kind = struct.unpack_from("<I4s", data, 12)
        if kind != b"JSON":
            raise ValueError("the first chunk is not JSON")
        self.json = json.loads(data[20 : 20 + length])
        start = 20 + length
        self.binary = b""
        if start < len(data):
            size, _ = struct.unpack_from("<I4s", data, start)
            self.binary = data[start + 8 : start + 8 + size]

    def accessor(self, index: int) -> list[tuple[float, ...]]:
        accessor = self.json["accessors"][index]
        view = self.json["bufferViews"][accessor["bufferView"]]
        code, size = COMPONENTS[accessor["componentType"]]
        width = WIDTHS[accessor["type"]]
        stride = view.get("byteStride") or size * width
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        return [
            struct.unpack_from(f"<{width}{code}", self.binary, start + i * stride)
            for i in range(accessor["count"])
        ]


def read_triangles(path: Path) -> list[Triangle]:
    """Every triangle of the default scene, where it really is."""
    document = _Document(path.read_bytes())
    doc = document.json
    materials = [m.get("name", "") for m in doc.get("materials", [])]
    triangles: list[Triangle] = []

    def visit(index: int, parent: Matrix) -> None:
        node = doc["nodes"][index]
        matrix = _multiply(parent, _node_matrix(node))
        if "mesh" in node:
            flip = _mirrors(matrix)
            for primitive in doc["meshes"][node["mesh"]]["primitives"]:
                if primitive.get("mode", 4) != 4:
                    continue
                points = [
                    _apply(matrix, p)
                    for p in document.accessor(primitive["attributes"]["POSITION"])
                ]
                if "indices" in primitive:
                    order = [i[0] for i in document.accessor(primitive["indices"])]
                else:
                    order = list(range(len(points)))
                name = (
                    materials[primitive["material"]] if "material" in primitive else ""
                )
                for i in range(0, len(order) - 2, 3):
                    a, b, c = (points[order[i + k]] for k in range(3))
                    triangles.append((a, c, b, name) if flip else (a, b, c, name))
        for child in node.get("children", []):
            visit(child, matrix)

    scene = doc["scenes"][doc.get("scene", 0)]
    for root in scene["nodes"]:
        visit(root, IDENTITY)
    return triangles


def bounds(triangles: list[Triangle]) -> tuple[Vec, Vec]:
    """The lowest and highest corner of the box round some triangles."""
    points = [p for a, b, c, _ in triangles for p in (a, b, c)]
    if not points:
        return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    return (
        tuple(min(p[i] for p in points) for i in range(3)),
        tuple(max(p[i] for p in points) for i in range(3)),
    )


def quarter_turn(point: Vec, turns: int) -> Vec:
    """Turn a point about the vertical by a number of quarter turns."""
    x, y, z = point
    for _ in range(turns % 4):
        x, z = z, -x
    return (x, y, z)


__all__ = ["Triangle", "bounds", "math", "quarter_turn", "read_triangles"]
