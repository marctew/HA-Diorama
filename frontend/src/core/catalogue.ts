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

export function modelUrl(catalogue: Catalogue, model: CatalogueModel): string {
  return `${catalogue.base_url}/${model.file}`;
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
