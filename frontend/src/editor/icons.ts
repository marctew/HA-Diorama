import { html, svg, type TemplateResult } from "lit";

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
  cube: svg`<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" />`,
};

export type IconName = keyof typeof PATHS;

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
