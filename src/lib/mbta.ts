import type { DepartureEvent, JsonApiResource, JsonApiResponse, StopSearchResult, TimeSource } from "./types";
import { normalizeRouteList } from "./routes";

const MBTA_BASE_URL = "https://api-v3.mbta.com";
const BUS_ROUTE_TYPE = "3";
let cachedBusStops: StopSearchResult[] | null = null;
const stopRoutesCache = new Map<string, string[]>();

interface StopEventsOptions {
  stopId: string;
  apiKey?: string;
  now?: Date;
}

export class MbtaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function clearMbtaStopCacheForTests(): void {
  cachedBusStops = null;
  stopRoutesCache.clear();
}

function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(path, MBTA_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchJson(path: string, params: Record<string, string | number | undefined>, apiKey?: string): Promise<JsonApiResponse> {
  const url = buildUrl(path, { ...params, api_key: apiKey });
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.api+json",
    },
  });

  if (!response.ok) {
    throw new MbtaError(`MBTA request failed with ${response.status}`, response.status);
  }

  return (await response.json()) as JsonApiResponse;
}

export async function searchStops(query: string, apiKey?: string): Promise<StopSearchResult[]> {
  if (query.trim().length < 2) {
    return [];
  }

  if (!cachedBusStops) {
    const json = await fetchJson(
      "/stops",
      {
        "filter[route_type]": BUS_ROUTE_TYPE,
        "fields[stop]": "name,description,latitude,longitude",
        sort: "name",
      },
      apiKey,
    );

    cachedBusStops = json.data.map((resource) => ({
      id: resource.id,
      name: String(resource.attributes?.name ?? resource.id),
      description: optionalString(resource.attributes?.description) ?? undefined,
      latitude: optionalNumber(resource.attributes?.latitude),
      longitude: optionalNumber(resource.attributes?.longitude),
    }));
  }

  const normalizedQuery = query.trim().toLowerCase();
  return cachedBusStops
    .filter((stop) => `${stop.name} ${stop.description ?? ""} ${stop.id}`.toLowerCase().includes(normalizedQuery))
    .slice(0, 12);
}

export async function fetchStopEvents({ stopId, apiKey, now = new Date() }: StopEventsOptions): Promise<DepartureEvent[]> {
  const [schedules, predictions] = await Promise.all([
    fetchSchedules(stopId, apiKey),
    fetchPredictions(stopId, apiKey),
  ]);

  const cutoff = now.getTime();
  return mergeEvents(schedules, predictions)
    .filter((event) => new Date(event.time).getTime() >= cutoff)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export async function fetchRoutesServingStop(stopId: string, apiKey?: string): Promise<string[]> {
  if (stopRoutesCache.has(stopId)) {
    return stopRoutesCache.get(stopId) ?? [];
  }

  const json = await fetchJson(
    "/routes",
    {
      "filter[stop]": stopId,
      "filter[type]": BUS_ROUTE_TYPE,
      "fields[route]": "short_name,long_name",
      sort: "short_name",
    },
    apiKey,
  );
  const routeIds = normalizeRouteList(
    json.data.map((resource) => String(resource.attributes?.short_name ?? resource.attributes?.long_name ?? resource.id)),
  );
  stopRoutesCache.set(stopId, routeIds);
  return routeIds;
}

async function fetchSchedules(stopId: string, apiKey: string | undefined): Promise<DepartureEvent[]> {
  const json = await fetchJson(
    "/schedules",
    {
      "filter[stop]": stopId,
      "filter[route_type]": BUS_ROUTE_TYPE,
      include: "route,trip",
      "page[limit]": 80,
      "filter[min_time]": "0:00",
      "filter[max_time]": "24:00",
      sort: "departure_time",
    },
    apiKey,
  );

  return parseEvents(json, "schedule");
}

async function fetchPredictions(stopId: string, apiKey?: string): Promise<DepartureEvent[]> {
  const json = await fetchJson(
    "/predictions",
    {
      "filter[stop]": stopId,
      "filter[route_type]": BUS_ROUTE_TYPE,
      include: "route,trip,schedule,alerts",
      "page[limit]": 80,
      sort: "departure_time",
    },
    apiKey,
  );

  return parseEvents(json, "prediction");
}

function parseEvents(json: JsonApiResponse, source: TimeSource): DepartureEvent[] {
  const included = new Map((json.included ?? []).map((resource) => [resourceKey(resource), resource]));

  return json.data.flatMap((resource) => {
    const stopId = relationshipId(resource, "stop");
    const routeId = relationshipId(resource, "route");
    const tripId = relationshipId(resource, "trip");
    const schedule = getRelated(resource, "schedule", included);
    const route = getRelated(resource, "route", included);
    const trip = getRelated(resource, "trip", included);
    const time = eventTime(resource);

    if (!stopId || !routeId || !tripId || !time) {
      return [];
    }

    const scheduleTime = schedule ? eventTime(schedule) : null;

    return [
      {
        tripId,
        routeId,
        routeName: String(route?.attributes?.short_name ?? route?.attributes?.long_name ?? routeId),
        directionId: Number(resource.attributes?.direction_id ?? trip?.attributes?.direction_id ?? 0),
        headsign: String(trip?.attributes?.headsign ?? ""),
        stopId,
        stopSequence: Number(resource.attributes?.stop_sequence ?? schedule?.attributes?.stop_sequence ?? 0),
        time,
        source,
        status: optionalString(resource.attributes?.status),
        scheduleTime,
        alertHeaders: relatedAlerts(resource, included),
      },
    ];
  });
}

function mergeEvents(schedules: DepartureEvent[], predictions: DepartureEvent[]): DepartureEvent[] {
  const byKey = new Map<string, DepartureEvent>();
  schedules.forEach((event) => byKey.set(eventKey(event), event));
  predictions.forEach((event) => byKey.set(eventKey(event), event));
  return [...byKey.values()];
}

function eventKey(event: DepartureEvent): string {
  return `${event.tripId}:${event.routeId}:${event.stopId}`;
}

function resourceKey(resource: JsonApiResource): string {
  return `${resource.type}:${resource.id}`;
}

function eventTime(resource: JsonApiResource): string | null {
  return optionalString(resource.attributes?.departure_time) ?? optionalString(resource.attributes?.arrival_time);
}

function relationshipId(resource: JsonApiResource, relationship: string): string | null {
  const data = resource.relationships?.[relationship]?.data;
  if (!data || Array.isArray(data)) {
    return null;
  }
  return data.id;
}

function getRelated(resource: JsonApiResource, relationship: string, included: Map<string, JsonApiResource>): JsonApiResource | undefined {
  const data = resource.relationships?.[relationship]?.data;
  if (!data || Array.isArray(data)) {
    return undefined;
  }
  return included.get(`${data.type}:${data.id}`);
}

function relatedAlerts(resource: JsonApiResource, included: Map<string, JsonApiResource>): string[] {
  const data = resource.relationships?.alerts?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => included.get(`${item.type}:${item.id}`)?.attributes?.header)
    .filter((header): header is string => typeof header === "string" && header.length > 0);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
