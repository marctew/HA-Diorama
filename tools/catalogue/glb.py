"""Write a model as a binary glTF (.glb) file.

A model here is a list of triangles with a flat normal and a colour each: one
mesh, one primitive, POSITION, NORMAL and COLOR_0, no textures. Units are
metres, +Y is up, the model stands on y = 0 centred on the origin and its
front faces +Z.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
import struct

Vec = tuple[float, float, float]


def srgb_to_linear(channel: float) -> float:
    """glTF vertex colours are linear; palettes are written as seen (sRGB)."""
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def hex_colour(value: str) -> Vec:
    """Return the linear RGB of a colour written as #rrggbb."""
    number = int(value.lstrip("#"), 16)
    return tuple(
        round(srgb_to_linear(((number >> shift) & 255) / 255), 5)
        for shift in (16, 8, 0)
    )


@dataclass
class Mesh:
    """Triangles being collected: nine numbers of each kind per triangle."""

    positions: list[float] = field(default_factory=list)
    normals: list[float] = field(default_factory=list)
    colours: list[float] = field(default_factory=list)

    def triangle(self, a: Vec, b: Vec, c: Vec, colour: Vec) -> None:
        """Add a triangle, counter-clockwise seen from its front."""
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length < 1e-12:
            return
        normal = (nx / length, ny / length, nz / length)
        for point in (a, b, c):
            self.positions.extend(round(value, 5) for value in point)
            self.normals.extend(round(value, 5) for value in normal)
            self.colours.extend(colour)

    def quad(self, a: Vec, b: Vec, c: Vec, d: Vec, colour: Vec) -> None:
        """Add a flat four-sided face, corners in counter-clockwise order."""
        self.triangle(a, b, c, colour)
        self.triangle(a, c, d, colour)

    def bounds(self) -> tuple[Vec, Vec]:
        """Return the lowest and highest corner of the box round the mesh."""
        xs, ys, zs = self.positions[0::3], self.positions[1::3], self.positions[2::3]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def _pad(data: bytes, filler: bytes) -> bytes:
    return data + filler * (-len(data) % 4)


def encode(mesh: Mesh, name: str) -> bytes:
    """Return the bytes of a .glb file holding the mesh."""
    count = len(mesh.positions) // 3
    low, high = mesh.bounds()
    chunks = [
        struct.pack(f"<{len(values)}f", *values)
        for values in (mesh.positions, mesh.normals, mesh.colours)
    ]
    views = []
    offset = 0
    for chunk in chunks:
        views.append(
            {
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": len(chunk),
                "target": 34962,
            }
        )
        offset += len(chunk)
    document = {
        "asset": {"version": "2.0", "generator": "Diorama build_catalogue"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": "flat",
                "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": 1},
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": count,
                "type": "VEC3",
                "min": list(low),
                "max": list(high),
            },
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": count, "type": "VEC3"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": offset}],
    }
    text = _pad(json.dumps(document, separators=(",", ":")).encode(), b" ")
    binary = _pad(b"".join(chunks), b"\x00")
    total = 12 + 8 + len(text) + 8 + len(binary)
    return b"".join(
        [
            struct.pack("<4sII", b"glTF", 2, total),
            struct.pack("<I4s", len(text), b"JSON"),
            text,
            struct.pack("<I4s", len(binary), b"BIN\x00"),
            binary,
        ]
    )
