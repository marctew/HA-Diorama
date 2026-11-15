// The dashboard card's configuration: what users write in YAML, and the
// checked form the card works with. No DOM here, so it tests in plain Node.

export const CARD_TYPE = "diorama-card";

export type CardView = "house" | "floor" | "room";

export interface CardConfig {
  view: CardView;
  floor?: string;
  room?: string;
  camera: string;
  interactive: boolean;
  controls: boolean;
  day_night: boolean;
  aspect_ratio: string;
}

const VIEWS: readonly CardView[] = ["house", "floor", "room"];
const ASPECT_RATIO = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/;

export const DEFAULT_CARD_CONFIG: CardConfig = {
  view: "house",
  camera: "default",
  interactive: true,
  controls: true,
  day_night: true,
  aspect_ratio: "16:9",
};

/** Check a raw card configuration and fill in the defaults. Throws an Error
 * with a message for the user when it is not valid. */
export function parseCardConfig(raw: unknown): CardConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("The card configuration must be a mapping.");
  }
  const input = raw as Record<string, unknown>;

  const view = input.view ?? DEFAULT_CARD_CONFIG.view;
  if (typeof view !== "string" || !VIEWS.includes(view as CardView)) {
    throw new Error(`view must be one of: ${VIEWS.join(", ")}.`);
  }

  const config: CardConfig = {
    view: view as CardView,
    camera: optionalString(input, "camera") ?? DEFAULT_CARD_CONFIG.camera,
    interactive: optionalBoolean(input, "interactive") ?? DEFAULT_CARD_CONFIG.interactive,
    controls: optionalBoolean(input, "controls") ?? DEFAULT_CARD_CONFIG.controls,
    day_night: optionalBoolean(input, "day_night") ?? DEFAULT_CARD_CONFIG.day_night,
    aspect_ratio: optionalString(input, "aspect_ratio") ?? DEFAULT_CARD_CONFIG.aspect_ratio,
  };
  aspectRatioValue(config.aspect_ratio);

  const floor = optionalString(input, "floor");
  const room = optionalString(input, "room");
  if (config.view === "floor") {
    if (!floor) throw new Error("view: floor needs a floor.");
    config.floor = floor;
  }
  if (config.view === "room") {
    if (!room) throw new Error("view: room needs a room.");
    config.room = room;
    if (floor) config.floor = floor;
  }
  return config;
}

/** Width divided by height for an "16:9" or "4/3" style string. */
export function aspectRatioValue(aspectRatio: string): number {
  const match = ASPECT_RATIO.exec(aspectRatio);
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;
  if (!(width > 0 && height > 0)) {
    throw new Error('aspect_ratio must look like "16:9".');
  }
  return width / height;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be text.`);
  }
  return value.trim();
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be true or false.`);
  }
  return value;
}
