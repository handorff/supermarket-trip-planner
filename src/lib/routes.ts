export function parseRouteList(value: string): string[] {
  return normalizeRouteList(value.split(/[\s,]+/));
}

export function normalizeRouteList(routeIds: string[]): string[] {
  return [...new Set(routeIds.map((route) => route.trim().toUpperCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function intersectRouteLists(routeLists: string[][]): string[] {
  if (routeLists.length === 0) {
    return [];
  }

  const [first, ...rest] = routeLists.map(normalizeRouteList);
  return first.filter((route) => rest.every((routes) => routes.includes(route)));
}

export function formatRouteList(routeIds: string[] | undefined): string {
  const normalized = normalizeRouteList(routeIds ?? []);
  return normalized.length > 0 ? normalized.join(", ") : "No routes assigned";
}

export function routeListsMatch(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = normalizeRouteList(left ?? []);
  const normalizedRight = normalizeRouteList(right ?? []);
  return normalizedLeft.length > 0 && normalizedLeft.length === normalizedRight.length && normalizedLeft.every((route, index) => route === normalizedRight[index]);
}
