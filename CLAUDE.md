# Diorama

Home Assistant custom integration: draw your house in 3D, place devices in it, show and control it from a panel and a dashboard card. Public, distributed through the Home Assistant Marketplace.

Read SPEC.md before changing behaviour. Section 12 is the build order (stages 1 to 4 are done: the skeleton, storage and the WebSocket API, the plan editor, the 3D renderer), section 13 the decisions already made, section 14 what was checked against the docs and what was learned the hard way.

## Layout

- `custom_components/diorama/`: the integration (Python, thin). `schema.py` validates houses and floors, `store.py` keeps them, `websocket_api.py` exposes them. `frontend/src/core/scene.ts` mirrors `schema.py`: change them together. `frontend/dist/` inside it is build output and is not committed.
- `frontend/`: TypeScript, Lit, Vite. `src/entries/card.ts` is loaded on every Home Assistant page and must stay tiny (no Lit, no three.js); everything heavy is loaded with `import()`. `src/core/` has no DOM or three.js so it tests in Node: `plan.ts` edits the wall graph (every function returns a new floor; `commit` tidies it), `rooms.ts` finds rooms, `snap.ts` snaps. `mesh.ts` turns a floor into triangles (no three.js, so it is tested). `src/render/` is the only place that imports three.js and is always loaded with `import()`. `src/editor/` is the editor UI: `plan-view.ts` is the canvas, `editor.ts` owns undo, saving, drafts and conflicts.
- `tests/`: pytest for the integration. `frontend/tests/`: vitest.
- `tools/brand/`: source of the icon; `node tools/brand/make.mjs` regenerates the PNGs in `custom_components/diorama/brand/`. Never edit those by hand.

## Checks

Run all of these before committing; CI runs the same.

- `python -m pytest`, `ruff check .`, `ruff format --check .` (Python 3.14, `pip install -r requirements-dev.txt`)
- in `frontend/`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`

Add a test with every change to logic, backend or frontend. Changes to what the panel or card shows should be looked at in a real Home Assistant, not only unit tested: the card registration bug in SPEC 14 passed every test.

## Rules

- Home Assistant docs are at https://contributors.home-assistant.io (every page has a Markdown version at `<url>/index.md`). Check them before using a Home Assistant API; do not rely on memory.
- No dependency on Home Assistant's internal `ha-*` elements except `ha-card`.
- The version lives in `custom_components/diorama/manifest.json` and must equal the release tag.
- UK English in user-facing text.
- No backslash escapes in `css` templates: an invalid one silently empties the whole stylesheet (SPEC 14).
