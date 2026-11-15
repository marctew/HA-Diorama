// The parts of Home Assistant's `hass` object that Diorama uses. See
// https://contributors.home-assistant.io/frontend/reference/hass-object/

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HassArea {
  area_id: string;
  name: string;
  floor_id: string | null;
}

export interface HassFloor {
  floor_id: string;
  name: string;
  level: number | null;
}

export interface HassUser {
  is_admin: boolean;
}

export interface HomeAssistant {
  states: Record<string, HassEntityState>;
  areas: Record<string, HassArea>;
  entities?: Record<
    string,
    {
      area_id?: string | null;
      device_id?: string | null;
      hidden?: boolean;
      entity_category?: string | null;
    }
  >;
  devices?: Record<string, { area_id?: string | null }>;
  floors: Record<string, HassFloor>;
  user?: HassUser;
  config?: { unit_system?: { length?: string } };
  dockedSidebar?: "docked" | "always_hidden" | "auto";
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: { entity_id?: string | string[] },
  ): Promise<unknown>;
  callWS<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
  /** Fetch a URL of Home Assistant as the signed-in user. */
  fetchWithAuth(path: string, init?: RequestInit): Promise<Response>;
  connection: {
    subscribeMessage<T>(
      callback: (message: T) => void,
      message: { type: string; [key: string]: unknown },
    ): Promise<() => Promise<void> | void>;
  };
}

export interface PanelInfo {
  config?: { version?: string; [key: string]: unknown };
}
