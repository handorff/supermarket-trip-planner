import type { AppData, Settings } from "./types";

const STORAGE_KEY = "supermarket-trip-planner:v1";

export const defaultSettings: Settings = {
  defaultShoppingMinutes: 45,
  apiKey: "",
  refreshIntervalSeconds: 90,
};

export const defaultData: AppData = {
  settings: defaultSettings,
  homeStopPairs: [],
  supermarkets: [],
};

export function loadAppData(): AppData {
  if (typeof window === "undefined") {
    return defaultData;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultData;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      settings: { ...defaultSettings, ...parsed.settings },
      homeStopPairs: parsed.homeStopPairs ?? [],
      supermarkets: (parsed.supermarkets ?? []).flatMap((market) => {
        const stopPair = market.stopPair ?? market.stopPairs?.[0];
        if (!stopPair) {
          return [];
        }

        return [{ ...market, stopPair, stopPairs: undefined }];
      }),
    };
  } catch {
    return defaultData;
  }
}

export function saveAppData(data: AppData): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
