import { describe, expect, it } from "vitest";
import { formatRouteList, parseRouteList, routeListsMatch } from "./routes";

describe("route helpers", () => {
  it("normalizes comma and space separated route lists", () => {
    expect(parseRouteList(" 83, 77  83 ")).toEqual(["77", "83"]);
  });

  it("matches route lists independent of order", () => {
    expect(routeListsMatch(["83", "77"], ["77", "83"])).toBe(true);
    expect(routeListsMatch(["83"], ["77", "83"])).toBe(false);
    expect(routeListsMatch([], [])).toBe(false);
  });

  it("formats empty route lists clearly", () => {
    expect(formatRouteList([])).toBe("No routes assigned");
  });
});
