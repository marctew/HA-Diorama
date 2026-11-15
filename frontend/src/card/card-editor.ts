import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DioramaApi } from "../core/api";
import { parseCardConfig, tidyCardConfig, type CardConfig, type CardView } from "../core/card-config";
import type { WallMode } from "../core/cutaway";
import type { Floor, House } from "../core/scene";
import { camerasFor } from "../core/views";
import { languageOf, localizer, type Localize, type TranslationKey } from "../shared/localize";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";

const SHAPES: readonly [string, TranslationKey][] = [
  ["16:9", "settings.shape_wide"],
  ["4:3", "settings.shape_standard"],
  ["1:1", "settings.shape_square"],
  ["3:4", "settings.shape_tall"],
];

/** The card's settings in the dashboard editor. Home Assistant gives it the
 * configuration and `hass`; it answers with `config-changed` events. */
@customElement("diorama-card-editor")
export class DioramaCardEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;

  @state() private raw: Record<string, unknown> = {};
  @state() private house?: House;
  /** Floors fetched for their lists of rooms. */
  @state() private floors: Readonly<Record<string, Floor>> = {};

  private loading = false;
  private readonly fetching = new Set<string>();

  setConfig(config: Record<string, unknown>): void {
    this.raw = config;
  }

  /** The configuration as the card reads it, forgiving of half-made ones. */
  private get config(): CardConfig {
    try {
      return parseCardConfig(this.raw);
    } catch {
      // A floor or room view with nothing chosen yet: show what there is.
      const safe = parseCardConfig({ ...this.raw, view: "house" });
      const view = this.raw.view === "floor" || this.raw.view === "room" ? this.raw.view : "house";
      return {
        ...safe,
        view,
        floor: typeof this.raw.floor === "string" ? this.raw.floor : undefined,
        room: typeof this.raw.room === "string" ? this.raw.room : undefined,
      };
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass") && this.hass && !this.house && !this.loading) void this.loadHouse();
    const floor = this.config.floor;
    if (this.config.view === "room" && floor && this.hass) this.loadFloor(floor);
  }

  private async loadHouse(): Promise<void> {
    if (!this.hass) return;
    this.loading = true;
    try {
      this.house = await new DioramaApi(this.hass).getHouse();
    } catch {
      // The pickers stay empty; the YAML editor still works.
    } finally {
      this.loading = false;
    }
  }

  private loadFloor(id: string): void {
    if (!this.hass || this.floors[id] || this.fetching.has(id)) return;
    this.fetching.add(id);
    new DioramaApi(this.hass)
      .getFloor(id)
      .then((floor) => (this.floors = { ...this.floors, [id]: floor }))
      .catch(() => undefined)
      .finally(() => this.fetching.delete(id));
  }

  protected override render(): TemplateResult {
    const config = this.config;
    const floors = this.house?.floors ?? [];
    const rooms = config.floor ? (this.floors[config.floor]?.rooms ?? []) : [];
    const t = localizer(this, languageOf(this.hass));
    return html`
      <label>
        <span>${t("settings.show")}</span>
        <select @change=${(event: Event) => this.setView(value(event) as CardView)}>
          ${option("house", t("settings.show_house"), config.view)}
          ${option("floor", t("settings.show_floor"), config.view)}
          ${option("room", t("settings.show_room"), config.view)}
        </select>
      </label>
      ${config.view === "house"
        ? nothing
        : html`<label>
            <span>${t("settings.floor")}</span>
            <select @change=${(event: Event) => this.change({ floor: value(event), room: undefined })}>
              ${config.floor && floors.some((floor) => floor.id === config.floor)
                ? nothing
                : html`<option value="" selected>${t("settings.choose_floor")}</option>`}
              ${floors.map((floor) => option(floor.id, floor.name, config.floor))}
            </select>
          </label>`}
      ${config.view !== "room"
        ? nothing
        : html`<label>
            <span>${t("settings.room")}</span>
            <select
              ?disabled=${!config.floor}
              @change=${(event: Event) => this.change({ room: value(event) })}
            >
              ${config.room && rooms.some((room) => room.id === config.room)
                ? nothing
                : html`<option value="" selected>${t("settings.choose_room")}</option>`}
              ${rooms.map((room) => option(room.id, room.name || t("settings.unnamed_room"), config.room))}
            </select>
          </label>`}
      ${this.house && floors.length === 0
        ? html`<p class="note">${t("settings.nothing_drawn")}</p>`
        : nothing}
      ${config.view === "house" && floors.length > 1
        ? html`<label class="check">
            <input
              type="checkbox"
              .checked=${config.floor_gap > 0}
              @change=${(event: Event) => this.change({ floor_gap: checked(event) ? 2.5 : 0 })}
            />
            <span>${t("settings.floor_gap")}</span>
          </label>`
        : nothing}
      ${this.renderCameras(config, t)}
      <label>
        <span>${t("settings.shape")}</span>
        <select @change=${(event: Event) => this.change({ aspect_ratio: value(event) })}>
          ${SHAPES.some(([ratio]) => ratio === config.aspect_ratio)
            ? nothing
            : option(config.aspect_ratio, config.aspect_ratio, config.aspect_ratio)}
          ${SHAPES.map(([ratio, label]) => option(ratio, t(label), config.aspect_ratio))}
        </select>
      </label>
      <label>
        <span>${t("settings.walls")}</span>
        <select @change=${(event: Event) => this.change({ walls: value(event) as WallMode })}>
          ${option("auto", t("settings.walls_auto"), config.walls)}
          ${option("full", t("settings.walls_full"), config.walls)}
          ${option("low", t("settings.walls_low"), config.walls)}
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          .checked=${config.interactive}
          @change=${(event: Event) => this.change({ interactive: checked(event) })}
        />
        <span>${t("settings.interactive")}</span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          .checked=${config.controls}
          @change=${(event: Event) => this.change({ controls: checked(event) })}
        />
        <span>${t("settings.controls")}</span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          .checked=${config.day_night}
          @change=${(event: Event) => this.change({ day_night: checked(event) })}
        />
        <span>${t("settings.day_night")}</span>
      </label>
    `;
  }

  private renderCameras(config: CardConfig, t: Localize): TemplateResult | typeof nothing {
    const cameras = this.house ? camerasFor(this.house, config) : [];
    const known = cameras.some((camera) => camera.id === config.camera);
    if (cameras.length === 0 && config.camera === "default") return nothing;
    return html`<label>
      <span>${t("settings.look_from")}</span>
      <select @change=${(event: Event) => this.change({ camera: value(event) || "default" })}>
        <option value="" ?selected=${!known}>${t("settings.look_from_default")}</option>
        ${cameras.map((camera) => option(camera.id, camera.name, config.camera))}
      </select>
    </label>`;
  }

  private setView(view: CardView): void {
    if (view === "house") return this.change({ view, floor: undefined, room: undefined });
    // Start from the first floor: one fewer thing to choose.
    const floor = this.config.floor ?? this.house?.floors[0]?.id;
    this.change({ view, floor, room: view === "room" ? this.config.room : undefined });
  }

  private change(patch: Partial<Record<keyof CardConfig, unknown>>): void {
    const next: Record<string, unknown> = { ...this.raw, ...patch };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    let config = next;
    try {
      config = tidyCardConfig(next);
    } catch {
      // Not complete yet (a floor view with no floor): pass it on as it is,
      // and the card says what is missing.
    }
    this.raw = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }),
    );
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: block;
        color: var(--diorama-text);
        font-size: 14px;
      }
      label {
        display: block;
        margin-bottom: 16px;
      }
      label > span {
        display: block;
        margin-bottom: 4px;
        font-size: 12px;
        color: var(--diorama-text-muted);
      }
      select {
        box-sizing: border-box;
        width: 100%;
        height: 44px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      label.check {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 32px;
        margin-bottom: 8px;
      }
      label.check > span {
        margin: 0;
        font-size: 14px;
        color: inherit;
      }
      input[type="checkbox"] {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--diorama-accent);
      }
      select:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      .note {
        margin: -8px 0 16px;
        font-size: 13px;
        color: var(--diorama-text-muted);
      }
    `,
  ];
}

function option(id: string, label: string, current: string | undefined): TemplateResult {
  return html`<option value=${id} ?selected=${id === current}>${label}</option>`;
}

function value(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-card-editor": DioramaCardEditor;
  }
}
