import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, BusFront, KeyRound, MapPin, Plus, RefreshCcw, Save, Search, Settings2, Trash2 } from "lucide-react";
import { fetchRoutesServingStop, fetchStopEvents, searchStops } from "./lib/mbta";
import { pairAllTrips } from "./lib/planner";
import { formatRouteList, intersectRouteLists, routeListsMatch } from "./lib/routes";
import { defaultSettings, loadAppData, makeId, saveAppData } from "./lib/storage";
import { formatClock, formatDuration } from "./lib/time";
import type { AppData, HomeStopPair, StopRef, StopSearchResult, StoreStopPair, Supermarket, TripOption } from "./lib/types";

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
  const hiddenCount = options.length - visibleOptions.length;

  return (
    <>
      {visibleOptions.length > 0 ? (
        <div className="timetable-wrap" aria-live="polite">
          <div className="timetable" role="table" aria-label="Trip options">
            <div className="timetable-header" role="row">
              <span role="columnheader">Leave</span>
              <span role="columnheader">Arrive</span>
              <span role="columnheader">Shop</span>
              <span role="columnheader">Return</span>
              <span role="columnheader">Home</span>
              <span role="columnheader">Route</span>
            </div>
            {visibleOptions.map((option) => (
              <TripRow key={option.id} option={option} requestedShoppingMinutes={requestedShoppingMinutes} />
            ))}
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

function TripRow({ option, requestedShoppingMinutes }: { option: TripOption; requestedShoppingMinutes: number }) {
  const hasLiveData =
    option.outbound.board.source === "prediction" ||
    option.outbound.alight.source === "prediction" ||
    option.inbound.board.source === "prediction" ||
    option.inbound.alight.source === "prediction";
  const warningText = option.shoppingMinutes < requestedShoppingMinutes ? ["This trip no longer has enough shopping time.", ...option.warnings] : option.warnings;

  return (
    <div className={warningText.length > 0 ? "timetable-row has-warning" : "timetable-row"} role="row">
      <span role="cell">
        <strong>{formatClock(option.outbound.board.time)}</strong>
        <small>{formatDuration(option.outbound.durationMinutes)}</small>
      </span>
      <span role="cell">{formatClock(option.outbound.alight.time)}</span>
      <span role="cell">
        <strong>{formatDuration(option.shoppingMinutes)}</strong>
        <small>{option.extraMinutes} min buffer</small>
      </span>
      <span role="cell">{formatClock(option.inbound.board.time)}</span>
      <span role="cell">{formatClock(option.inbound.alight.time)}</span>
      <span role="cell" className="route-cell">
        <span>
          <BusFront size={15} /> {option.outbound.board.routeName}
        </span>
        <span className={hasLiveData ? "source-pill live" : "source-pill"}>{hasLiveData ? "Live" : "Schedule"}</span>
      </span>
      {warningText.length > 0 ? (
        <span className="row-warning" role="cell">
          <AlertTriangle size={15} /> {warningText.join(" ")}
        </span>
      ) : null}
    </div>
  );
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
