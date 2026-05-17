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
    return normalizeAppData(JSON.parse(raw));
  } catch {
    return defaultData;
  }
}

export function parseImportedAppData(raw: string): AppData {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.homeStopPairs) || !Array.isArray(parsed.supermarkets)) {
    throw new Error("Import file must contain supermarket trip planner setup data.");
  }

  return normalizeAppData(parsed);
}

export function normalizeAppData(parsed: unknown): AppData {
  if (!isRecord(parsed)) {
    return defaultData;
  }

  return {
    settings: { ...defaultSettings, ...(isRecord(parsed.settings) ? parsed.settings : {}) },
    homeStopPairs: Array.isArray(parsed.homeStopPairs) ? parsed.homeStopPairs : [],
    supermarkets: (Array.isArray(parsed.supermarkets) ? parsed.supermarkets : []).flatMap((market) => {
      if (!isRecord(market)) {
        return [];
      }

      const stopPair = market.stopPair ?? (Array.isArray(market.stopPairs) ? market.stopPairs[0] : undefined);
      if (!stopPair) {
        return [];
      }

      return [{ ...market, stopPair, stopPairs: undefined }] as AppData["supermarkets"];
    }),
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
