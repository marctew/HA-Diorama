// The furniture catalogue the integration serves: what models there are, how
// big they are and where their files live.

import type { FixtureKind } from "./scene";

export interface CatalogueModel {
  /** What an item on a floor carries, such as "basics/sofa_2". */
  id: string;
  name: string;
  category: string;
  tags: string[];
  source: string;
  /** Path of the .glb file under the catalogue's base URL. */
  file: string;
  /** For a model added on this installation: where its file is, to be
   * fetched signed in. Then `file` is empty. */
  url?: string;
  /** The box the model fills, in metres: width across, depth front to back. */
  width: number;
  depth: number;
  height: number;
  /** Where the middle of that box is from the model's origin: [across, back to front]. */
  centre: [number, number];
  /** Stands with its back to a wall. */
  against_wall: boolean;
  /** Hangs from the ceiling. */
  hanging?: boolean;
  /** The kind of fixture this is when a device is bound to it. */
  kind?: FixtureKind;
  /** Small things can be stood on it, at `surface_height` or else its top. */
  surface?: boolean;
  surface_height?: number;
  /** Small enough to be stood on a surface. */
  tabletop?: boolean;
  /** A staircase: makes a hole in the floor above it. */
  stairs?: boolean;
  /** Goes on a wall: how far off the floor it is put to begin with. */
  mount_height?: number;
  /** For a light: how far up the model its light comes from. */
  light_height?: number;
  /** A strip of light: lights what is under it along its length, and fixes
   * itself under a wall unit it is dropped on. */
  strip?: boolean;
}

export interface CatalogueSource {
  id: string;
  name: string;
  author: string;
  licence: string;
}

export interface Catalogue {
  version: number;
  base_url: string;
  sources: CatalogueSource[];
  models: CatalogueModel[];
}

export const EMPTY_CATALOGUE: Catalogue = { version: 1, base_url: "", sources: [], models: [] };

/** The source of the models people add themselves. */
export const USER_SOURCE = "user";
const PRIVATE_PREFIX = "/api/diorama/";

export function modelUrl(catalogue: Catalogue, model: CatalogueModel): string {
  return model.url ?? `${catalogue.base_url}/${model.file}`;
}

/** Whether a model was added on this installation rather than bundled. */
export function isOwnModel(model: CatalogueModel): boolean {
  return model.source === USER_SOURCE;
}

/** Whether the file at a URL is only handed to someone who is signed in. */
export function needsSignIn(url: string): boolean {
  return url.startsWith(PRIVATE_PREFIX);
}

export function findModel(catalogue: Catalogue, id: string): CatalogueModel | undefined {
  return catalogue.models.find((model) => model.id === id);
}

/** The categories, in the order the catalogue first mentions them. */
export function categories(catalogue: Catalogue): string[] {
  return [...new Set(catalogue.models.map((model) => model.category))];
}

/** Models whose name, tags or category contain every word typed. */
export function searchModels(catalogue: Catalogue, query: string): CatalogueModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return catalogue.models;
  return catalogue.models.filter((model) => {
    const text = [model.name, model.category, ...model.tags].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
