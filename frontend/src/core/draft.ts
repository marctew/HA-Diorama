// Unsaved edits are kept in the browser as you go, so a crashed tab or a
// closed laptop loses nothing. Storage can be missing or full; then there is
// simply no draft.

import type { Floor } from "./scene";

export interface Draft {
  /** The revision of the saved floor the edits were made on. */
  baseRevision: number;
  floor: Floor;
  savedAt: number;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const key = (floorId: string) => `diorama.draft.${floorId}`;

export function saveDraft(storage: DraftStorage | undefined, draft: Draft): void {
  try {
    storage?.setItem(key(draft.floor.id), JSON.stringify(draft));
  } catch {
    // Full or blocked: carry on without a draft.
  }
}

export function loadDraft(storage: DraftStorage | undefined, floorId: string): Draft | undefined {
  try {
    const raw = storage?.getItem(key(floorId));
    if (!raw) return undefined;
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (
      typeof draft.baseRevision !== "number" ||
      typeof draft.savedAt !== "number" ||
      typeof draft.floor !== "object" ||
      draft.floor === null ||
      draft.floor.id !== floorId ||
      !Array.isArray(draft.floor.vertices) ||
      !Array.isArray(draft.floor.walls)
    ) {
      return undefined;
    }
    return draft as Draft;
  } catch {
    return undefined;
  }
}

export function clearDraft(storage: DraftStorage | undefined, floorId: string): void {
  try {
    storage?.removeItem(key(floorId));
  } catch {
    // Nothing to do.
  }
}

/** The browser's storage, or undefined where it is not allowed. */
export function browserStorage(): DraftStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
