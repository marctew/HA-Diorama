"""The few shapes the basic furniture is built from."""

from __future__ import annotations

import math

from .glb import Mesh, Vec, hex_colour

# One small palette for every model, written as seen on screen.
PALETTE = {
    "wood": "#c9a26b",
    "wood_dark": "#7a5a3e",
    "wood_pale": "#e3cfa6",
    "white": "#f2f0ea",
    "cream": "#e6dcc8",
    "grey": "#b9bcc0",
    "grey_dark": "#5d6268",
    "black": "#2e3134",
    "metal": "#a9b0b6",
    "fabric_blue": "#6f8fa8",
    "fabric_green": "#8aa58f",
    "fabric_warm": "#c98d6b",
    "fabric_grey": "#9aa0a8",
    "linen": "#eae6de",
    "leaf": "#5f9a62",
    "leaf_dark": "#3f7a4a",
    "terracotta": "#b9684a",
    "glass": "#bfdde6",
    "water": "#9fd0e0",
    "steel": "#d0d4d8",
    "glow": "#ffe9a8",
    "screen": "#1f2428",
}


def colour(name: str) -> Vec:
    """Return a palette colour, linear."""
    return hex_colour(PALETTE[name])


def box(mesh: Mesh, size: Vec, at: Vec, paint: str, turn: float = 0) -> None:
    """Add a box. `size` is width, height, depth. `at` is where the middle of
    its base sits. `turn` rotates it about the vertical, in degrees."""
    width, height, depth = size
    cos, sin = math.cos(math.radians(turn)), math.sin(math.radians(turn))

    def place(x: float, y: float, z: float) -> Vec:
        return (at[0] + x * cos + z * sin, at[1] + y, at[2] - x * sin + z * cos)

    w, d = width / 2, depth / 2
    low = [place(-w, 0, d), place(w, 0, d), place(w, 0, -d), place(-w, 0, -d)]
    top = [
        place(-w, height, d),
        place(w, height, d),
        place(w, height, -d),
        place(-w, height, -d),
    ]
    shade = colour(paint)
    mesh.quad(top[0], top[1], top[2], top[3], shade)
    mesh.quad(low[3], low[2], low[1], low[0], shade)
    for i in range(4):
        j = (i + 1) % 4
        mesh.quad(low[i], low[j], top[j], top[i], shade)


def cylinder(
    mesh: Mesh,
    radius: float,
    height: float,
    at: Vec,
    paint: str,
    sides: int = 12,
    top_radius: float | None = None,
) -> None:
    """Add an upright cylinder, or a cone frustum when `top_radius` differs."""
    upper = radius if top_radius is None else top_radius
    shade = colour(paint)

    def ring(r: float, y: float) -> list[Vec]:
        return [
            (
                at[0] + r * math.cos(2 * math.pi * i / sides),
                at[1] + y,
                at[2] - r * math.sin(2 * math.pi * i / sides),
            )
            for i in range(sides)
        ]

    low, top = ring(radius, 0), ring(upper, height)
    centre_low = (at[0], at[1], at[2])
    centre_top = (at[0], at[1] + height, at[2])
    for i in range(sides):
        j = (i + 1) % sides
        mesh.quad(low[i], low[j], top[j], top[i], shade)
        mesh.triangle(centre_top, top[i], top[j], shade)
        mesh.triangle(centre_low, low[j], low[i], shade)


def legs(
    mesh: Mesh,
    width: float,
    depth: float,
    height: float,
    paint: str,
    thick: float = 0.05,
    inset: float = 0.04,
) -> None:
    """Add four legs under a rectangle of the given width and depth."""
    x = width / 2 - inset - thick / 2
    z = depth / 2 - inset - thick / 2
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(mesh, (thick, height, thick), (sx * x, 0, sz * z), paint)
