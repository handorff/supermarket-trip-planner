import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, Clock, Download, KeyRound, MapPin, Plus, RefreshCcw, Save, Search, Settings2, Trash2, Upload, Wifi } from "lucide-react";
import { fetchRoutesServingStop, fetchStopEvents, searchStops } from "./lib/mbta";
import { MAX_SHOPPING_BUFFER_MINUTES, pairAllTrips } from "./lib/planner";
import { formatRouteList, intersectRouteLists, routeListsMatch } from "./lib/routes";
import { defaultSettings, loadAppData, makeId, parseImportedAppData, saveAppData } from "./lib/storage";
import { formatClock, formatDuration, minutesBetween } from "./lib/time";
import type { AppData, HomeStopPair, LegOption, StopRef, StopSearchResult, StoreStopPair, Supermarket, TripOption } from "./lib/types";

type StopField = "homeOutbound" | "homeReturn" | "storeArrival" | "storeDeparture";

interface StopDrafts {
  homeOutbound?: StopRef;
  homeReturn?: StopRef;
  storeArrival?: StopRef;
  storeDeparture?: StopRef;
}

const emptyStopDrafts: StopDrafts = {};
const DEFAULT_DEPARTURE_WINDOW_MINUTES = 120;
const getInitialData = () => loadAppData();

export function App() {
  const [data, setData] = useState<AppData>(() => getInitialData());
  const [activeTab, setActiveTab] = useState<"plan" | "setup">(() => {
    const initialData = getInitialData();
    return hasSavedPlannerInfo(initialData) ? "plan" : "setup";
  });
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [shoppingMinutes, setShoppingMinutes] = useState(data.settings.defaultShoppingMinutes);
  const [options, setOptions] = useState<TripOption[]>([]);
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [tripError, setTripError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [marketName, setMarketName] = useState("");
  const [marketAddress, setMarketAddress] = useState("");
  const [stopDrafts, setStopDrafts] = useState<StopDrafts>(emptyStopDrafts);
  const [homeRouteIds, setHomeRouteIds] = useState<string[]>([]);
  const [storePairRouteIds, setStorePairRouteIds] = useState<string[]>([]);
  const [homeRouteStatus, setHomeRouteStatus] = useState("");
  const [storeRouteStatus, setStoreRouteStatus] = useState("");
  const [showAllTrips, setShowAllTrips] = useState(false);
  const [setupTransferStatus, setSetupTransferStatus] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => saveAppData(data), [data]);

  useEffect(() => {
    if (!selectedMarketId && data.supermarkets[0]) {
      setSelectedMarketId(data.supermarkets[0].id);
    }
  }, [data.supermarkets, selectedMarketId]);

  const selectedMarket = data.supermarkets.find((market) => market.id === selectedMarketId);
  const selectedStorePair = selectedMarket?.stopPair;
  const selectedHome = selectedStorePair
    ? data.homeStopPairs.find((pair) => routeListsMatch(pair.routeIds, selectedStorePair.routeIds))
    : undefined;
  const canPlan = Boolean(selectedHome && selectedStorePair);
  const refreshSeconds = data.settings.apiKey ? Math.min(data.settings.refreshIntervalSeconds, 45) : data.settings.refreshIntervalSeconds;

  useEffect(() => {
    void inferRoutesForStops(
      [stopDrafts.homeOutbound, stopDrafts.homeReturn],
      data.settings.apiKey,
      setHomeRouteIds,
      setHomeRouteStatus,
    );
  }, [stopDrafts.homeOutbound, stopDrafts.homeReturn, data.settings.apiKey]);

  useEffect(() => {
    void inferRoutesForStops(
      [stopDrafts.storeArrival, stopDrafts.storeDeparture],
      data.settings.apiKey,
      setStorePairRouteIds,
      setStoreRouteStatus,
    );
  }, [stopDrafts.storeArrival, stopDrafts.storeDeparture, data.settings.apiKey]);

  async function loadTrips() {
    if (!selectedHome || !selectedStorePair) {
      setOptions([]);
      return;
    }

    setIsLoadingTrips(true);
    setTripError("");
    try {
      const [homeOutbound, storeArrival, storeDeparture, homeReturn] = await Promise.all([
        fetchStopEvents({ stopId: selectedHome.outboundStop.id, apiKey: data.settings.apiKey }),
        fetchStopEvents({ stopId: selectedStorePair.arrivalStop.id, apiKey: data.settings.apiKey }),
        fetchStopEvents({ stopId: selectedStorePair.departureStop.id, apiKey: data.settings.apiKey }),
        fetchStopEvents({ stopId: selectedHome.returnStop.id, apiKey: data.settings.apiKey }),
      ]);

      setOptions(pairAllTrips({ shoppingMinutes }, homeOutbound, storeArrival, storeDeparture, homeReturn));
      setLastUpdated(new Date());
    } catch (error) {
      setTripError(error instanceof Error ? error.message : "Could not load MBTA data.");
    } finally {
      setIsLoadingTrips(false);
    }
  }

  useEffect(() => {
    if (!canPlan) {
      return undefined;
    }

    void loadTrips();
    const interval = window.setInterval(() => void loadTrips(), refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [selectedHome?.id, selectedMarketId, shoppingMinutes, data.settings.apiKey, data.settings.refreshIntervalSeconds]);

  useEffect(() => {
    setShowAllTrips(false);
  }, [selectedMarketId, shoppingMinutes]);

  function updateData(next: AppData) {
    setData(next);
  }

  function updateSettings(settings: Partial<AppData["settings"]>) {
    updateData({ ...data, settings: { ...data.settings, ...settings } });
  }

  function addHomePair() {
    const routeIds = homeRouteIds;
    if (routeIds.length === 0 || !stopDrafts.homeOutbound || !stopDrafts.homeReturn) {
      return;
    }

    const pair: HomeStopPair = {
      id: makeId("home"),
      name: formatRouteList(routeIds),
      routeIds,
      outboundStop: stopDrafts.homeOutbound,
      returnStop: stopDrafts.homeReturn,
    };
    updateData({ ...data, homeStopPairs: [...data.homeStopPairs, pair] });
    setHomeRouteIds([]);
    setStopDrafts((drafts) => ({ ...drafts, homeOutbound: undefined, homeReturn: undefined }));
  }

  function addSupermarket() {
    const routeIds = storePairRouteIds;
    if (!marketName.trim() || routeIds.length === 0 || !stopDrafts.storeArrival || !stopDrafts.storeDeparture) {
      return;
    }

    const pair: StoreStopPair = {
      id: makeId("store-pair"),
      label: formatRouteList(routeIds),
      routeIds,
      arrivalStop: stopDrafts.storeArrival,
      departureStop: stopDrafts.storeDeparture,
    };
    const market: Supermarket = {
      id: makeId("market"),
      name: marketName.trim(),
      address: marketAddress.trim(),
      stopPair: pair,
    };
    updateData({ ...data, supermarkets: [...data.supermarkets, market] });
    setMarketName("");
    setMarketAddress("");
    setStorePairRouteIds([]);
    setStopDrafts((drafts) => ({ ...drafts, storeArrival: undefined, storeDeparture: undefined }));
    setSelectedMarketId(market.id);
  }

  function deleteHomePair(id: string) {
    updateData({ ...data, homeStopPairs: data.homeStopPairs.filter((pair) => pair.id !== id) });
  }

  function deleteMarket(id: string) {
    updateData({ ...data, supermarkets: data.supermarkets.filter((market) => market.id !== id) });
  }

  function exportSetup() {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "supermarket-trip-planner-setup.json";
    link.click();
    URL.revokeObjectURL(url);
    setSetupTransferStatus("Setup exported.");
  }

  async function importSetup(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const imported = parseImportedAppData(await readFileText(file));
      updateData(imported);
      setSelectedMarketId(imported.supermarkets[0]?.id ?? "");
      setShoppingMinutes(imported.settings.defaultShoppingMinutes);
      setOptions([]);
      setTripError("");
      setLastUpdated(null);
      setStopDrafts(emptyStopDrafts);
      setHomeRouteIds([]);
      setStorePairRouteIds([]);
      setSetupTransferStatus("Setup imported.");
    } catch (error) {
      setSetupTransferStatus(error instanceof Error ? error.message : "Could not import setup JSON.");
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Supermarket Trip Planner</h1>
        </div>
        <button
          className={activeTab === "setup" ? "icon-button active" : "icon-button"}
          type="button"
          onClick={() => setActiveTab(activeTab === "plan" ? "setup" : "plan")}
          aria-label={activeTab === "plan" ? "Open setup" : "Open planner"}
        >
          <Settings2 size={22} />
        </button>
      </header>

      {activeTab === "plan" ? (
        <section className="planner-panel">
          <div className="planner-controls">
            <label>
              Supermarket
              <select value={selectedMarketId} onChange={(event) => setSelectedMarketId(event.target.value)}>
                <option value="">Add a supermarket in setup</option>
                {data.supermarkets.map((market) => (
                  <option key={market.id} value={market.id}>
                    {market.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Shopping time
              <div className="number-row">
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={shoppingMinutes}
                  onChange={(event) => setShoppingMinutes(Number(event.target.value))}
                />
                <span>min</span>
              </div>
            </label>
          </div>

          <div className="sticky-summary">
            <div>
              <strong>{canPlan ? `${formatRouteList(selectedHome?.routeIds)} to ${selectedMarket?.name}` : "Setup required"}</strong>
              <span>
                {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "No live data yet"}
              </span>
            </div>
            <button className="secondary-button" type="button" onClick={() => void loadTrips()} disabled={!canPlan || isLoadingTrips}>
              <RefreshCcw size={17} /> Refresh
            </button>
          </div>

          {!selectedHome || !selectedStorePair ? (
            <EmptyState text="Add a home stop group with the same inferred route as this supermarket." />
          ) : null}

          {tripError ? <WarningBanner text={tripError} /> : null}
          {isLoadingTrips ? <p className="muted">Loading MBTA schedules and predictions...</p> : null}
          {!isLoadingTrips && canPlan && options.length === 0 ? <EmptyState text="No single-bus round trips currently leave enough shopping time." /> : null}

          {options.length > 0 ? (
            <TripTimetable
              options={options}
              requestedShoppingMinutes={shoppingMinutes}
              showAllTrips={showAllTrips}
              onShowMore={() => setShowAllTrips(true)}
            />
          ) : null}
        </section>
      ) : (
        <section className="setup-stack">
          <section className="panel">
            <div className="section-heading">
              <h2>Settings</h2>
              <KeyRound size={19} />
            </div>
            <div className="field-grid">
              <label>
                Default shopping minutes
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={data.settings.defaultShoppingMinutes}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    updateSettings({ defaultShoppingMinutes: value || defaultSettings.defaultShoppingMinutes });
                    setShoppingMinutes(value || defaultSettings.defaultShoppingMinutes);
                  }}
                />
              </label>
              <label>
                Optional MBTA API key
                <input
                  type="password"
                  value={data.settings.apiKey}
                  placeholder="Stored only on this device"
                  onChange={(event) => updateSettings({ apiKey: event.target.value })}
                />
              </label>
              <label>
                Refresh interval
                <div className="number-row">
                  <input
                    type="number"
                    min="30"
                    step="15"
                    value={data.settings.refreshIntervalSeconds}
                    onChange={(event) => updateSettings({ refreshIntervalSeconds: Number(event.target.value) || 90 })}
                  />
                  <span>sec</span>
                </div>
              </label>
            </div>
            <div className="setup-transfer">
              <button className="secondary-button" type="button" onClick={exportSetup}>
                <Download size={17} /> Export setup
              </button>
              <label className="secondary-button file-button">
                <Upload size={17} /> Import setup
                <input
                  ref={importInputRef}
                  aria-label="Import setup JSON"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void importSetup(event.target.files?.[0])}
                />
              </label>
            </div>
            {setupTransferStatus ? <p className="muted setup-transfer-status">{setupTransferStatus}</p> : null}
          </section>

          <section className="panel">
            <div className="section-heading">
              <h2>Home Stops</h2>
              <Save size={19} />
            </div>
            <StopPicker
              label="Bus from home"
              selected={stopDrafts.homeOutbound}
              apiKey={data.settings.apiKey}
              onSelect={(stop) => setStopDrafts((drafts) => ({ ...drafts, homeOutbound: stop }))}
            />
            <StopPicker
              label="Bus back near home"
              selected={stopDrafts.homeReturn}
              apiKey={data.settings.apiKey}
              onSelect={(stop) => setStopDrafts((drafts) => ({ ...drafts, homeReturn: stop }))}
            />
            <InferredRoutes routeIds={homeRouteIds} status={homeRouteStatus} />
            <button className="primary-button" type="button" onClick={addHomePair}>
              <Plus size={18} /> Save home stops
            </button>
            <SavedList
              items={data.homeStopPairs.map((pair) => ({
                id: pair.id,
                title: formatRouteList(pair.routeIds),
                detail: `${pair.outboundStop.name} -> ${pair.returnStop.name}`,
              }))}
              onDelete={deleteHomePair}
            />
          </section>

          <section className="panel">
            <div className="section-heading">
              <h2>Supermarkets</h2>
              <MapPin size={19} />
            </div>
            <label>
              Store name
              <input value={marketName} placeholder="Market Basket" onChange={(event) => setMarketName(event.target.value)} />
            </label>
            <label>
              Address
              <input value={marketAddress} placeholder="Optional" onChange={(event) => setMarketAddress(event.target.value)} />
            </label>
            <StopPairEditor
              stopDrafts={stopDrafts}
              setStopDrafts={setStopDrafts}
              apiKey={data.settings.apiKey}
            />
            <InferredRoutes routeIds={storePairRouteIds} status={storeRouteStatus} />
            <div className="button-row">
              <button className="primary-button" type="button" onClick={addSupermarket}>
                <Plus size={18} /> Save supermarket
              </button>
            </div>
            <SavedList
              items={data.supermarkets.map((market) => ({
                id: market.id,
                title: market.name,
                detail: `${formatRouteList(market.stopPair.routeIds)} | ${market.stopPair.arrivalStop.name} -> ${market.stopPair.departureStop.name}`,
              }))}
              onDelete={deleteMarket}
            />
          </section>
        </section>
      )}
    </main>
  );
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read setup JSON.")));
    reader.readAsText(file);
  });
}

function hasSavedPlannerInfo(data: AppData): boolean {
  return data.homeStopPairs.length > 0 && data.supermarkets.length > 0;
}

function StopPairEditor({
  stopDrafts,
  setStopDrafts,
  apiKey,
}: {
  stopDrafts: StopDrafts;
  setStopDrafts: Dispatch<SetStateAction<StopDrafts>>;
  apiKey: string;
}) {
  return (
    <>
      <StopPicker
        label="Arrive near store"
        selected={stopDrafts.storeArrival}
        apiKey={apiKey}
        onSelect={(stop) => setStopDrafts((drafts) => ({ ...drafts, storeArrival: stop }))}
      />
      <StopPicker
        label="Leave from store"
        selected={stopDrafts.storeDeparture}
        apiKey={apiKey}
        onSelect={(stop) => setStopDrafts((drafts) => ({ ...drafts, storeDeparture: stop }))}
      />
    </>
  );
}

async function inferRoutesForStops(
  stops: Array<StopRef | undefined>,
  apiKey: string,
  setRouteIds: (routeIds: string[]) => void,
  setStatus: (status: string) => void,
) {
  const selectedStops = stops.filter((stop): stop is StopRef => Boolean(stop));
  if (selectedStops.length < stops.length) {
    setRouteIds([]);
    setStatus("Choose both stops to infer shared routes.");
    return;
  }

  setStatus("Finding shared routes...");
  try {
    const routeLists = await Promise.all(selectedStops.map((stop) => fetchRoutesServingStop(stop.id, apiKey)));
    const sharedRoutes = intersectRouteLists(routeLists);
    setRouteIds(sharedRoutes);
    setStatus(sharedRoutes.length > 0 ? "Shared routes inferred from the selected stops." : "These stops do not share a bus route.");
  } catch (error) {
    setRouteIds([]);
    setStatus(error instanceof Error ? error.message : "Could not infer routes for these stops.");
  }
}

function InferredRoutes({ routeIds, status }: { routeIds: string[]; status: string }) {
  return (
    <div className={routeIds.length > 0 ? "inferred-routes ready" : "inferred-routes"}>
      <small>Shared routes</small>
      <strong>{formatRouteList(routeIds)}</strong>
      <span>{status}</span>
    </div>
  );
}

function StopPicker({ label, selected, apiKey, onSelect }: { label: string; selected?: StopRef; apiKey: string; onSelect: (stop: StopRef) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StopSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }

      setIsSearching(true);
      setError("");
      try {
        setResults(await searchStops(query, apiKey));
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Stop search failed.");
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [query, apiKey]);

  return (
    <div className="stop-picker">
      <label>
        {label}
        <div className="search-input">
          <Search size={17} />
          <input value={query} placeholder="Search MBTA bus stops" onChange={(event) => setQuery(event.target.value)} />
        </div>
      </label>
      {selected ? <p className="selected-stop">{selected.name}</p> : null}
      {isSearching ? <p className="muted">Searching stops...</p> : null}
      {error ? <WarningBanner text={error} /> : null}
      {results.length > 0 ? (
        <div className="result-list">
          {results.map((stop) => (
            <button
              key={stop.id}
              type="button"
              onClick={() => {
                onSelect(stop);
                setQuery("");
                setResults([]);
              }}
            >
              <span>{stop.name}</span>
              <small>{stop.description || stop.id}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TripTimetable({
  options,
  requestedShoppingMinutes,
  showAllTrips,
  onShowMore,
}: {
  options: TripOption[];
  requestedShoppingMinutes: number;
  showAllTrips: boolean;
  onShowMore: () => void;
}) {
  const cutoff = Date.now() + DEFAULT_DEPARTURE_WINDOW_MINUTES * 60000;
  const visibleOptions = showAllTrips
    ? options
    : options.filter((option) => new Date(option.outbound.board.time).getTime() <= cutoff);
  const hiddenCount = uniqueLegs(options, "outbound").length - uniqueLegs(visibleOptions, "outbound").length;
  const [selectedOutboundKey, setSelectedOutboundKey] = useState("");
  const [selectedInboundKey, setSelectedInboundKey] = useState("");
  const outboundLegs = uniqueLegs(visibleOptions, "outbound");
  const inboundLegs = uniqueLegs(visibleOptions, "inbound").sort(compareLegDeparture);
  const defaultOption = visibleOptions.find((option) => isPracticalOption(option, requestedShoppingMinutes)) ?? visibleOptions[0];

  useEffect(() => {
    if (visibleOptions.length === 0) {
      setSelectedOutboundKey("");
      setSelectedInboundKey("");
      return;
    }

    const hasSelectedOutbound = outboundLegs.some((leg) => legKey(leg) === selectedOutboundKey);
    const hasSelectedInbound = inboundLegs.some((leg) => legKey(leg) === selectedInboundKey);
    if (!hasSelectedOutbound || !hasSelectedInbound) {
      setSelectedOutboundKey(legKey(defaultOption.outbound));
      setSelectedInboundKey(legKey(defaultOption.inbound));
    }
  }, [visibleOptions, outboundLegs, inboundLegs, defaultOption, selectedOutboundKey, selectedInboundKey]);

  const selectedOutbound = outboundLegs.find((leg) => legKey(leg) === selectedOutboundKey) ?? defaultOption?.outbound;
  const selectedInbound = inboundLegs.find((leg) => legKey(leg) === selectedInboundKey) ?? defaultOption?.inbound;
  const selectedOption = selectedOutbound && selectedInbound ? buildSelectedTripOption(selectedOutbound, selectedInbound, requestedShoppingMinutes) : undefined;

  function chooseOutbound(key: string) {
    setSelectedOutboundKey(key);
  }

  function chooseInbound(key: string) {
    setSelectedInboundKey(key);
  }

  return (
    <>
      {visibleOptions.length > 0 && selectedOption ? (
        <div className="trip-picker" aria-live="polite">
          <SelectedTrip option={selectedOption} requestedShoppingMinutes={requestedShoppingMinutes} />
          <div className="leg-picker-grid">
            <LegPicker
              title="To supermarket"
              legs={outboundLegs}
              selectedKey={legKey(selectedOption.outbound)}
              onSelect={chooseOutbound}
            />
            <LegPicker
              title="Back home"
              legs={inboundLegs}
              selectedKey={legKey(selectedOption.inbound)}
              onSelect={chooseInbound}
            />
          </div>
        </div>
      ) : (
        <EmptyState text="No practical trips depart in the next 2 hours." />
      )}
      {hiddenCount > 0 ? (
        <button className="show-more-button" type="button" onClick={onShowMore}>
          Show {hiddenCount} later trip{hiddenCount === 1 ? "" : "s"}
        </button>
      ) : null}
    </>
  );
}

function SelectedTrip({ option, requestedShoppingMinutes }: { option: TripOption; requestedShoppingMinutes: number }) {
  const warningText = option.shoppingMinutes < requestedShoppingMinutes ? ["This trip no longer has enough shopping time.", ...option.warnings] : option.warnings;

  return (
    <section className={warningText.length > 0 ? "selected-trip has-warning" : "selected-trip"} aria-label="Selected trip combination">
      <div>
        <small>Leave</small>
        <TimeWithSource time={option.outbound.board.time} source={option.outbound.board.source} strong />
      </div>
      <div>
        <small>Arrive</small>
        <TimeWithSource time={option.outbound.alight.time} source={option.outbound.alight.source} />
      </div>
      <div>
        <small>Shop</small>
        <strong>{formatDuration(option.shoppingMinutes)}</strong>
        <span>{option.extraMinutes} min buffer</span>
      </div>
      <div>
        <small>Return</small>
        <TimeWithSource time={option.inbound.board.time} source={option.inbound.board.source} />
      </div>
      <div>
        <small>Home</small>
        <TimeWithSource time={option.inbound.alight.time} source={option.inbound.alight.source} />
      </div>
      {warningText.length > 0 ? (
        <p className="row-warning">
          <AlertTriangle size={15} /> {warningText.join(" ")}
        </p>
      ) : null}
    </section>
  );
}

function TimeWithSource({ time, source, strong = false }: { time: string; source: "prediction" | "schedule"; strong?: boolean }) {
  const label = source === "prediction" ? "Live prediction" : "Schedule";
  const Icon = source === "prediction" ? Wifi : Clock;
  const timeText = formatClock(time);

  return (
    <span className="time-with-source">
      {strong ? <strong>{timeText}</strong> : <span>{timeText}</span>}
      <span className={source === "prediction" ? "time-source live" : "time-source"} aria-label={label} title={label}>
        <Icon size={14} />
      </span>
    </span>
  );
}

function LegPicker({
  title,
  legs,
  selectedKey,
  onSelect,
}: {
  title: string;
  legs: TripOption["outbound"][];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="leg-picker">
      <h2>{title}</h2>
      <div className="leg-scroll">
        {legs.map((leg) => {
          const key = legKey(leg);
          return (
            <button className={key === selectedKey ? "leg-option selected" : "leg-option"} key={key} type="button" onClick={() => onSelect(key)}>
              <span className="leg-time-row">
                <strong>{formatClock(leg.board.time)}</strong>
                <span aria-hidden="true">→</span>
                <span>{formatClock(leg.alight.time)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function uniqueLegs(options: TripOption[], side: "outbound" | "inbound"): TripOption["outbound"][] {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const leg = option[side];
    const key = legKey(leg);
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [leg];
  });
}

function compareLegDeparture(left: LegOption, right: LegOption): number {
  return new Date(left.board.time).getTime() - new Date(right.board.time).getTime();
}

function isPracticalOption(option: TripOption, requestedShoppingMinutes: number): boolean {
  return option.shoppingMinutes >= requestedShoppingMinutes && option.extraMinutes <= MAX_SHOPPING_BUFFER_MINUTES;
}

function legKey(leg: TripOption["outbound"]): string {
  return `${leg.board.tripId}:${leg.board.routeId}:${leg.board.time}:${leg.alight.time}`;
}

function buildSelectedTripOption(outbound: LegOption, inbound: LegOption, requestedShoppingMinutes: number): TripOption {
  const shoppingMinutes = minutesBetween(outbound.alight.time, inbound.board.time);
  const extraMinutes = shoppingMinutes - requestedShoppingMinutes;
  const warnings: string[] = [];

  if (shoppingMinutes < 0) {
    warnings.push("The return trip leaves before this supermarket arrival.");
  } else if (shoppingMinutes < requestedShoppingMinutes) {
    warnings.push(`Shopping time dropped to ${shoppingMinutes} minutes.`);
  } else if (extraMinutes <= 10) {
    warnings.push(`Only ${extraMinutes} minutes of buffer after shopping.`);
  }

  return {
    id: `${legKey(outbound)}-${legKey(inbound)}`,
    outbound,
    inbound,
    shoppingMinutes,
    extraMinutes,
    warnings,
  };
}

function WarningBanner({ text }: { text: string }) {
  return (
    <div className="warning-banner">
      <AlertTriangle size={17} /> {text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function SavedList({ items, onDelete }: { items: Array<{ id: string; title: string; detail: string }>; onDelete: (id: string) => void }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="saved-list">
      {items.map((item) => (
        <div key={item.id}>
          <span>
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
          </span>
          <button className="icon-button" type="button" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>
            <Trash2 size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}
