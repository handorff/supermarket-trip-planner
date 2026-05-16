import { describe, expect, it } from "vitest";
import { buildLegs, pairAllTrips, pairTripOptions, warningsForCurrentPlan } from "./planner";
import type { DepartureEvent } from "./types";

function event(overrides: Partial<DepartureEvent>): DepartureEvent {
  return {
    tripId: "trip-a",
    routeId: "77",
    routeName: "77",
    directionId: 0,
    headsign: "Arlington Heights",
    stopId: "stop",
    stopSequence: 1,
    time: "2026-05-16T14:00:00-04:00",
    source: "schedule",
    status: null,
    scheduleTime: null,
    alertHeaders: [],
    ...overrides,
  };
}

describe("buildLegs", () => {
  it("pairs only events from the same trip, route, direction, and forward stop sequence", () => {
    const legs = buildLegs(
      [
        event({ tripId: "trip-a", stopId: "home", stopSequence: 10 }),
        event({ tripId: "trip-b", stopId: "home", stopSequence: 10 }),
      ],
      [
        event({ tripId: "trip-a", stopId: "store", stopSequence: 20, time: "2026-05-16T14:18:00-04:00" }),
        event({ tripId: "trip-b", stopId: "store", stopSequence: 5, time: "2026-05-16T14:12:00-04:00" }),
        event({ tripId: "trip-a", routeId: "78", stopId: "store", stopSequence: 20, time: "2026-05-16T14:18:00-04:00" }),
      ],
    );

    expect(legs).toHaveLength(1);
    expect(legs[0].durationMinutes).toBe(18);
    expect(legs[0].board.tripId).toBe("trip-a");
  });
});

describe("pairTripOptions", () => {
  it("keeps the first practical return for each outbound trip and sorts by outbound time", () => {
    const outboundLegs = [
      {
        board: event({ tripId: "out-2", time: "2026-05-16T14:10:00-04:00" }),
        alight: event({ tripId: "out-2", stopSequence: 20, time: "2026-05-16T14:30:00-04:00" }),
        durationMinutes: 20,
      },
      {
        board: event({ tripId: "out-1", time: "2026-05-16T14:00:00-04:00" }),
        alight: event({ tripId: "out-1", stopSequence: 20, time: "2026-05-16T14:20:00-04:00" }),
        durationMinutes: 20,
      },
    ];
    const inboundLegs = [
      {
        board: event({ tripId: "in-1", time: "2026-05-16T15:20:00-04:00", directionId: 1 }),
        alight: event({ tripId: "in-1", stopSequence: 20, time: "2026-05-16T15:40:00-04:00", directionId: 1 }),
        durationMinutes: 20,
      },
      {
        board: event({ tripId: "in-2", time: "2026-05-16T15:40:00-04:00", directionId: 1 }),
        alight: event({ tripId: "in-2", stopSequence: 20, time: "2026-05-16T16:00:00-04:00", directionId: 1 }),
        durationMinutes: 20,
      },
    ];

    const options = pairTripOptions(outboundLegs, inboundLegs, 45);

    expect(options).toHaveLength(2);
    expect(options[0].outbound.board.tripId).toBe("out-1");
    expect(options[0].shoppingMinutes).toBe(60);
    expect(options[0].inbound.board.tripId).toBe("in-1");
  });

  it("rejects options without enough shopping time", () => {
    const outboundLegs = [
      {
        board: event({ time: "2026-05-16T14:00:00-04:00" }),
        alight: event({ stopSequence: 20, time: "2026-05-16T14:30:00-04:00" }),
        durationMinutes: 30,
      },
    ];
    const inboundLegs = [
      {
        board: event({ tripId: "in", directionId: 1, time: "2026-05-16T15:00:00-04:00" }),
        alight: event({ tripId: "in", directionId: 1, stopSequence: 20, time: "2026-05-16T15:20:00-04:00" }),
        durationMinutes: 20,
      },
    ];

    expect(pairTripOptions(outboundLegs, inboundLegs, 45)).toHaveLength(0);
  });

  it("rejects options with impractically long shopping gaps", () => {
    const outboundLegs = [
      {
        board: event({ time: "2026-05-16T14:00:00-04:00" }),
        alight: event({ stopSequence: 20, time: "2026-05-16T14:30:00-04:00" }),
        durationMinutes: 30,
      },
    ];
    const inboundLegs = [
      {
        board: event({
          tripId: "in",
          directionId: 1,
          time: "2026-05-16T17:01:00-04:00",
        }),
        alight: event({ tripId: "in", directionId: 1, stopSequence: 20, time: "2026-05-16T17:40:00-04:00" }),
        durationMinutes: 20,
      },
    ];

    expect(pairTripOptions(outboundLegs, inboundLegs, 45)).toHaveLength(0);
  });
});

describe("pairAllTrips", () => {
  it("builds a complete round-trip option from four stop event lists", () => {
    const options = pairAllTrips(
      { shoppingMinutes: 45 },
      [event({ tripId: "out", stopId: "home", stopSequence: 1, time: "2026-05-16T14:00:00-04:00" })],
      [event({ tripId: "out", stopId: "store-in", stopSequence: 5, time: "2026-05-16T14:20:00-04:00" })],
      [event({ tripId: "in", directionId: 1, stopId: "store-out", stopSequence: 8, time: "2026-05-16T15:10:00-04:00" })],
      [event({ tripId: "in", directionId: 1, stopId: "home-return", stopSequence: 14, time: "2026-05-16T15:33:00-04:00" })],
    );

    expect(options).toHaveLength(1);
    expect(options[0].shoppingMinutes).toBe(50);
  });

  it("reports reduced shopping time warnings for an existing plan", () => {
    const option = pairTripOptions(
      [
        {
          board: event({ time: "2026-05-16T14:00:00-04:00" }),
          alight: event({ stopSequence: 20, time: "2026-05-16T14:30:00-04:00" }),
          durationMinutes: 30,
        },
      ],
      [
        {
          board: event({ tripId: "in", directionId: 1, time: "2026-05-16T15:20:00-04:00" }),
          alight: event({ tripId: "in", directionId: 1, stopSequence: 20, time: "2026-05-16T15:45:00-04:00" }),
          durationMinutes: 25,
        },
      ],
      45,
    )[0];

    const updated = { ...option, shoppingMinutes: 40 };
    expect(warningsForCurrentPlan(updated, 45)).toContain("Shopping time dropped to 40 minutes.");
  });
});
