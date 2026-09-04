import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as db from "@/lib/db";
import { haversine } from "@/lib/geo";
import { downloadRoadNetwork, geocodeCity } from "@/lib/osm";
import type {
  CircleArea,
  GeocodeResult,
  GraphStats,
  LatLng,
  RouteResult,
  RoutingResponse,
  SavedCityMeta,
  SavedRoute,
  SerializedGraph,
} from "@/lib/types";
import { RoutingWorkerClient } from "@/lib/workerClient";
import type { PointKind } from "@/components/MapView";

export interface LoadedNetwork {
  id: string;
  name: string;
  displayName: string;
  center: LatLng;
  radius: number;
  stats: GraphStats;
  source: "network" | "offline";
  rawBytes: number;
  elementCount?: number;
  buildMs: number;
}

export interface Busy {
  kind: "geocode" | "download" | "build" | "load" | "route";
  phase: string;
  progress?: number;
  detail?: string;
}

const DEFAULT_RADIUS = 2500;

export function useWayfinder() {
  const workerRef = useRef<RoutingWorkerClient | null>(null);
  const worker = () => (workerRef.current ??= new RoutingWorkerClient());
  const graphRef = useRef<SerializedGraph | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- city / area ---
  const [cityQuery, setCityQuery] = useState("Hyderabad, India");
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([]);
  const [offlineMatches, setOfflineMatches] = useState<SavedCityMeta[]>([]);
  const [city, setCity] = useState<GeocodeResult | null>(null);
  const [view, setView] = useState<{ center: LatLng; zoom: number; key: number } | null>(null);
  const [circle, setCircle] = useState<CircleArea | null>(null);
  const [network, setNetwork] = useState<LoadedNetwork | null>(null);
  const [networkSaved, setNetworkSaved] = useState(false);

  // --- status ---
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  // --- routing inputs ---
  const [start, setStart] = useState<LatLng | null>(null);
  const [end, setEnd] = useState<LatLng | null>(null);
  const [stops, setStops] = useState<LatLng[]>([]);
  const [placing, setPlacing] = useState<PointKind | null>(null);
  const [routeMode, setRouteMode] = useState<"fixed" | "optimized">("fixed");
  const [maxRoutes, setMaxRoutes] = useState(4);

  // --- results ---
  const [result, setResult] = useState<RoutingResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [viewingSaved, setViewingSaved] = useState<SavedRoute | null>(null);

  // --- persistence ---
  const [savedCities, setSavedCities] = useState<SavedCityMeta[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  const refreshSaved = useCallback(async () => {
    try {
      const [c, r, s] = await Promise.all([db.listCities(), db.listRoutes(), db.storageEstimate()]);
      setSavedCities(c);
      setSavedRoutes(r);
      setStorage(s);
    } catch (e) {
      setError(`IndexedDB unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void refreshSaved();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refreshSaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearRouting = useCallback(() => {
    setResult(null);
    setSelectedRouteId(null);
    setViewingSaved(null);
  }, []);

  const resetPoints = useCallback(() => {
    setStart(null);
    setEnd(null);
    setStops([]);
    setPlacing(null);
    clearRouting();
  }, [clearRouting]);

  /* ------------------------------------------------------------ */
  /* Step 1 — city search: check IndexedDB first, then Nominatim   */
  /* ------------------------------------------------------------ */
  const searchCity = useCallback(async (forceOnline = false) => {
    const q = cityQuery.trim();
    if (!q) return;
    setError(null);
    setGeoResults([]);
    // IndexedDB first: if this city was saved before, offer it without touching the network.
    const local = forceOnline ? [] : await db.findCitiesByName(q);
    setOfflineMatches(local);
    if (local.length > 0 && !forceOnline) return;
    if (!online) {
      if (local.length === 0) setError("You are offline and no saved network matches this city. Connect to download it.");
      return;
    }
    setBusy({ kind: "geocode", phase: "Geocoding via Nominatim…" });
    try {
      const res = await geocodeCity(q);
      if (res.length === 0) {
        setError(`Nominatim found no place named “${q}”. Check the spelling or add a country (e.g. “Hyderabad, India”).`);
      } else {
        setGeoResults(res);
        if (res.length === 1) selectCity(res[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityQuery, online]);

  const selectCity = useCallback(
    (g: GeocodeResult) => {
      setCity(g);
      setGeoResults([]);
      setCircle({ center: [g.lat, g.lng], radius: DEFAULT_RADIUS });
      setView({ center: [g.lat, g.lng], zoom: 12, key: Date.now() });
      setNetwork(null);
      setNetworkSaved(false);
      graphRef.current = null;
      void worker().clear();
      resetPoints();
    },
    [resetPoints]
  );

  /* ------------------------------------------------------------ */
  /* Step 2 — download & build (or load from IndexedDB)            */
  /* ------------------------------------------------------------ */
  const downloadNetwork = useCallback(async () => {
    if (!city || !circle) return;
    setError(null);
    clearRouting();
    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = performance.now();
    try {
      setBusy({ kind: "download", phase: "Querying Overpass API…", detail: "waiting for server" });
      const { text, bytes } = await downloadRoadNetwork(
        circle.center[0],
        circle.center[1],
        circle.radius,
        (b, ep) => setBusy({ kind: "download", phase: "Downloading road data", detail: `${(b / 1048576).toFixed(1)} MB from ${new URL(ep).host}` }),
        ac.signal
      );
      setBusy({ kind: "build", phase: "Parsing Overpass JSON", progress: 0 });
      const { graph, stats, elementCount } = await worker().build(text, circle.center, circle.radius, (p) =>
        setBusy({ kind: "build", phase: p.phase, progress: p.progress, detail: p.detail })
      );
      graphRef.current = graph;
      const id = db.cityId(city.name, circle.center, circle.radius);
      setNetwork({
        id,
        name: city.name,
        displayName: city.displayName,
        center: circle.center,
        radius: circle.radius,
        stats,
        source: "network",
        rawBytes: bytes,
        elementCount,
        buildMs: performance.now() - t0,
      });
      setNetworkSaved(savedCities.some((c) => c.id === id));
      setPlacing("start");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }, [city, circle, clearRouting, savedCities]);

  const cancelDownload = useCallback(() => {
    abortRef.current?.abort();
    if (busy?.kind === "build") {
      workerRef.current?.terminate();
      workerRef.current = null;
      setBusy(null);
    }
  }, [busy]);

  const loadSavedCity = useCallback(
    async (meta: SavedCityMeta) => {
      setError(null);
      setBusy({ kind: "load", phase: "Reading saved network from IndexedDB…" });
      try {
        const saved = await db.getCity(meta.id);
        if (!saved) throw new Error("Saved city record not found.");
        await worker().load(saved.graph, (p) => setBusy({ kind: "load", phase: p.phase, progress: p.progress }));
        graphRef.current = saved.graph;
        setCity({ displayName: saved.displayName, name: saved.name, lat: saved.center[0], lng: saved.center[1] });
        setCircle({ center: saved.center, radius: saved.radius });
        setView({ center: saved.center, zoom: 13, key: Date.now() });
        setNetwork({
          id: saved.id,
          name: saved.name,
          displayName: saved.displayName,
          center: saved.center,
          radius: saved.radius,
          stats: saved.stats,
          source: "offline",
          rawBytes: saved.rawBytes,
          buildMs: 0,
        });
        setNetworkSaved(true);
        setGeoResults([]);
        setOfflineMatches([]);
        resetPoints();
        setPlacing("start");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [resetPoints]
  );

  const saveNetworkOffline = useCallback(async () => {
    if (!network || !graphRef.current) return;
    setError(null);
    try {
      await db.saveCity({
        id: network.id,
        name: network.name,
        displayName: network.displayName,
        center: network.center,
        radius: network.radius,
        savedAt: Date.now(),
        stats: network.stats,
        graph: graphRef.current,
        rawBytes: network.rawBytes,
      });
      setNetworkSaved(true);
      await refreshSaved();
    } catch (e) {
      setError(`Could not save to IndexedDB: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [network, refreshSaved]);

  const deleteSavedCity = useCallback(
    async (id: string) => {
      await db.deleteCity(id);
      if (network?.id === id) setNetworkSaved(false);
      await refreshSaved();
    },
    [network, refreshSaved]
  );

  const changeArea = useCallback(() => {
    setNetwork(null);
    setNetworkSaved(false);
    graphRef.current = null;
    void worker().clear();
    resetPoints();
  }, [resetPoints]);

  /* ------------------------------------------------------------ */
  /* Step 3 — points                                                */
  /* ------------------------------------------------------------ */
  const insideCircle = useCallback(
    (ll: LatLng) => !!circle && haversine(circle.center[0], circle.center[1], ll[0], ll[1]) <= circle.radius,
    [circle]
  );

  const onMapClick = useCallback(
    (ll: LatLng) => {
      if (!placing || !network) return;
      if (!insideCircle(ll)) {
        setError("That point is outside the search circle. Routes are only computed on roads inside it.");
        return;
      }
      setError(null);
      clearRouting();
      if (placing === "start") {
        setStart(ll);
        setPlacing(end ? null : "end");
      } else if (placing === "end") {
        setEnd(ll);
        setPlacing(null);
      } else {
        setStops((s) => [...s, ll]);
      }
    },
    [placing, network, insideCircle, end, clearRouting]
  );

  const onMovePoint = useCallback(
    (kind: PointKind, index: number, ll: LatLng) => {
      if (!network || !insideCircle(ll)) {
        if (network) setError("Point moved outside the search circle — it was reset. Keep points inside the circle.");
        else setError("Load the road network for this route's city before editing its points.");
        // force re-render with old position
        if (kind === "start") setStart((s) => (s ? [...s] : s));
        else if (kind === "end") setEnd((s) => (s ? [...s] : s));
        else setStops((s) => s.map((p) => [...p] as LatLng));
        return;
      }
      clearRouting();
      if (kind === "start") setStart(ll);
      else if (kind === "end") setEnd(ll);
      else setStops((s) => s.map((p, i) => (i === index ? ll : p)));
    },
    [insideCircle, clearRouting, network]
  );

  const removeStop = useCallback(
    (i: number) => {
      setStops((s) => s.filter((_, j) => j !== i));
      clearRouting();
    },
    [clearRouting]
  );
  const moveStop = useCallback(
    (i: number, dir: -1 | 1) => {
      setStops((s) => {
        const j = i + dir;
        if (j < 0 || j >= s.length) return s;
        const n = s.slice();
        [n[i], n[j]] = [n[j], n[i]];
        return n;
      });
      clearRouting();
    },
    [clearRouting]
  );
  const swapEnds = useCallback(() => {
    setStart(end);
    setEnd(start);
    clearRouting();
  }, [start, end, clearRouting]);

  /* ------------------------------------------------------------ */
  /* Step 4 — compute                                               */
  /* ------------------------------------------------------------ */
  const compute = useCallback(async () => {
    if (!start || !end || !network) return;
    if (routeMode === "optimized" && stops.length > 10) {
      setError(`Optimised ordering is capped at 10 intermediate stops (you have ${stops.length}). Remove stops or use fixed order.`);
      return;
    }
    setError(null);
    setViewingSaved(null);
    setPlacing(null);
    setBusy({ kind: "route", phase: "Starting route computation…", progress: 0 });
    try {
      const res = await worker().route({ points: [start, ...stops, end], mode: routeMode, maxRoutes }, (p) =>
        setBusy({ kind: "route", phase: p.phase, progress: p.progress, detail: p.detail })
      );
      setResult(res);
      setSelectedRouteId(res.routes[0]?.id ?? null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [start, end, stops, network, routeMode, maxRoutes]);

  /* ------------------------------------------------------------ */
  /* Saved routes                                                   */
  /* ------------------------------------------------------------ */
  const saveRouteToDb = useCallback(
    async (route: RouteResult, name: string) => {
      if (!result || !network || !start || !end) return;
      try {
        await db.saveRoute({
          name,
          cityName: network.name,
          cityId: network.id,
          points: [start, ...stops, end],
          order: result.order,
          mode: routeMode,
          route,
          savedAt: Date.now(),
        });
        await refreshSaved();
      } catch (e) {
        setError(`Could not save route: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [result, network, start, end, stops, routeMode, refreshSaved]
  );

  const deleteSavedRoute = useCallback(
    async (id: number) => {
      await db.deleteRoute(id);
      if (viewingSaved?.id === id) setViewingSaved(null);
      await refreshSaved();
    },
    [viewingSaved, refreshSaved]
  );

  const viewSavedRoute = useCallback((sr: SavedRoute) => {
    setViewingSaved(sr);
    setResult(null);
    setSelectedRouteId(sr.route.id);
    setPlacing(null);
    const pts = sr.points;
    setStart(pts[0]);
    setEnd(pts[pts.length - 1]);
    setStops(pts.slice(1, -1));
    setView({ center: sr.route.geometry[Math.floor(sr.route.geometry.length / 2)], zoom: 13, key: Date.now() });
  }, []);

  const isRouteSaved = useCallback(
    (route: RouteResult) =>
      savedRoutes.some(
        (s) =>
          s.cityId === network?.id &&
          s.route.distance === route.distance &&
          s.route.time === route.time &&
          s.route.criterion === route.criterion
      ),
    [savedRoutes, network]
  );

  const displayedRoutes = useMemo<RouteResult[]>(() => {
    if (viewingSaved) return [viewingSaved.route];
    return result?.routes ?? [];
  }, [viewingSaved, result]);

  return {
    // state
    cityQuery,
    setCityQuery,
    geoResults,
    offlineMatches,
    city,
    view,
    circle,
    setCircle,
    network,
    networkSaved,
    busy,
    error,
    setError,
    online,
    start,
    end,
    stops,
    placing,
    setPlacing,
    routeMode,
    setRouteMode,
    maxRoutes,
    setMaxRoutes,
    result,
    selectedRouteId,
    setSelectedRouteId,
    viewingSaved,
    savedCities,
    savedRoutes,
    storage,
    displayedRoutes,
    // actions
    searchCity,
    selectCity,
    downloadNetwork,
    cancelDownload,
    loadSavedCity,
    saveNetworkOffline,
    deleteSavedCity,
    changeArea,
    onMapClick,
    onMovePoint,
    removeStop,
    moveStop,
    swapEnds,
    resetPoints,
    compute,
    saveRouteToDb,
    deleteSavedRoute,
    viewSavedRoute,
    isRouteSaved,
  };
}

export type Wayfinder = ReturnType<typeof useWayfinder>;
