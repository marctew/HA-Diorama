// The integration's WebSocket commands, typed. Reading is open to every user;
// saving, deleting, export and import need an administrator.

import type { Catalogue } from "./catalogue";
import type { Floor, House, HouseExport, HouseInput, SceneEvent } from "./scene";

/** The two methods of Home Assistant's `hass` object that the API needs. */
export interface Transport {
  callWS<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
  connection: {
    subscribeMessage<T>(
      callback: (message: T) => void,
      message: { type: string; [key: string]: unknown },
    ): Promise<() => Promise<void> | void>;
  };
}

export class DioramaApi {
  constructor(private readonly transport: Transport) {}

  async getHouse(): Promise<House> {
    return (await this.transport.callWS<{ house: House }>({ type: "diorama/house/get" })).house;
  }

  /** Save the settings and floor list. `revision` is the one the edit started from. */
  async saveHouse(house: HouseInput, revision: number): Promise<House> {
    const result = await this.transport.callWS<{ house: House }>({
      type: "diorama/house/save",
      revision,
      house,
    });
    return result.house;
  }

  async getFloor(floorId: string): Promise<Floor> {
    const result = await this.transport.callWS<{ floor: Floor }>({
      type: "diorama/floor/get",
      floor_id: floorId,
    });
    return result.floor;
  }

  /** Save one floor. Its own `revision` says which version the edit started from. */
  async saveFloor(floor: Floor): Promise<Floor> {
    const result = await this.transport.callWS<{ floor: Floor }>({
      type: "diorama/floor/save",
      floor_id: floor.id,
      revision: floor.revision,
      floor,
    });
    return result.floor;
  }

  async deleteFloor(floorId: string): Promise<House> {
    const result = await this.transport.callWS<{ house: House }>({
      type: "diorama/floor/delete",
      floor_id: floorId,
    });
    return result.house;
  }

  async exportHouse(): Promise<HouseExport> {
    const result = await this.transport.callWS<{ export: HouseExport }>({
      type: "diorama/export",
    });
    return result.export;
  }

  async importHouse(data: unknown): Promise<House> {
    const result = await this.transport.callWS<{ house: House }>({
      type: "diorama/import",
      data,
    });
    return result.house;
  }

  async getCatalogue(): Promise<Catalogue> {
    const result = await this.transport.callWS<{ catalogue: Catalogue }>({
      type: "diorama/catalogue/get",
    });
    return result.catalogue;
  }

  /** Be told whenever something is saved. Resolves to a function that stops it. */
  subscribe(listener: (event: SceneEvent) => void): Promise<() => Promise<void> | void> {
    return this.transport.connection.subscribeMessage<SceneEvent>(listener, {
      type: "diorama/subscribe",
    });
  }
}

/** Home Assistant rejects a failed command with `{ code, message }`. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Someone else saved first: reload, then decide what to do with the edit. */
export function isConflict(error: unknown): boolean {
  return errorCode(error) === "conflict";
}

/** A message to show for a failed command. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Something went wrong talking to Home Assistant.";
}

/** "No floors yet", "1 floor", "3 floors". */
export function describeFloors(house: House): string {
  const count = house.floors.length;
  if (count === 0) return "No floors yet";
  return count === 1 ? "1 floor" : `${count} floors`;
}
