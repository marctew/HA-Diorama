"""Diorama's own furniture: simple low-poly pieces at real sizes.

Each function builds one model from boxes and cylinders. Everything stands on
y = 0, is centred on the origin, and faces +Z (the side you sit on, open or
look at). Sizes are in metres and are typical UK sizes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
import math

from .glb import Mesh
from .shapes import beam, box, cylinder, legs, panel, tube


@dataclass(frozen=True)
class Model:
    """One catalogue entry and how to build it."""

    id: str
    name: str
    category: str
    build: Callable[[Mesh], None]
    tags: tuple[str, ...] = ()
    # The kind of fixture this naturally is when an entity is bound to it.
    kind: str | None = None
    # Stands against a wall: the editor turns its back to the nearest one.
    against_wall: bool = field(default=False)
    # Hangs from the ceiling instead of standing on the floor.
    hanging: bool = field(default=False)
    # Small things can be stood on it. Its top is `surface_height` up, or at
    # its full height when that is not given.
    surface: bool = field(default=False)
    surface_height: float | None = field(default=None)
    # Small enough to be stood on a surface.
    tabletop: bool = field(default=False)
    # A staircase: makes a hole in the floor above it.
    stairs: bool = field(default=False)
    # Goes on a wall: how far off the floor it is put to begin with.
    mount_height: float | None = field(default=None)
    # For a light: how far up the model its light comes from, where that is
    # not near the top of a lamp or under a pendant.
    light_height: float | None = field(default=None)
    # A strip of light: it lights what is under it along its whole length,
    # and fixes itself under a wall unit it is dropped on.
    strip: bool = field(default=False)
    # The whole of it lights up in the colour of its light: a light panel.
    lit: bool = field(default=False)


def _sofa(mesh: Mesh, width: float, fabric: str) -> None:
    depth, seat, arm = 0.9, 0.42, 0.16
    box(mesh, (width, 0.12, depth), (0, 0.06, 0), "grey_dark")
    legs(mesh, width, depth, 0.06, "wood_dark", thick=0.06, inset=0.03)
    box(mesh, (width - 2 * arm, seat - 0.18, depth - 0.2), (0, 0.18, 0.1), fabric)
    box(mesh, (width, 0.62, 0.2), (0, 0.18, -depth / 2 + 0.1), fabric)
    for side in (-1, 1):
        box(mesh, (arm, 0.42, depth), (side * (width / 2 - arm / 2), 0.18, 0), fabric)
    seats = max(1, round((width - 2 * arm) / 0.65))
    cushion = (width - 2 * arm) / seats
    for i in range(seats):
        x = -width / 2 + arm + cushion * (i + 0.5)
        box(mesh, (cushion - 0.03, 0.1, depth - 0.34), (x, seat, 0.13), "linen")


def sofa_2(mesh: Mesh) -> None:
    _sofa(mesh, 1.65, "fabric_blue")


def sofa_3(mesh: Mesh) -> None:
    _sofa(mesh, 2.2, "fabric_grey")


def armchair(mesh: Mesh) -> None:
    _sofa(mesh, 0.95, "fabric_green")


def coffee_table(mesh: Mesh) -> None:
    box(mesh, (1.1, 0.05, 0.6), (0, 0.37, 0), "wood")
    legs(mesh, 1.1, 0.6, 0.37, "wood_dark")
    box(mesh, (0.95, 0.03, 0.48), (0, 0.12, 0), "wood")


def tv_unit(mesh: Mesh) -> None:
    box(mesh, (1.6, 0.42, 0.4), (0, 0.05, 0), "wood")
    legs(mesh, 1.6, 0.4, 0.05, "black", thick=0.04)
    box(mesh, (0.5, 0.3, 0.02), (-0.5, 0.11, 0.2), "wood_pale")
    box(mesh, (0.5, 0.3, 0.02), (0.5, 0.11, 0.2), "wood_pale")
    box(mesh, (0.3, 0.02, 0.2), (0, 0.47, 0), "black")
    box(mesh, (0.06, 0.08, 0.05), (0, 0.49, 0), "black")
    box(mesh, (1.24, 0.72, 0.05), (0, 0.57, 0), "black")
    box(mesh, (1.18, 0.66, 0.01), (0, 0.6, 0.03), "screen")


def bookcase(mesh: Mesh) -> None:
    width, height, depth = 0.9, 1.9, 0.32
    box(mesh, (width, height, 0.02), (0, 0, -depth / 2 + 0.01), "wood_dark")
    for side in (-1, 1):
        box(mesh, (0.03, height, depth), (side * (width / 2 - 0.015), 0, 0), "wood")
    shelves = 6
    for i in range(shelves):
        box(
            mesh,
            (width - 0.06, 0.03, depth),
            (0, i * (height - 0.03) / (shelves - 1), 0),
            "wood",
        )
    books = [
        "fabric_warm",
        "fabric_blue",
        "leaf_dark",
        "cream",
        "terracotta",
        "grey_dark",
    ]
    for shelf in range(shelves - 1):
        y = shelf * (height - 0.03) / (shelves - 1) + 0.03
        x = -width / 2 + 0.06
        for n in range(7):
            thick = 0.05 + 0.02 * ((shelf + n) % 3)
            tall = 0.22 + 0.03 * ((shelf * 2 + n) % 4)
            if x + thick > width / 2 - 0.2 and (shelf + n) % 2:
                break
            box(
                mesh,
                (thick, tall, 0.2),
                (x + thick / 2, y, 0),
                books[(shelf * 3 + n) % len(books)],
            )
            x += thick + 0.005


def floor_lamp(mesh: Mesh) -> None:
    cylinder(mesh, 0.15, 0.03, (0, 0, 0), "black")
    cylinder(mesh, 0.015, 1.35, (0, 0.03, 0), "metal", sides=6)
    cylinder(mesh, 0.2, 0.28, (0, 1.32, 0), "glow", top_radius=0.13)


def table_lamp(mesh: Mesh) -> None:
    cylinder(mesh, 0.08, 0.03, (0, 0, 0), "terracotta")
    cylinder(mesh, 0.05, 0.2, (0, 0.03, 0), "terracotta", sides=8, top_radius=0.02)
    cylinder(mesh, 0.14, 0.18, (0, 0.24, 0), "glow", top_radius=0.09)


def ceiling_light(mesh: Mesh) -> None:
    # Hangs from 2.4 m: place it at floor level and it sits under the ceiling.
    cylinder(mesh, 0.06, 0.02, (0, 2.38, 0), "white", sides=8)
    cylinder(mesh, 0.008, 0.38, (0, 2.0, 0), "black", sides=4)
    cylinder(mesh, 0.2, 0.2, (0, 1.82, 0), "glow", top_radius=0.1)


def downlight(mesh: Mesh) -> None:
    # Set into the ceiling at 2.4 m: a trim ring and the lamp inside it.
    cylinder(mesh, 0.05, 0.012, (0, 2.388, 0), "white", sides=12)
    cylinder(mesh, 0.034, 0.006, (0, 2.383, 0), "glow", sides=12)


def led_strip(mesh: Mesh) -> None:
    # A metre of it, to be stretched to the length wanted.
    box(mesh, (1.0, 0.008, 0.016), (0, 0.008, 0), "glow")
    box(mesh, (1.0, 0.008, 0.02), (0, 0, 0), "white")


def desk_lamp(mesh: Mesh) -> None:
    # A spring-arm lamp clamped to the back of a desk, its shade over the work.
    box(mesh, (0.07, 0.05, 0.06), (0, 0, -0.08), "grey_dark")
    box(mesh, (0.04, 0.03, 0.04), (0, 0.05, -0.08), "grey_dark")
    foot, elbow, neck = (0, 0.08, -0.08), (0, 0.47, -0.2), (0, 0.66, 0.2)
    for side in (-0.013, 0.013):
        tube(
            mesh,
            (side, foot[1], foot[2]),
            (side, elbow[1], elbow[2]),
            0.006,
            "grey_dark",
            5,
        )
        tube(
            mesh,
            (side, elbow[1], elbow[2]),
            (side, neck[1], neck[2]),
            0.006,
            "grey_dark",
            5,
        )
    tube(
        mesh, (-0.02, elbow[1], elbow[2]), (0.02, elbow[1], elbow[2]), 0.014, "black", 6
    )
    tube(mesh, (-0.018, neck[1], neck[2]), (0.018, neck[1], neck[2]), 0.012, "black", 6)
    # The shade: a neck, then a cone opening down and forwards.
    tube(mesh, (0, 0.68, 0.2), (0, 0.63, 0.25), 0.035, "grey_dark", 10)
    tube(mesh, (0, 0.63, 0.25), (0, 0.53, 0.33), 0.04, "grey_dark", 12, end_radius=0.1)
    tube(mesh, (0, 0.535, 0.326), (0, 0.527, 0.332), 0.085, "glow", 12)


def _light_panel(mesh: Mesh, outline: list[tuple[float, float]]) -> None:
    panel(mesh, outline, 0, 0.004, "grey")
    panel(mesh, outline, 0.004, 0.012, "white")


def light_panel_triangle(mesh: Mesh) -> None:
    _light_panel(mesh, [(-0.115, 0), (0.115, 0), (0, 0.199)])


def light_panel_triangle_down(mesh: Mesh) -> None:
    _light_panel(mesh, [(-0.115, 0.199), (0, 0), (0.115, 0.199)])


def light_panel_hexagon(mesh: Mesh) -> None:
    _light_panel(
        mesh,
        [
            (-0.0575, 0),
            (0.0575, 0),
            (0.115, 0.0995),
            (0.0575, 0.199),
            (-0.0575, 0.199),
            (-0.115, 0.0995),
        ],
    )


def _printer(
    mesh: Mesh, width: float, depth: float, height: float, feeder: bool
) -> None:
    # An enclosed printer: a dark case, a glass door and lid, the bed inside.
    box(mesh, (width, 0.03, depth), (0, 0, 0), "black")
    box(mesh, (width, height - 0.03, depth), (0, 0.03, 0), "grey_dark")
    door = (width * 0.8, height * 0.6)
    box(mesh, (door[0], door[1], 0.012), (0, height * 0.24, depth / 2), "glass")
    box(
        mesh,
        (door[0] * 0.8, 0.012, depth * 0.5),
        (0, height * 0.34, depth * 0.1),
        "steel",
    )
    box(
        mesh,
        (0.02, door[1] * 0.3, 0.02),
        (door[0] / 2 - 0.03, height * 0.4, depth / 2 + 0.012),
        "black",
    )
    box(
        mesh,
        (width * 0.34, height * 0.1, 0.012),
        (width * 0.24, height * 0.87, depth / 2),
        "screen",
    )
    box(mesh, (width * 0.86, 0.012, depth * 0.86), (0, height, 0), "glass")
    if not feeder:
        return
    # The box of filament that sits on top and feeds it: four reels in a row.
    top = height + 0.012
    box(mesh, (width * 0.94, 0.09, depth * 0.72), (0, top, 0), "grey_dark")
    reels = ("fabric_warm", "fabric_blue", "leaf", "cream")
    for index, paint in enumerate(reels):
        x = (index - 1.5) * width * 0.2
        tube(
            mesh,
            (x - width * 0.07, top + 0.13, 0),
            (x + width * 0.07, top + 0.13, 0),
            0.085,
            paint,
            12,
        )


def printer(mesh: Mesh) -> None:
    _printer(mesh, 0.39, 0.39, 0.46, feeder=False)


def printer_feeder(mesh: Mesh) -> None:
    _printer(mesh, 0.39, 0.39, 0.46, feeder=True)


def printer_large(mesh: Mesh) -> None:
    _printer(mesh, 0.49, 0.51, 0.63, feeder=False)


def printer_large_feeder(mesh: Mesh) -> None:
    _printer(mesh, 0.49, 0.51, 0.63, feeder=True)


def _sim_rig(mesh: Mesh, screens: int) -> None:
    # The driver sits at the back and faces the front. A frame of aluminium
    # bar, a bucket seat, a wheel on its deck, pedals, and the screens.
    for side in (-0.26, 0.26):
        box(mesh, (0.04, 0.08, 1.4), (side, 0, 0), "black")
        box(mesh, (0.04, 0.62, 0.08), (side, 0.08, 0.22), "black")
    for z in (-0.64, 0.0, 0.64):
        box(mesh, (0.56, 0.04, 0.04), (0, 0.02, z), "black")
    # Seat.
    box(mesh, (0.46, 0.1, 0.48), (0, 0.2, -0.34), "grey_dark")
    for side in (-0.215, 0.215):
        box(mesh, (0.05, 0.1, 0.44), (side, 0.28, -0.34), "black")
    beam(mesh, (0, 0.27, -0.56), (0, 0.98, -0.72), 0.44, 0.09, "grey_dark")
    beam(mesh, (0, 0.98, -0.72), (0, 1.14, -0.75), 0.26, 0.09, "black")
    beam(mesh, (0, 0.36, -0.53), (0, 0.9, -0.655), 0.2, 0.02, "fabric_warm")
    # Wheel deck, base and wheel.
    box(mesh, (0.56, 0.03, 0.2), (0, 0.7, 0.22), "black")
    box(mesh, (0.2, 0.12, 0.2), (0, 0.73, 0.22), "grey_dark")
    tube(mesh, (0, 0.8, 0.12), (0, 0.815, 0.03), 0.03, "black", 8)
    tube(mesh, (0, 0.815, 0.03), (0, 0.82, 0.0), 0.15, "black", 14)
    tube(mesh, (0, 0.8205, -0.002), (0, 0.8215, -0.006), 0.11, "grey_dark", 14)
    # Pedals on a sloping plate.
    beam(mesh, (0, 0.09, 0.42), (0, 0.24, 0.66), 0.5, 0.02, "black")
    for x in (-0.15, 0.0, 0.15):
        beam(mesh, (x, 0.14, 0.47), (x, 0.3, 0.56), 0.07, 0.02, "steel")
    # Screens, on a stand beyond the wheel.
    for side in (-0.2, 0.2):
        box(mesh, (0.04, 0.9, 0.04), (side, 0.08, 0.66), "black")
    box(mesh, (0.5, 0.04, 0.04), (0, 0.9, 0.66), "black")
    wide, tall = 0.74, 0.42

    def screen(x: float, z: float, turn: float) -> None:
        box(mesh, (wide, tall, 0.03), (x, 0.72, z), "black", turn=turn)
        # The picture, on the side the driver looks at.
        angle = math.radians(turn)
        box(
            mesh,
            (wide - 0.03, tall - 0.03, 0.006),
            (x + 0.018 * -math.sin(angle), 0.735, z - 0.018 * math.cos(angle)),
            "screen",
            turn=turn,
        )

    screen(0, 0.62, 0)
    if screens == 3:
        reach = wide / 2 + (wide / 2) * math.cos(math.radians(50))
        back = (wide / 2) * math.sin(math.radians(50))
        screen(-reach, 0.62 - back, -50)
        screen(reach, 0.62 - back, 50)


def sim_rig(mesh: Mesh) -> None:
    _sim_rig(mesh, 1)


def sim_rig_triple(mesh: Mesh) -> None:
    _sim_rig(mesh, 3)


def rug(mesh: Mesh) -> None:
    box(mesh, (2.0, 0.012, 1.4), (0, 0, 0), "fabric_warm")
    box(mesh, (1.76, 0.014, 1.16), (0, 0, 0), "cream")
    box(mesh, (1.5, 0.016, 0.9), (0, 0, 0), "fabric_warm")


def plant(mesh: Mesh) -> None:
    cylinder(mesh, 0.14, 0.3, (0, 0, 0), "terracotta", top_radius=0.19)
    cylinder(mesh, 0.17, 0.02, (0, 0.29, 0), "wood_dark")
    cylinder(mesh, 0.02, 0.4, (0, 0.3, 0), "wood_dark", sides=5)
    cylinder(mesh, 0.3, 0.35, (0, 0.6, 0), "leaf", sides=7, top_radius=0.22)
    cylinder(mesh, 0.22, 0.3, (0.03, 0.9, 0.02), "leaf_dark", sides=7, top_radius=0.06)


def _table(mesh: Mesh, width: float, depth: float) -> None:
    box(mesh, (width, 0.04, depth), (0, 0.71, 0), "wood")
    legs(mesh, width, depth, 0.71, "wood", thick=0.07, inset=0.06)
    box(mesh, (width - 0.3, 0.08, 0.03), (0, 0.63, depth / 2 - 0.12), "wood")
    box(mesh, (width - 0.3, 0.08, 0.03), (0, 0.63, -depth / 2 + 0.12), "wood")


def dining_table(mesh: Mesh) -> None:
    _table(mesh, 1.6, 0.9)


def dining_table_small(mesh: Mesh) -> None:
    _table(mesh, 0.9, 0.9)


def chair(mesh: Mesh) -> None:
    box(mesh, (0.44, 0.04, 0.44), (0, 0.43, 0), "wood_pale")
    legs(mesh, 0.44, 0.44, 0.43, "wood", thick=0.04, inset=0.02)
    for side in (-1, 1):
        box(mesh, (0.04, 0.48, 0.04), (side * 0.18, 0.47, -0.18), "wood")
    box(mesh, (0.4, 0.16, 0.03), (0, 0.76, -0.18), "wood_pale")


def kitchen_base(mesh: Mesh) -> None:
    box(mesh, (0.6, 0.1, 0.5), (0, 0, -0.03), "grey_dark")
    box(mesh, (0.6, 0.76, 0.58), (0, 0.1, -0.01), "white")
    box(mesh, (0.56, 0.7, 0.02), (0, 0.13, 0.28), "cream")
    box(mesh, (0.16, 0.02, 0.02), (0, 0.76, 0.3), "metal")
    box(mesh, (0.6, 0.04, 0.62), (0, 0.86, 0), "wood_dark")


def kitchen_sink(mesh: Mesh) -> None:
    kitchen_base(mesh)
    box(mesh, (0.46, 0.012, 0.4), (0, 0.9, 0.02), "steel")
    box(mesh, (0.36, 0.006, 0.3), (0, 0.912, 0.04), "grey")
    cylinder(mesh, 0.015, 0.2, (0, 0.9, -0.22), "metal", sides=6)
    box(mesh, (0.03, 0.03, 0.16), (0, 1.08, -0.15), "metal")


def cooker(mesh: Mesh) -> None:
    box(mesh, (0.6, 0.9, 0.6), (0, 0, 0), "steel")
    box(mesh, (0.5, 0.42, 0.02), (0, 0.12, 0.3), "black")
    box(mesh, (0.44, 0.02, 0.03), (0, 0.6, 0.31), "metal")
    box(mesh, (0.6, 0.02, 0.6), (0, 0.9, 0), "black")
    for x in (-0.14, 0.14):
        for z in (-0.13, 0.14):
            cylinder(mesh, 0.085, 0.008, (x, 0.92, z), "grey_dark", sides=10)
    box(mesh, (0.6, 0.1, 0.03), (0, 0.92, -0.285), "steel")


def fridge(mesh: Mesh) -> None:
    box(mesh, (0.6, 1.8, 0.62), (0, 0, -0.01), "steel")
    box(mesh, (0.57, 1.1, 0.03), (0, 0.66, 0.31), "white")
    box(mesh, (0.57, 0.58, 0.03), (0, 0.04, 0.31), "white")
    box(mesh, (0.03, 0.4, 0.03), (-0.22, 0.95, 0.335), "metal")
    box(mesh, (0.03, 0.25, 0.03), (-0.22, 0.32, 0.335), "metal")


def washing_machine(mesh: Mesh) -> None:
    box(mesh, (0.6, 0.85, 0.58), (0, 0, 0), "white")
    box(mesh, (0.56, 0.12, 0.01), (0, 0.71, 0.29), "grey")
    cylinder(mesh, 0.2, 0.02, (0, 0.2, 0.285), "grey_dark", sides=14)
    # The door is a short cylinder lying on its side: build it from a box ring.
    box(mesh, (0.3, 0.3, 0.02), (0, 0.24, 0.3), "glass")
    box(mesh, (0.36, 0.03, 0.03), (0, 0.21, 0.3), "steel")
    box(mesh, (0.36, 0.03, 0.03), (0, 0.54, 0.3), "steel")
    box(mesh, (0.03, 0.36, 0.03), (-0.165, 0.21, 0.3), "steel")
    box(mesh, (0.03, 0.36, 0.03), (0.165, 0.21, 0.3), "steel")


def _bed(mesh: Mesh, width: float, cover: str) -> None:
    length = 2.0
    box(mesh, (width, 0.26, length), (0, 0.08, 0), "wood")
    legs(mesh, width, length, 0.08, "wood_dark", thick=0.07, inset=0.02)
    box(mesh, (width, 0.95, 0.06), (0, 0, -length / 2 - 0.03), "wood")
    box(mesh, (width - 0.06, 0.2, length - 0.06), (0, 0.34, 0), "linen")
    box(
        mesh,
        (width - 0.04, 0.06, length * 0.62),
        (0, 0.52, length * 0.19 - 0.01),
        cover,
    )
    pillows = 2 if width > 1.2 else 1
    span = (width - 0.2) / pillows
    for i in range(pillows):
        x = -width / 2 + 0.1 + span * (i + 0.5)
        box(mesh, (span - 0.08, 0.1, 0.4), (x, 0.54, -length / 2 + 0.28), "white")


def bed_double(mesh: Mesh) -> None:
    _bed(mesh, 1.4, "fabric_blue")


def bed_king(mesh: Mesh) -> None:
    _bed(mesh, 1.6, "fabric_grey")


def bed_single(mesh: Mesh) -> None:
    _bed(mesh, 0.95, "fabric_green")


def bedside_table(mesh: Mesh) -> None:
    box(mesh, (0.45, 0.42, 0.4), (0, 0.1, 0), "wood")
    legs(mesh, 0.45, 0.4, 0.1, "wood_dark", thick=0.04, inset=0.02)
    box(mesh, (0.39, 0.15, 0.02), (0, 0.33, 0.2), "wood_pale")
    box(mesh, (0.39, 0.15, 0.02), (0, 0.14, 0.2), "wood_pale")
    for y in (0.4, 0.21):
        box(mesh, (0.1, 0.015, 0.02), (0, y, 0.215), "metal")


def wardrobe(mesh: Mesh) -> None:
    box(mesh, (1.2, 2.0, 0.6), (0, 0.04, 0), "wood")
    box(mesh, (1.16, 0.04, 0.56), (0, 0, 0), "wood_dark")
    for side in (-1, 1):
        box(mesh, (0.57, 1.9, 0.02), (side * 0.295, 0.09, 0.3), "wood_pale")
        box(mesh, (0.02, 0.3, 0.03), (side * 0.05, 0.95, 0.32), "metal")


def chest_of_drawers(mesh: Mesh) -> None:
    box(mesh, (0.9, 0.78, 0.45), (0, 0.06, 0), "wood")
    legs(mesh, 0.9, 0.45, 0.06, "wood_dark", thick=0.05, inset=0.02)
    for i in range(3):
        y = 0.09 + i * 0.25
        box(mesh, (0.84, 0.22, 0.02), (0, y, 0.225), "wood_pale")
        box(mesh, (0.2, 0.015, 0.02), (0, y + 0.1, 0.24), "metal")


def desk(mesh: Mesh) -> None:
    box(mesh, (1.3, 0.04, 0.65), (0, 0.7, 0), "wood_pale")
    for side in (-1, 1):
        box(mesh, (0.04, 0.7, 0.6), (side * 0.61, 0, 0), "wood_pale")
    box(mesh, (1.18, 0.3, 0.02), (0, 0.36, -0.28), "wood_pale")
    box(mesh, (0.38, 0.46, 0.55), (0.38, 0.22, 0), "white")
    box(mesh, (0.52, 0.32, 0.03), (-0.2, 0.84, -0.18), "black")
    box(mesh, (0.48, 0.28, 0.01), (-0.2, 0.86, -0.16), "screen")
    box(mesh, (0.06, 0.1, 0.04), (-0.2, 0.74, -0.19), "black")
    box(mesh, (0.2, 0.012, 0.14), (-0.2, 0.74, -0.18), "black")


def office_chair(mesh: Mesh) -> None:
    for turn in (0, 60, 120):
        box(mesh, (0.56, 0.03, 0.05), (0, 0.04, 0), "black", turn=turn)
        for end in (-0.26, 0.26):
            x = end * math.cos(math.radians(turn))
            z = -end * math.sin(math.radians(turn))
            cylinder(mesh, 0.025, 0.04, (x, 0, z), "grey_dark", sides=6)
    cylinder(mesh, 0.03, 0.36, (0, 0.06, 0), "metal", sides=6)
    box(mesh, (0.48, 0.07, 0.46), (0, 0.42, 0), "grey_dark")
    box(mesh, (0.44, 0.5, 0.06), (0, 0.55, -0.22), "grey_dark")
    for side in (-1, 1):
        box(mesh, (0.05, 0.03, 0.26), (side * 0.27, 0.64, -0.02), "black")
        box(mesh, (0.04, 0.16, 0.04), (side * 0.27, 0.48, 0.06), "black")


def bath(mesh: Mesh) -> None:
    box(mesh, (1.7, 0.56, 0.7), (0, 0, 0), "white")
    box(mesh, (1.5, 0.02, 0.52), (0, 0.555, 0), "water")
    box(mesh, (1.7, 0.03, 0.09), (0, 0.56, 0.305), "white")
    box(mesh, (1.7, 0.03, 0.09), (0, 0.56, -0.305), "white")
    box(mesh, (0.1, 0.03, 0.52), (0.8, 0.56, 0), "white")
    box(mesh, (0.1, 0.03, 0.52), (-0.8, 0.56, 0), "white")
    cylinder(mesh, 0.015, 0.12, (-0.78, 0.59, 0), "metal", sides=6)
    box(mesh, (0.1, 0.025, 0.03), (-0.74, 0.7, 0), "metal")


def shower(mesh: Mesh) -> None:
    box(mesh, (0.9, 0.08, 0.9), (0, 0, 0), "white")
    box(mesh, (0.02, 1.9, 0.9), (0.44, 0.08, 0), "glass")
    box(mesh, (0.9, 1.9, 0.02), (0, 0.08, 0.44), "glass")
    cylinder(mesh, 0.015, 1.9, (-0.36, 0.08, -0.36), "metal", sides=6)
    box(mesh, (0.2, 0.02, 0.2), (-0.26, 1.96, -0.26), "metal")
    cylinder(mesh, 0.03, 0.01, (0, 0.08, 0), "grey_dark", sides=8)


def toilet(mesh: Mesh) -> None:
    box(mesh, (0.38, 0.38, 0.18), (0, 0.4, -0.26), "white")
    box(mesh, (0.4, 0.03, 0.2), (0, 0.78, -0.26), "white")
    box(mesh, (0.24, 0.36, 0.3), (0, 0, -0.05), "white")
    cylinder(mesh, 0.19, 0.08, (0, 0.34, 0.08), "white", sides=12)
    cylinder(mesh, 0.2, 0.025, (0, 0.42, 0.08), "cream", sides=12)
    box(mesh, (0.05, 0.02, 0.03), (0.1, 0.81, -0.2), "metal")


def basin(mesh: Mesh) -> None:
    box(mesh, (0.56, 0.22, 0.36), (0, 0, -0.03), "grey_dark")
    box(mesh, (0.6, 0.6, 0.42), (0, 0.22, -0.02), "wood_pale")
    box(mesh, (0.62, 0.05, 0.46), (0, 0.82, 0), "white")
    box(mesh, (0.42, 0.01, 0.28), (0, 0.872, 0.03), "water")
    cylinder(mesh, 0.014, 0.14, (0, 0.87, -0.17), "metal", sides=6)
    box(mesh, (0.025, 0.025, 0.12), (0, 1.0, -0.12), "metal")
    for side in (-1, 1):
        box(mesh, (0.27, 0.52, 0.02), (side * 0.145, 0.26, 0.19), "white")


def radiator(mesh: Mesh) -> None:
    box(mesh, (1.0, 0.56, 0.03), (0, 0.14, -0.04), "white")
    for i in range(12):
        box(mesh, (0.05, 0.6, 0.07), (-0.46 + i * 0.0836, 0.12, 0), "white")
    for side in (-1, 1):
        box(mesh, (0.03, 0.14, 0.03), (side * 0.42, 0, 0), "metal")


def stairs(mesh: Mesh) -> None:
    # Thirteen steps up to 2.6 m, running back from the front.
    steps, rise, going, width = 13, 0.2, 0.25, 0.9
    for i in range(steps):
        z = (steps * going) / 2 - going * (i + 0.5)
        box(mesh, (width, rise * (i + 1), going), (0, 0, z), "wood_pale")
        box(mesh, (width, 0.025, going + 0.02), (0, rise * (i + 1), z + 0.01), "wood")


MODELS: tuple[Model, ...] = (
    Model(
        "sofa_2",
        "Sofa, two seats",
        "Living room",
        sofa_2,
        ("couch", "settee"),
        against_wall=True,
    ),
    Model(
        "sofa_3",
        "Sofa, three seats",
        "Living room",
        sofa_3,
        ("couch", "settee"),
        against_wall=True,
    ),
    Model("armchair", "Armchair", "Living room", armchair, ("chair", "seat")),
    Model("coffee_table", "Coffee table", "Living room", coffee_table, ("table",)),
    Model(
        "tv_unit",
        "TV on a unit",
        "Living room",
        tv_unit,
        ("television", "media"),
        kind="media",
        against_wall=True,
        surface=True,
    ),
    Model(
        "bookcase",
        "Bookcase",
        "Living room",
        bookcase,
        ("shelves", "books"),
        against_wall=True,
    ),
    Model("rug", "Rug", "Living room", rug, ("carpet", "mat")),
    Model("plant", "Plant", "Living room", plant, ("pot", "houseplant")),
    Model(
        "floor_lamp",
        "Floor lamp",
        "Lighting",
        floor_lamp,
        ("light", "standard lamp"),
        kind="light",
    ),
    Model(
        "table_lamp",
        "Table lamp",
        "Lighting",
        table_lamp,
        ("light", "bedside"),
        kind="light",
        tabletop=True,
    ),
    Model(
        "ceiling_light",
        "Ceiling light",
        "Lighting",
        ceiling_light,
        ("pendant", "light"),
        kind="light",
        hanging=True,
    ),
    Model(
        "downlight",
        "Downlight",
        "Lighting",
        downlight,
        ("spotlight", "recessed", "ceiling", "light"),
        kind="light",
        hanging=True,
        light_height=2.38,
    ),
    Model(
        "led_strip",
        "LED strip",
        "Lighting",
        led_strip,
        ("strip", "under cabinet", "tape", "light"),
        kind="light",
        light_height=0.0,
        strip=True,
    ),
    Model(
        "desk_lamp",
        "Desk lamp, spring arm",
        "Lighting",
        desk_lamp,
        ("light", "architect", "task", "clamp", "office"),
        kind="light",
        tabletop=True,
        light_height=0.52,
    ),
    Model(
        "light_panel_triangle",
        "Light panel, triangle",
        "Lighting",
        light_panel_triangle,
        ("light", "wall", "panel", "led", "rgb"),
        kind="light",
        against_wall=True,
        mount_height=1.4,
        light_height=0.1,
        lit=True,
    ),
    Model(
        "light_panel_triangle_down",
        "Light panel, triangle pointing down",
        "Lighting",
        light_panel_triangle_down,
        ("light", "wall", "panel", "led", "rgb"),
        kind="light",
        against_wall=True,
        mount_height=1.4,
        light_height=0.1,
        lit=True,
    ),
    Model(
        "light_panel_hexagon",
        "Light panel, hexagon",
        "Lighting",
        light_panel_hexagon,
        ("light", "wall", "panel", "led", "rgb"),
        kind="light",
        against_wall=True,
        mount_height=1.4,
        light_height=0.1,
        lit=True,
    ),
    Model(
        "dining_table",
        "Dining table",
        "Kitchen and dining",
        dining_table,
        ("table",),
        surface=True,
    ),
    Model(
        "dining_table_small",
        "Small table",
        "Kitchen and dining",
        dining_table_small,
        ("table", "breakfast"),
        surface=True,
    ),
    Model("chair", "Dining chair", "Kitchen and dining", chair, ("seat",)),
    Model(
        "kitchen_base",
        "Kitchen unit",
        "Kitchen and dining",
        kitchen_base,
        ("cupboard", "worktop", "counter"),
        against_wall=True,
        surface=True,
    ),
    Model(
        "kitchen_sink",
        "Kitchen sink",
        "Kitchen and dining",
        kitchen_sink,
        ("tap", "worktop"),
        against_wall=True,
    ),
    Model(
        "cooker",
        "Cooker",
        "Kitchen and dining",
        cooker,
        ("oven", "hob", "stove"),
        against_wall=True,
    ),
    Model(
        "fridge",
        "Fridge freezer",
        "Kitchen and dining",
        fridge,
        ("refrigerator",),
        against_wall=True,
    ),
    Model(
        "washing_machine",
        "Washing machine",
        "Kitchen and dining",
        washing_machine,
        ("laundry", "dryer", "dishwasher"),
        against_wall=True,
        surface=True,
    ),
    Model("bed_double", "Double bed", "Bedroom", bed_double, (), against_wall=True),
    Model("bed_king", "King size bed", "Bedroom", bed_king, (), against_wall=True),
    Model("bed_single", "Single bed", "Bedroom", bed_single, (), against_wall=True),
    Model(
        "bedside_table",
        "Bedside table",
        "Bedroom",
        bedside_table,
        ("nightstand", "cabinet"),
        against_wall=True,
        surface=True,
    ),
    Model(
        "wardrobe",
        "Wardrobe",
        "Bedroom",
        wardrobe,
        ("cupboard", "closet"),
        against_wall=True,
    ),
    Model(
        "chest_of_drawers",
        "Chest of drawers",
        "Bedroom",
        chest_of_drawers,
        ("dresser",),
        against_wall=True,
        surface=True,
    ),
    Model(
        "desk",
        "Desk with a monitor",
        "Office",
        desk,
        ("computer", "study"),
        against_wall=True,
        surface=True,
        surface_height=0.74,
    ),
    Model("office_chair", "Office chair", "Office", office_chair, ("seat", "swivel")),
    Model("bath", "Bath", "Bathroom", bath, ("tub",), against_wall=True),
    Model("shower", "Shower", "Bathroom", shower, ("cubicle",), against_wall=True),
    Model("toilet", "Toilet", "Bathroom", toilet, ("wc", "loo"), against_wall=True),
    Model(
        "basin",
        "Basin on a unit",
        "Bathroom",
        basin,
        ("sink", "vanity"),
        against_wall=True,
    ),
    Model(
        "radiator",
        "Radiator",
        "Fittings",
        radiator,
        ("heating",),
        kind="climate",
        against_wall=True,
    ),
    Model("stairs", "Stairs", "Fittings", stairs, ("staircase", "steps"), stairs=True),
    Model(
        "printer",
        "3D printer, enclosed",
        "Workshop and games",
        printer,
        ("printing", "maker", "workshop"),
        kind="light",
        tabletop=True,
        light_height=0.3,
    ),
    Model(
        "printer_feeder",
        "3D printer with filament box",
        "Workshop and games",
        printer_feeder,
        ("printing", "maker", "workshop", "multicolour"),
        kind="light",
        tabletop=True,
        light_height=0.3,
    ),
    Model(
        "printer_large",
        "3D printer, large",
        "Workshop and games",
        printer_large,
        ("printing", "maker", "workshop"),
        kind="light",
        tabletop=True,
        light_height=0.4,
    ),
    Model(
        "printer_large_feeder",
        "3D printer, large, with filament box",
        "Workshop and games",
        printer_large_feeder,
        ("printing", "maker", "workshop", "multicolour"),
        kind="light",
        tabletop=True,
        light_height=0.4,
    ),
    Model(
        "sim_rig",
        "Sim racing rig",
        "Workshop and games",
        sim_rig,
        ("racing", "simulator", "wheel", "cockpit", "gaming"),
    ),
    Model(
        "sim_rig_triple",
        "Sim racing rig, three screens",
        "Workshop and games",
        sim_rig_triple,
        ("racing", "simulator", "wheel", "cockpit", "gaming", "triple"),
    ),
)
