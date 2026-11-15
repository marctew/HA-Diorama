# Diorama: specification

A Home Assistant custom integration that lets you lay out your house in 3D (floor by floor, room by room, with furniture), place your devices in it, and see and control them there. Lights glow when they are on; tapping a lamp toggles it. The same scene is available as a full-screen panel and as a dashboard card showing the whole house, one floor or one room.

Public release, distributed through the Home Assistant Marketplace (the built-in successor to HACS, from 2026.11).

Status: design agreed; stages 1 to 8 are built: the skeleton, storage and the WebSocket API, the plan editor for walls and rooms, the 3D renderer with its preview in the editor, furniture, lights and switches bound to the scene, the dashboard card, and doors, windows, several floors, tracing over a plan image and saved camera views. Section 12 is the build order. Section 13 records decisions already made. Section 14 records what was checked against the Home Assistant contributor docs (https://contributors.home-assistant.io, which replaced developers.home-assistant.io) and what is still open.

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
- `diorama.house`: house settings, the ordered list of floors (ids, names, elevation, `ha_floor_id`) and the saved camera views (id, name, the floor it was saved on, position and target).
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
| `diorama/catalogue/get` | any user | Returns `{catalogue}`: the bundled models (section 10) and `base_url`, where their files are served. Models people have added come after them, with a `url` instead of a `file` |

Errors use Home Assistant's `{code, message}`: `invalid_format` with the path of the problem (`walls.0.b: there is no vertex 'v9'`), `conflict` when `revision` is not the current one (nothing is saved; the client reloads), `not_found` for an unknown floor, `unauthorized` for a non-admin, `invalid_stored_data` when a stored floor fails validation.

HTTP (`http.py`): plan images and models

- `POST /api/diorama/trace` (admin): the body is a PNG, JPEG or WebP image, recognised by its first bytes and not by any name or type the client gives, at most 10 MB. It is stored in `<config>/diorama/trace/` under a generated id, which is returned. `GET /api/diorama/trace/<id>` serves it to any signed-in user; `DELETE` (admin) removes it. An image a floor no longer uses is not cleaned up yet.

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
- Openings sit on a wall by offset from vertex `a`. Doors and windows may bind a `binary_sensor` or `cover`. A door has `leaves` (1 or 2), `hinge` (`start` or `end`: which end of the opening a single leaf hangs from) and `swing` (1 or -1: the side it opens to). An `archway` is a door-sized hole with no door.
- An item has `scale` and, on top of it, `stretch`: three factors, across, front to back and up. `on` is the id of the piece it stands on, or null; `z` is how far off the floor it is. `cut_above` (stairs only) says whether it opens the floor above.
- A room with `open` set has no floor.
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
- Device tool (`B`; not `D`, which Home Assistant uses): a drawer docked beside the plan listing the lights and switches that can be placed, first those in the areas the floor's rooms are linked to, under each room's name with the ones not yet placed first, then the rest behind "show from other areas". Pick one and click where it is. Dropped on a lamp, the TV or another piece of furniture of the right kind, it attaches to it and goes where that goes; dropped on the floor, a light gets a ceiling light and a switch a marker at switch height. An entity goes on a floor once.
- Fixtures show in the plan as round badges coloured by their live state. They are selected, dragged (which takes one off its furniture), box-selected and deleted like everything else. The inspector shows the entity, its state now, what a tap does (switch, show details, nothing), its height if it is a marker, and can detach it from its furniture.
- Door and window tool (`O`): choose which, then click a wall; a preview shows where it will go. In the select tool an opening slides along its wall or onto another by dragging, and the inspector sets its kind, width, height, sill and distance from the wall's end. Openings stay within their wall when it is shortened, move to the right half when it is split, and go with it when it is deleted.
- Tracing: with nothing selected, the inspector takes a plan image, which is shown under the drawing. "Set the scale" asks for two clicks on the image and the real distance between them; the first point stays put. Its strength is a slider.
- Floors (the Floors button in the header): name, height of its floor, the Home Assistant floor it corresponds to, order, delete (a second click confirms, since everything on it goes), and add. A new floor goes on top at the height of the walls below plus 0.3 m, and can start from the outside walls of the floor below. A picker in the header switches floor; unsaved edits to the floor you leave are kept as a draft.
- Saved views (the Views button on the 3D pane): turn the model, name the view, and a card can look from there. A view remembers the floor it was saved on.
- Undo and redo (200 steps), Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y.
- Saving: explicit Save (Ctrl+S) with a status. Unsaved edits are written to `localStorage` as a draft as you go and offered back after a reload or crash. If the floor is saved elsewhere meanwhile, the editor reloads when there is nothing unsaved, and otherwise offers "load their version" or "save mine over it". Leaving the page with unsaved edits asks first.
- Lengths and areas follow Home Assistant's unit system, for display and for typed input.
- On a narrow screen the editor shows the 3D view only: look, do not edit.

Still to come

- Placing furniture by dragging it out of the drawer, and into the 3D view. For now: pick, then click in the plan.
- Ghosted outlines of the floor below while drawing, stairwell cut-outs.

## 7. Renderer

- One renderer class (`render/scene-renderer.ts`) used by the panel preview and the card. There is one WebGL context for the whole page (`render/shared-gl.ts`): each view asks it to draw its scene, and the picture is copied onto the view's own 2D canvas. A dashboard can therefore hold any number of cards (22 on one page were tried), and models are uploaded to the GPU once however many views show them. The furniture pictures in the drawer use it too.
- Views (`core/views.ts`): the whole house with its floors stacked at their elevations, one floor, or one room, which is the floor cut down to that room, the walls round and inside it, and what stands in it.
- Walls in the camera's way are lowered to 0.3 m (`core/cutaway.ts`): those on the camera's side of what it looks at, re-decided as the camera turns. From nearly overhead nothing is lowered. A view can ask for all walls at full height or all low instead. Each wall is its own mesh so that it can be lowered alone.
- A view that is scrolled out of sight, or on a tab in the background, draws nothing and catches up when it is back. Input: floor documents with their elevations, and what to highlight. three.js and the renderer are in a chunk of their own, fetched the first time a 3D view is shown.
- The triangles are made without three.js (`core/mesh.ts`), so that part is unit tested: each wall is a solid whose corners are mitred against its neighbours, so walls tile without gaps or overlap; each face of a wall takes the wall colour of the room it looks into, and the outside colour where it looks into none; one slab per room in its floor finish's colour; no ceilings. One mesh of walls and one of slabs per floor, coloured per vertex.
- Look: flat-shaded materials, a small fixed palette, soft sky and ambient light, one directional "sun" with a single shadow map. No physically based lighting. The background is transparent, so the page shows through.
- Furniture: each model file is loaded once and drawn as one instanced mesh per model, whatever the number of pieces. A model the catalogue does not know, or that fails to load, is a grey box.
- Fixtures (`render/fixture-layer.ts`): each has a marker to see and tap, on a thin stem if it has no model. Lights are faked, not simulated: one that is on gets a soft additive glow and a wash of its colour over the floor of its room, both scaled by brightness. The wash is drawn on the room's own outline, so it stops at the walls. Colour follows `rgb_color`, else colour temperature, else warm white. At high quality the four brightest lights also get a real, unshadowed point light. State changes only update colours and visibility; nothing is rebuilt.
- Taps are matched to fixtures on screen, within 22 pixels of the fixture, so the target is 44 pixels however small it is drawn. A press that moves is a camera drag and never a tap.
- Camera: orbit with limits, pinch and drag on touch, zoom limited to the size of the house. It frames the whole house until someone moves it, and "Reset view" frames it again. Editing the floor does not move the camera.
- Render on demand only: a frame is drawn when the content, camera or size changes, and while the camera glides to a stop. Measured idle: no frames.
- Quality tiers (`core/quality.ts`), picked once per page from the device's cores, memory and whether it is a phone or tablet (the context is shared, so it cannot differ between cards): low has no shadows or antialiasing and a pixel ratio of 1; medium has a 1024 shadow map and a pixel ratio up to 1.5; high a 2048 shadow map and up to 2.

Still to come

- Doors and windows are cut out of both faces of their wall, with the sides of the hole filled in; a window gets a see-through pane. A door with no sensor is an open doorway.
- Ghosted neighbours in the room view, smooth camera transitions, double-tap a room to focus it. In the house view an upper floor still hides most of the one below; spacing the floors apart helps, but hiding upper floors on demand would be better.

Day and night (stage 9)

- `core/sun.ts` turns the elevation and azimuth of `sun.sun` into lighting: where the light comes from, how strong the sun and the sky are, their colour, and whether shadows are worth drawing. Full day above 10 degrees of elevation, full night below -6, warm in between, bluish and never black at night. The light is never drawn from lower than 14 degrees. The top of the plan is taken to be north; there is no setting for which way the house faces yet.
- A view follows the sun only when asked (`day-night` on `diorama-scene-view`): the card does by default, the editor's preview is always a fixed afternoon. At night the view's background darkens with it, and lights that are on show up more.
- The sun moves every few minutes; the view relights only when its elevation or azimuth has changed.

## 8. Entity bindings

A binding is a small module per kind: which entities it accepts, how state maps to visuals, what a tap does. Adding a domain must not touch the renderer core.

| Kind | Entities | Visual | Tap |
|---|---|---|---|
| light | `light.*` | glow, colour, brightness | toggle |
| switch | `switch.*`, `input_boolean.*`, `fan.*` | on/off colour | toggle |
| cover | `cover.*` | on a door or window: a blind as far down as the cover is shut. Elsewhere a marker | toggle; garage doors, gates and doors ask first |
| opening | `binary_sensor` of class door, window, garage_door, opening | on a door: the leaf swings open. Green shut, amber open | more-info |
| climate | `climate.*`, temperature `sensor` | the temperature beside it, and the floor of its room tinted from blue (cold) to red (hot) | more-info |
| presence | `binary_sensor` of class occupancy, motion, presence | the floor of its room tinted while someone is there | more-info |
| media | `media_player.*` | glows while playing | more-info |
| lock | `lock.*` | green locked, amber anything else | more-info only, never toggles on tap |
| label | any other `sensor` or `binary_sensor` | its reading beside it | more-info |

- All of these are built (`core/bindings.ts`): one binding per kind, which says what the entity looks like (`FixtureVisual`: on, level, colour, glow, and optionally a label, a room tint and how far open) and what a tap does. The renderer and the plan only see the visual, so a new kind does not touch them. Not built from the first draft of this table: a fan that spins, a window that opens, a pulsing outline for presence.
- Which kind an entity becomes goes by its domain and, for sensors, its device class (`kindForEntity`). Entities that are hidden, or that are a device's diagnostics or settings (`entity_category`), are not offered.
- A door or window takes an entity of its own (`opening.entity_id`, chosen in the inspector): a sensor or a cover. It is shown and tapped like a fixture, through a fixture made up on the fly (`openingFixtures`, id `opening:<id>`) that is never stored. A blind or a door's leaf hangs off its wall's mesh, so it is lowered with the wall.
- Tap does the kind's action unless the fixture says otherwise (`options.tap`: `toggle`, `confirm`, `more-info` or `none`; only the ones the kind allows, `tapChoices`). `confirm` shows a strip in the view asking "Open Garage door?" and toggles on yes; it goes away by itself after eight seconds. A lock's tap can only be `more-info` or `none`, whatever is stored. Press and hold opens the details, by firing Home Assistant's `hass-more-info` event. Full `tap_action`/`hold_action` configuration is not built.
- A reading is drawn at a real size in the model but never smaller than 22 pixels on screen, so that it can be read in a small card.
- Hit targets are at least 44 px on screen regardless of model size.
- `unavailable` and `unknown` render greyed, and a tap opens the details instead of toggling; a fixture whose entity no longer exists is shown the same way and flagged in the inspector.
- State updates are optimistic: a toggle shows at once, is dropped as soon as Home Assistant's state agrees, and reverts if the call fails or nothing confirms it within three seconds. A cover is shown open or closed, whichever it is heading for; one that takes longer than three seconds to get there shows its real position from then on.
- `hass` is replaced on every state change in the house. Fixture visuals are recomputed only when the state object of an entity on the floor has changed (`shared/fixture-state.ts`), so unrelated changes cost nothing and draw nothing.

## 9. Dashboard card

```yaml
type: custom:diorama-card
view: room            # house | floor | room
floor: f_ground       # for view: floor, and best given for view: room
room: r1              # for view: room
interactive: true     # false = display only, taps ignored
controls: true        # orbit/zoom gestures; false locks the camera
walls: auto           # auto | full | low
aspect_ratio: "16:9"
camera: c_ab12cd34    # the id of a saved view; the editor offers them by name
floor_gap: 2.5        # house view: metres of extra space between floors
day_night: true       # light the house as the sun is now; false = always daytime
```

Built (stage 7)

- The element on the dashboard (`entries/card.ts`) is a stub of a few kilobytes that is on every Home Assistant page. It loads the card proper the first time one is shown, and that loads three.js only once there is a house to draw.
- The card loads the house, the floors its view needs and no others (`shared/scene-controller.ts`), and the catalogue. A room card that names its floor fetches one floor. It subscribes to saves and reloads what changed, so an edit in the panel shows on every dashboard without a reload.
- Devices are live and work as in the editor's preview: tap does what the fixture's kind does (section 8), hold opens the details. `interactive: false` makes it display only.
- `day_night` (on by default) lights the house as the sun is (section 7); the card's background darkens at night.
- Visual config editor (`card/card-editor.ts`), returned from `getConfigElement`: what to show, floor, room, shape, walls, and the three toggles. It stores only what differs from the defaults. `getStubConfig` returns the whole house. Registered in `window.customCards` with a preview.
- Sizes itself by `aspect_ratio`: `rows: "auto"` in the sections view (`getGridOptions`), a matching `getCardSize` for masonry.
- `camera` looks from a saved view, lifted to wherever its floor is shown; without one, or if the view has been deleted, the house is framed. `floor_gap` spaces the floors of the house view apart.
- Empty states: no house drawn yet (with a link to the panel for admins), the room or floor is no longer there, the 3D view could not be loaded or WebGL is unavailable.
- Card chrome follows Home Assistant's theme through `ha-card`; the scene's background is transparent.

Not done

- The user's reduced-motion setting.
- The card reads `hass` rather than subscribing to the `states` context. It costs almost nothing, because fixture states are only recomputed when an entity on the floor has changed (section 8).

## 10. Furniture catalogue

Built (stage 5)

- `tools/build_catalogue.py` writes `custom_components/diorama/assets/`: one `.glb` per model under `models/<source>/`, and `catalogue.json` listing each model's id, name, category, search tags, source, file, the box it fills in metres (width, depth, height and where the middle of that box is from the model's origin), whether it stands against a wall or hangs from the ceiling, and the kind of fixture it naturally is (lamps, the TV, the radiator). The output is committed, and a test fails if it is not what the tool builds.
- The first set is "Diorama basics": 33 original low-poly pieces at typical UK sizes, defined in `tools/catalogue/basics.py` from boxes and cylinders with one small palette, and released as CC0. About 520 kB in all.
- Model format: one mesh, `POSITION`, `NORMAL` and `COLOR_0`, no textures; metres, +Y up, standing on y = 0, front facing +Z. The loader in the frontend accepts any `.glb` and reduces it to that (meshes merged, material colours baked into vertex colours, textures ignored), so other kits and uploads go through the same path.
- With it come 78 pieces of Kenney's Furniture Kit 2.0 (CC0), 123 models and about 2.6 MB in all. The kit's own `.glb` files for those pieces are kept in `tools/catalogue/kenney/` with its licence, and `tools/catalogue/kenney.py` lists each piece with the size it should really be: the kit is about half real size, starts at a corner and has colours of its own. `gltf_read.py` reads the triangles with their node transforms applied; each piece is then scaled (per axis where a real size is given, as for kitchen units, which must be 600 mm wide), put on the floor with its middle on the origin, and painted from the one palette by the name of the kit's material. What is written is in the same format as the basic set. Each piece was looked at in the drawer and in a room with 2.4 m walls.
- Pictures for the drawer are drawn in the browser from the models themselves, so there are no thumbnail files to keep in step.
- Only CC0 models are bundled; a test checks every model's source says so. Sources and licences are listed in `CREDITS.md`.

Not done

- Quaternius's furniture (CC0) has not been looked at.

My models (stage 10)

- "Add a model" at the foot of the furniture list takes a `.glb`. The browser reads it (`render/model-import.ts`), shows it, and asks how big it really is (`editor/model-dialog.ts`): the three sizes are linked, a file drawn in millimetres or centimetres is guessed as such (`core/upload.ts`), and a size over 30 m is refused. It then writes the model out again in the bundled format (one mesh, real size, standing on the floor, middle on the origin, vertex colours, no textures) and sends that, so what is stored is small and draws like everything else. The server never parses a model: it checks the glTF header and the size (10 MB) and keeps the bytes.
- `models.py` keeps the files in `<config>/diorama/models/m_<16 hex>.glb` and the list (name, sizes, against a wall) in `.storage/diorama.models`; at most 200. They appear in the catalogue after the bundled ones as `user/m_...`, category "My models", with a `url` under `/api/diorama/models/`. That address needs a signed-in user, so the frontend fetches it with `hass.fetchWithAuth` (`setPrivateFetch` in `render/models.ts`) where bundled models are fetched plainly.
- Adding and deleting are for administrators and send a `catalogue` event to subscribers, so open cards and panels fetch the catalogue again. Deleting a model leaves the pieces made from it in place, drawn as grey boxes like any unknown model.
- Not done: renaming or resizing a model after adding it (delete and add again), `.gltf` with separate files, textures, and carrying models in an export of the house.
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
- Translations: `translations/en.json` for the backend (config flow). In the frontend, `locales/en.ts` holds the words and is the list of keys; `shared/localize.ts` gives a component `t(key, values)` for the language Home Assistant is set to, fetching a language the first time it is wanted and falling back to English key by key. A new language is one file and one line in `LOADERS`. So far the card, its settings and the 3D view's own prompts go through it: everything someone who only looks at a dashboard sees. The drawing panel, which only administrators use, still has its English in place; moving it over is mechanical and is the next step before asking for translations. Messages for a mistake in a card's YAML are English too.
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
11. After the first release (0.2.0): stacking, stretching, double doors and archways, stairwells.
12. 0.3.0: downlights and one entity on many fittings, strip lights, sliding and glass doors.
13. 0.4.0: more lights and a workshop (desk lamp, light panels, printers, sim rig), a kind for uploaded models.

All thirteen stages are built. What is left before the first release is in section 14 under "Still open": things only the owner of the repository can do.

## 13. Decisions already made

- Custom integration, not an add-on/app: one install provides panel and card, works on every installation type, no token handling.
- Distributed through the Marketplace; public repo `marctew/HA-Diorama`; domain `diorama`.
- Low-poly stylised look. CC0 models only in the bundle. Lighting is faked for looks and performance.
- Browser-first. Editor is desktop only; viewing and control work on any device through the card.
- Card can show the whole house, a floor or a room.
- Entity state and service calls go through the frontend `hass` object and WebSocket, never polling.
- Scene stored per floor so a room card loads only what it needs.
- Locks never toggle on tap; garage doors ask first.
- The bundled furniture is Diorama's own set and a chosen part of Kenney's Furniture Kit, rebuilt to one size, palette and format (section 10).
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
- A Lit boolean property that is true by default cannot be turned off with a `?attribute=${false}` binding: the attribute is simply absent and the default stands. The card's `interactive: false` and `controls: false` did nothing until they were bound as properties. Properties that default to true are declared `attribute: false`.
- `getConfigElement` may be async: Home Assistant waited for the editor's code to load.
- In a `css` tagged template an escape such as `\33 d` (a class starting with a digit) is an invalid escape: the whole stylesheet silently becomes `undefined` and the element fails to render. Typecheck, lint and tests do not catch it. Avoid class names that need escaping.
- Home Assistant has single-key shortcuts of its own that work on any page, including a custom panel: `e`, `c`, `d`, `m` and `a` open its search and assistant. Pressing `D` for the device tool opened Home Assistant's device search over the editor. Keep Diorama's own keys off those letters.
- `hass.entities` (the entity registry as the frontend has it) carries `area_id`, `device_id` and `hidden` among others, and firing `hass-more-info` with `{entityId}` from inside the panel opens the details dialog: both checked in a running instance.
- Home Assistant's own request filter turns away a path with `..` in it (400) before a view sees it; the id check in `http.py` is still there for everything else.
- Keyboard handling skips keys typed into fields, which at first included Ctrl+S: with a slider focused, saving did nothing. Ctrl+S is handled before that check.
- Home Assistant gives a custom panel no height: `height: 100%` on the panel element collapses to its content. The panel sets `100dvh` itself.
- Credentials added with `hass --script auth add` become an administrator on first sign-in. To test as a non-admin, create the user through Home Assistant with the `system-users` group.

Learned while building stage 9:

- `hass.entities` also carries `entity_category` (`diagnostic` or `config`), which is how a device's signal strength and firmware sensors are kept out of the device list. Seen in Home Assistant 2026.10.4; the `sun` integration's own sensors are an example.
- `sun.sun` has `elevation` and `azimuth` attributes (degrees, azimuth clockwise from north), and is there on a default installation.
- A template cover goes straight from `closed` to `open`; a real one reports `opening` for a while. The optimistic state covers both: it waits for the state it expects and gives up after three seconds.
- Home Assistant's own frontend logs an unhandled `unknown_command` rejection on every page of the bare test instance. It is not Diorama's.

Stage 11, as built (0.2.0)

- Stacking (`core/stacking.ts`). The catalogue marks models as a `surface` (with a `surface_height` where the top is not the place, as on a desk with a monitor) or as `tabletop`, and gives things for a wall a `mount_height`. A tabletop piece placed or dropped over a surface gets `on` set to it and `z` set to its top (`restack`); dropped elsewhere it goes back to the floor. Only one level: nothing stands on something that is itself standing on something. `updateItems` carries what stands on a piece along when it moves or turns, `deleteItems` drops it to the floor, and the editor runs `settleStacks` on every edit so that a taller table lifts its lamp. A model someone added counts as tabletop if it is small; nothing they add is a surface, but any piece can be given a height by hand ("Off the floor"), which also takes it off what it was on.
- Stretching (`core/items.ts`). `itemScale` is `scale` times `stretch` per axis and is what the plan outline, the 3D instance and a lamp's light height all use. A selected piece has four handles on the plan, a little outside its outline so that a small piece can still be picked up by its middle; dragging one moves that side and leaves the opposite one where it is (`stretchItemTo`), in 5 cm steps unless Alt is held. The inspector takes a width, depth and height in metres. Every model can be stretched.
- Doors (`core/openings.ts`, `render/fixture-layer.ts`). `doorLeaves` says where each leaf hangs. Every door is drawn with its leaves, standing open unless it has a sensor that says shut; a door with a cover (a garage door) has a blind instead. The plan draws each leaf and its swing to match. A selected door or window has a handle at each end (`resizeOpening`).
- Stairwells (`core/stairwells.ts`). The catalogue marks staircases (`stairs`). The floor above one is drawn with its outline left out: `buildFloorMesh` takes `holes` and cuts each floor triangle against them (`subtractConvex` in `geometry.ts`, exact and with no dependence on the shape of the rooms). In the house view each floor is cut for the stairs of the floor under it. A floor or room shown alone also needs that floor loaded (`floorsNeeded`), is cut the same way, and draws its staircases coming up from below (`ViewFloor.below`). The editor fetches the floor below for the same purpose and outlines the hole on the plan. A room marked `open` has no floor at all, for stairwells of other shapes.
- The hole is the whole outline of the staircase, not just the part that needs headroom.
- The plan image can be slid about: "Move it" in the floor panel turns dragging on the plan into moving the image (`moveTrace`), whatever is drawn over it, until Esc, the button again or another tool. One undo step for each drag.

Stage 12, as built (0.3.0)

- One entity, many fittings. Nothing ever stopped two fixtures naming one entity except the device list, which no longer greys out what is placed (it shows how many times). A light or switch stays picked after it is placed, so that each fitting can be clicked in turn. Every fixture of an entity shows its state, and a tap on any of them works it. `fittingsSharing` counts the fixtures of an entity in a room, and the light each throws on the floor is divided by that, so that the room is lit once.
- Downlights. `basics/downlight` is a ring in the ceiling; `light_height` in the catalogue says where a model's light comes from when that is neither the top of a lamp nor under a pendant. A light that is not a piece of furniture has "Shown as" in the inspector (the hanging light models, or a marker), and `fillRoom` lays out rows and columns of it across the box round its room, leaving out spots outside an L-shaped room and replacing the ones like it already there. At most 60 at a time.
- Strip lights. `basics/led_strip` is a metre of strip marked `strip`, stretched like any furniture. Dropped on a wall-mounted piece (`unitOver`) it takes that piece's middle, width and turn and sits just under it, with `on` set so that it goes where the unit goes; `settleStacks` keeps a strip under its unit where it keeps anything else on top. Dragged off, it keeps its height. It is picked by an outline 16 cm across (`pickFootprint`), being 2 cm itself. Bound to a light, it is drawn as a lit bar with a band of light on whatever is under it (`stripLight` finds the worktop), and lights the room less than a lamp does.
- Doors. `style` is `hinged` or `sliding`, `glazed` makes the leaves glass with their edges drawn as a frame. A sliding door is two panels in two tracks (`slidingPanels`): one fixed at the `hinge` end, one that slides across it. With no sensor it is drawn shut, where a swinging door stands open. A cover on a sliding door moves its panels rather than drawing a blind.

Stage 13, as built (0.4.0)

- `tools/catalogue/shapes.py` gained three shapes: `tube` (a round bar or cone between any two points), `beam` (a flat bar between any two points) and `panel` (an upright flat shape facing the front). With them the basic set has a spring-arm desk lamp, three light panels for a wall, four enclosed 3D printers (two sizes, with and without a filament box on top) and two sim racing rigs. The printers are light-kind, for their chamber lights; the rigs are plain furniture.
- A model marked `lit` (the light panels) is covered, when its light is on, by a skin of its own shape in the light's colour (`fixture-layer.ts`), so that a colour scene shows on the wall. Like a strip, a panel is picked by a wider outline than its own.
- `duplicateItems` copies the fixtures bound to what it copies, on the same entity: a second panel, lamp or downlight is one Ctrl+D.
- Someone adding a model can say that it is a light, something switched, or a media player (`kind` in `models.py` and the dialog). That is what makes a device dropped on it become it.
- Screens. A model lists its `screens` in the catalogue (where the picture is, its size and which way it faces): the televisions, the monitor, the desk with a monitor and the sim rigs. A fixture bound to one draws a lit picture over each while its entity is on, brighter while a media player is playing. Anything with a screen can be bound to a media player, a switch or a light (`canBe`), since a monitor is as likely to be on a smart plug as to be a media player.
- Room temperature. A room has `temperature_entity`, chosen in the inspector from thermostats and temperature sensors (those of its area first). `roomFixtures` makes a climate fixture of it on the fly (id `room:<id>`, never stored), so it tints the floor like any other and a tap opens its details. Its reading is written flat on the floor in big figures, in the emptiest patch of the room (`clearSpot`), turned each frame to face the camera, and drawn over whatever stands in front of it: a reading hidden by a wall is no use on a dashboard.
- Doors. `closed` says whether a door with no sensor is drawn shut (`doorRest`); unsaid, a swinging door stands open and a sliding one shut, as before. The plan draws the leaf where it stands.
- The light that lights throw on a room's floor is divided by the square root of the number of different lights on in that room, and small lamps, panels and strips throw half or less of what a ceiling light does.

Learned while building stage 12:

- A strip two centimetres across could not be hit with a device, or picked up, until it was given a wider outline to be picked by. Found in the browser.
- Eight glows the size of a lampshade and eight full washes whited the room out; a downlight's glow is 40% of a lamp's and the wash is shared.

Learned while building stage 11:

- A handle drawn on the middle of each side of a small piece covers the piece: the first try at dragging a lamp off a table stretched the lamp instead. Found in the browser, not by a unit test.
- With a table selected, a click on the lamp standing on it used to pick the table again, because what is selected is preferred. What stands on a piece is now preferred over the piece.
- `Omit` on a union of object types keeps only the keys they share; the handle drags are their own union with the pointer added on.

Learned while building stage 10:

- Home Assistant 2026.11.1 runs everything as 2026.10.4 did; nothing needed changing.
- `hass.fetchWithAuth` answers are cached by the browser like any other (`Cache-Control: private`), so a plain `fetch` of a model's address from the same browser can succeed afterwards. Someone who is not signed in gets 401, which is what the tests check.
- three.js's `GLTFExporter.parseAsync` with `binary: true` gives an `ArrayBuffer`, and writes vertex colours as `COLOR_0` when the material has `vertexColors`. It is loaded only when a model is being added (36 kB).
- `LitElement` has a `remove()` of its own from `HTMLElement`: a private method of that name does not compile.
- The plan was squeezed to a sliver when a list was docked beside it in split view on a laptop; the 3D side now gives way (found while taking screenshots, not by a test).

Still open:

- Stages 9 and 10 were run end to end on Home Assistant 2026.11.1 (a second environment with that version: the test tooling still installs 2026.10.4, which is what pytest and CI run on). Nothing has been installed through the Marketplace: that needs a published release. Do it with a pre-release before the first real one.
- To release: merge to `main`; give the repository a description and topics (the HACS action fails without them); publish a GitHub release tagged `0.1.0` with the 0.1.0 section of `CHANGELOG.md` as its notes, as a pre-release first; check that the action attached `diorama.zip`; install it through the Marketplace from the link on a real installation. Listing in the catalogue is then a pull request to `hacs/default`.
- hassfest passes in CI. The HACS action fails until the repository has a description and topics, and a licence on the default branch (the LICENSE file is there once this work is merged); its manifest, brand, issues and `hacs.json` checks pass.
- The card config editor API (`getConfigElement`, `getStubConfig`, or a form schema): read https://contributors.home-assistant.io/frontend/custom-ui/card-editor/ at the start of stage 7.
- That no entry in the catalogue (`hacs/default`) already uses the name or domain `diorama`.
