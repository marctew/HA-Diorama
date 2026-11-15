# Diorama: specification

A Home Assistant custom integration that lets you lay out your house in 3D (floor by floor, room by room, with furniture), place your devices in it, and see and control them there. Lights glow when they are on; tapping a lamp toggles it. The same scene is available as a full-screen panel and as a dashboard card showing the whole house, one floor or one room.

Public release, distributed through the Home Assistant Marketplace (the built-in successor to HACS, from 2026.11).

Status: design agreed; stages 1 to 5 are built: the skeleton, storage and the WebSocket API, the plan editor for walls and rooms, the 3D renderer with its preview in the editor, and furniture. Section 12 is the build order. Section 13 records decisions already made. Section 14 records what was checked against the Home Assistant contributor docs (https://contributors.home-assistant.io, which replaced developers.home-assistant.io) and what is still open.

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
  - Serve `frontend/dist` under `/diorama_static/<version>/` and `assets` under `/diorama_assets/<version>/` with `hass.http.async_register_static_paths([StaticPathConfig(...)])`. These are public, unauthenticated files, like everything in `www`, so nothing user-specific goes there.
  - Register the panel with `panel_custom.async_register_panel(hass, frontend_url_path="diorama", webcomponent_name="diorama-panel", module_url=..., sidebar_title="Diorama", sidebar_icon=..., require_admin=True)`.
  - Register the card loader with `frontend.add_extra_js_url(hass, url)`. Diorama is published as an integration, not a dashboard plugin, so the Marketplace does not add a dashboard resource for it; the integration loads its own card.
  - Register the WebSocket commands.
  - Put the integration version in the path of every asset URL (`/diorama_static/<version>/...`) for cache busting. Not in a query string: see section 14.
- `manifest.json`: `domain`, `name`, `version` (same as the release tag; the Marketplace refuses an install without it), `documentation`, `issue_tracker`, `codeowners`, `config_flow: true`, `dependencies: ["http", "frontend", "panel_custom", "websocket_api"]`, `categories` (one to three, from the integration categories list), no `requirements` unless needed.
- The panel owns its whole page: it draws its own header and the button that opens the sidebar on narrow screens, and uses the `narrow` and `route` properties it is given.

Storage (`store.py`, built)

- `Store` helper, so data lands in `.storage` and is in every backup.
- `diorama.house`: house settings and the ordered list of floors (ids, names, elevation, `ha_floor_id`).
- `diorama.floor.<id>`: one file per floor, holding everything on that floor (section 5). A floor that is listed but has never been saved has no file and reads as empty.
- Every document has `schema_version` and a `revision` that goes up by one with each save. Both are set by the server; a client can send them back and they are ignored. Format changes later go through the Store's migrate hook.
- Uploaded models and trace images live in `<config>/diorama/`, outside `custom_components`, because a Marketplace update replaces the whole integration folder.
- Removing the integration leaves the stored house in place, so removing and adding it again loses nothing.

WebSocket commands (`websocket_api.py`, built)

| Command | Who | Purpose |
|---|---|---|
| `diorama/house/get` | any user | Returns `{house}`: settings, floor list, revision |
| `diorama/house/save` `{revision, house}` | admin | Saves settings and the floor list. Can rename, reorder and add floors; leaving an existing floor out is refused |
| `diorama/floor/get` `{floor_id}` | any user | Returns `{floor}` |
| `diorama/floor/save` `{floor_id, revision, floor}` | admin | Saves one floor and returns it with its new revision |
| `diorama/floor/delete` `{floor_id}` | admin | Removes the floor from the house and deletes its file |
| `diorama/subscribe` | any user | Events: `{type: "house", revision}`, `{type: "floor", floor_id, revision}`, `{type: "floor_deleted", floor_id}`, `{type: "reset", revision}` after an import |
| `diorama/export` | admin | Returns `{export: {diorama_export: 1, house, floors: {id: floor}}}` |
| `diorama/import` `{data}` | admin | Replaces the whole house with an export. Every revision jumps above anything a client can be holding |
| `diorama/catalogue/get` | any user | Returns `{catalogue}`: the bundled models (section 10) and `base_url`, where their files are served. Uploaded models join it in stage 10 |

Errors use Home Assistant's `{code, message}`: `invalid_format` with the path of the problem (`walls.0.b: there is no vertex 'v9'`), `conflict` when `revision` is not the current one (nothing is saved; the client reloads), `not_found` for an unknown floor, `unauthorized` for a non-admin, `invalid_stored_data` when a stored floor fails validation.

HTTP (not built; uploads come with the trace image in stage 8 and model upload in stage 10)

- `POST /api/diorama/models` (admin, authenticated): upload a `.glb`. Check the glTF binary magic bytes, cap size at 10 MB, store under a generated id, never use the uploaded filename as a path.
- `DELETE /api/diorama/models/<id>` (admin).
- `GET /api/diorama/models/<id>` and `GET /api/diorama/trace/<id>` (any authenticated user): uploaded files are served through authenticated views, not a static path, and the frontend fetches them with `hass.fetchWithAuth`. Only the bundled CC0 catalogue is public.

Validation (`schema.py`, built): every save is checked against section 5: types, ranges, size limits, unique ids and references between walls, vertices, openings, rooms, items and fixtures. Stored documents are checked again when they are loaded: a broken house stops setup with an error naming the file, a broken floor is reported instead of served, and neither file is touched, so a backup can be restored or an import laid over it. Entity IDs are checked for shape only and not required to exist, so a removed device does not make a floor unsaveable. Schemas are written with `import voluptuous as vol`, which Home Assistant resolves to Probatio, its own validation library since 2026.9.

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

Layout: plan view (2D, SVG) as the main working surface, floating tool and save bars over it, a right inspector for the selection, and a live 3D preview: plan only, side by side (the default) or 3D only, remembered per browser. The preview follows every edit and picks out the selected room. On a narrow screen only the 3D view is shown. The floor switcher comes with stage 8.

Built (stage 3)

- Wall tool (`W`): click to place corners in a continuous run; Esc, right-click or double-click stops, and so does landing on a corner or wall that is already there. Live dimension label; type a length and press Enter to place the wall at exactly that length in the direction of the pointer.
- Snapping, in order: an existing corner, the middle of a wall, a point on a wall, 0/45/90 degrees from the last corner (then level with another corner, else a 5 cm step of length), level with other corners on each axis, the 5 cm grid. A wall drawn nearly square onto another lands where its straight line meets it, so it comes out straight. Alt switches snapping off. Guide lines show what a point lined up with.
- Select tool (`V`): click a corner, wall or room; Shift-click to add corners and walls; drag to move them (the grabbed corner snaps, the rest keep their places relative to it); Delete removes. Dragging the background pans, scrolling zooms about the pointer, space-drag and the middle button pan anywhere.
- The wall graph is tidied after every finished edit (`core/plan.ts`): corners in the same place merge, a wall is split where another wall meets or crosses it, duplicates and zero-length walls go, corners no wall uses go. Deleting a wall rejoins the straight run it split. Deleting a corner in a run joins its two walls.
- Rooms are found again after every edit (`core/rooms.ts`) and keep their id, name and area through moves, splits and joins, as section 5 describes.
- Inspector: a room's name, Home Assistant area (grouped by floor; picking one names an unnamed room), floor finish, wall colour, area and perimeter; a wall's length (the end with fewer walls attached moves) and thickness; a corner's position; the floor's wall height and totals.
- Furniture tool (`F`): a drawer docked beside the plan with the catalogue by category, a search box and a picture of each piece. Pick one, then click in the plan to place it, as many times as you like; `R` turns it 15 degrees (Shift+`R` the other way) before or after placing; Esc stops. A piece that belongs against a wall (a sofa, a bed, a wardrobe) turns its back to a wall when it is brought near one and sits flat against it; Alt switches that off.
- Furniture is selected, dragged, deleted and undone like walls, and can be selected together with them. Ctrl+D duplicates the selected pieces. Shift-drag on the background selects every corner, whole wall and piece of furniture in a box.
- Each piece records the room it stands in, and that follows when it is moved or the walls around it change. The inspector shows its position, rotation, size and room.
- Undo and redo (200 steps), Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y.
- Saving: explicit Save (Ctrl+S) with a status. Unsaved edits are written to `localStorage` as a draft as you go and offered back after a reload or crash. If the floor is saved elsewhere meanwhile, the editor reloads when there is nothing unsaved, and otherwise offers "load their version" or "save mine over it". Leaving the page with unsaved edits asks first.
- Lengths and areas follow Home Assistant's unit system, for display and for typed input.
- On a narrow screen the editor shows the 3D view only: look, do not edit.

Still to come

- Door/window: click a wall, drag along it, edit width/height/sill in the inspector (stage 8).
- Placing furniture by dragging it out of the drawer, and into the 3D view. For now: pick, then click in the plan.
- Devices: a drawer listing entities grouped by the selected room's area, unplaced first. Drag one into the room to create a fixture; kind and default model are picked from the entity domain and device class. A toggle shows entities from all areas (stage 6).
- Trace: upload a plan image, click two points and enter the real distance to set scale (stage 8).
- Floors: add, rename, reorder, set elevation, link to a Home Assistant floor, "copy outer walls from floor below" (stage 8). Until then the panel creates one "Ground floor" and shows a plain picker if the house has more.

## 7. Renderer

- One renderer class (`render/scene-renderer.ts`) used by the panel preview and, from stage 7, the card. Input: floor documents with their elevations, and what to highlight. three.js and the renderer are in a chunk of their own, fetched the first time a 3D view is shown.
- The triangles are made without three.js (`core/mesh.ts`), so that part is unit tested: each wall is a solid whose corners are mitred against its neighbours, so walls tile without gaps or overlap; each face of a wall takes the wall colour of the room it looks into, and the outside colour where it looks into none; one slab per room in its floor finish's colour; no ceilings. One mesh of walls and one of slabs per floor, coloured per vertex.
- Look: flat-shaded materials, a small fixed palette, soft sky and ambient light, one directional "sun" with a single shadow map. No physically based lighting. The background is transparent, so the page shows through.
- Furniture: each model file is loaded once and drawn as one instanced mesh per model, whatever the number of pieces. A model the catalogue does not know, or that fails to load, is a grey box.
- Camera: orbit with limits, pinch and drag on touch, zoom limited to the size of the house. It frames the whole house until someone moves it, and "Reset view" frames it again. Editing the floor does not move the camera.
- Render on demand only: a frame is drawn when the content, camera or size changes, and while the camera glides to a stop. Measured idle: no frames.
- Quality tiers (`core/quality.ts`), picked from the device's cores, memory and whether it is a phone or tablet, overridable: low has no shadows or antialiasing and a pixel ratio of 1; medium has a 1024 shadow map and a pixel ratio up to 1.5; high a 2048 shadow map and up to 2.

Still to come

- Cut-outs for doors and windows (stage 8).
- Lights are faked, not simulated: an on light gets an emissive material on its model, a soft additive glow sprite, and a coloured wash on its room's floor scaled by brightness. Colour follows `rgb_color` or colour temperature. A small number of real unshadowed point lights (default 4, nearest to camera) can be enabled on capable devices (stage 6).
- Views: `house` (all floors stacked, exploded spacing optional), `floor`, `room` (that room plus its walls, neighbours hidden or ghosted). Walls between the camera and the room fade out or drop to a low cut height. Saved camera presets per view, smooth transitions, double-tap a room to focus it (stages 7 and 8). The mesh builder already takes a maximum wall height for the cut.
- Day and night: ambient level and sun angle follow `sun.sun`; can be turned off (stage 9).

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

Built (stage 5)

- `tools/build_catalogue.py` writes `custom_components/diorama/assets/`: one `.glb` per model under `models/<source>/`, and `catalogue.json` listing each model's id, name, category, search tags, source, file, the box it fills in metres (width, depth, height and where the middle of that box is from the model's origin), whether it stands against a wall or hangs from the ceiling, and the kind of fixture it naturally is (lamps, the TV, the radiator). The output is committed, and a test fails if it is not what the tool builds.
- The bundled set is "Diorama basics": 33 original low-poly pieces at typical UK sizes, defined in `tools/catalogue/basics.py` from boxes and cylinders with one small palette, and released as CC0. About 520 kB in all.
- Model format: one mesh, `POSITION`, `NORMAL` and `COLOR_0`, no textures; metres, +Y up, standing on y = 0, front facing +Z. The loader in the frontend accepts any `.glb` and reduces it to that (meshes merged, material colours baked into vertex colours, textures ignored), so other kits and uploads go through the same path.
- Pictures for the drawer are drawn in the browser from the models themselves, so there are no thumbnail files to keep in step.
- Only CC0 models are bundled; a test checks every model's source says so. Sources and licences are listed in `CREDITS.md`.

Not done

- The Kenney Furniture Kit and Quaternius furniture (both CC0) were the plan for the bundled set. The Kenney kit could not be fetched automatically: the site hands out its download through a signed link behind a "continue without donating" step, and scripting round that is not something to do without the owner's say. To add it, download the kit by hand, and extend `tools/build_catalogue.py` to read its `.glb` files, set each model's real-world scale (the kits are not at real scale or consistent with each other), remap materials to the palette, and check every model by eye against a 2.4 m wall. Quaternius has not been looked at.
- User uploads ("My models", with a dimension prompt) come in stage 10.
- Budget: bundled assets under 15 MB total, any single model under 500 kB (the second is tested).

## 11. Quality, testing and release

- Backend: pytest with `pytest-homeassistant-custom-component`. Cover config flow, every WebSocket command (including permissions and the revision conflict), schema validation, storage migration, upload validation.
- Frontend: vitest for `core/` (wall graph edits, room detection and identity matching, opening placement, unit conversion) and for each binding's state-to-visual mapping. `core/` has no three.js or DOM dependency so it tests in plain Node.
- One Playwright smoke test that loads a fixture house in the renderer and compares a screenshot. Not written yet: the renderer has so far been checked by hand in a real Home Assistant (does it draw, does the camera move, does it stop drawing when idle).
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
- The bundled furniture is Diorama's own set for now, not Kenney's (section 10).
- Removing the integration keeps the stored house. Deleting a floor is its own explicit command and cannot happen as a side effect of saving the floor list.
- Ids (floors, vertices, walls and so on) are made by the client: lowercase letters, digits and underscores, at most 32 characters.

## 14. Checked against the docs, and still open

Checked on 2026-11-15 against https://contributors.home-assistant.io (frontend and Marketplace areas) and the Marketplace user docs:

- The Marketplace installs integrations, dashboard plugins, themes and templates on every installation type. It does not install apps (add-ons).
- One repository holds one integration; the Marketplace installs the first folder under `custom_components/`, and everything the integration needs must be inside it. Sections 3, 4 and 11 follow the publisher guides (`hacs.json` keys, `zip_release`, manifest keys, `brand/`, `translations/`, the two CI actions, the catalogue process).
- Custom panels: `panel_custom.async_register_panel()` with `module_url` and `require_admin`; the element receives `hass`, `narrow`, `route` and `panel`.
- Custom cards: `setConfig`, `hass`, `getCardSize`, `getGridOptions`, `preview`; the `states` context subscription; `window.loadCardHelpers()` for dialogs such as the confirmation prompt.
- `hass.states`, `hass.entities`, `hass.devices`, `hass.areas`, `hass.floors`, `hass.callService`, `hass.callWS` and `hass.connection` are all in the hass object reference.

Learned while building stage 1 (run against Home Assistant 2026.10.4, the newest version the test tooling installs):

- `frontend.add_extra_js_url()`, `hass.http.async_register_static_paths()` with `StaticPathConfig`, and `frontend.async_remove_panel()` exist with the signatures used in section 4.
- Home Assistant replaces the browser's custom element registry when its app starts, and only looks for cards in the new one. A module loaded with `add_extra_js_url` can run before that, and a card it defines then shows as "Custom element doesn't exist". The card entry therefore waits for `customElements.whenDefined("home-assistant")` before it defines `diorama-card`. Keep this for anything else defined from that entry.
- The Vite build needs `base: "./"`, or the preload of lazy chunks asks for them at the site root and gets a 404.
- None of the integration categories fits a dashboard tool, so the manifest has no `categories`. The HACS action reports that as a warning, not a failure.
- In the sections view the card returns `rows: "auto"` so its height follows `aspect_ratio`.
- The version goes in the path of the frontend's URL, not in `?v=`. Chunks import each other by relative path, which drops a query string; the browser then saw `diorama-panel.js` and `diorama-panel.js?v=...` as two modules, ran the entry twice and failed on defining its elements again. This only showed once a lazily loaded chunk (the 3D view) shared code with the entry.
- Vertex colours are linear in three.js and in glTF. Colours in the code are written as they should look (sRGB) and converted where the geometry is handed to three.js, or by the catalogue tool. Before that, stage 4's walls and floors were paler than their colours.
- In a `css` tagged template an escape such as `\33 d` (a class starting with a digit) is an invalid escape: the whole stylesheet silently becomes `undefined` and the element fails to render. Typecheck, lint and tests do not catch it. Avoid class names that need escaping.
- Home Assistant gives a custom panel no height: `height: 100%` on the panel element collapses to its content. The panel sets `100dvh` itself.
- Credentials added with `hass --script auth add` become an administrator on first sign-in. To test as a non-admin, create the user through Home Assistant with the `system-users` group.

Still open:

- Nothing has been run on Home Assistant 2026.11 itself, or installed through the Marketplace. Do both before the first release.
- hassfest passes in CI. The HACS action fails until the repository has a description and topics, and a licence on the default branch (the LICENSE file is there once this work is merged); its manifest, brand, issues and `hacs.json` checks pass.
- The card config editor API (`getConfigElement`, `getStubConfig`, or a form schema): read https://contributors.home-assistant.io/frontend/custom-ui/card-editor/ at the start of stage 7.
- That no entry in the catalogue (`hacs/default`) already uses the name or domain `diorama`.
