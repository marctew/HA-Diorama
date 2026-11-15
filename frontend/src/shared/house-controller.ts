import type { ReactiveController, ReactiveControllerHost } from "lit";
import { DioramaApi, errorMessage } from "../core/api";
import type { House } from "../core/scene";
import type { HomeAssistant } from "../types/hass";

/** Keeps an element's copy of the house current: loads it once Home Assistant
 * is available, and again whenever someone saves it. */
export class HouseController implements ReactiveController {
  house?: House;
  error?: string;

  private hass?: HomeAssistant;
  private unsubscribe?: () => Promise<void> | void;
  private connected = false;
  private started = false;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  /** Call from the element whenever it is given a `hass` object. */
  setHass(hass: HomeAssistant | undefined): void {
    this.hass = hass;
    if (hass && this.connected && !this.started) void this.start();
  }

  /** Take a house that has just come back from a save, without waiting to be
   * told about it. */
  adopt(house: House): void {
    this.house = house;
    this.error = undefined;
    this.host.requestUpdate();
  }

  /** Fetch the house again. */
  reload(): Promise<void> {
    return this.load();
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

  private async start(): Promise<void> {
    this.started = true;
    await this.load();
    if (!this.connected || !this.hass || this.unsubscribe) return;
    try {
      const unsubscribe = await new DioramaApi(this.hass).subscribe((event) => {
        if (event.type === "house" || event.type === "reset") void this.load();
      });
      if (this.connected) this.unsubscribe = unsubscribe;
      else void unsubscribe();
    } catch {
      // Without the subscription the house is still shown, just not refreshed.
    }
  }

  private async load(): Promise<void> {
    if (!this.hass) return;
    try {
      this.house = await new DioramaApi(this.hass).getHouse();
      this.error = undefined;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.host.requestUpdate();
  }
}
