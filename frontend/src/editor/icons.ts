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
