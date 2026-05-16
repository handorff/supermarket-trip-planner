export type TimeSource = "prediction" | "schedule";

export interface Settings {
  defaultShoppingMinutes: number;
  apiKey: string;
  refreshIntervalSeconds: number;
}

export interface StopRef {
  id: string;
  name: string;
  description?: string;
}

export interface HomeStopPair {
  id: string;
  name: string;
  routeIds: string[];
  outboundStop: StopRef;
  returnStop: StopRef;
}

export interface StoreStopPair {
  id: string;
  label: string;
  routeIds: string[];
  arrivalStop: StopRef;
  departureStop: StopRef;
}

export interface Supermarket {
  id: string;
  name: string;
  address?: string;
  stopPair: StoreStopPair;
  stopPairs?: StoreStopPair[];
}

export interface AppData {
  settings: Settings;
  homeStopPairs: HomeStopPair[];
  supermarkets: Supermarket[];
}

export interface DepartureEvent {
  tripId: string;
  routeId: string;
  routeName: string;
  directionId: number;
  headsign: string;
  stopId: string;
  stopSequence: number;
  time: string;
  source: TimeSource;
  status?: string | null;
  scheduleTime?: string | null;
  alertHeaders: string[];
}

export interface LegOption {
  board: DepartureEvent;
  alight: DepartureEvent;
  durationMinutes: number;
}

export interface TripOption {
  id: string;
  outbound: LegOption;
  inbound: LegOption;
  shoppingMinutes: number;
  extraMinutes: number;
  warnings: string[];
}

export interface PlannerRequest {
  homePair: HomeStopPair;
  storePair: StoreStopPair;
  shoppingMinutes: number;
  now: Date;
  apiKey?: string;
}

export interface StopSearchResult extends StopRef {
  latitude?: number;
  longitude?: number;
}

export interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | Array<{ id: string; type: string }> | null }>;
}

export interface JsonApiResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}
