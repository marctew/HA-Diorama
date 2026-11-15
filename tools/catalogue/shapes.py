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


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _unit(a: Vec) -> Vec:
    length = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    return (a[0] / length, a[1] / length, a[2] / length)


def _frame(start: Vec, end: Vec) -> tuple[Vec, Vec]:
    """Two directions square to a line and to each other. The first is level
    and, for a line that runs front to back or up, points across."""
    along = _unit(_sub(end, start))
    across = (1.0, 0.0, 0.0) if abs(along[0]) < 0.9 else (0.0, 0.0, 1.0)
    second = _unit(_cross(along, across))
    first = _cross(second, along)
    return first, second


def tube(
    mesh: Mesh,
    start: Vec,
    end: Vec,
    radius: float,
    paint: str,
    sides: int = 8,
    end_radius: float | None = None,
) -> None:
    """Add a round bar from one point to another, at any angle; a cone when
    `end_radius` differs. Both ends are closed."""
    far = radius if end_radius is None else end_radius
    first, second = _frame(start, end)
    shade = colour(paint)

    def ring(centre: Vec, r: float) -> list[Vec]:
        points = []
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            c, s = r * math.cos(angle), r * math.sin(angle)
            points.append(
                tuple(centre[k] + c * first[k] + s * second[k] for k in range(3))
            )
        return points

    low, top = ring(start, radius), ring(end, far)
    for i in range(sides):
        j = (i + 1) % sides
        mesh.quad(low[i], low[j], top[j], top[i], shade)
        mesh.triangle(end, top[i], top[j], shade)
        mesh.triangle(start, low[j], low[i], shade)


def beam(
    mesh: Mesh, start: Vec, end: Vec, width: float, thickness: float, paint: str
) -> None:
    """Add a flat bar from one point to another, at any angle: `width` across,
    `thickness` the other way. For a line that leans back, across is level."""
    first, second = _frame(start, end)
    shade = colour(paint)

    def corners(centre: Vec) -> list[Vec]:
        return [
            tuple(
                centre[k] + sx * width / 2 * first[k] + sy * thickness / 2 * second[k]
                for k in range(3)
            )
            for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))
        ]

    low, top = corners(start), corners(end)
    mesh.quad(top[0], top[1], top[2], top[3], shade)
    mesh.quad(low[3], low[2], low[1], low[0], shade)
    for i in range(4):
        j = (i + 1) % 4
        mesh.quad(low[i], low[j], top[j], top[i], shade)


def panel(
    mesh: Mesh,
    outline: list[tuple[float, float]],
    back: float,
    front: float,
    paint: str,
) -> None:
    """Add a flat panel standing upright, facing the front: `outline` is its
    shape as seen from the front (across, up), which must bulge nowhere
    inwards, and it runs from `back` to `front`."""
    shade = colour(paint)
    # Counter-clockwise as seen from the front, whichever way it was given.
    area = sum(
        outline[i][0] * outline[(i + 1) % len(outline)][1]
        - outline[(i + 1) % len(outline)][0] * outline[i][1]
        for i in range(len(outline))
    )
    points = outline if area > 0 else list(reversed(outline))
    near = [(x, y, front) for x, y in points]
    far = [(x, y, back) for x, y in points]
    for i in range(1, len(points) - 1):
        mesh.triangle(near[0], near[i], near[i + 1], shade)
        mesh.triangle(far[0], far[i + 1], far[i], shade)
    for i in range(len(points)):
        j = (i + 1) % len(points)
        mesh.quad(far[i], far[j], near[j], near[i], shade)
