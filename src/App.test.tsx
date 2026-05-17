import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { clearMbtaStopCacheForTests } from "./lib/mbta";
import { formatClock } from "./lib/time";

function okJson(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearMbtaStopCacheForTests();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves first-run setup data", async () => {
    const user = userEvent.setup();
    mockSetupFetches();

    render(<App />);
    await pickStop(user, "Bus from home", "home", "Home Outbound");
    await pickStop(user, "Bus back near home", "return", "Home Return");
    await screen.findByText("Shared routes inferred from the selected stops.");
    await user.click(screen.getByRole("button", { name: /save home stops/i }));

    await user.type(screen.getByLabelText("Store name"), "Market");
    await pickStop(user, "Arrive near store", "store", "Store Arrival");
    await pickStop(user, "Leave from store", "departure", "Store Departure");
    await screen.findAllByText("Shared routes inferred from the selected stops.");
    await user.click(screen.getByRole("button", { name: /save supermarket/i }));

    expect(screen.getAllByText("77").length).toBeGreaterThan(0);
    expect(screen.getByText("Market")).toBeInTheDocument();
    expect(window.localStorage.getItem("supermarket-trip-planner:v1")).toContain("Market");
  });

  it("renders planner options from mocked MBTA data", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-16T13:00:00-04:00"));
    seedStorage();
    mockTripFetches();

    render(<App />);

    await waitFor(() => expect(screen.getByText("50 min")).toBeInTheDocument());
    expect(screen.getAllByLabelText("Live prediction").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Schedule").length).toBeGreaterThan(0);
    expect(screen.getByText(/Only 5 minutes of buffer after shopping/i)).toBeInTheDocument();
  });

  it("stores and applies an optional API key", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Optional MBTA API key"), "secret");

    expect(window.localStorage.getItem("supermarket-trip-planner:v1")).toContain("secret");
  });

  it("exports the saved setup data as JSON", async () => {
    seedStorage();

    render(<App />);

    await screen.findByText("Market");
    await userEvent.click(screen.getByRole("button", { name: /open setup/i }));
    const exportLink = screen.getByRole("link", { name: /export setup/i });
    const href = exportLink.getAttribute("href") ?? "";
    const exported = JSON.parse(decodeURIComponent(href.replace("data:application/json;charset=utf-8,", "")));

    expect(exportLink).toHaveAttribute("download", "Supermarket Trip Planner Setup.json");
    expect(exported.homeStopPairs).toHaveLength(1);
    expect(exported.supermarkets[0].name).toBe("Market");
  });

  it("imports setup data from a JSON file", async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = new File(
      [
        JSON.stringify({
          settings: { defaultShoppingMinutes: 55, apiKey: "imported-key", refreshIntervalSeconds: 120 },
          homeStopPairs: [
            {
              id: "imported-home",
              name: "Imported home",
              routeIds: ["87"],
              outboundStop: { id: "home-out", name: "Home Outbound" },
              returnStop: { id: "home-back", name: "Home Return" },
            },
          ],
          supermarkets: [
            {
              id: "imported-market",
              name: "Imported Market",
              stopPair: {
                id: "imported-store",
                label: "Imported store",
                routeIds: ["87"],
                arrivalStop: { id: "store-in", name: "Store Arrival" },
                departureStop: { id: "store-out", name: "Store Departure" },
              },
            },
          ],
        }),
      ],
      "setup.json",
      { type: "application/json" },
    );

    await user.upload(screen.getByLabelText("Import setup JSON"), file);

    expect(await screen.findByText("Setup imported.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("55")).toBeInTheDocument();
    expect(screen.getByText("Imported Market")).toBeInTheDocument();
    expect(window.localStorage.getItem("supermarket-trip-planner:v1")).toContain("imported-key");
  });

  it("auto-selects the home stop group with matching routes", async () => {
    seedStorageWithRouteMatches();
    mockTripFetches();

    render(<App />);

    await waitFor(() => expect(screen.getByDisplayValue("Market")).toBeInTheDocument());
    expect(screen.queryByLabelText("Home stops")).not.toBeInTheDocument();
    expect(screen.getByText("83 to Market")).toBeInTheDocument();
  });

  it("hides trips more than two hours out until show more is tapped", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-16T14:00:00-04:00"));
    seedStorage();
    mockMultipleTripFetches();
    const firstOutboundBoardTime = formatClock("2026-05-16T14:10:00-04:00");
    const laterOutboundBoardTime = formatClock("2026-05-16T17:10:00-04:00");

    render(<App />);

    await waitFor(() => expect(screen.getAllByText(firstOutboundBoardTime).length).toBeGreaterThan(0));
    expect(screen.queryByText(laterOutboundBoardTime)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show 1 later trip/i }));

    expect(screen.getAllByText(laterOutboundBoardTime).length).toBeGreaterThan(0);
  });

  it("limits default return trips to the first return that works for the latest visible outbound", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-16T14:00:00-04:00"));
    seedStorage();
    mockMultipleTripFetches();

    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: legTimeName(formatClock("2026-05-16T15:20:00-04:00"), formatClock("2026-05-16T15:40:00-04:00")) })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: legTimeName(formatClock("2026-05-16T18:20:00-04:00"), formatClock("2026-05-16T18:40:00-04:00")) })).not.toBeInTheDocument();
  });

  it("keeps outbound and return picks independent", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-16T14:00:00-04:00"));
    seedStorage();
    mockMultipleTripFetches();
    const laterOutboundBoardTime = formatClock("2026-05-16T17:10:00-04:00");
    const laterOutboundAlightTime = formatClock("2026-05-16T17:30:00-04:00");
    const firstReturnBoardTime = formatClock("2026-05-16T15:20:00-04:00");

    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /show 1 later trip/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /show 1 later trip/i }));
    await user.click(screen.getByRole("button", { name: legTimeName(laterOutboundBoardTime, laterOutboundAlightTime) }));

    const selectedTrip = within(screen.getByLabelText("Selected trip combination"));
    expect(selectedTrip.getByText(laterOutboundBoardTime)).toBeInTheDocument();
    expect(selectedTrip.getByText(firstReturnBoardTime)).toBeInTheDocument();
  });

  it("shows return trips after the first arrival even when they leave before requested shopping time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-16T14:00:00-04:00"));
    seedStorage();
    mockMultipleTripFetches();
    const earlyReturnBoardTime = formatClock("2026-05-16T14:45:00-04:00");

    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: legTimeName(earlyReturnBoardTime, formatClock("2026-05-16T15:05:00-04:00")) })).toBeInTheDocument());
    expect(within(screen.getByLabelText("Selected trip combination")).getByText(formatClock("2026-05-16T15:20:00-04:00"))).toBeInTheDocument();
  });
});

function legTimeName(boardTime: string, alightTime: string): RegExp {
  return new RegExp(`${escapeRegExp(boardTime)}\\s*${escapeRegExp(alightTime)}`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mockSetupFetches() {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/stops")) {
      return okJson({
        data: [
          { id: "home-out", type: "stop", attributes: { name: "Home Outbound" } },
          { id: "home-back", type: "stop", attributes: { name: "Home Return" } },
          { id: "store-in", type: "stop", attributes: { name: "Store Arrival" } },
          { id: "store-out", type: "stop", attributes: { name: "Store Departure" } },
        ],
      });
    }
    if (url.includes("/routes")) {
      return okJson({ data: [{ id: "77", type: "route", attributes: { short_name: "77" } }] });
    }
    return emptyResponse();
  });
}

async function pickStop(user: ReturnType<typeof userEvent.setup>, label: string, query: string, resultName: string) {
  await user.type(screen.getByLabelText(label), query);
  await screen.findByRole("button", { name: new RegExp(resultName, "i") });
  await user.click(screen.getByRole("button", { name: new RegExp(resultName, "i") }));
}

function seedStorage() {
  window.localStorage.setItem(
    "supermarket-trip-planner:v1",
    JSON.stringify({
      settings: { defaultShoppingMinutes: 45, apiKey: "abc", refreshIntervalSeconds: 90 },
      homeStopPairs: [
        {
          id: "home",
          name: "Home",
          routeIds: ["77"],
          outboundStop: { id: "home-out", name: "Home Outbound" },
          returnStop: { id: "home-back", name: "Home Return" },
        },
      ],
      supermarkets: [
        {
          id: "market",
          name: "Market",
          stopPair: {
            id: "store",
            label: "Store stops",
            routeIds: ["77"],
            arrivalStop: { id: "store-in", name: "Store Arrival" },
            departureStop: { id: "store-out", name: "Store Departure" },
          },
        },
      ],
    }),
  );
}

function seedStorageWithRouteMatches() {
  window.localStorage.setItem(
    "supermarket-trip-planner:v1",
    JSON.stringify({
      settings: { defaultShoppingMinutes: 45, apiKey: "abc", refreshIntervalSeconds: 90 },
      homeStopPairs: [
        {
          id: "home-77",
          name: "77 home",
          routeIds: ["77"],
          outboundStop: { id: "other-home-out", name: "Other Home Outbound" },
          returnStop: { id: "other-home-back", name: "Other Home Return" },
        },
        {
          id: "home-83",
          name: "83 home",
          routeIds: ["83"],
          outboundStop: { id: "home-out", name: "Home Outbound" },
          returnStop: { id: "home-back", name: "Home Return" },
        },
      ],
      supermarkets: [
        {
          id: "market",
          name: "Market",
          stopPair: {
            id: "store",
            label: "Store stops",
            routeIds: ["83"],
            arrivalStop: { id: "store-in", name: "Store Arrival" },
            departureStop: { id: "store-out", name: "Store Departure" },
          },
        },
      ],
    }),
  );
}

function mockTripFetches() {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    const stop = new URL(url).searchParams.get("filter[stop]") ?? "";
    const isPrediction = url.includes("/predictions");
    if (stop === "home-out") {
      return eventsResponse(stop, "out", 1, isPrediction ? "2026-05-16T14:07:00-04:00" : "2026-05-16T14:00:00-04:00", isPrediction ? "prediction" : "schedule", "2026-05-16T14:00:00-04:00");
    }
    if (stop === "store-in") {
      return eventsResponse(stop, "out", 5, "2026-05-16T14:27:00-04:00", isPrediction ? "prediction" : "schedule");
    }
    if (stop === "store-out") {
      return isPrediction ? emptyResponse() : eventsResponse(stop, "in", 6, "2026-05-16T15:17:00-04:00", "schedule");
    }
    if (stop === "home-back") {
      return isPrediction ? emptyResponse() : eventsResponse(stop, "in", 12, "2026-05-16T15:39:00-04:00", "schedule");
    }
    return emptyResponse();
  });
}

function mockMultipleTripFetches() {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    const stop = new URL(url).searchParams.get("filter[stop]") ?? "";
    const isPrediction = url.includes("/predictions");
    if (isPrediction) {
      return emptyResponse();
    }
    if (stop === "home-out") {
      return okJson({
        data: [
          eventResource("schedule-home-out-1", "schedule", "home-out", "out-1", 1, "2026-05-16T14:10:00-04:00"),
          eventResource("schedule-home-out-2", "schedule", "home-out", "out-2", 1, "2026-05-16T17:10:00-04:00"),
        ],
        included: includedTrips(["out-1", "out-2"]),
      });
    }
    if (stop === "store-in") {
      return okJson({
        data: [
          eventResource("schedule-store-in-1", "schedule", "store-in", "out-1", 5, "2026-05-16T14:30:00-04:00"),
          eventResource("schedule-store-in-2", "schedule", "store-in", "out-2", 5, "2026-05-16T17:30:00-04:00"),
        ],
        included: includedTrips(["out-1", "out-2"]),
      });
    }
    if (stop === "store-out") {
      return okJson({
        data: [
          eventResource("schedule-store-out-early", "schedule", "store-out", "in-early", 6, "2026-05-16T14:45:00-04:00", 1),
          eventResource("schedule-store-out-1", "schedule", "store-out", "in-1", 6, "2026-05-16T15:20:00-04:00", 1),
          eventResource("schedule-store-out-2", "schedule", "store-out", "in-2", 6, "2026-05-16T18:20:00-04:00", 1),
        ],
        included: includedTrips(["in-early", "in-1", "in-2"]),
      });
    }
    if (stop === "home-back") {
      return okJson({
        data: [
          eventResource("schedule-home-back-early", "schedule", "home-back", "in-early", 12, "2026-05-16T15:05:00-04:00", 1),
          eventResource("schedule-home-back-1", "schedule", "home-back", "in-1", 12, "2026-05-16T15:40:00-04:00", 1),
          eventResource("schedule-home-back-2", "schedule", "home-back", "in-2", 12, "2026-05-16T18:40:00-04:00", 1),
        ],
        included: includedTrips(["in-early", "in-1", "in-2"]),
      });
    }
    return emptyResponse();
  });
}

function eventResource(id: string, type: "schedule" | "prediction", stopId: string, tripId: string, stopSequence: number, time: string, directionId = 0) {
  return {
    id,
    type,
    attributes: {
      departure_time: time,
      stop_sequence: stopSequence,
      direction_id: directionId,
    },
    relationships: {
      stop: { data: { id: stopId, type: "stop" } },
      route: { data: { id: "77", type: "route" } },
      trip: { data: { id: tripId, type: "trip" } },
    },
  };
}

function includedTrips(tripIds: string[]) {
  return [
    { id: "77", type: "route", attributes: { short_name: "77" } },
    ...tripIds.map((tripId) => ({ id: tripId, type: "trip", attributes: { headsign: tripId.startsWith("in") ? "Home" : "Market" } })),
  ];
}

function emptyResponse(): Response {
  return okJson({ data: [], included: [] });
}

function eventsResponse(stopId: string, tripId: string, stopSequence: number, time: string, type: "schedule" | "prediction", scheduleTime?: string): Response {
  const oppositeDirection = tripId === "in" ? 1 : 0;
  return okJson({
    data: [
      {
        id: `${type}-${stopId}`,
        type,
        attributes: {
          departure_time: time,
          stop_sequence: stopSequence,
          direction_id: oppositeDirection,
        },
        relationships: {
          stop: { data: { id: stopId, type: "stop" } },
          route: { data: { id: "77", type: "route" } },
          trip: { data: { id: tripId, type: "trip" } },
          schedule: scheduleTime ? { data: { id: `schedule-${stopId}`, type: "schedule" } } : { data: null },
        },
      },
    ],
    included: [
      { id: "77", type: "route", attributes: { short_name: "77" } },
      { id: tripId, type: "trip", attributes: { headsign: tripId === "in" ? "Home" : "Market" } },
      { id: `schedule-${stopId}`, type: "schedule", attributes: { departure_time: scheduleTime } },
    ],
  });
}
