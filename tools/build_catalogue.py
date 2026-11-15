"""Build the bundled furniture catalogue.

    python tools/build_catalogue.py

writes custom_components/diorama/assets/models/<source>/<model>.glb and
assets/catalogue.json. The output is committed, and a test checks that it
matches what this tool makes, so run it after changing a model. Never edit
the output by hand.

Only CC0 models go in the bundle (SPEC.md section 10). So far that is
Diorama's own basic set, built here from boxes and cylinders.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.catalogue import basics
from tools.catalogue.glb import Mesh, encode

ASSETS = (
    Path(__file__).resolve().parent.parent / "custom_components" / "diorama" / "assets"
)
CATALOGUE_VERSION = 1

SOURCES = [
    {
        "id": "basics",
        "name": "Diorama basics",
        "author": "Diorama contributors",
        "licence": "CC0-1.0",
    }
]


def build() -> dict[str, bytes]:
    """Return every file of the catalogue, by path relative to the assets folder."""
    files: dict[str, bytes] = {}
    models = []
    for model in basics.MODELS:
        mesh = Mesh()
        model.build(mesh)
        low, high = mesh.bounds()
        if low[1] < -1e-6:
            raise ValueError(f"{model.id} goes below the floor")
        if low[1] > 1e-6 and not model.hanging:
            raise ValueError(f"{model.id} floats {low[1]:.3f} m above the floor")
        path = f"models/basics/{model.id}.glb"
        files[path] = encode(mesh, model.id)
        entry = {
            "id": f"basics/{model.id}",
            "name": model.name,
            "category": model.category,
            "tags": list(model.tags),
            "source": "basics",
            "file": path,
            # The box the model fills, in metres. It may sit off-centre.
            "width": round(high[0] - low[0], 3),
            "depth": round(high[2] - low[2], 3),
            "height": round(high[1], 3),
            "centre": [
                round((low[0] + high[0]) / 2, 3),
                round((low[2] + high[2]) / 2, 3),
            ],
            "against_wall": model.against_wall,
        }
        if model.hanging:
            entry["hanging"] = True
        if model.kind:
            entry["kind"] = model.kind
        models.append(entry)
    catalogue = {"version": CATALOGUE_VERSION, "sources": SOURCES, "models": models}
    files["catalogue.json"] = (json.dumps(catalogue, indent=2) + "\n").encode()
    return files


def main() -> None:
    files = build()
    for stale in ASSETS.rglob("*"):
        if stale.is_file() and stale.relative_to(ASSETS).as_posix() not in files:
            stale.unlink()
    for path, data in files.items():
        target = ASSETS / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    total = sum(len(data) for data in files.values())
    print(f"{len(files) - 1} models, {total / 1024:.0f} kB in {ASSETS}")


if __name__ == "__main__":
    main()
