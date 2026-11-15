# Diorama: specification

A Home Assistant custom integration that lets you lay out your house in 3D (floor by floor, room by room, with furniture), place your devices in it, and see and control them there. Lights glow when they are on; tapping a lamp toggles it. The same scene is available as a full-screen panel and as a dashboard card showing the whole house, one floor or one room.

Public release, distributed through the Home Assistant Marketplace (the built-in successor to HACS, from 2026.11).

Status: design agreed, nothing built. Section 12 is the build order. Section 13 records decisions already made. Section 14 records what was checked against the Home Assistant contributor docs (https://contributors.home-assistant.io, which replaced developers.home-assistant.io) and what is still open.

## 1. Goals and non-goals

Goals

- Draw a house in the browser with no external tools: walls, rooms, doors, windows, floors, furniture.
- Know about Home Assistant's floors, areas, devices and entities, so mapping is "drag the six things in Kitchen into place", not typing entity IDs.
- Live, two-way: state changes show in the scene within a frame or two; tapping an object calls the service.
- One install gives both the editor panel and the dashboard card.
- Runs acceptably on a phone and a cheap wall tablet when viewing.
- Looks good: low-poly, stylised, consistent.

Non-goals

- Architectural accuracy, CAD export, or photorealism.
- Importing Sweet Home 3D, IFC or other CAD formats (maybe later; not in v1).
- Editing on touch devices. The editor is desktop (mouse and keyboard). Viewing and control work everywhere.
- Being an add-on/app. There is no container and no separate server.

## 2. Architecture

```
custom_components/diorama/        Python, thin
  storage (.storage via Store)    scene JSON, partitioned per floor
  websocket commands              scene read/write/subscribe, catalogue
  http views                      static frontend, bundled assets, model upload
  panel + card registration

frontend/                         TypeScript, most of the code
  core/      scene model, geometry (wall graph, room detection), no three.js
  render/    three.js renderer shared by panel and card
  editor/    2D plan editor + 3D preview (panel only)
  card/      diorama-card + its config editor
  panel/     sidebar panel shell
```

- Frontend stack: TypeScript, Lit (as Home Assistant's own frontend), three.js, Vite. No React. Lit and three.js are bundled into our own modules; the frontend does not share its copy.
- Elements are standard JavaScript classes (never transpiled to ES5), which the panel loader requires.
- No dependency on Home Assistant's internal `ha-*` elements: they are not a public API and can change in any release. `ha-card` is the one exception, used as the card container. Pickers for areas, floors and entities are our own, built from `hass.areas`, `hass.floors`, `hass.devices` and `hass.entities`.
- Both the panel and the card receive the frontend's `hass` object. All entity state and service calls go through it. The integration never proxies state and the frontend never holds a token. The card subscribes to the `states` context (a `context-request` event) so it is not re-run on every unrelated `hass` change, and then only reacts to the entities in its view.
- Diorama's own data (the scene) goes over custom WebSocket commands on the existing `hass.connection`.
- The card loader registered on every page is a tiny stub. three.js, the renderer and models are loaded with dynamic `import()` only when a card or the panel is actually on screen.

## 3. Repository layout

```
custom_components/diorama/
  __init__.py  manifest.json  config_flow.py  const.py
  store.py     websocket_api.py  http.py
  translations/en.json      custom integrations ship finished files, no strings.json
  brand/icon.png            shown by Home Assistant and the Marketplace
  frontend/dist/            built bundle (release artefact, see 11)
  assets/catalogue.json     bundled furniture catalogue
  assets/models/*.glb
frontend/                   source (src/, package.json, vite.config.ts, tests)
tools/build_catalogue.py    converts source model kits into assets/
tests/                      pytest, integration backend
hacs.json                   Marketplace manifest
SPEC.md  README.md  LICENSE  CREDITS.md
```

Integration domain: `diorama`. Card type: `custom:diorama-card`. Panel path: `/diorama`. Code licence: MIT.

## 4. Backend

Setup

- Config flow, single instance, no options to enter. Adding the integration creates an empty house.
- On setup:
  - Serve `frontend/dist` and `assets` with `hass.http.async_register_static_paths([StaticPathConfig(...)])` under `/diorama_static/`. These are public, unauthenticated files, like everything in `www`, so nothing user-specific goes there.
  - Register the panel with `panel_custom.async_register_panel(hass, frontend_url_path="diorama", webcomponent_name="diorama-panel", module_url=..., sidebar_title="Diorama", sidebar_icon=..., require_admin=True)`.
  - Register the card loader with `frontend.add_extra_js_url(hass, url)`. Diorama is published as an integration, not a dashboard plugin, so the Marketplace does not add a dashboard resource for it; the integration loads its own card.
  - Register the WebSocket commands.
  - Put the integration version in every asset URL (`?v=<version>`) for cache busting.
- `manifest.json`: `domain`, `name`, `version` (same as the release tag; the Marketplace refuses an install without it), `documentation`, `issue_tracker`, `codeowners`, `config_flow: true`, `dependencies: ["http", "frontend", "panel_custom", "websocket_api"]`, `categories` (one to three, from the integration categories list), no `requirements` unless needed.
- The panel owns its whole page: it draws its own header and the button that opens the sidebar on narrow screens, and uses the `narrow` and `route` properties it is given.

Storage

- `Store` helper, so data lands in `.storage` and is in every backup.
- `diorama.house`: house settings and the ordered list of floors (ids, names, elevation, `ha_floor_id`).
- `diorama.floor.<id>`: one file per floor, holding everything on that floor (section 5).
- Every stored document has `schema_version` and a `revision` counter. Migrations run through the Store's migrate hook.
- Uploaded models and trace images live in `<config>/diorama/`, outside `custom_components`, because a Marketplace update replaces the whole integration folder.

WebSocket commands

| Command | Who | Purpose |
|---|---|---|
| `diorama/house/get` | any user | House settings and floor list |
| `diorama/house/save` | admin | Save house settings and floor list |
| `diorama/floor/get` | any user | One floor document |
| `diorama/floor/save` | admin | Save one floor; must send the `revision` it was based on, rejected with `conflict` if stale |
| `diorama/floor/delete` | admin | Delete a floor |
| `diorama/subscribe` | any user | Pushes `{floor_id, revision}` when anything is saved, so open cards reload |
| `diorama/catalogue/get` | any user | Bundled plus uploaded model catalogue |
| `diorama/export` / `diorama/import` | admin | Whole house as one JSON document |

HTTP

- `POST /api/diorama/models` (admin, authenticated): upload a `.glb`. Check the glTF binary magic bytes, cap size at 10 MB, store under a generated id, never use the uploaded filename as a path.
- `DELETE /api/diorama/models/<id>` (admin).
- `GET /api/diorama/models/<id>` and `GET /api/diorama/trace/<id>` (any authenticated user): uploaded files are served through authenticated views, not a static path, and the frontend fetches them with `hass.fetchWithAuth`. Only the bundled CC0 catalogue is public.

Validation: every save is validated server-side with voluptuous against the schema in section 5 (types, ranges, id references). Entity IDs are stored as given and not required to exist, so a removed device does not make a floor unsaveable.

## 5. Scene model

Units are metres and degrees. Plan coordinates are `x` (east) and `y` (south) on the floor; height is `z` in the data and maps to three.js Y. The UI shows metric or imperial following Home Assistant's unit system.

```jsonc
// diorama.floor.<id>
{
  "schema_version": 1, "revision": 12, "id": "f_ground",
  "wall_height": 2.4,
  "vertices": [{ "id": "v1", "x": 0, "y": 0 }],
  "walls": [{ "id": "w1", "a": "v1", "b": "v2", "thickness": 0.1, "height": null }],
  "openings": [{ "id": "o1", "wall": "w1", "type": "door", "offset": 1.2, "width": 0.8,
                 "height": 2.0, "sill": 0, "entity_id": null }],
  "rooms": [{ "id": "r1", "name": "Kitchen", "area_id": "kitchen", "boundary": ["v1","v2","v3","v4"],
              "floor_style": "wood_light", "wall_colour": "#e8e4dc" }],
  "items": [{ "id": "i1", "model": "kenney/sofa_long", "x": 2.1, "y": 3.0, "z": 0,
              "rotation": 90, "scale": 1, "room": "r1" }],
  "fixtures": [{ "id": "x1", "entity_id": "light.kitchen_pendant", "kind": "light",
                 "x": 2.0, "y": 1.5, "z": 2.2, "room": "r1", "item": null,
                 "model": "kenney/lamp_ceiling", "options": {} }],
  "trace": { "image": "trace_ground.png", "scale": 0.012, "x": 0, "y": 0, "opacity": 0.4 }
}
```

- Walls are a graph: vertices and segments between them. Shared walls are one segment, so dragging a vertex moves every wall attached to it.
- Rooms are the closed faces of that graph. After each edit the editor re-detects faces and matches them to the existing rooms (same vertex set first, then centroid containment) so a room keeps its id, name and area through edits. Unmatched old rooms are dropped; new faces become unnamed rooms.
- Openings sit on a wall by offset from vertex `a`. Doors and windows may bind a `binary_sensor` or `cover`.
- An item is furniture. A fixture is something bound to an entity. A fixture can have its own model, or point at an item (`item`) so an existing lamp model becomes the light.
- `trace` is an optional floor-plan image to draw over. The image is stored with uploaded models.
- Stairs are an item with a model in v1 (purely visual). No stairwell cut-outs until later.

## 6. Editor (panel)

Layout: plan view (2D, SVG) as the main working surface, a live 3D preview you can toggle or split, a left rail of tools, a right inspector for the selection, a floor switcher.

Tools

- Wall: click to place vertices, continuous chain, Esc to stop. Snaps to existing vertices, to wall midpoints, to 0/45/90 degrees and to a grid (default 5 cm, Alt disables). Live dimension labels; type a number to set length exactly.
- Select/move: vertices, walls, openings, items, fixtures. Multi-select, delete, duplicate, undo/redo (command stack, at least 100 steps).
- Door/window: click a wall, drag along it, edit width/height/sill in the inspector.
- Room inspector: name, Home Assistant area (picker), floor finish, wall colour. Assigning an area offers that area's name as the room name.
- Furniture: catalogue drawer with search and categories, drag into plan or 3D, rotate with R (15 degree steps, Shift for free), snaps to walls.
- Devices: a drawer listing entities grouped by the selected room's area, unplaced first. Drag one into the room to create a fixture; kind and default model are picked from the entity domain and device class. A toggle shows entities from all areas.
- Trace: upload a plan image, click two points and enter the real distance to set scale.
- Floors: add, rename, reorder, set elevation, link to a Home Assistant floor, "copy outer walls from floor below".

Saving: explicit Save with a dirty indicator, plus autosave of a local draft to `localStorage` so a crashed tab loses nothing. Conflict on save offers reload or overwrite.

## 7. Renderer

- One renderer class used by the panel preview and the card. Input: floor documents, catalogue, a view definition, and `hass`.
- Geometry: walls extruded from the graph with mitred joins and cut-outs for openings; one floor slab per room; no ceilings. Merge static geometry per floor; instance repeated models.
- Look: flat or toon-shaded materials, a small fixed palette, soft ambient light, one directional "sun" with a single shadow map. No physically based lighting.
- Lights are faked, not simulated: an on light gets an emissive material on its model, a soft additive glow sprite, and a coloured wash on its room's floor scaled by brightness. Colour follows `rgb_color` or colour temperature. A small number of real unshadowed point lights (default 4, nearest to camera) can be enabled on capable devices.
- Views: `house` (all floors stacked, exploded spacing optional), `floor`, `room` (that room plus its walls, neighbours hidden or ghosted). Walls between the camera and the room fade out or drop to a low cut height.
- Camera: orbit with limits, pinch and drag on touch, saved presets per view, smooth transitions. Double-tap a room to focus it.
- Day and night: ambient level and sun angle follow `sun.sun`; can be turned off.
- Render on demand only: draw when state, camera or size changes, then stop. No continuous animation loop except during a transition.
- Quality tiers (auto-detected, overridable): low disables shadows, glow sprites become flat, pixel ratio capped at 1; high enables shadows and point lights.

## 8. Entity bindings

A binding is a small module per kind: which entities it accepts, how state maps to visuals, what a tap does. Adding a domain must not touch the renderer core.

| Kind | Entities | Visual | Tap |
|---|---|---|---|
| light | `light.*` | glow, colour, brightness | toggle |
| switch | `switch.*`, `input_boolean.*`, `fan.*` | on/off tint; fan spins | toggle |
| cover | `cover.*` | blind or curtain position, garage door | toggle, confirm for garage |
| opening | `binary_sensor` door/window | door swings, window opens | more-info |
| climate | `climate.*`, temperature `sensor` | room floor tint by temperature, label | more-info |
| presence | occupancy/motion `binary_sensor` | room outline pulse | more-info |
| media | `media_player.*` | screen glow when playing | more-info |
| lock | `lock.*` | padlock icon state | more-info only, never toggles on tap |
| label | any `sensor` | floating value chip | more-info |

- v1 ships `light` and `switch`. The rest follow in the order above (section 12).
- Tap and hold follow Home Assistant's standard action config (`tap_action`, `hold_action`), overridable per fixture. Default hold is more-info, raised by firing the standard `hass-more-info` event.
- Hit targets are padded to at least 44 px on screen regardless of model size.
- `unavailable` and `unknown` render greyed with a small warning marker; a fixture whose entity no longer exists is flagged in the editor.
- State updates are optimistic: show the new state at once, revert if the service call fails.

## 9. Dashboard card

```yaml
type: custom:diorama-card
view: room            # house | floor | room
floor: f_ground       # for view: floor
room: r1              # for view: room
camera: default       # saved preset name
interactive: true     # false = display only, taps ignored
controls: true        # orbit/zoom gestures; false locks the camera
day_night: true
aspect_ratio: "16:9"
```

- Visual config editor (`getConfigElement`) with pickers for view, floor, room and preset; `getStubConfig` returns the whole house. Registered in `window.customCards` with a preview.
- Works in sections layout (`getGridOptions`) and masonry (`getCardSize`).
- A room card fetches only its floor's document.
- Browsers limit live WebGL contexts, so cards do not each own one. A single shared `WebGLRenderer` on an offscreen canvas renders each visible card in turn and copies the result into that card's 2D canvas. Cards off screen (IntersectionObserver) or on a hidden tab are not rendered.
- Subscribes to `diorama/subscribe` and reloads when the scene is saved elsewhere.
- Respects Home Assistant themes for card chrome (background, text) and the user's reduced-motion setting.
- Empty states: no house drawn yet (link to the panel for admins), room or floor no longer exists, WebGL unavailable.

## 10. Furniture catalogue

- Bundled set: Kenney Furniture Kit and Quaternius furniture, both CC0, shipped as GLB. CC0 only in the bundle; anything needing attribution stays out. Sources and licences are still listed in `CREDITS.md`.
- `tools/build_catalogue.py` takes the source kits and writes `assets/models/*.glb` plus `assets/catalogue.json`: id, name, category, tags, real-world footprint and height in metres, the scale factor that gets it to those dimensions, default kind if it is a natural fixture (lamps, TVs), and a thumbnail.
- Source kits are not real-world scale and not consistent with each other; the scale factor in the catalogue is what fixes that. Every model must be checked by eye against a 2.4 m wall.
- Materials are remapped to the Diorama palette at build time so both kits look like one set.
- User uploads appear in the same drawer under "My models", with a dimension prompt on upload.
- Budget: bundled assets under 15 MB total, any single model under 500 KB.

## 11. Quality, testing and release

- Backend: pytest with `pytest-homeassistant-custom-component`. Cover config flow, every WebSocket command (including permissions and the revision conflict), schema validation, storage migration, upload validation.
- Frontend: vitest for `core/` (wall graph edits, room detection and identity matching, opening placement, unit conversion) and for each binding's state-to-visual mapping. `core/` has no three.js or DOM dependency so it tests in plain Node.
- One Playwright smoke test that loads a fixture house in the renderer and compares a screenshot.
- CI on every push and pull request: ruff, pytest, tsc, eslint, vitest, the `hassfest` action, and the HACS action (`hacs/action`) with `category: "integration"`, with no checks ignored. Both must pass for the catalogue.
- Releases: a published GitHub release (a tag alone is not enough) built by a GitHub Action, which attaches `diorama.zip` holding the contents of `custom_components/diorama` with the built `frontend/dist` inside. Built files are not committed to `main`. The tag, `manifest.json` `version` and the frontend cache-busting version are the same string. Release notes are what users see on the update entity, so breaking changes go at the top.
- `hacs.json`: `{"name": "Diorama", "zip_release": true, "filename": "diorama.zip", "homeassistant": "2026.11.0"}`.
- Updates to an integration need a Home Assistant restart; a first install does not (config flow).
- Catalogue: listing for everyone means a pull request to `hacs/default`, which the docs say takes months to be reviewed. It needs a description, topics, issues enabled, a README, a full release, a `brand/icon.png`, and passing hassfest and HACS action runs. Until then users add the repo from a link: put a `marketplace_repository` My link badge (`owner=marctew&repository=HA-Diorama&category=integration`) and a `config_flow_start` badge in the README.
- Translations: `translations/en.json` for the backend (config flow, errors) and a frontend locale file; English only at launch, structured so others can be added.
- Supported Home Assistant: 2026.11 or later (set in `hacs.json` and `manifest.json`).

## 12. Build order

Each stage ends with something that runs and with its tests.

1. Skeleton: integration loads, config flow, empty panel in the sidebar, card registers and shows a placeholder, CI green.
2. Storage and WebSocket API with the full schema, validation, permissions, export/import.
3. Plan editor: walls, snapping, dimensions, undo, room detection, room naming and area assignment. One floor.
4. Renderer: extruded walls and floors, orbit camera, 3D preview in the panel, quality tiers.
5. Furniture: catalogue build tool, bundled set, drawer, placement and rotation.
6. Bindings v1: device drawer, fixtures, `light` and `switch`, live state, tap and hold.
7. Card: house/floor/room views, config editor, shared renderer, visibility handling.
8. Doors and windows, multiple floors, trace image, camera presets.
9. More bindings in the order of the table in section 8; day and night.
10. Release: README with screenshots, CREDITS, model upload, translations structure, Marketplace submission.

Stages 1 to 7 are the first public alpha.

## 13. Decisions already made

- Custom integration, not an add-on/app: one install provides panel and card, works on every installation type, no token handling.
- Distributed through the Marketplace; public repo `marctew/HA-Diorama`; domain `diorama`.
- Low-poly stylised look. CC0 models only in the bundle. Lighting is faked for looks and performance.
- Browser-first. Editor is desktop only; viewing and control work on any device through the card.
- Card can show the whole house, a floor or a room.
- Entity state and service calls go through the frontend `hass` object and WebSocket, never polling.
- Scene stored per floor so a room card loads only what it needs.
- Locks never toggle on tap; garage doors ask first.

## 14. Checked against the docs, and still open

Checked on 2026-11-15 against https://contributors.home-assistant.io (frontend and Marketplace areas) and the Marketplace user docs:

- The Marketplace installs integrations, dashboard plugins, themes and templates on every installation type. It does not install apps (add-ons).
- One repository holds one integration; the Marketplace installs the first folder under `custom_components/`, and everything the integration needs must be inside it. Sections 3, 4 and 11 follow the publisher guides (`hacs.json` keys, `zip_release`, manifest keys, `brand/`, `translations/`, the two CI actions, the catalogue process).
- Custom panels: `panel_custom.async_register_panel()` with `module_url` and `require_admin`; the element receives `hass`, `narrow`, `route` and `panel`.
- Custom cards: `setConfig`, `hass`, `getCardSize`, `getGridOptions`, `preview`; the `states` context subscription; `window.loadCardHelpers()` for dialogs such as the confirmation prompt.
- `hass.states`, `hass.entities`, `hass.devices`, `hass.areas`, `hass.floors`, `hass.callService`, `hass.callWS` and `hass.connection` are all in the hass object reference.

Still open:

- `frontend.add_extra_js_url()` and `hass.http.async_register_static_paths()` are not described in the contributor docs. Their signatures were confirmed in the Home Assistant 2026.2.3 source; confirm them on 2026.11 at the start of stage 1.
- The card config editor API (`getConfigElement`, `getStubConfig`, or a form schema): read https://contributors.home-assistant.io/frontend/custom-ui/card-editor/ at the start of stage 7.
- Which integration `categories` fit: read the categories list at stage 1.
- That no entry in the catalogue (`hacs/default`) already uses the name or domain `diorama`.
