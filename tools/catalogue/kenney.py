"""Pieces from Kenney's Furniture Kit (www.kenney.nl), which is CC0.

The kit's own files are in the `kenney` folder beside this one, as they came.
They are about half real size, start at a corner and carry the kit's colours,
so each piece used is listed here with the size it should really be, and is
rebuilt like the basic set: real size, standing on the floor, middle on the
origin, facing +Z, in the one palette.

Only pieces that stand on the floor or hang from the ceiling are taken:
furniture cannot yet be put on a table or a wall. To add one, give it an
entry in PIECES, run tools/build_catalogue.py, and look at it in the drawer
beside a 2.4 m wall.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .basics import Model
from .glb import Mesh
from .gltf_read import bounds, quarter_turn, read_triangles
from .shapes import colour

FOLDER = Path(__file__).parent / "kenney"

# The kit is modelled at about half size.
KIT_SCALE = 2.0
# How high the ceiling is taken to be for things that hang from it.
CEILING = 2.4

# The kit's materials in our palette.
PAINT = {
    "wood": "wood",
    "woodDark": "wood_dark",
    "metal": "steel",
    "metalLight": "white",
    "metalMedium": "grey_dark",
    "metalDark": "black",
    "carpet": "fabric_warm",
    "carpetBlue": "fabric_blue",
    "carpetDarker": "terracotta",
    "carpetWhite": "linen",
    "fur": "wood",
    "glass": "glass",
    "lamp": "glow",
    "plant": "leaf",
    "_defaultMat": "white",
    "": "grey",
}


@dataclass(frozen=True)
class Piece:
    """One model of the kit and how it is to appear."""

    file: str
    id: str
    name: str
    category: str
    tags: tuple[str, ...] = ()
    # Real sizes in metres. Any left out follow the others; with none given
    # the piece is the kit's size doubled.
    width: float | None = None
    height: float | None = None
    depth: float | None = None
    # Quarter turns to bring its front round to +Z.
    turn: int = 0
    against_wall: bool = False
    hanging: bool = False
    kind: str | None = None
    # Materials to paint differently from PAINT, by the kit's name for them.
    paint: tuple[tuple[str, str], ...] = ()


def _build(piece: Piece, mesh: Mesh) -> None:
    triangles = [
        (
            quarter_turn(a, piece.turn),
            quarter_turn(b, piece.turn),
            quarter_turn(c, piece.turn),
            m,
        )
        for a, b, c, m in read_triangles(FOLDER / f"{piece.file}.glb")
    ]
    low, high = bounds(triangles)
    wanted = (piece.width, piece.height, piece.depth)
    given = [
        target / (high[axis] - low[axis])
        for axis, target in enumerate(wanted)
        if target is not None and high[axis] > low[axis]
    ]
    # Axes with no size of their own keep the piece in proportion.
    rest = sum(given) / len(given) if given else KIT_SCALE
    scale = [
        target / (high[axis] - low[axis])
        if target is not None and high[axis] > low[axis]
        else rest
        for axis, target in enumerate(wanted)
    ]
    middle = ((low[0] + high[0]) / 2, (low[2] + high[2]) / 2)
    lift = CEILING - (high[1] - low[1]) * scale[1] if piece.hanging else 0.0
    paint = {**PAINT, **dict(piece.paint)}

    def place(point: tuple[float, ...]) -> tuple[float, float, float]:
        return (
            (point[0] - middle[0]) * scale[0],
            (point[1] - low[1]) * scale[1] + lift,
            (point[2] - middle[1]) * scale[2],
        )

    for a, b, c, material in triangles:
        mesh.triangle(place(a), place(b), place(c), colour(paint.get(material, "grey")))


def _model(piece: Piece) -> Model:
    return Model(
        piece.id,
        piece.name,
        piece.category,
        lambda mesh, piece=piece: _build(piece, mesh),
        piece.tags,
        kind=piece.kind,
        against_wall=piece.against_wall,
        hanging=piece.hanging,
    )


LIVING = "Living room"
LIGHTING = "Lighting"
KITCHEN = "Kitchen and dining"
BEDROOM = "Bedroom"
OFFICE = "Office"
BATHROOM = "Bathroom"
FITTINGS = "Fittings"
GREY = (("carpet", "fabric_grey"),)
GREEN = (("carpet", "fabric_green"),)

PIECES: tuple[Piece, ...] = (
    # Living room.
    Piece(
        "loungeSofa",
        "sofa_lounge",
        "Sofa, low",
        LIVING,
        ("couch", "settee"),
        against_wall=True,
        paint=GREY,
    ),
    Piece(
        "loungeSofaLong",
        "sofa_chaise",
        "Sofa with a chaise",
        LIVING,
        ("couch", "settee", "corner"),
        against_wall=True,
        paint=GREY,
    ),
    Piece(
        "loungeSofaCorner",
        "sofa_corner",
        "Sofa, corner",
        LIVING,
        ("couch", "settee", "l-shaped"),
        against_wall=True,
        paint=GREY,
    ),
    Piece(
        "loungeSofaOttoman",
        "footstool",
        "Footstool",
        LIVING,
        ("ottoman", "pouffe"),
        paint=GREY,
    ),
    Piece(
        "loungeChair",
        "lounge_chair",
        "Armchair, low",
        LIVING,
        ("chair", "seat"),
        paint=GREEN,
    ),
    Piece(
        "loungeChairRelax",
        "recliner",
        "Recliner",
        LIVING,
        ("chair", "armchair"),
        paint=GREEN,
    ),
    Piece(
        "loungeDesignSofa",
        "sofa_modern",
        "Sofa, modern",
        LIVING,
        ("couch", "settee"),
        against_wall=True,
    ),
    Piece(
        "loungeDesignSofaCorner",
        "sofa_modern_corner",
        "Sofa, modern corner",
        LIVING,
        ("couch", "settee", "l-shaped"),
        against_wall=True,
    ),
    Piece(
        "loungeDesignChair",
        "armchair_modern",
        "Loveseat, modern",
        LIVING,
        ("chair", "seat"),
    ),
    Piece(
        "tableCoffeeGlass",
        "coffee_table_glass",
        "Coffee table, glass",
        LIVING,
        ("table",),
        width=1.1,
    ),
    Piece(
        "tableCoffeeSquare",
        "coffee_table_square",
        "Coffee table, square",
        LIVING,
        ("table",),
        width=0.7,
    ),
    Piece(
        "sideTable",
        "console_table",
        "Console table",
        LIVING,
        ("side table", "hall"),
        against_wall=True,
    ),
    Piece(
        "sideTableDrawers",
        "sideboard",
        "Sideboard",
        LIVING,
        ("drawers", "cabinet"),
        against_wall=True,
    ),
    Piece(
        "cabinetTelevision",
        "tv_cabinet",
        "TV cabinet",
        LIVING,
        ("television", "unit", "media"),
        against_wall=True,
    ),
    Piece(
        "bookcaseClosedWide",
        "bookcase_wide",
        "Bookcase, wide",
        LIVING,
        ("shelves", "books"),
        width=1.6,
        height=1.8,
        depth=0.4,
        against_wall=True,
    ),
    Piece(
        "bookcaseOpenLow",
        "shelves_low",
        "Shelves, low",
        LIVING,
        ("bookcase", "books"),
        against_wall=True,
    ),
    Piece(
        "bookcaseClosedDoors",
        "cupboard",
        "Cupboard",
        LIVING,
        ("cabinet", "storage"),
        width=0.85,
        height=1.8,
        depth=0.45,
        against_wall=True,
    ),
    Piece(
        "speaker",
        "speaker",
        "Speaker",
        LIVING,
        ("hi-fi", "music", "media"),
        height=1.0,
        kind="media",
    ),
    Piece(
        "rugRound",
        "rug_round",
        "Rug, round",
        LIVING,
        ("carpet", "mat"),
        width=1.6,
        depth=1.6,
        height=0.016,
        paint=(("carpet", "fabric_blue"), ("carpetDarker", "linen")),
    ),
    Piece(
        "rugRectangle",
        "rug_large",
        "Rug, large",
        LIVING,
        ("carpet", "mat"),
        width=2.6,
        depth=1.7,
        height=0.016,
        paint=(("carpet", "cream"), ("carpetDarker", "fabric_warm")),
    ),
    Piece("pottedPlant", "plant_tall", "Plant, tall", LIVING, ("pot", "houseplant")),
    Piece(
        "plantSmall1",
        "plant_small",
        "Plant, small",
        LIVING,
        ("pot", "houseplant"),
        height=0.5,
        paint=(("wood", "terracotta"),),
    ),
    # Lighting.
    Piece(
        "lampRoundFloor",
        "floor_lamp_round",
        "Floor lamp, round shade",
        LIGHTING,
        ("light", "standard lamp"),
        height=1.6,
        kind="light",
    ),
    Piece(
        "lampSquareFloor",
        "floor_lamp_square",
        "Floor lamp, square shade",
        LIGHTING,
        ("light", "standard lamp"),
        height=1.6,
        kind="light",
    ),
    Piece(
        "lampSquareCeiling",
        "ceiling_light_square",
        "Ceiling light, square",
        LIGHTING,
        ("pendant", "light"),
        hanging=True,
        kind="light",
    ),
    Piece(
        "ceilingFan",
        "ceiling_fan",
        "Ceiling fan",
        LIGHTING,
        ("fan",),
        width=1.1,
        depth=1.1,
        height=0.3,
        hanging=True,
        kind="switch",
    ),
    # Kitchen and dining.
    Piece(
        "kitchenCabinet",
        "base_unit_door",
        "Base unit, door",
        KITCHEN,
        ("cupboard", "worktop", "cabinet"),
        width=0.6,
        height=0.9,
        depth=0.62,
        against_wall=True,
    ),
    Piece(
        "kitchenCabinetDrawer",
        "base_unit_drawers",
        "Base unit, drawers",
        KITCHEN,
        ("cupboard", "worktop", "cabinet"),
        width=0.6,
        height=0.9,
        depth=0.62,
        against_wall=True,
    ),
    Piece(
        "kitchenCabinetCornerInner",
        "base_unit_corner",
        "Base unit, corner",
        KITCHEN,
        ("cupboard", "worktop", "cabinet"),
        width=0.62,
        height=0.9,
        depth=0.62,
        against_wall=True,
    ),
    Piece(
        "kitchenSink",
        "sink_unit",
        "Sink unit, mixer tap",
        KITCHEN,
        ("tap", "basin"),
        width=0.6,
        height=0.98,
        depth=0.62,
        against_wall=True,
    ),
    Piece(
        "kitchenStove",
        "cooker_gas",
        "Cooker, gas",
        KITCHEN,
        ("oven", "hob", "stove"),
        width=0.6,
        height=0.9,
        depth=0.62,
        against_wall=True,
    ),
    Piece(
        "kitchenStoveElectric",
        "cooker_electric",
        "Cooker, electric",
        KITCHEN,
        ("oven", "hob", "stove"),
        width=0.6,
        height=0.9,
        depth=0.62,
        against_wall=True,
    ),
    Piece(
        "kitchenFridgeLarge",
        "fridge_american",
        "Fridge freezer, double",
        KITCHEN,
        ("refrigerator", "american"),
        width=0.9,
        height=1.8,
        depth=0.7,
        against_wall=True,
    ),
    Piece(
        "kitchenFridgeSmall",
        "fridge_small",
        "Fridge, under the counter",
        KITCHEN,
        ("refrigerator",),
        width=0.6,
        height=0.85,
        depth=0.6,
        against_wall=True,
    ),
    Piece(
        "dryer",
        "tumble_dryer",
        "Tumble dryer",
        KITCHEN,
        ("laundry", "utility"),
        width=0.6,
        height=0.85,
        depth=0.6,
        against_wall=True,
    ),
    Piece(
        "washerDryerStacked",
        "washer_dryer_stacked",
        "Washer and dryer, stacked",
        KITCHEN,
        ("laundry", "utility", "washing machine"),
        width=0.6,
        height=1.7,
        depth=0.6,
        against_wall=True,
    ),
    Piece(
        "kitchenBar",
        "breakfast_bar",
        "Breakfast bar",
        KITCHEN,
        ("island", "counter"),
        width=1.2,
        height=0.95,
        depth=0.5,
    ),
    Piece(
        "stoolBar", "bar_stool", "Bar stool", KITCHEN, ("seat", "chair"), height=0.75
    ),
    Piece(
        "table",
        "dining_table_long",
        "Dining table, six seats",
        KITCHEN,
        ("table",),
        width=1.8,
        height=0.75,
        depth=0.9,
    ),
    Piece(
        "tableCross",
        "trestle_table",
        "Trestle table",
        KITCHEN,
        ("table", "dining"),
        width=1.8,
        height=0.75,
        depth=0.9,
    ),
    Piece(
        "chairCushion",
        "chair_cushion",
        "Dining chair, cushioned",
        KITCHEN,
        ("seat",),
        width=0.44,
        height=0.92,
        depth=0.44,
        paint=GREEN,
    ),
    Piece(
        "chairModernCushion",
        "chair_modern",
        "Dining chair, modern",
        KITCHEN,
        ("seat",),
        width=0.44,
        height=0.9,
        depth=0.44,
    ),
    Piece(
        "bench",
        "bench",
        "Bench",
        KITCHEN,
        ("seat", "dining", "hall"),
        width=1.1,
        height=0.9,
        depth=0.42,
    ),
    # Bedroom.
    Piece(
        "bedBunk",
        "bunk_bed",
        "Bunk bed",
        BEDROOM,
        ("bed", "children"),
        width=1.0,
        height=1.65,
        depth=2.06,
        against_wall=True,
        paint=(("carpet", "fabric_blue"),),
    ),
    Piece(
        "cabinetBedDrawer",
        "bedside_cabinet",
        "Bedside cabinet",
        BEDROOM,
        ("bedside table", "nightstand"),
        against_wall=True,
    ),
    Piece(
        "deskCorner",
        "desk_corner",
        "Desk, corner",
        OFFICE,
        ("table", "work"),
        against_wall=True,
    ),
    Piece(
        "chairDesk",
        "desk_chair",
        "Desk chair, high back",
        OFFICE,
        ("office chair", "swivel"),
        height=1.15,
        paint=(("carpet", "fabric_blue"),),
    ),
    # Bathroom.
    Piece(
        "bathtub",
        "bath_taps",
        "Bath, with taps",
        BATHROOM,
        ("bathtub", "tub"),
        width=1.7,
        height=0.6,
        depth=0.75,
        against_wall=True,
        paint=(("carpetWhite", "white"),),
    ),
    Piece(
        "bathroomCabinetDrawer",
        "vanity_unit",
        "Vanity unit",
        BATHROOM,
        ("basin", "sink", "cabinet"),
        width=0.6,
        height=0.85,
        depth=0.46,
        against_wall=True,
        paint=(("carpetWhite", "white"),),
    ),
    Piece(
        "showerRound",
        "shower_quadrant",
        "Shower, quadrant",
        BATHROOM,
        ("cubicle", "enclosure"),
        width=0.9,
        height=2.0,
        depth=0.9,
        against_wall=True,
        paint=(("carpetWhite", "white"),),
    ),
    Piece(
        "toiletSquare",
        "toilet_square",
        "Toilet, square",
        BATHROOM,
        ("wc", "loo"),
        width=0.4,
        height=0.8,
        depth=0.66,
        against_wall=True,
        paint=(("carpetWhite", "white"),),
    ),
    # Fittings.
    Piece(
        "stairsOpen",
        "stairs_open",
        "Stairs, open",
        FITTINGS,
        ("staircase", "steps"),
        turn=1,
        width=0.9,
        height=2.6,
        depth=3.3,
    ),
    Piece(
        "stairsCorner",
        "stairs_turn",
        "Stairs, with a turn",
        FITTINGS,
        ("staircase", "steps", "corner"),
        width=2.4,
        height=2.6,
        depth=1.95,
    ),
    Piece(
        "coatRackStanding",
        "coat_stand",
        "Coat stand",
        FITTINGS,
        ("hall", "rack"),
        height=1.75,
    ),
    Piece(
        "rugDoormat",
        "doormat",
        "Doormat",
        FITTINGS,
        ("mat", "hall"),
        width=0.7,
        depth=0.42,
        height=0.014,
        paint=(("wood", "wood_dark"),),
    ),
    Piece(
        "trashcan", "bin", "Bin", FITTINGS, ("rubbish", "waste", "trash"), height=0.6
    ),
    Piece(
        "cardboardBoxClosed",
        "box",
        "Cardboard box",
        FITTINGS,
        ("storage", "moving"),
        height=0.45,
        paint=(("wood", "wood_pale"), ("woodDark", "wood")),
    ),
)

MODELS: tuple[Model, ...] = tuple(_model(piece) for piece in PIECES)
