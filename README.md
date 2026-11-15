# Diorama

Lay out your house in 3D in Home Assistant, floor by floor and room by room, add furniture, and place your devices in it. Lights glow when they are on, and tapping a lamp toggles it. The same scene is a full-screen panel and a dashboard card showing the whole house, a floor or a room.

> **Early days.** You can draw the walls and rooms of a floor from above, see them in 3D beside the plan as you draw, and link rooms to Home Assistant areas. There is no furniture or device placement yet, and the dashboard card only shows a placeholder. [SPEC.md](SPEC.md) has the design and the build order.

## Install

Diorama is a custom integration for Home Assistant 2026.11 or later, installed through the Marketplace. It is not in the catalogue yet, so add it from a link:

1. Go to **Settings** > **Marketplace** and select **Add from link**.
2. Enter `marctew/HA-Diorama`, type **Integration**, and install it.
3. Add the **Diorama** integration when the setup opens. There is nothing to configure.

There are no releases yet, and the Marketplace installs Diorama from the zip attached to a release. Until the first one, build it yourself (see below).

## Use

- **Diorama** in the sidebar (administrators only) is where the house is drawn. Press `W` to draw walls: click each corner, close the loop to make a room, type a length and press Enter for an exact wall. `V` selects and moves. Drawing needs a desktop-sized screen.
- On a dashboard, add the **Diorama** card:

```yaml
type: custom:diorama-card
view: room          # house | floor | room
room: r1            # for view: room
floor: f_ground     # for view: floor
aspect_ratio: "16:9"
```

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
