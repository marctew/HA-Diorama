import type { ReactiveController, ReactiveControllerHost } from "lit";
import { DioramaApi, errorMessage } from "../core/api";
import type { Catalogue } from "../core/catalogue";
import type { Floor, House, SceneEvent } from "../core/scene";
import { floorsNeeded, type ViewRequest } from "../core/views";
import type { HomeAssistant } from "../types/hass";

/** Keeps an element supplied with what a view needs: the house, the floors
 * the view shows (and no others), and the furniture catalogue. It reloads
 * what changes when someone saves in the editor. */
export class SceneController implements ReactiveController {
  house?: House;
  /** The floors loaded so far, by id. A new map whenever one changes. */
  floors: ReadonlyMap<string, Floor> = new Map();
  catalogue?: Catalogue;
  error?: string;

  private hass?: HomeAssistant;
  private request?: ViewRequest;
  private unsubscribe?: () => Promise<void> | void;
  private connected = false;
  private started = false;
  /** Floors being fetched, so each is asked for once. */
  private readonly fetching = new Set<string>();

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  /** Call whenever the element is given a `hass` object. */
  setHass(hass: HomeAssistant | undefined): void {
    this.hass = hass;
    if (hass && this.connected && !this.started) void this.start();
  }

  /** Say what the element shows. Floors it no longer needs are dropped. */
  setRequest(request: ViewRequest | undefined): void {
    this.request = request;
    this.loadFloors();
  }

  hostConnected(): void {
    this.connected = true;
    if (this.hass && !this.started) void this.start();
  }

  hostDisconnected(): void {
    this.connected = false;
    this.started = false;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe) void unsubscribe();
  }

  private get api(): DioramaApi | undefined {
    return this.hass ? new DioramaApi(this.hass) : undefined;
  }

  private async start(): Promise<void> {
    this.started = true;
    const api = this.api;
    if (!api) return;
    this.loadCatalogue();
    await this.loadHouse();
    if (!this.connected || this.unsubscribe) return;
    try {
      const unsubscribe = await api.subscribe(this.onEvent);
      if (this.connected && !this.unsubscribe) this.unsubscribe = unsubscribe;
      else void unsubscribe();
    } catch {
      // Without the subscription it is shown, but not refreshed.
    }
  }

  private loadCatalogue(): void {
    void this.api?.getCatalogue().then(
      (catalogue) => {
        this.catalogue = catalogue;
        this.host.requestUpdate();
      },
      // Without it the house is still shown, just without furniture.
      () => undefined,
    );
  }

  private async loadHouse(): Promise<void> {
    const api = this.api;
    if (!api) return;
    try {
      this.house = await api.getHouse();
      this.error = undefined;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.host.requestUpdate();
    this.loadFloors();
  }

  /** Fetch the floors the view needs and has not got; forget the rest. */
  private loadFloors(): void {
    const api = this.api;
    if (!api || !this.house || !this.request) return;
    const needed = new Set(floorsNeeded(this.house, this.request));
    if ([...this.floors.keys()].some((id) => !needed.has(id))) {
      this.floors = new Map([...this.floors].filter(([id]) => needed.has(id)));
      this.host.requestUpdate();
    }
    for (const id of needed) {
      if (!this.floors.has(id)) this.fetchFloor(api, id);
    }
  }

  private fetchFloor(api: DioramaApi, id: string): void {
    if (this.fetching.has(id)) return;
    this.fetching.add(id);
    api
      .getFloor(id)
      .then(
        (floor) => {
          this.floors = new Map(this.floors).set(id, floor);
          this.error = undefined;
        },
        (error) => {
          this.error = errorMessage(error);
        },
      )
      .finally(() => {
        this.fetching.delete(id);
        this.host.requestUpdate();
      });
  }

  private onEvent = (event: SceneEvent): void => {
    const api = this.api;
    if (!api) return;
    if (event.type === "catalogue") {
      // A model was added or taken away.
      this.loadCatalogue();
    } else if (event.type === "house") {
      void this.loadHouse();
    } else if (event.type === "reset") {
      this.floors = new Map();
      void this.loadHouse();
    } else if (event.type === "floor") {
      // Only if this view shows that floor, and has an older copy of it.
      const held = this.floors.get(event.floor_id);
      if (held && held.revision < event.revision) this.fetchFloor(api, event.floor_id);
    } else if (this.floors.has(event.floor_id)) {
      this.floors = new Map([...this.floors].filter(([id]) => id !== event.floor_id));
      this.host.requestUpdate();
    }
  };
}
