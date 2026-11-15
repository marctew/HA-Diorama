// How an entity's state becomes something you can see, and what tapping it
// does. One binding per kind of fixture. Adding a kind means adding a binding
// here; the renderer and the plan only ever see a FixtureVisual.

import type { Colour } from "./mesh";
import type { FixtureKind } from "./scene";

/** As much of an entity's state as bindings look at. */
export interface EntityState {
  state: string;
  attributes: Record<string, unknown>;
}

export interface FixtureVisual {
  /** Unavailable, unknown or missing entities are drawn greyed out. */
  available: boolean;
  /** Lit, running, open, unlocked, occupied: whatever "active" means for the kind. */
  on: boolean;
  /** How strongly it shows, 0 to 1. A light's brightness, a blind's opening;
   * 1 for anything else that is on. */
  level: number;
  /** As seen on screen (sRGB, 0 to 1). */
  colour: Colour;
  /** Whether it throws light on its surroundings. */
  glows: boolean;
  /** A few characters to show beside it: a temperature, a reading. */
  label?: string;
  /** How strongly its colour tints the floor of its room, 0 to 1. */
  tint?: number;
  /** For doors, windows and blinds: how far open, 0 (shut) to 1. */
  open?: number;
}

/** "confirm" toggles after asking: for things that should not move by accident. */
export type TapAction = "toggle" | "confirm" | "more-info" | "none";

export interface Binding {
  kind: FixtureKind;
  visual(entity: EntityState): FixtureVisual;
  /** What a tap does unless the fixture says otherwise. */
  tap: TapAction;
  /** Whether a tap may ever change the entity. A lock never unlocks on a tap. */
  mayToggle: boolean;
}

const WARM_WHITE: Colour = [1, 0.84, 0.6];
const GREEN: Colour = [0.3, 0.72, 0.4];
const AMBER: Colour = [0.96, 0.62, 0.18];
const BLUE: Colour = [0.3, 0.6, 0.92];
const OFF: Colour = [0.6, 0.62, 0.65];

export const MISSING: FixtureVisual = {
  available: false,
  on: false,
  level: 0,
  colour: OFF,
  glows: false,
};

/** Roughly the colour of a black body at a temperature, for white lights.
 * Good from candlelight (1900 K) to daylight (6500 K), which is what bulbs do. */
export function kelvinToColour(kelvin: number): Colour {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const clamp = (value: number) => Math.min(1, Math.max(0, value / 255));
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(red), clamp(green), clamp(blue)];
}

function lightColour(attributes: Record<string, unknown>): Colour {
  const rgb = attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length >= 3 && rgb.every((channel) => typeof channel === "number")) {
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  }
  const kelvin = attributes.color_temp_kelvin;
  if (typeof kelvin === "number" && kelvin > 0) return kelvinToColour(kelvin);
  return WARM_WHITE;
}

function unavailable(entity: EntityState): boolean {
  return entity.state === "unavailable" || entity.state === "unknown";
}

/** A reading short enough to sit beside a marker: "21.5°", "48 %", "on". */
export function shortReading(entity: EntityState): string {
  const unit = entity.attributes.unit_of_measurement;
  const number = Number(entity.state);
  const value =
    entity.state.trim() !== "" && Number.isFinite(number)
      ? String(Math.abs(number) >= 100 ? Math.round(number) : Number(number.toFixed(1)))
      : entity.state.replace(/_/g, " ");
  if (typeof unit !== "string" || unit === "") return value.slice(0, 12);
  // Degrees read better without the letter or a space.
  if (unit.startsWith("°")) return `${value}°`;
  return `${value} ${unit}`.slice(0, 12);
}

/** A colour for a temperature: blue when cold, through neutral, to red when
 * hot. Takes Celsius; `unit` says what the number is in. */
export function temperatureColour(value: number, unit: unknown): Colour {
  const celsius = typeof unit === "string" && unit.includes("F") ? ((value - 32) * 5) / 9 : value;
  const stops: [number, Colour][] = [
    [12, [0.25, 0.5, 0.95]],
    [18, [0.4, 0.75, 0.9]],
    [21, [0.55, 0.8, 0.55]],
    [24, [0.98, 0.72, 0.25]],
    [28, [0.92, 0.3, 0.22]],
  ];
  if (celsius <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [at, colour] = stops[i];
    const [from, before] = stops[i - 1];
    if (celsius <= at) {
      const t = (celsius - from) / (at - from);
      return [0, 1, 2].map((c) => before[c] + (colour[c] - before[c]) * t) as unknown as Colour;
    }
  }
  return stops[stops.length - 1][1];
}

const light: Binding = {
  kind: "light",
  tap: "toggle",
  mayToggle: true,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const on = entity.state === "on";
    const brightness = entity.attributes.brightness;
    // A light that is on but reports no brightness is simply on.
    const level = !on ? 0 : typeof brightness === "number" ? Math.max(0.08, brightness / 255) : 1;
    return { available: true, on, level, colour: on ? lightColour(entity.attributes) : OFF, glows: on };
  },
};

const switchBinding: Binding = {
  kind: "switch",
  tap: "toggle",
  mayToggle: true,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const on = entity.state === "on";
    return { available: true, on, level: on ? 1 : 0, colour: on ? GREEN : OFF, glows: false };
  },
};

const cover: Binding = {
  kind: "cover",
  tap: "toggle",
  mayToggle: true,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const position = entity.attributes.current_position;
    const open =
      typeof position === "number"
        ? Math.min(1, Math.max(0, position / 100))
        : entity.state === "closed"
          ? 0
          : 1;
    const on = open > 0;
    return { available: true, on, level: open, open, colour: on ? BLUE : OFF, glows: false };
  },
};

const opening: Binding = {
  kind: "opening",
  tap: "more-info",
  mayToggle: false,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const on = entity.state === "on";
    return { available: true, on, level: on ? 1 : 0, open: on ? 1 : 0, colour: on ? AMBER : GREEN, glows: false };
  },
};

const climate: Binding = {
  kind: "climate",
  tap: "more-info",
  mayToggle: false,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    // A thermostat reports the room's temperature as an attribute; a sensor is it.
    const current = entity.attributes.current_temperature;
    const value = typeof current === "number" ? current : Number(entity.state);
    const heating = entity.attributes.hvac_action === "heating";
    if (!Number.isFinite(value)) {
      return { available: true, on: heating, level: 1, colour: OFF, glows: false, label: shortReading(entity) };
    }
    const unit = entity.attributes.unit_of_measurement ?? entity.attributes.temperature_unit;
    return {
      available: true,
      on: heating,
      level: 1,
      colour: temperatureColour(value, unit),
      glows: false,
      label: `${Number(value.toFixed(1))}°`,
      tint: 0.14,
    };
  },
};

const presence: Binding = {
  kind: "presence",
  tap: "more-info",
  mayToggle: false,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const on = entity.state === "on" || entity.state === "home";
    return { available: true, on, level: on ? 1 : 0, colour: on ? BLUE : OFF, glows: false, tint: on ? 0.22 : 0 };
  },
};

const media: Binding = {
  kind: "media",
  tap: "more-info",
  mayToggle: false,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const playing = entity.state === "playing";
    const on = !["off", "standby", "idle"].includes(entity.state);
    return {
      available: true,
      on,
      level: playing ? 0.7 : on ? 0.3 : 0,
      colour: on ? [0.55, 0.75, 1] : OFF,
      glows: playing,
    };
  },
};

const lock: Binding = {
  kind: "lock",
  tap: "more-info",
  mayToggle: false,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    // "On" is the state that wants attention: not locked.
    const on = entity.state !== "locked";
    return { available: true, on, level: on ? 1 : 0, colour: on ? AMBER : GREEN, glows: false };
  },
};

const label: Binding = {
  kind: "label",
  tap: "more-info",
  mayToggle: false,
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const on = entity.state === "on";
    return {
      available: true,
      on,
      level: on ? 1 : 0,
      colour: on ? AMBER : [0.45, 0.5, 0.56],
      glows: false,
      label: shortReading(entity),
    };
  },
};

export const BINDINGS: Readonly<Record<FixtureKind, Binding>> = {
  light,
  switch: switchBinding,
  cover,
  opening,
  climate,
  presence,
  media,
  lock,
  label,
};

export function domainOf(entityId: string): string {
  return entityId.split(".", 1)[0];
}

const OPENING_CLASSES = ["door", "window", "garage_door", "opening"];
const PRESENCE_CLASSES = ["occupancy", "motion", "presence"];
/** Covers that are big, heavy or let people in: these ask before they move. */
const CAREFUL_COVERS = ["garage", "gate", "door"];

/** The kind of fixture an entity becomes, or undefined if it cannot be shown.
 * Sensors go by their device class, so pass the entity's attributes. */
export function kindForEntity(
  entityId: string,
  attributes: Record<string, unknown> = {},
): FixtureKind | undefined {
  const deviceClass = attributes.device_class;
  switch (domainOf(entityId)) {
    case "light":
      return "light";
    case "switch":
    case "input_boolean":
    case "fan":
      return "switch";
    case "cover":
      return "cover";
    case "climate":
      return "climate";
    case "media_player":
      return "media";
    case "lock":
      return "lock";
    case "binary_sensor":
      if (typeof deviceClass === "string" && OPENING_CLASSES.includes(deviceClass)) return "opening";
      if (typeof deviceClass === "string" && PRESENCE_CLASSES.includes(deviceClass)) return "presence";
      return "label";
    case "sensor":
      return deviceClass === "temperature" ? "climate" : "label";
    default:
      return undefined;
  }
}

/** What a fixture of a kind looks like for an entity's state. */
export function fixtureVisual(kind: FixtureKind, entity: EntityState | undefined): FixtureVisual {
  const binding = BINDINGS[kind];
  if (!binding || !entity) return MISSING;
  return binding.visual(entity);
}

/** The things a tap on a fixture of this kind can be set to do. */
export function tapChoices(kind: FixtureKind): TapAction[] {
  return BINDINGS[kind]?.mayToggle ? ["toggle", "confirm", "more-info", "none"] : ["more-info", "none"];
}

/** What tapping a fixture does: its own setting if it has one and the kind
 * allows it, else the kind's. A garage door or gate asks first. */
export function tapAction(
  kind: FixtureKind,
  options: Record<string, unknown>,
  attributes: Record<string, unknown> = {},
): TapAction {
  const binding = BINDINGS[kind];
  const own = options.tap;
  if (typeof own === "string" && (tapChoices(kind) as string[]).includes(own)) return own as TapAction;
  if (!binding) return "more-info";
  if (kind === "cover" && CAREFUL_COVERS.includes(String(attributes.device_class))) return "confirm";
  return binding.tap;
}

/** The service call that toggles an entity. */
export function toggleCall(entityId: string): { domain: string; service: string } {
  const domain = domainOf(entityId);
  const toggles = ["light", "switch", "input_boolean", "fan", "cover"];
  return { domain: toggles.includes(domain) ? domain : "homeassistant", service: "toggle" };
}

/** The state a toggle should leave an entity in, to show before Home
 * Assistant confirms it. */
export function toggledState(entityId: string, state: string): string {
  if (domainOf(entityId) === "cover") return state === "closed" || state === "closing" ? "open" : "closed";
  return state === "on" ? "off" : "on";
}

/** What a toggle would do, in words, for asking first: "Open", "Switch off". */
export function toggleVerb(entityId: string, state: string): string {
  const next = toggledState(entityId, state);
  if (next === "open") return "Open";
  if (next === "closed") return "Close";
  return next === "on" ? "Switch on" : "Switch off";
}
