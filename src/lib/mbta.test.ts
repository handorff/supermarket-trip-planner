import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMbtaStopCacheForTests, fetchRoutesServingStop, fetchStopEvents, searchStops } from "./mbta";

describe("MBTA client", () => {
  beforeEach(() => {
    clearMbtaStopCacheForTests();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("searches bus stops client-side and appends an optional API key", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "1", type: "stop", attributes: { name: "Mass Ave at Pearl St", description: "Near store" } },
          { id: "2", type: "stop", attributes: { name: "Broadway", description: "Elsewhere" } },
        ],
      }),
    } as Response);

    const results = await searchStops("pearl", "abc123");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("api_key=abc123");
  });

  it("replaces scheduled events with prediction events for the same trip route and stop", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "sched-1",
              type: "schedule",
              attributes: {
                departure_time: "2026-05-16T14:00:00-04:00",
                stop_sequence: 4,
                direction_id: 0,
              },
              relationships: {
                stop: { data: { id: "home", type: "stop" } },
                route: { data: { id: "77", type: "route" } },
                trip: { data: { id: "trip-1", type: "trip" } },
              },
            },
          ],
          included: [
            { id: "77", type: "route", attributes: { short_name: "77" } },
            { id: "trip-1", type: "trip", attributes: { headsign: "Harvard" } },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "pred-1",
              type: "prediction",
              attributes: {
                departure_time: "2026-05-16T14:07:00-04:00",
                stop_sequence: 4,
                direction_id: 0,
              },
              relationships: {
                stop: { data: { id: "home", type: "stop" } },
                route: { data: { id: "77", type: "route" } },
                trip: { data: { id: "trip-1", type: "trip" } },
                schedule: { data: { id: "sched-1", type: "schedule" } },
              },
            },
          ],
          included: [
            { id: "77", type: "route", attributes: { short_name: "77" } },
            { id: "trip-1", type: "trip", attributes: { headsign: "Harvard" } },
            { id: "sched-1", type: "schedule", attributes: { departure_time: "2026-05-16T14:00:00-04:00" } },
          ],
        }),
      } as Response);

    const events = await fetchStopEvents({ stopId: "home", now: new Date("2026-05-16T13:00:00-04:00") });

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("prediction");
    expect(events[0].time).toBe("2026-05-16T14:07:00-04:00");
    expect(events[0].scheduleTime).toBe("2026-05-16T14:00:00-04:00");
  });

  it("fetches bus route names serving a stop", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "route-83", type: "route", attributes: { short_name: "83" } },
          { id: "route-77", type: "route", attributes: { short_name: "77" } },
        ],
      }),
    } as Response);

    await expect(fetchRoutesServingStop("stop-a", "key")).resolves.toEqual(["77", "83"]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("filter%5Bstop%5D=stop-a");
  });
});
