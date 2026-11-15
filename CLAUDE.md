# Diorama

Home Assistant custom integration: draw your house in 3D, place devices in it, show and control it from a panel and a dashboard card. Public, distributed through the Home Assistant Marketplace.

Read SPEC.md before changing behaviour. Section 12 is the build order (all thirteen stages are done), section 13 the decisions already made, section 14 what was checked against the docs and what was learned the hard way.

## Layout

- `custom_components/diorama/`: the integration (Python, thin). `schema.py` validates houses and floors, `store.py` keeps them, `websocket_api.py` exposes them, `http.py` takes uploaded plan images and models, `models.py` keeps the models people add. `frontend/src/core/scene.ts` mirrors `schema.py`: change them together. `frontend/dist/` inside it is build output and is not committed.
- `frontend/`: TypeScript, Lit, Vite. `src/entries/card.ts` is loaded on every Home Assistant page and must stay tiny (no Lit, no three.js); everything heavy is loaded with `import()`. `src/core/` has no DOM or three.js so it tests in Node: `plan.ts` edits the wall graph (every function returns a new floor; `commit` tidies it), `rooms.ts` finds rooms, `snap.ts` snaps. `openings.ts` is doors and windows, `floors.ts` the floors of the house, `trace.ts` the plan image. `items.ts` places, moves and stretches furniture, `fixtures.ts` places and moves entities, `stacking.ts` stands small things on furniture, `stairwells.ts` opens a floor for the stairs below it, and `bindings.ts` says how each kind of entity looks and what a tap does (add a kind there). `sun.ts` turns `sun.sun` into lighting, `upload.ts` sizes a model being added. `mesh.ts` turns a floor into triangles (no three.js, so it is tested). `views.ts` works out what a house, floor or room view shows, `cutaway.ts` which walls to lower. `src/render/` is the only place that imports three.js and is always loaded with `import()`; all views draw through the one WebGL context in `shared-gl.ts`, never make another. `src/card/` is the dashboard card and its config editor. `src/editor/` is the editor UI: `plan-view.ts` is the canvas, `editor.ts` owns undo, saving, drafts and conflicts.
- `tests/`: pytest for the integration. `frontend/tests/`: vitest.
- `tools/build_catalogue.py` builds the bundled furniture (`custom_components/diorama/assets/`) from `tools/catalogue/basics.py` (our own pieces) and `tools/catalogue/kenney.py` (pieces of Kenney's kit, whose files are in `tools/catalogue/kenney/`; add one by giving it an entry in `PIECES`). Run it after changing a model and commit the output; never edit the output by hand. A test compares the two.
- `tools/brand/`: source of the icon; `node tools/brand/make.mjs` regenerates the PNGs in `custom_components/diorama/brand/`. Never edit those by hand.

## Checks

Run all of these before committing; CI runs the same.

- `python -m pytest`, `ruff check .`, `ruff format --check .` (Python 3.14, `pip install -r requirements-dev.txt`)
- in `frontend/`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`

Add a test with every change to logic, backend or frontend. Changes to what the panel or card shows should be looked at in a real Home Assistant, not only unit tested: the card registration bug in SPEC 14 passed every test.

## Rules

- Home Assistant docs are at https://contributors.home-assistant.io (every page has a Markdown version at `<url>/index.md`). Check them before using a Home Assistant API; do not rely on memory.
- No dependency on Home Assistant's internal `ha-*` elements except `ha-card`.
- The version lives in `custom_components/diorama/manifest.json` and must equal the release tag. Pushing that tag makes the release (`.github/workflows/release.yml`).
- UK English in user-facing text. Words in the card, its settings and the 3D view go in `frontend/src/locales/en.ts` and are read with `t()` from `shared/localize.ts`, not written in the component.
- `CHANGELOG.md` gets a line for anything a user would notice; its section for a version is that release's notes.
- A Lit property that is true by default takes `attribute: false` and is set with `.prop=${...}`; a boolean attribute cannot switch it off (SPEC 14).
- Keyboard shortcuts: not `e`, `c`, `d`, `m` or `a`, which Home Assistant takes on every page.
- No backslash escapes in `css` templates: an invalid one silently empties the whole stylesheet (SPEC 14).
