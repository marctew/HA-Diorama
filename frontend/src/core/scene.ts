// The house as the integration stores it. Mirrors
// custom_components/diorama/schema.py; SPEC.md section 5 explains the model.
// Units are metres and degrees: x and y are plan coordinates, z is height.

export type FixtureKind =
  | "light"
  | "switch"
  | "cover"
  | "opening"
  | "climate"
  | "presence"
  | "media"
  | "lock"
  | "label";

export interface FloorMeta {
  id: string;
  name: string;
  elevation: number;
  ha_floor_id: string | null;
}

export interface HouseSettings {
  name: string;
}

export interface House {
  schema_version: number;
  revision: number;
  settings: HouseSettings;
  floors: FloorMeta[];
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: string;
  b: string;
  thickness: number;
  height: number | null;
}

export interface Opening {
  id: string;
  wall: string;
  type: "door" | "window";
  offset: number;
  width: number;
  height: number;
  sill: number;
  entity_id: string | null;
}

export interface Room {
  id: string;
  name: string;
  area_id: string | null;
  boundary: string[];
  floor_style: string;
  wall_colour: string;
}

export interface Item {
  id: string;
  model: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  room: string | null;
}

export interface Fixture {
  id: string;
  entity_id: string;
  kind: FixtureKind;
  x: number;
  y: number;
  z: number;
  room: string | null;
  item: string | null;
  model: string | null;
  options: Record<string, unknown>;
}

export interface Trace {
  image: string;
  scale: number;
  x: number;
  y: number;
  opacity: number;
}

export interface Floor {
  schema_version: number;
  revision: number;
  id: string;
  wall_height: number;
  vertices: Vertex[];
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  fixtures: Fixture[];
  trace: Trace | null;
}

/** What a save sends: the server fills in anything optional that is left out. */
export type HouseInput = { settings?: Partial<HouseSettings>; floors: Partial<FloorMeta>[] };

export interface HouseExport {
  diorama_export: number;
  house: House;
  floors: Record<string, Floor>;
}

/** Sent to subscribers whenever something is saved. */
export type SceneEvent =
  | { type: "house"; revision: number }
  | { type: "floor"; floor_id: string; revision: number }
  | { type: "floor_deleted"; floor_id: string }
  | { type: "reset"; revision: number };
