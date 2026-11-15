import { html, svg, type TemplateResult } from "lit";
import type { FixtureKind } from "../core/scene";

const PATHS = {
  select: svg`<path d="M6 3.5 18.5 11l-5.4 1.6L11 18.5z" fill="currentColor" stroke-linejoin="round" />`,
  wall: svg`<path d="M6.7 17.3 17.3 6.7" /><circle cx="5" cy="19" r="2.2" /><circle cx="19" cy="5" r="2.2" />`,
  undo: svg`<path d="M8 5 3 10l5 5" /><path d="M3 10h11a6 6 0 0 1 0 12h-3" />`,
  redo: svg`<path d="m16 5 5 5-5 5" /><path d="M21 10H10a6 6 0 0 0 0 12h3" />`,
  fit: svg`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />`,
  plus: svg`<path d="M12 5v14M5 12h14" />`,
  minus: svg`<path d="M5 12h14" />`,
  trash: svg`<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />`,
  check: svg`<path d="m5 12 5 5 9-10" />`,
  menu: svg`<path d="M3 6h18M3 12h18M3 18h18" />`,
  plan: svg`<rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 13h9V4M13 13v7" />`,
  split: svg`<rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14" />`,
  furniture: svg`<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" /><path d="M3 12.5a1.5 1.5 0 0 1 3 0V15h12v-2.5a1.5 1.5 0 0 1 3 0V18H3zM6 18v2M18 18v2" />`,
  copy: svg`<rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />`,
  rotate: svg`<path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" />`,
  close: svg`<path d="M6 6l12 12M18 6 6 18" />`,
  device: svg`<path d="M9 17.5h6M10 20.5h4" /><path d="M8.2 14.5a6 6 0 1 1 7.6 0c-.5.5-.8 1-.8 1.7H9c0-.7-.3-1.2-.8-1.7z" />`,
  unlink: svg`<path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />`,
  opening: svg`<path d="M4 21h16M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21" /><path d="M14.5 12.5h.01" stroke-width="2.6" />`,
  image: svg`<rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="9" r="1.5" />`,
  camera: svg`<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" />`,
  layers: svg`<path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5M3 17.5l9 5 9-5" opacity="0.55" />`,
  up: svg`<path d="m6 14 6-6 6 6" />`,
  down: svg`<path d="m6 10 6 6 6-6" />`,
  cube: svg`<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" />`,
};

export type IconName = keyof typeof PATHS;

/** A glyph for each kind of fixture, drawn about the origin to fit a badge
 * of radius 10. Stroke it; do not fill. */
export const KIND_GLYPHS: Readonly<Record<FixtureKind, TemplateResult>> = {
  light: svg`<path d="M-3 1.5a4.2 4.2 0 1 1 6 0v1.7h-6zM-2 5.4h4" />`,
  switch: svg`<path d="M0 -5v4.5M-3.3 -2.9a4.6 4.6 0 1 0 6.6 0" />`,
  cover: svg`<path d="M-5 -4.6h10M-3.8 -4.6v9.2h7.6v-9.2M-3.8 -1.6h7.6M-3.8 1.4h7.6" />`,
  opening: svg`<path d="M-5 5h10M-3.2 5v-9.6h6.4V5M0.9 0.4h0.1" />`,
  climate: svg`<path d="M-1.3 0.9v-4.6a1.3 1.3 0 0 1 2.6 0v4.6a2.7 2.7 0 1 1-2.6 0zM0 3.2v-3" />`,
  presence: svg`<path d="M1.8 -3.4a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0M-3.8 5.2c0-2.8 1.7-4.4 3.8-4.4s3.8 1.6 3.8 4.4" />`,
  media: svg`<path d="M-2.4 -4.2v8.4l6.2-4.2z" />`,
  lock: svg`<path d="M-3.6 -0.6h7.2v5.4h-7.2zM-2.1 -0.6v-1.7a2.1 2.1 0 0 1 4.2 0v1.7" />`,
  label: svg`<path d="M-4.4 3.4a5 5 0 1 1 8.8 0M0 1.2l2.3-3.3" />`,
};

/** What each kind of fixture is called in lists. */
export const KIND_NAMES: Readonly<Record<FixtureKind, string>> = {
  light: "Light",
  switch: "Switch",
  cover: "Blind or cover",
  opening: "Door or window",
  climate: "Temperature",
  presence: "Presence",
  media: "Media player",
  lock: "Lock",
  label: "Sensor",
};

export function icon(name: IconName): TemplateResult {
  return html`<svg
    class="icon"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${PATHS[name]}
  </svg>`;
}
