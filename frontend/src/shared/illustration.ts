import { svg, type SVGTemplateResult } from "lit";

/** A small isometric room, used for empty states. Colours come from the
 * Home Assistant theme through CSS variables set on the host. */
export function roomIllustration(): SVGTemplateResult {
  return svg`
    <svg viewBox="0 0 240 200" role="img" aria-label="An empty room">
      <polygon points="120,100 220,150 120,198 20,150" fill="var(--diorama-floor)" />
      <polygon points="20,150 20,70 120,20 120,100" fill="var(--diorama-wall-a)" />
      <polygon points="120,100 120,20 220,70 220,150" fill="var(--diorama-wall-b)" />
      <polygon points="150,75 190,95 190,125 150,105" fill="var(--diorama-window)" />
      <polygon points="50,135 50,85 80,70 80,120" fill="var(--diorama-door)" />
      <polygon points="96,150 128,134 160,150 128,166" fill="var(--diorama-accent)" opacity="0.35" />
      <polygon points="126,112 130,110 130,148 126,150" fill="var(--diorama-door)" />
      <polygon points="116,104 128,96 140,104 128,112" fill="var(--diorama-accent)" />
    </svg>
  `;
}
