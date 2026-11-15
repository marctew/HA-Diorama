import { css } from "lit";

/** Maps Home Assistant theme variables onto Diorama's own, with fallbacks so
 * the elements also look right outside Home Assistant. */
export const themeStyles = css`
  :host {
    --diorama-text: var(--primary-text-color, #1c1c1c);
    --diorama-text-muted: var(--secondary-text-color, #6b6b6b);
    --diorama-accent: var(--primary-color, #03a9f4);
    --diorama-floor: color-mix(in srgb, var(--diorama-text) 12%, transparent);
    --diorama-wall-a: color-mix(in srgb, var(--diorama-text) 22%, transparent);
    --diorama-wall-b: color-mix(in srgb, var(--diorama-text) 16%, transparent);
    --diorama-window: color-mix(in srgb, var(--diorama-accent) 45%, transparent);
    --diorama-door: color-mix(in srgb, var(--diorama-text) 38%, transparent);
  }
`;
