# Changes

The notes of each release are what Home Assistant shows on Diorama's update. Anything that needs you to do something goes first.

## 0.4.1

- Compressed models can be added: the ones furniture shops such as IKEA publish would not read before.
- A model you add takes its colours from its textures, rather than coming out white where it had no other colour.
- Much more detailed models fit: one is kept in about a quarter of the space it took, and the most that is kept is 25 MB rather than 10.

## 0.4.0

- New pieces: a spring-arm desk lamp, light panels for a wall (triangles and a hexagon), enclosed 3D printers in two sizes with or without a filament box, and a sim racing rig with one screen or three.
- A light panel takes the colour of its light over the whole panel.
- Copying a lamp, a panel or anything else that is a light copies its light with it, so a wall of panels is one light.
- A model you add can be said to be a light, something switched, or a television or speaker. A device dropped on it then becomes it.
- Several different lights on in one room no longer white its floor out.
- Televisions, monitors and the screens of the sim rig light up while the media player, plug or light they are bound to is on.
- A room can be given a thermostat or temperature sensor: its reading is written on the floor and the room takes its colour.
- A door with no sensor can be set to stand shut instead of open.

## 0.3.0

- Downlights: a light can be shown as a downlight in the ceiling, and "Fill the room" lays out rows and columns of them, all worked by the one light.
- The same device can be placed more than once. A light or switch stays picked while you click each fitting it works.
- LED strips: a strip of light that stretches to any length, fixes itself under a wall unit it is dropped on, and lights the worktop below.
- Sliding doors and glass doors: a door can slide instead of swing, and any door can be glass. A sliding door with no sensor is drawn shut.
- Fittings on the same light share the light they throw on the floor, so eight downlights do not white a room out.

## 0.2.0

Houses drawn with 0.1.0 load as they are. Once a house has been saved with 0.2.0, do not go back to 0.1.0 with it.

- Small things stand on furniture: drop a lamp on a table or a microwave on a worktop and it sits on top and moves with it. Anything can be given a height off the floor.
- Furniture can be stretched: drag the handles of a selected piece on the plan, or type a width, depth and height.
- Doors can have two leaves, hang from either side and open either way, and every door now has its leaf. An archway is a doorway with no door.
- Drag either end of a door or window to make it wider or narrower.
- The plan image can be moved: choose Move it and drag, to line it up with walls already drawn.
- Stairs open the floor above them, and show coming up through it. A room can also be marked as open to the floor below.
- 21 more pieces of furniture, 111 in all: table lamps, televisions, a microwave, toaster and coffee machine, a laptop and monitor, kitchen wall units, a cooker hood, a mirror, a coat rack and a wall light.
- A stretched or stacked piece can no longer be grabbed by mistake for the one under it.

## 0.1.0

The first release. Needs Home Assistant 2026.11 or later.

- Draw a house: walls, rooms, doors and windows, several floors, and a plan image to trace over.
- Furnish it from 90 included pieces, or add `.glb` models of your own.
- Place lights, switches, fans, covers, door and window sensors, thermostats and temperature sensors, motion and presence sensors, media players, locks and other sensors. They show their state, and a tap works the ones that can be worked.
- A dashboard card for the whole house, a floor or a room, with saved camera angles and day and night.
- Export and import of the whole house.
