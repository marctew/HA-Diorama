# Diorama

Lay out your house in 3D in Home Assistant, floor by floor and room by room, add furniture, and place your devices in it. Lights glow when they are on, and tapping a lamp toggles it. The same scene is a full-screen panel and a dashboard card showing the whole house, a floor or a room.

> **Early days.** You can draw the walls and rooms of a floor from above, furnish them from a catalogue of 33 pieces, see it all in 3D beside the plan as you work, link rooms to Home Assistant areas, and place your lights and switches: they glow when on, and a tap in the 3D view switches them. A dashboard card shows the whole house, a floor or a room, live. You can have several floors, doors and windows, and trace over a plan image. This is an alpha: lights and switches are the only devices so far. [SPEC.md](SPEC.md) has the design and the build order.

## Install

Diorama is a custom integration for Home Assistant 2026.11 or later, installed through the Marketplace. It is not in the catalogue yet, so add it from a link:

1. Go to **Settings** > **Marketplace** and select **Add from link**.
2. Enter `marctew/HA-Diorama`, type **Integration**, and install it.
3. Add the **Diorama** integration when the setup opens. There is nothing to configure.

There are no releases yet, and the Marketplace installs Diorama from the zip attached to a release. Until the first one, build it yourself (see below).

## Use

- **Diorama** in the sidebar (administrators only) is where the house is drawn. Press `W` to draw walls: click each corner, close the loop to make a room, type a length and press Enter for an exact wall. `F` opens the furniture list: pick a piece and click to place it, `R` turns it. `B` lists your lights and switches: pick one and click where it is, or on a lamp to make it that lamp. `O` adds doors and windows. `V` selects and moves. With nothing selected, the panel on the right takes a plan image to trace over. The Floors button adds and arranges floors, and Views on the 3D side saves camera angles for cards to use. Drawing needs a desktop-sized screen.
- On a dashboard, add the **Diorama** card and choose what it shows in its settings, or in YAML:

```yaml
type: custom:diorama-card
view: room            # house | floor | room
floor: f_ground       # for view: floor or room
room: r1              # for view: room
aspect_ratio: "16:9"
walls: auto           # auto lowers the walls in the way; full | low
interactive: true     # false: taps do nothing
controls: true        # false: the view cannot be turned or zoomed
floor_gap: 2.5        # house view: space the floors apart (metres)
camera: c_ab12cd34    # a saved view, easiest picked in the card's settings
```

Tap a light or switch to work it; press and hold for its details. Any number of cards can share a dashboard.

## Develop

Backend (Python 3.14):

```bash
pip install -r requirements-dev.txt
python -m pytest
ruff check . && ruff format --check .
```

Frontend (Node 22):

```bash
cd frontend
npm ci
npm run build       # writes custom_components/diorama/frontend/dist
npm test && npm run typecheck && npm run lint
```

To try it, link or copy `custom_components/diorama` into the `custom_components` folder of a Home Assistant configuration, build the frontend, restart, and add the integration.

## Licence

MIT. Bundled models and their licences are listed in [CREDITS.md](CREDITS.md).
