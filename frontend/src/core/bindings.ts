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
  on: boolean;
  /** How strongly it shows, 0 to 1. A light's brightness; 1 for anything else that is on. */
  level: number;
  /** As seen on screen (sRGB, 0 to 1). */
  colour: Colour;
  /** Whether it throws light on its surroundings. */
  glows: boolean;
}

export type TapAction = "toggle" | "more-info" | "none";

export interface Binding {
  kind: FixtureKind;
  /** Entity domains this kind can be bound to. */
  domains: readonly string[];
  visual(entity: EntityState): FixtureVisual;
  /** What a tap does unless the fixture says otherwise. */
  tap: TapAction;
}

const WARM_WHITE: Colour = [1, 0.84, 0.6];
const SWITCH_ON: Colour = [0.3, 0.72, 0.4];
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

const light: Binding = {
  kind: "light",
  domains: ["light"],
  tap: "toggle",
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
  domains: ["switch", "input_boolean", "fan"],
  tap: "toggle",
  visual(entity) {
    if (unavailable(entity)) return MISSING;
    const on = entity.state === "on";
    return { available: true, on, level: on ? 1 : 0, colour: on ? SWITCH_ON : OFF, glows: false };
  },
};

/** The kinds that are built. The rest of FixtureKind comes later (SPEC 8). */
export const BINDINGS: Readonly<Partial<Record<FixtureKind, Binding>>> = {
  light,
  switch: switchBinding,
};

export function domainOf(entityId: string): string {
  return entityId.split(".", 1)[0];
}

/** The kind of fixture an entity becomes, or undefined if none is built for
 * its domain yet. */
export function kindForEntity(entityId: string): FixtureKind | undefined {
  const domain = domainOf(entityId);
  for (const binding of Object.values(BINDINGS)) {
    if (binding.domains.includes(domain)) return binding.kind;
  }
  return undefined;
}

/** What a fixture of a kind looks like for an entity's state. */
export function fixtureVisual(kind: FixtureKind, entity: EntityState | undefined): FixtureVisual {
  const binding = BINDINGS[kind];
  if (!binding || !entity) return MISSING;
  return binding.visual(entity);
}

/** What tapping a fixture does: its own setting if it has one, else its kind's. */
export function tapAction(kind: FixtureKind, options: Record<string, unknown>): TapAction {
  const own = options.tap;
  if (own === "toggle" || own === "more-info" || own === "none") return own;
  return BINDINGS[kind]?.tap ?? "more-info";
}

/** The service call that toggles an entity. */
export function toggleCall(entityId: string): { domain: string; service: string } {
  const domain = domainOf(entityId);
  const toggles = ["light", "switch", "input_boolean", "fan"];
  return { domain: toggles.includes(domain) ? domain : "homeassistant", service: "toggle" };
}
