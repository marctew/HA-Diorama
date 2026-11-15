import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { DioramaApi, errorMessage, isConflict } from "../core/api";
import { browserStorage, clearDraft, loadDraft, saveDraft, type Draft } from "../core/draft";
import { History } from "../core/history";
import { EMPTY_CATALOGUE, type Catalogue, type CatalogueModel } from "../core/catalogue";
import type { FixtureVisual } from "../core/bindings";
import { allFixtures, deleteFixtures } from "../core/fixtures";
import { deleteItems, duplicateItems, rotateItems, ROTATE_STEP } from "../core/items";
import type { Point } from "../core/geometry";
import { deleteOpenings, type OpeningType } from "../core/openings";
import { deleteVertices, deleteWalls } from "../core/plan";
import { calibrate, newTrace } from "../core/trace";
import { parseLength } from "../core/units";
import { newId } from "../core/ids";
import type { Camera, FixtureKind, Floor, House, SceneEvent } from "../core/scene";
import type { UnitSystem } from "../core/units";
import { FixtureStates } from "../shared/fixture-state";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon } from "./icons";
import "./catalogue-drawer";
import "./device-drawer";
import "./inspector";
import "./plan-view";
import type { DioramaPlanView, Tool } from "./plan-view";
import { isEmpty, NO_SELECTION, prune, type Selection } from "./selection";
import type { SceneFloor } from "../render/scene-renderer";

/** What the editor shows: the plan, the 3D model, or both side by side. */
export type ViewMode = "plan" | "split" | "3d";

const VIEW_MODE_KEY = "diorama.editor.view";

const DRAFT_DELAY = 400;

/** What the floor holds, without the two keys the server owns. */
function content(floor: Floor): string {
  return JSON.stringify({ ...floor, revision: 0, schema_version: 0 });
}

/** The editor for one floor: the plan, the tools, the inspector, and
 * everything about saving (undo, drafts, conflicts with other people). */
@customElement("diorama-editor")
export class DioramaEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property() floorId?: string;
  /** The house, for its saved views. Changes to them leave as
   * `cameras-change` events; whoever owns the house saves them. */
  @property({ attribute: false }) house?: House;
  /** On a narrow screen the plan can be looked at but not changed. */
  @property({ type: Boolean, reflect: true }) narrow = false;

  /** The floor as it is saved. */
  @state() private saved?: Floor;
  /** The floor as it is being edited. */
  @state() private floor?: Floor;
  @state() private tool: Tool = "select";
  @state() private selection: Selection = NO_SELECTION;
  @state() private loadError?: string;
  @state() private saveError?: string;
  @state() private saving = false;
  /** Someone else saved this floor while it was being edited here. */
  @state() private conflict = false;
  /** Unsaved edits found from an earlier visit. */
  @state() private draftOffer?: Draft;
  @state() private catalogue: Catalogue = EMPTY_CATALOGUE;
  /** The piece of furniture the next click in the plan will place. */
  @state() private placing?: CatalogueModel;
  /** The entity the next click in the plan will place. */
  @state() private placingEntity?: string;
  @state() private placingKind: FixtureKind = "switch";
  /** What each fixture looks like now, for the badges in the plan. */
  @state() private visuals: ReadonlyMap<string, FixtureVisual> = new Map();
  /** What the door and window tool places. */
  @state() private openingType: OpeningType = "door";
  /** The plan image being traced over, once fetched. */
  @state() private traceImage?: { id: string; url: string; width: number; height: number };
  /** Picking two points on the image, to set its scale. */
  @state() private calibrating = false;
  /** The two points picked, waiting for the real distance between them. */
  @state() private measured?: { first: Point; second: Point };
  /** The list of saved views is open. */
  @state() private viewsOpen = false;
  @state() private viewMode: ViewMode = "split";
  /** The 3D view's code has arrived. It is only fetched when first shown. */
  @state() private sceneLoaded = false;
  @state() private sceneFailed = false;

  /** The floor as the 3D view wants it; the same array until the floor changes. */
  private sceneFloors: readonly SceneFloor[] = [];

  @query("diorama-plan-view") private plan?: DioramaPlanView;

  private history?: History<Floor>;
  /** The state of the history that matches what is saved. */
  private savedState?: Floor;
  private loadedId?: string;
  private unsubscribe?: () => Promise<void> | void;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private readonly storage = browserStorage();
  private readonly fixtureStates = new FixtureStates(() => this.requestUpdate());

  private get api(): DioramaApi | undefined {
    return this.hass ? new DioramaApi(this.hass) : undefined;
  }

  private get units(): UnitSystem {
    return this.hass?.config?.unit_system?.length === "mi" ? "imperial" : "metric";
  }

  /** A narrow screen has no room for the plan's tools: show the model. */
  private get mode(): ViewMode {
    return this.narrow ? "3d" : this.viewMode;
  }

  private get dirty(): boolean {
    return this.floor !== undefined && this.floor !== this.savedState;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const remembered = readSetting(this.storage, VIEW_MODE_KEY);
    if (remembered === "plan" || remembered === "split" || remembered === "3d") {
      this.viewMode = remembered;
    }
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("beforeunload", this.onBeforeUnload);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.flushDraft();
    this.fixtureStates.dispose();
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    this.loadedId = undefined;
    if (unsubscribe) void unsubscribe();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if ((changed.has("hass") || changed.has("floorId")) && this.hass && this.floorId) {
      if (this.loadedId !== this.floorId) void this.load(this.floorId);
    }
    if (this.fixtureStates.update(this.hass, this.floor ? allFixtures(this.floor) : [])) {
      this.visuals = this.fixtureStates.visuals;
    }
    const traceId = this.floor?.trace?.image;
    if (traceId !== this.traceWanted) {
      this.traceWanted = traceId;
      void this.loadTrace(traceId);
    }
    if ((changed as Map<PropertyKey, unknown>).has("floor")) {
      this.sceneFloors = this.floor ? [{ floor: this.floor, elevation: 0 }] : [];
    }
    if (this.mode !== "plan" && !this.sceneLoaded && !this.sceneFailed) void this.loadScene();
  }

  private sceneLoading = false;
  private traceWanted?: string;

  // The plan image to trace over.

  /** Fetch an uploaded image (it needs the user's sign-in, so it cannot just
   * be given to the page as an address) and find out how big it is. */
  private async loadTrace(id: string | undefined): Promise<void> {
    const previous = this.traceImage;
    if (!id || !this.hass) {
      this.traceImage = undefined;
    } else if (previous?.id !== id) {
      try {
        const response = await this.hass.fetchWithAuth(`/api/diorama/trace/${id}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const picture = await measureImage(await response.blob());
        if (this.traceWanted !== id) {
          URL.revokeObjectURL(picture.url);
          return;
        }
        this.traceImage = { id, ...picture };
      } catch (error) {
        console.warn("Diorama: the plan image could not be loaded", error);
        this.traceImage = undefined;
      }
    }
    if (previous && previous !== this.traceImage) URL.revokeObjectURL(previous.url);
  }

  private async uploadTrace(file: File): Promise<void> {
    const floor = this.floor;
    if (!this.hass || !floor) return;
    this.saveError = undefined;
    try {
      const picture = await measureImage(file);
      const response = await this.hass.fetchWithAuth("/api/diorama/trace", {
        method: "POST",
        body: file,
      });
      if (!response.ok) {
        URL.revokeObjectURL(picture.url);
        const reply = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(reply.message ?? `The upload failed (${response.status}).`);
      }
      const { id } = (await response.json()) as { id: string };
      // Shown at once from the file in hand; no need to fetch it back.
      if (this.traceImage) URL.revokeObjectURL(this.traceImage.url);
      this.traceWanted = id;
      this.traceImage = { id, ...picture };
      const xs = floor.vertices.map((vertex) => vertex.x);
      const ys = floor.vertices.map((vertex) => vertex.y);
      const centre = xs.length
        ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
        : { x: 0, y: 0 };
      this.applyEdit({ ...floor, trace: newTrace(id, picture.width, picture.height, centre) });
      this.plan?.fitToFloor();
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : "The image could not be used.";
    }
  }

  private finishCalibration(text: string): void {
    const floor = this.floor;
    const measured = this.measured;
    const metres = parseLength(text, this.units);
    if (!floor?.trace || !measured || metres === undefined) return;
    this.applyEdit({ ...floor, trace: calibrate(floor.trace, measured.first, measured.second, metres) });
    this.measured = undefined;
    this.calibrating = false;
  }

  private async loadScene(): Promise<void> {
    if (this.sceneLoading) return;
    this.sceneLoading = true;
    try {
      await import("../render/scene-view");
      this.sceneLoaded = true;
    } catch (error) {
      console.error("Diorama: the 3D view could not be loaded", error);
      this.sceneFailed = true;
    } finally {
      this.sceneLoading = false;
    }
  }

  private setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    writeSetting(this.storage, VIEW_MODE_KEY, mode);
    if (mode === "3d") this.tool = "select";
  }

  // Loading and saving.

  private async load(floorId: string): Promise<void> {
    const api = this.api;
    if (!api) return;
    this.flushDraft();
    this.loadedId = floorId;
    this.loadError = undefined;
    if (this.catalogue === EMPTY_CATALOGUE) {
      // The plan works without it: furniture is then drawn as plain squares.
      void api.getCatalogue().then(
        (catalogue) => (this.catalogue = catalogue),
        (error) => console.warn("Diorama: the furniture catalogue did not load", error),
      );
    }
    this.floor = undefined;
    this.saved = undefined;
    try {
      const floor = await api.getFloor(floorId);
      if (this.loadedId !== floorId) return;
      this.adopt(floor);
      const draft = loadDraft(this.storage, floorId);
      if (draft && content(draft.floor) !== content(floor)) this.draftOffer = draft;
      else clearDraft(this.storage, floorId);
    } catch (error) {
      if (this.loadedId === floorId) this.loadError = errorMessage(error);
      return;
    }
    if (!this.unsubscribe) {
      try {
        const unsubscribe = await api.subscribe(this.onSceneEvent);
        if (this.isConnected && !this.unsubscribe) this.unsubscribe = unsubscribe;
        else void unsubscribe();
      } catch {
        // Without it, a change made elsewhere shows up as a conflict on save.
      }
    }
  }

  /** Take a floor from the server as both the saved and the edited state. */
  private adopt(floor: Floor): void {
    this.saved = floor;
    this.floor = floor;
    this.savedState = floor;
    this.history = new History(floor);
    this.selection = prune(this.selection, floor);
    this.conflict = false;
    this.saveError = undefined;
    this.draftOffer = undefined;
  }

  private async save(overwrite = false): Promise<void> {
    const api = this.api;
    const floor = this.floor;
    if (!api || !floor || !this.saved || this.saving || (!this.dirty && !overwrite)) return;
    this.saving = true;
    this.saveError = undefined;
    try {
      let revision = this.saved.revision;
      if (overwrite) revision = (await api.getFloor(floor.id)).revision;
      const result = await api.saveFloor({ ...floor, revision });
      this.saved = result;
      // Edits made while the save was on its way stay unsaved.
      this.savedState = floor;
      this.conflict = false;
      if (!this.dirty) clearDraft(this.storage, floor.id);
      this.requestUpdate();
    } catch (error) {
      if (isConflict(error)) this.conflict = true;
      else this.saveError = errorMessage(error);
    } finally {
      this.saving = false;
    }
  }

  /** Throw away the edits made here and show what is saved. */
  private async reload(): Promise<void> {
    if (!this.floorId) return;
    clearDraft(this.storage, this.floorId);
    this.loadedId = undefined;
    await this.load(this.floorId);
  }

  private onSceneEvent = (event: SceneEvent): void => {
    if (!this.saved) return;
    const mine = event.type === "floor" && event.floor_id === this.saved.id;
    if (!mine && event.type !== "reset") return;
    // Our own save: the reply has, or will have, the same revision.
    if (this.saving || event.revision <= this.saved.revision) return;
    if (this.dirty) this.conflict = true;
    else void this.reload();
  };

  // Editing.

  private applyEdit(floor: Floor): void {
    if (!this.history || floor === this.floor) return;
    this.history.push(floor);
    this.setFloor(floor);
  }

  private setFloor(floor: Floor): void {
    this.floor = floor;
    this.selection = prune(this.selection, floor);
    this.scheduleDraft();
  }

  private undo(): void {
    if (this.history?.canUndo) this.setFloor(this.history.undo());
  }

  private redo(): void {
    if (this.history?.canRedo) this.setFloor(this.history.redo());
  }

  private deleteSelection(): void {
    const floor = this.floor;
    if (!floor || isEmpty(this.selection)) return;
    let result = deleteOpenings(floor, new Set(this.selection.openings));
    result = deleteFixtures(result, new Set(this.selection.fixtures));
    result = deleteItems(result, new Set(this.selection.items));
    result = deleteWalls(result, new Set(this.selection.walls));
    result = deleteVertices(result, new Set(this.selection.vertices));
    this.applyEdit(result);
  }

  private rotateSelection(degrees: number): void {
    if (!this.floor || this.selection.items.length === 0) return;
    this.applyEdit(rotateItems(this.floor, new Set(this.selection.items), degrees));
  }

  private duplicateSelection(): void {
    if (!this.floor || this.selection.items.length === 0) return;
    const copied = duplicateItems(this.floor, new Set(this.selection.items));
    this.applyEdit(copied.floor);
    // The copies are selected, ready to be dragged into place.
    this.selection = { ...NO_SELECTION, items: copied.ids };
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== "select") this.selection = NO_SELECTION;
    if (tool !== "furniture") this.placing = undefined;
    if (tool !== "device") this.placingEntity = undefined;
  }

  // Drafts.

  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.flushDraft(), DRAFT_DELAY);
  }

  private flushDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    if (!this.floor || !this.saved) return;
    if (this.dirty) {
      saveDraft(this.storage, {
        baseRevision: this.saved.revision,
        floor: this.floor,
        savedAt: Date.now(),
      });
    } else if (!this.draftOffer) {
      clearDraft(this.storage, this.floor.id);
    }
  }

  private restoreDraft(): void {
    const draft = this.draftOffer;
    this.draftOffer = undefined;
    if (draft) this.applyEdit({ ...draft.floor });
  }

  private discardDraft(): void {
    this.draftOffer = undefined;
    if (this.floorId) clearDraft(this.storage, this.floorId);
  }

  // Keyboard.

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode === "3d" && !(event.ctrlKey || event.metaKey)) return;
    if (this.narrow || !this.floor) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key;
    // Saving works from anywhere, a field included; the browser's own "save
    // page" is never what is wanted here.
    if (command && key.toLowerCase() === "s") {
      event.preventDefault();
      void this.save();
      return;
    }
    if (isTyping(event)) return;
    if (command) {
      const lower = key.toLowerCase();
      if (lower === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if (lower === "y") {
        event.preventDefault();
        this.redo();
      } else if (lower === "s") {
        event.preventDefault();
        void this.save();
      } else if (lower === "d") {
        event.preventDefault();
        this.duplicateSelection();
      }
      return;
    }
    if (event.altKey) return;
    if (this.plan?.typeKey(key)) {
      event.preventDefault();
      return;
    }
    if (key === "Escape") {
      if (this.calibrating || this.measured) {
        this.calibrating = false;
        this.measured = undefined;
        return;
      }
      if (this.plan?.cancel()) return;
      if (this.placing) this.placing = undefined;
      else if (this.placingEntity) this.placingEntity = undefined;
      else if (this.tool !== "select") this.setTool("select");
      else this.selection = NO_SELECTION;
    } else if (key.toLowerCase() === "r") {
      const step = event.shiftKey ? -ROTATE_STEP : ROTATE_STEP;
      if (!this.plan?.rotatePlacing(step)) this.rotateSelection(step);
    } else if (key.toLowerCase() === "o" && !this.plan?.drawing) {
      this.setTool("opening");
    } else if (key.toLowerCase() === "f" && !this.plan?.drawing) {
      this.setTool("furniture");
    } else if (key.toLowerCase() === "b" && !this.plan?.drawing) {
      // Not D: Home Assistant opens its own device search on D.
      this.setTool("device");
    } else if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      this.deleteSelection();
    } else if (key === " ") {
      event.preventDefault();
      this.plan?.setSpace(true);
    } else if (key.toLowerCase() === "w" && !this.plan?.drawing) {
      this.setTool("wall");
    } else if (key.toLowerCase() === "v" && !this.plan?.drawing) {
      this.setTool("select");
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === " ") this.plan?.setSpace(false);
  };

  private onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.dirty) return;
    this.flushDraft();
    event.preventDefault();
  };

  // Rendering.

  protected override render(): TemplateResult {
    if (this.loadError) {
      return html`
        <div class="message" role="alert">
          <p>${this.loadError}</p>
          <button class="primary" @click=${() => this.reload()}>Try again</button>
        </div>
      `;
    }
    if (!this.floor) return html`<div class="message"><p>Loading the floor...</p></div>`;
    const mode = this.mode;
    return html`
      <div class="stage mode-${mode}">
        <div class="pane plan-pane" ?hidden=${mode === "3d"}>
          ${this.renderDrawer()}
          <diorama-plan-view
            .floor=${this.floor}
            .tool=${this.tool}
            .selection=${this.selection}
            .catalogue=${this.catalogue}
            .placing=${this.placing}
            .visuals=${this.visuals}
            .placingEntity=${this.placingEntity}
            .placingKind=${this.placingKind}
            .openingType=${this.openingType}
            .traceImage=${this.traceImage}
            ?calibrating=${this.calibrating}
            .units=${this.units}
            @plan-calibrate=${(event: CustomEvent<{ first: Point; second: Point }>) => {
              this.measured = event.detail;
              this.calibrating = false;
            }}
            @plan-edit=${(event: CustomEvent<{ floor: Floor; placedFixture?: string }>) => {
              this.applyEdit(event.detail.floor);
              // A device goes on the floor once: the next pick is another one.
              if (event.detail.placedFixture) this.placingEntity = undefined;
            }}
            @plan-select=${(event: CustomEvent<{ selection: Selection }>) =>
              (this.selection = event.detail.selection)}
          ></diorama-plan-view>
          ${this.renderPlanOverlays()}
        </div>
        ${mode === "plan" ? nothing : html`<div class="pane scene-pane">${this.renderScene()}</div>`}
        ${this.narrow ? this.renderNarrowNotice() : [this.renderTools(), this.renderSave()]}
        <div class="notices">${this.renderNotices()}</div>
      </div>
      ${this.narrow
        ? nothing
        : html`<diorama-inspector
            .floor=${this.floor}
            .selection=${this.selection}
            .hass=${this.hass}
            .catalogue=${this.catalogue}
            .units=${this.units}
            @inspector-edit=${(event: CustomEvent<{ floor: Floor }>) =>
              this.applyEdit(event.detail.floor)}
            @inspector-delete=${this.deleteSelection}
            @inspector-trace-upload=${(event: CustomEvent<{ file: File }>) =>
              this.uploadTrace(event.detail.file)}
            @inspector-trace-scale=${() => {
              this.setTool("select");
              this.measured = undefined;
              this.calibrating = true;
            }}
            @inspector-rotate=${() => this.rotateSelection(ROTATE_STEP)}
            @inspector-duplicate=${this.duplicateSelection}
          ></diorama-inspector>`}
    `;
  }

  private renderScene(): TemplateResult {
    if (this.sceneFailed) {
      return html`<p class="pane-message" role="alert">
        The 3D view could not be loaded. Reload the page to try again.
      </p>`;
    }
    if (!this.sceneLoaded) return html`<p class="pane-message">Loading the 3D view...</p>`;
    return html`<diorama-scene-view
        .floors=${this.sceneFloors}
        .catalogue=${this.catalogue}
        .hass=${this.hass}
        .highlightRoom=${this.selection.room}
      ></diorama-scene-view>
      ${this.renderViews()}`;
  }

  // Saved views: a camera position with a name, for cards to look from.

  /** The views saved on this floor, or on none. */
  private get cameras(): Camera[] {
    return (this.house?.cameras ?? []).filter(
      (camera) => camera.floor === null || camera.floor === this.floorId,
    );
  }

  private renderViews(): TemplateResult | typeof nothing {
    if (!this.house || this.narrow) return nothing;
    const cameras = this.cameras;
    const full = this.house.cameras.length >= 30;
    return html`
      <button
        class="views-button"
        aria-expanded=${this.viewsOpen}
        @click=${() => (this.viewsOpen = !this.viewsOpen)}
      >
        ${icon("camera")} Views${cameras.length ? html` (${cameras.length})` : nothing}
      </button>
      ${this.viewsOpen
        ? html`<div class="views" role="group" aria-label="Saved views">
            ${cameras.length === 0
              ? html`<p>
                  Turn the model to an angle you like and save it. A dashboard card can then look
                  from there.
                </p>`
              : cameras.map(
                  (camera) => html`
                    <div class="view">
                      <button class="go" title="Look from here" @click=${() => this.goToView(camera)}>
                        ${camera.name}
                      </button>
                      <button
                        class="remove"
                        title="Delete this view"
                        aria-label="Delete the view ${camera.name}"
                        @click=${() => this.changeCameras((all) => all.filter((c) => c.id !== camera.id))}
                      >
                        ${icon("close")}
                      </button>
                    </div>
                  `,
                )}
            <form
              @submit=${(event: SubmitEvent) => {
                event.preventDefault();
                const input = (event.target as HTMLFormElement).querySelector("input")!;
                if (this.saveView(input.value)) input.value = "";
              }}
            >
              <input
                type="text"
                maxlength="60"
                placeholder="Name this view"
                aria-label="Name for this view"
                ?disabled=${full}
              />
              <button class="primary" type="submit" ?disabled=${full}>Save</button>
            </form>
          </div>`
        : nothing}
    `;
  }

  private sceneView() {
    return this.renderRoot.querySelector("diorama-scene-view");
  }

  private goToView(camera: Camera): void {
    this.sceneView()?.goTo(camera);
  }

  /** Save where the camera is now under a name. Returns false if it could not. */
  private saveView(name: string): boolean {
    const at = this.sceneView()?.currentCamera();
    const trimmed = name.trim();
    if (!at || !trimmed || !this.floorId) return false;
    this.changeCameras((all) => [
      ...all,
      { id: newId("c"), name: trimmed, floor: this.floorId!, ...at },
    ]);
    return true;
  }

  private changeCameras(change: (cameras: Camera[]) => Camera[]): void {
    if (!this.house) return;
    this.dispatchEvent(
      new CustomEvent("cameras-change", { detail: { cameras: change(this.house.cameras) } }),
    );
  }

  private renderTools(): TemplateResult {
    const tool = (id: Tool, label: string, key: string) => html`
      <button
        class=${this.tool === id ? "active" : ""}
        title="${label} (${key})"
        aria-label=${label}
        aria-pressed=${this.tool === id}
        @click=${() => this.setTool(id)}
      >
        ${icon(id)}
      </button>
    `;
    const view = (id: ViewMode, label: string, name: "plan" | "split" | "cube") => html`
      <button
        class=${this.viewMode === id ? "active" : ""}
        title=${label}
        aria-label=${label}
        aria-pressed=${this.viewMode === id}
        @click=${() => this.setViewMode(id)}
      >
        ${icon(name)}
      </button>
    `;
    return html`
      <div class="toolbar tools" role="toolbar" aria-label="Tools">
        ${this.mode === "3d"
          ? nothing
          : html`${tool("select", "Select and move", "V")} ${tool("wall", "Draw walls", "W")}
              ${tool("opening", "Add doors and windows", "O")}
              ${tool("furniture", "Add furniture", "F")} ${tool("device", "Place devices", "B")}
              <span class="divider"></span>`}
        <button
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          ?disabled=${!this.history?.canUndo}
          @click=${this.undo}
        >
          ${icon("undo")}
        </button>
        <button
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          ?disabled=${!this.history?.canRedo}
          @click=${this.redo}
        >
          ${icon("redo")}
        </button>
        <span class="divider"></span>
        ${view("plan", "Plan only", "plan")} ${view("split", "Plan and 3D side by side", "split")}
        ${view("3d", "3D only", "cube")}
      </div>
    `;
  }

  /** The furniture list, docked beside the plan so that it covers none of it. */
  private renderDrawer(): TemplateResult | typeof nothing {
    if (this.narrow) return nothing;
    if (this.tool === "device") {
      return html`<div class="dock">
        <diorama-device-drawer
          .hass=${this.hass}
          .floor=${this.floor}
          .picked=${this.placingEntity}
          @device-pick=${(event: CustomEvent<{ entityId?: string; kind?: FixtureKind }>) => {
            this.placingEntity = event.detail.entityId;
            if (event.detail.kind) this.placingKind = event.detail.kind;
          }}
          @device-close=${() => this.setTool("select")}
        ></diorama-device-drawer>
      </div>`;
    }
    if (this.tool !== "furniture") return nothing;
    return html`<div class="dock">
      <diorama-catalogue-drawer
        .catalogue=${this.catalogue}
        .picked=${this.placing}
        .units=${this.units}
        @catalogue-pick=${(event: CustomEvent<{ model?: CatalogueModel }>) =>
          (this.placing = event.detail.model)}
        @catalogue-close=${() => this.setTool("select")}
      ></diorama-catalogue-drawer>
    </div>`;
  }

  /** What sits over the plan itself: the nudge to start, and the tool's hint. */
  private renderPlanOverlays(): TemplateResult | typeof nothing {
    if (this.narrow || this.tool === "furniture" || this.tool === "device") return nothing;
    if (this.floor && this.floor.walls.length === 0 && this.tool === "select") {
      return html`
        <div class="start">
          <p>Nothing drawn on this floor yet.</p>
          <button class="primary" @click=${() => this.setTool("wall")}>
            ${icon("wall")} Draw walls
          </button>
        </div>
      `;
    }
    if (this.calibrating) {
      return html`<p class="hint">
        Click two points on the image that you know the distance between. Esc to cancel.
      </p>`;
    }
    if (this.tool === "opening") {
      const kind = (id: OpeningType, label: string) => html`
        <button
          class=${this.openingType === id ? "active" : ""}
          aria-pressed=${this.openingType === id}
          @click=${() => (this.openingType = id)}
        >
          ${label}
        </button>
      `;
      return html`<div class="choice" role="group" aria-label="What to add">
        ${kind("door", "Door")} ${kind("window", "Window")}
        <span>Click a wall to add one. Esc to finish.</span>
      </div>`;
    }
    if (this.tool === "wall") {
      return html`<p class="hint">
        Click to place each corner. Type a length and press Enter for an exact wall. Esc to finish.
      </p>`;
    }
    return nothing;
  }

  private renderSave(): TemplateResult {
    const status = this.saving ? "Saving..." : this.dirty ? "Unsaved changes" : "Saved";
    return html`
      <div class="toolbar save">
        <span class="status ${this.dirty ? "dirty" : ""}" aria-live="polite">${status}</span>
        <button
          class="primary"
          title="Save (Ctrl+S)"
          ?disabled=${!this.dirty || this.saving}
          @click=${() => this.save()}
        >
          ${icon("check")} Save
        </button>
      </div>
    `;
  }

  private renderNarrowNotice(): TemplateResult {
    return html`<p class="hint narrow">Drawing needs a wider screen. Here you can look around.</p>`;
  }

  private renderNotices(): TemplateResult | typeof nothing {
    if (this.measured) {
      return html`
        <form
          class="notice"
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            const input = (event.target as HTMLFormElement).querySelector("input")!;
            this.finishCalibration(input.value);
          }}
        >
          <p><strong>How far apart are those two points really?</strong></p>
          <div class="actions">
            <input
              type="text"
              inputmode="decimal"
              placeholder=${this.units === "metric" ? "In metres, like 3.2" : "In feet, like 10ft 6in"}
              aria-label="Real distance"
              autofocus
            />
            <button type="button" @click=${() => (this.measured = undefined)}>Cancel</button>
            <button class="primary" type="submit">Set the scale</button>
          </div>
        </form>
      `;
    }
    if (this.conflict) {
      return html`
        <div class="notice" role="alert">
          <p>
            <strong>This floor was changed somewhere else.</strong> You can load that version and
            lose what you changed here, or save yours over it.
          </p>
          <div class="actions">
            <button @click=${() => this.reload()}>Load their version</button>
            <button class="primary" ?disabled=${this.saving} @click=${() => this.save(true)}>
              Save mine over it
            </button>
          </div>
        </div>
      `;
    }
    if (this.saveError) {
      return html`
        <div class="notice error" role="alert">
          <p><strong>Not saved.</strong> ${this.saveError}</p>
          <div class="actions">
            <button @click=${() => (this.saveError = undefined)}>Dismiss</button>
          </div>
        </div>
      `;
    }
    if (this.draftOffer) {
      const stale = this.saved && this.draftOffer.baseRevision !== this.saved.revision;
      return html`
        <div class="notice">
          <p>
            <strong>You have unsaved changes from ${formatWhen(this.draftOffer.savedAt)}.</strong>
            ${stale
              ? "The floor has been saved since then; restoring puts your older changes on top."
              : "Restore them to carry on where you left off."}
          </p>
          <div class="actions">
            <button @click=${this.discardDraft}>Discard</button>
            <button class="primary" @click=${this.restoreDraft}>Restore</button>
          </div>
        </div>
      `;
    }
    return nothing;
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: flex;
        min-height: 0;
        height: 100%;
        color: var(--diorama-text);
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
        font-size: 14px;
      }
      .stage {
        position: relative;
        flex: 1;
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
      }
      .stage.mode-split {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      .pane {
        position: relative;
        min-width: 0;
        min-height: 0;
      }
      .pane[hidden] {
        display: none;
      }
      .scene-pane {
        border-left: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .stage.mode-3d .scene-pane {
        border-left: 0;
      }
      diorama-plan-view {
        flex: 1;
        min-width: 0;
      }
      diorama-scene-view {
        position: absolute;
        inset: 0;
      }
      .pane-message {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        margin: 0;
        padding: 24px;
        text-align: center;
        color: var(--diorama-text-muted);
      }
      diorama-inspector {
        flex: none;
        width: 300px;
        border-left: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        background: var(--card-background-color, #fff);
      }
      .toolbar {
        position: absolute;
        top: 16px;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 14px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      }
      .tools {
        left: 16px;
      }
      .save {
        right: 16px;
        gap: 10px;
        padding-left: 14px;
      }
      .toolbar button:not(.primary) {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        padding: 0;
        border: 0;
        border-radius: 10px;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      .toolbar button:not(.primary):hover:not(:disabled) {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      .toolbar button.active {
        background: color-mix(in srgb, var(--diorama-accent) 16%, transparent);
        color: var(--diorama-accent);
      }
      button:disabled {
        opacity: 0.38;
        cursor: default;
      }
      button:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      .divider {
        width: 1px;
        height: 22px;
        margin: 0 4px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .status {
        font-size: 13px;
        color: var(--diorama-text-muted);
        white-space: nowrap;
      }
      .status.dirty {
        color: var(--diorama-text);
      }
      button.primary,
      .notice button,
      .message button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 38px;
        padding: 0 16px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }
      button.primary {
        padding-left: 12px;
        border-color: transparent;
        background: var(--diorama-accent);
        color: var(--text-primary-color, #fff);
      }
      .notice button.primary,
      .message button.primary {
        padding-left: 16px;
      }
      .hint {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        box-sizing: border-box;
        width: max-content;
        max-width: calc(100% - 200px);
        margin: 0;
        padding: 8px 14px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--diorama-text) 86%, transparent);
        color: var(--primary-background-color, #fff);
        font-size: 13px;
        text-align: center;
        pointer-events: none;
      }
      .hint.narrow {
        bottom: 64px;
        max-width: calc(100% - 32px);
      }
      .plan-pane {
        display: flex;
      }
      .dock {
        flex: none;
        display: flex;
        box-sizing: border-box;
        width: 292px;
        /* Clear of the toolbar above. */
        padding: 76px 8px 16px 16px;
      }
      diorama-catalogue-drawer,
      diorama-device-drawer {
        flex: 1;
        min-width: 0;
      }
      .views-button {
        position: absolute;
        right: 126px;
        bottom: 16px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 12px 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      }
      .views {
        position: absolute;
        right: 16px;
        bottom: 60px;
        box-sizing: border-box;
        width: 280px;
        max-width: calc(100% - 32px);
        max-height: calc(100% - 150px);
        overflow-y: auto;
        padding: 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 14px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      }
      .views p {
        margin: 0 4px 10px;
        font-size: 13px;
        line-height: 1.4;
        color: var(--diorama-text-muted);
      }
      .view {
        display: flex;
        align-items: center;
      }
      .view .go {
        flex: 1;
        min-width: 0;
        height: 36px;
        padding: 0 8px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .view .remove {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--diorama-text-muted);
        cursor: pointer;
      }
      .view button:hover {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      .views form {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .views input {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        height: 38px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--primary-background-color, #fafafa);
        color: inherit;
        font: inherit;
      }
      .views button.primary {
        padding: 0 14px;
      }
      .choice {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 4px;
        box-sizing: border-box;
        max-width: calc(100% - 200px);
        padding: 4px 14px 4px 4px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 999px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
        font-size: 13px;
        white-space: nowrap;
      }
      .choice button {
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .choice button.active {
        background: color-mix(in srgb, var(--diorama-accent) 16%, transparent);
        color: var(--diorama-accent);
        font-weight: 500;
      }
      .choice span {
        margin-left: 8px;
        color: var(--diorama-text-muted);
      }
      .notice input {
        flex: 1;
        min-width: 0;
        height: 38px;
        box-sizing: border-box;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: var(--primary-background-color, #fafafa);
        color: inherit;
        font: inherit;
      }
      .start {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        display: grid;
        justify-items: center;
        gap: 12px;
        padding: 24px 28px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      .start p {
        margin: 0;
        color: var(--diorama-text-muted);
      }
      .notices {
        position: absolute;
        top: 76px;
        left: 50%;
        transform: translateX(-50%);
        width: min(520px, calc(100% - 32px));
      }
      .notice {
        padding: 14px 16px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-left: 4px solid var(--diorama-accent);
        border-radius: 12px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      }
      .notice.error {
        border-left-color: var(--error-color, #db4437);
      }
      .notice p {
        margin: 0 0 12px;
        line-height: 1.45;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .message {
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 12px;
        flex: 1;
        padding: 24px;
        text-align: center;
        color: var(--diorama-text-muted);
      }
      .message p {
        margin: 0;
      }
    `,
  ];
}

type Settings = Pick<Storage, "getItem" | "setItem"> | undefined;

function readSetting(storage: Settings, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSetting(storage: Settings, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Not remembered, then.
  }
}

/** Find out how big an image is, and give it an address the page can show. */
async function measureImage(blob: Blob): Promise<{ url: string; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error("empty image");
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That file is not an image this browser can show.");
  }
}

/** Keys typed into a field are for the field. */
function isTyping(event: KeyboardEvent): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (target.isContentEditable) return true;
    if (target instanceof HTMLInputElement) {
      // A slider, tick box or file chooser takes no typing.
      return !["range", "checkbox", "radio", "file", "color", "button"].includes(target.type);
    }
    if (["TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  }
  return false;
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? `${time} today` : `${date.toLocaleDateString()} at ${time}`;
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-editor": DioramaEditor;
  }
}
