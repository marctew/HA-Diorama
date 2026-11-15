import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  categories,
  EMPTY_CATALOGUE,
  isOwnModel,
  modelUrl,
  searchModels,
  type Catalogue,
  type CatalogueModel,
} from "../core/catalogue";
import { modelFileId } from "../core/upload";
import { formatLength, type UnitSystem } from "../core/units";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon } from "./icons";

/** The furniture catalogue: search it, pick a piece, then click in the plan
 * to place it. Fires `catalogue-pick` with the model, or undefined to stop
 * placing, `catalogue-upload` with a file to add as a model, and
 * `catalogue-close`. */
@customElement("diorama-catalogue-drawer")
export class DioramaCatalogueDrawer extends LitElement {
  @property({ attribute: false }) catalogue: Catalogue = EMPTY_CATALOGUE;
  /** To fetch and remove the models people added themselves. */
  @property({ attribute: false }) hass?: HomeAssistant;
  /** The model being placed, if any. */
  @property({ attribute: false }) picked?: CatalogueModel;
  @property() units: UnitSystem = "metric";

  @state() private query = "";
  /** Pictures of the models, by model id, as they are drawn. */
  @state() private pictures: Readonly<Record<string, string>> = {};
  /** One of your own models that "delete" has been pressed on once. */
  @state() private confirming?: string;
  @state() private deleteError?: string;

  private picturesFor?: Catalogue;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("catalogue") && this.catalogue !== this.picturesFor) {
      this.picturesFor = this.catalogue;
      void this.drawPictures(this.catalogue);
    }
  }

  /** Pictures need the 3D code, which is fetched here if it has not been. */
  private async drawPictures(catalogue: Catalogue): Promise<void> {
    if (catalogue.models.length === 0) return;
    try {
      const { thumbnail } = await import("../render/thumbnails");
      const hass = this.hass;
      if (hass) {
        const { setPrivateFetch } = await import("../render/models");
        setPrivateFetch((path) => hass.fetchWithAuth(path));
      }
      for (const model of catalogue.models) {
        const picture = await thumbnail(modelUrl(catalogue, model));
        if (this.catalogue !== catalogue) return;
        if (picture) this.pictures = { ...this.pictures, [model.id]: picture };
      }
    } catch (error) {
      // The tiles still show each piece's outline and size.
      console.warn("Diorama: furniture pictures are not available", error);
    }
  }

  protected override render(): TemplateResult {
    const found = searchModels(this.catalogue, this.query);
    const bundled = found.filter((model) => !isOwnModel(model));
    const own = found.filter(isOwnModel);
    const searching = this.query.trim() !== "";
    return html`
      <header>
        <h2>Furniture</h2>
        <button
          class="icon"
          title="Close"
          aria-label="Close the furniture list"
          @click=${() => this.dispatchEvent(new CustomEvent("catalogue-close"))}
        >
          ${icon("close")}
        </button>
      </header>
      <input
        type="search"
        placeholder="Search: sofa, bed, lamp..."
        aria-label="Search furniture"
        .value=${this.query}
        @input=${(event: Event) => (this.query = (event.target as HTMLInputElement).value)}
      />
      <div class="list">
        ${this.catalogue.models.length === 0
          ? html`<p class="empty">The furniture catalogue could not be loaded.</p>`
          : found.length === 0
            ? html`<p class="empty">Nothing matches "${this.query}".</p>`
            : categories(this.catalogue).map((category) => this.renderCategory(category, bundled))}
        ${searching && own.length === 0 ? nothing : this.renderOwn(own, searching)}
      </div>
      <p class="help">
        ${this.picked
          ? html`Click in the plan to place the <strong>${this.picked.name.toLowerCase()}</strong
              >. <kbd>R</kbd> turns it, <kbd>Esc</kbd> stops.`
          : "Pick a piece, then click in the plan to place it."}
      </p>
    `;
  }

  private renderCategory(category: string, found: CatalogueModel[]): TemplateResult | typeof nothing {
    const models = found.filter((model) => model.category === category);
    if (models.length === 0) return nothing;
    return html`
      <h3>${category}</h3>
      <div class="tiles">${models.map((model) => this.renderTile(model))}</div>
    `;
  }

  /** Your own models, and the way to add one. */
  private renderOwn(own: CatalogueModel[], searching: boolean): TemplateResult {
    return html`
      <h3>My models</h3>
      <div class="tiles">
        ${own.map(
          (model) => html`
            <div class="own">
              ${this.renderTile(model)}
              ${this.confirming === model.id
                ? html`<button class="remove sure" @click=${() => this.deleteModel(model)}>Delete?</button>`
                : html`<button
                    class="remove"
                    title="Delete this model"
                    aria-label="Delete ${model.name}"
                    @click=${() => {
                      this.confirming = model.id;
                      this.deleteError = undefined;
                    }}
                  >
                    ${icon("close")}
                  </button>`}
            </div>
          `,
        )}
        ${searching
          ? nothing
          : html`<label class="tile add" title="Add a .glb model of your own">
              <input
                type="file"
                accept=".glb,model/gltf-binary"
                @change=${(event: Event) => {
                  const input = event.target as HTMLInputElement;
                  const file = input.files?.[0];
                  // So that the same file can be chosen again.
                  input.value = "";
                  if (file) {
                    this.dispatchEvent(new CustomEvent("catalogue-upload", { detail: { file } }));
                  }
                }}
              />
              <span class="plus">${icon("plus")}</span>
              <span class="name">Add a model</span>
            </label>`}
      </div>
      ${this.confirming
        ? html`<p class="note">Pieces already made from it stay in the plan as grey boxes.</p>`
        : nothing}
      ${this.deleteError ? html`<p class="note error" role="alert">${this.deleteError}</p>` : nothing}
    `;
  }

  private async deleteModel(model: CatalogueModel): Promise<void> {
    this.confirming = undefined;
    if (!this.hass) return;
    try {
      const response = await this.hass.fetchWithAuth(
        `/api/diorama/models/${modelFileId(model.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(String(response.status));
      if (this.picked?.id === model.id) {
        this.dispatchEvent(new CustomEvent("catalogue-pick", { detail: { model: undefined } }));
      }
      // The list itself follows when Home Assistant says the catalogue changed.
    } catch (error) {
      console.warn("Diorama: could not delete the model", error);
      this.deleteError = `${model.name} could not be deleted.`;
    }
  }

  private renderTile(model: CatalogueModel): TemplateResult {
    const picked = this.picked?.id === model.id;
    const picture = this.pictures[model.id];
    const size = `${formatLength(model.width, this.units)} × ${formatLength(model.depth, this.units)}`;
    return html`
      <button
        class="tile ${picked ? "picked" : ""}"
        title="${model.name}, ${size}"
        aria-pressed=${picked}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("catalogue-pick", { detail: { model: picked ? undefined : model } }),
          )}
      >
        ${picture
          ? html`<img src=${picture} alt="" />`
          : html`<span class="outline" style=${outlineStyle(model)}></span>`}
        <span class="name">${model.name}</span>
      </button>
    `;
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        min-height: 0;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 14px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
        color: var(--diorama-text);
        font-size: 13px;
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 8px 6px 16px;
      }
      h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      h3 {
        margin: 14px 0 6px;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--diorama-text-muted);
      }
      h3:first-child {
        margin-top: 4px;
      }
      button.icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      button.icon:hover {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      input {
        box-sizing: border-box;
        height: 36px;
        margin: 0 12px 4px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--primary-background-color, #fafafa);
        color: inherit;
        font: inherit;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 12px 8px;
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .tile {
        display: grid;
        justify-items: center;
        gap: 2px;
        padding: 4px 2px 6px;
        border: 1.5px solid transparent;
        border-radius: 10px;
        background: color-mix(in srgb, var(--diorama-text) 4%, transparent);
        color: inherit;
        font: inherit;
        font-size: 11px;
        line-height: 1.2;
        text-align: center;
        cursor: pointer;
      }
      .own {
        position: relative;
        display: grid;
      }
      .remove {
        position: absolute;
        top: 3px;
        right: 3px;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--card-background-color, #fff);
        color: var(--diorama-text-muted);
        box-shadow: 0 0 0 1px var(--divider-color, rgba(0, 0, 0, 0.2));
        cursor: pointer;
        opacity: 0;
      }
      .remove svg {
        width: 13px;
        height: 13px;
      }
      .own:hover .remove,
      .remove:focus-visible,
      .remove.sure {
        opacity: 1;
      }
      .remove.sure {
        width: auto;
        padding: 0 8px;
        border-radius: 11px;
        background: var(--error-color, #db4437);
        color: #fff;
        font: inherit;
        font-size: 11px;
        box-shadow: none;
      }
      .tile.add {
        border: 1.5px dashed color-mix(in srgb, var(--diorama-text) 30%, transparent);
        background: none;
        color: var(--diorama-text-muted);
      }
      .tile.add input {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: 0;
        opacity: 0;
      }
      .tile.add:focus-within {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      .plus {
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
      }
      .note {
        margin: 8px 2px 0;
        font-size: 12px;
        line-height: 1.4;
        color: var(--diorama-text-muted);
      }
      .note.error {
        color: var(--error-color, #c62828);
      }
      .tile:hover {
        background: color-mix(in srgb, var(--diorama-text) 9%, transparent);
      }
      .tile.picked {
        border-color: var(--diorama-accent);
        background: color-mix(in srgb, var(--diorama-accent) 14%, transparent);
      }
      .tile img,
      .tile .outline {
        width: 64px;
        height: 64px;
      }
      .tile img {
        object-fit: contain;
      }
      .tile .outline {
        box-sizing: border-box;
        border: 1.5px solid color-mix(in srgb, var(--diorama-text) 45%, transparent);
        border-radius: 3px;
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
        place-self: center;
      }
      .name {
        min-height: 2.4em;
      }
      .empty {
        margin: 24px 8px;
        text-align: center;
        color: var(--diorama-text-muted);
      }
      .help {
        margin: 0;
        padding: 10px 14px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        font-size: 12px;
        line-height: 1.4;
        color: var(--diorama-text-muted);
      }
      kbd {
        padding: 1px 5px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 4px;
        font: inherit;
        font-size: 11px;
        color: var(--diorama-text);
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
    `,
  ];
}

/** Until its picture is drawn, a tile shows the piece's outline from above,
 * in proportion. */
function outlineStyle(model: CatalogueModel): string {
  const largest = Math.max(model.width, model.depth, 0.01);
  const width = Math.max(8, Math.round((model.width / largest) * 56));
  const height = Math.max(8, Math.round((model.depth / largest) * 56));
  return `width:${width}px;height:${height}px;margin:${(64 - height) / 2}px ${(64 - width) / 2}px`;
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-catalogue-drawer": DioramaCatalogueDrawer;
  }
}
