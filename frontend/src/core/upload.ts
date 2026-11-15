// Adding your own model: working out a name and a size for it before it is
// sent. No DOM or three.js here, so it tests in plain Node.

/** The box a model fills: across, front to back, and up. */
export interface ModelSize {
  width: number;
  depth: number;
  height: number;
}

export type Dimension = keyof ModelSize;

/** What goes with the file when it is sent. */
export interface ModelDetails extends ModelSize {
  name: string;
  against_wall: boolean;
  /** What it is, if a device can be it: a light dropped on it becomes it. */
  kind?: ModelKind | null;
}

/** The kinds of device a model someone adds can be said to be. */
export const MODEL_KINDS = ["light", "switch", "media"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/** The server takes nothing bigger, and nothing outside these sizes. */
export const MODEL_MAX_BYTES = 25 * 1024 * 1024;
/** A file bigger than this is not even read: it would only hang the page. */
export const MODEL_FILE_MAX_BYTES = 60 * 1024 * 1024;
export const MODEL_MIN_SIZE = 0.01;
export const MODEL_MAX_SIZE = 30;
export const MODEL_NAME_LENGTH = 60;

/** A name to start from, from the file's: "my_arm-chair.v2.glb" is "My arm chair v2". */
export function modelName(filename: string): string {
  const words = filename
    .replace(/^.*[\\/]/, "")
    .replace(/\.(glb|gltf)$/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MODEL_NAME_LENGTH)
    .trim();
  if (!words) return "My model";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function round(metres: number): number {
  return Math.round(metres * 1000) / 1000;
}

/** A model's size at a scale, to the millimetre. */
export function scaledSize(size: ModelSize, scale: number): ModelSize {
  return {
    width: round(size.width * scale),
    depth: round(size.depth * scale),
    height: round(size.height * scale),
  };
}

/** The scale that makes one dimension of a model a given number of metres.
 * Undefined if that cannot be worked out. */
export function scaleFor(size: ModelSize, dimension: Dimension, metres: number): number | undefined {
  const now = size[dimension];
  if (!(now > 0) || !(metres > 0) || !Number.isFinite(metres)) return undefined;
  return metres / now;
}

/** A first guess at the scale of a file. Models are often drawn in
 * millimetres or centimetres, and no piece of furniture is 180 m tall. */
export function likelyScale(size: ModelSize): number {
  const largest = Math.max(size.width, size.depth, size.height);
  if (largest >= 400) return 0.001;
  if (largest >= 12) return 0.01;
  return 1;
}

/** What is wrong with a size, in words, or undefined if it will do. */
export function sizeProblem(size: ModelSize): string | undefined {
  const all = [size.width, size.depth, size.height];
  if (all.some((value) => !Number.isFinite(value))) return "The model has no size.";
  if (Math.max(...all) > MODEL_MAX_SIZE) {
    return `That is more than ${MODEL_MAX_SIZE} m across. Set its real size.`;
  }
  // A rug or a picture is thin one way; nothing is thin every way.
  if (Math.max(...all) < MODEL_MIN_SIZE * 5) return "That is too small to see. Set its real size.";
  return undefined;
}

/** A size the server will take: nothing thinner than a centimetre. */
export function acceptableSize(size: ModelSize): ModelSize {
  const fit = (value: number) => Math.min(MODEL_MAX_SIZE, Math.max(MODEL_MIN_SIZE, round(value)));
  return { width: fit(size.width), depth: fit(size.depth), height: fit(size.height) };
}

/** The address to send a model to, with what it is in the query string. */
export function uploadPath(details: ModelDetails): string {
  const size = acceptableSize(details);
  const query = new URLSearchParams({
    name: details.name.trim().slice(0, MODEL_NAME_LENGTH),
    width: String(size.width),
    depth: String(size.depth),
    height: String(size.height),
    against_wall: details.against_wall ? "true" : "false",
    ...(details.kind ? { kind: details.kind } : {}),
  });
  return `/api/diorama/models?${query.toString()}`;
}

/** The id a model's file has on the server, from its catalogue id. */
export function modelFileId(catalogueId: string): string {
  return catalogueId.replace(/^.*\//, "");
}
