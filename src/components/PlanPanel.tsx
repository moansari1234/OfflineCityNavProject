import { useState, type ReactNode } from "react";
import { formatBytes, formatDistance, formatDuration } from "@/lib/geo";
import type { RouteResult } from "@/lib/types";
import type { Wayfinder } from "@/hooks/useWayfinder";
import { cn } from "@/utils/cn";
import { Alert, Button, Spinner, Stat, Step } from "./ui";

export function PlanPanel({ wf }: { wf: Wayfinder }) {
  const cityDone = !!wf.city;
  const netDone = !!wf.network;
  const pointsDone = !!wf.start && !!wf.end;
  const isBusy = !!wf.busy;

  return (
    <div>
      {/* ---------------- 1. City ---------------- */}
      <Step n={1} title="City" status={cityDone ? "done" : "active"}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void wf.searchCity();
          }}
        >
          <input
            value={wf.cityQuery}
            onChange={(e) => wf.setCityQuery(e.target.value)}
            placeholder="e.g. Hyderabad, India"
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-800/70 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
          />
          <Button type="submit" disabled={isBusy || !wf.cityQuery.trim()}>
            {wf.busy?.kind === "geocode" ? <Spinner /> : "Find"}
          </Button>
        </form>

        {wf.offlineMatches.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-400">Available offline — no network needed</div>
            {wf.offlineMatches.map((m) => (
              <button
                key={m.id}
                onClick={() => void wf.loadSavedCity(m)}
                disabled={isBusy}
                className="flex w-full items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left text-xs hover:bg-emerald-500/20"
              >
                <span>
                  <span className="font-semibold text-slate-100">{m.name}</span>
                  <span className="text-slate-400"> · {formatDistance(m.radius)} radius · {m.stats.nodeCount.toLocaleString()} nodes</span>
                </span>
                <span className="text-emerald-300">Load ↓</span>
              </button>
            ))}
            <button
              onClick={() => void wf.searchCity(true)}
              disabled={isBusy || !wf.online}
              className="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline disabled:opacity-40"
            >
              Search Nominatim online instead (new area / different city)
            </button>
          </div>
        )}

        {!wf.city && wf.offlineMatches.length === 0 && wf.geoResults.length === 0 && wf.savedCities.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-400">Saved offline — quick load</div>
            {wf.savedCities.slice(0, 3).map((m) => (
              <button
                key={m.id}
                onClick={() => void wf.loadSavedCity(m)}
                disabled={isBusy}
                className="flex w-full items-center justify-between rounded-md border border-slate-700/80 bg-slate-800/40 px-3 py-2 text-left text-xs hover:border-emerald-500/50"
              >
                <span>
                  <span className="font-semibold text-slate-100">{m.name}</span>
                  <span className="text-slate-400"> · {formatDistance(m.radius)} radius</span>
                </span>
                <span className="text-emerald-300">Load ↓</span>
              </button>
            ))}
          </div>
        )}

        {wf.geoResults.length > 0 && (
          <div className="mt-3 space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Nominatim results</div>
            {wf.geoResults.map((g, i) => (
              <button
                key={i}
                onClick={() => wf.selectCity(g)}
                className="block w-full rounded-md border border-slate-700/80 bg-slate-800/50 px-3 py-2 text-left text-xs leading-snug text-slate-200 hover:border-amber-400/60 hover:bg-slate-800"
              >
                <span className="font-semibold">{g.name}</span>
                <span className="block truncate text-slate-400">{g.displayName}</span>
              </button>
            ))}
          </div>
        )}

        {wf.city && (
          <div className="mt-3 rounded-md bg-slate-800/60 px-3 py-2 text-xs">
            <div className="font-semibold text-slate-100">{wf.city.name}</div>
            <div className="truncate text-slate-400" title={wf.city.displayName}>
              {wf.city.displayName}
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-500">
              {wf.city.lat.toFixed(5)}, {wf.city.lng.toFixed(5)}
            </div>
          </div>
        )}
      </Step>

      {/* ---------------- 2. Area & network ---------------- */}
      <Step
        n={2}
        title="Search area & road network"
        status={netDone ? "done" : cityDone ? "active" : "todo"}
        right={
          netDone && (
            <Button size="sm" variant="ghost" onClick={wf.changeArea} disabled={isBusy}>
              Change area
            </Button>
          )
        }
      >
        {!wf.circle && <p className="text-xs text-slate-400">Locate a city first.</p>}
        {wf.circle && !netDone && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-400">
              Drag the <span className="text-sky-300">blue centre</span> to move the circle and the{" "}
              <span className="text-slate-100">white handle</span> to resize it. Only roads inside this circle are downloaded and routed.
            </p>
            <label className="block">
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-slate-300">Radius</span>
                <span className="font-mono text-slate-100">{formatDistance(wf.circle.radius)}</span>
              </div>
              <input
                type="range"
                min={300}
                max={15000}
                step={100}
                value={wf.circle.radius}
                onChange={(e) => wf.setCircle({ center: wf.circle!.center, radius: Number(e.target.value) })}
                className="w-full accent-amber-400"
                disabled={isBusy}
              />
            </label>
            {wf.circle.radius > 6000 && (
              <Alert kind="warn">
                Large radius: the Overpass download may be tens of MB and take a while. Overpass may reject very large queries.
              </Alert>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void wf.downloadNetwork()} disabled={isBusy || !wf.online}>
                {wf.busy?.kind === "download" || wf.busy?.kind === "build" ? <Spinner /> : "⇣"} Download roads from Overpass
              </Button>
              {(wf.busy?.kind === "download" || wf.busy?.kind === "build") && (
                <Button variant="danger" onClick={wf.cancelDownload}>
                  Cancel
                </Button>
              )}
            </div>
            {!wf.online && <Alert kind="warn">You are offline. Load a saved network from the Saved tab or from the search above.</Alert>}
          </div>
        )}
        {wf.network && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide",
                  wf.network.source === "offline" ? "bg-emerald-500/20 text-emerald-300" : "bg-sky-500/20 text-sky-300"
                )}
              >
                {wf.network.source === "offline" ? "Loaded from IndexedDB" : "Live from Overpass"}
              </span>
              <span className="text-slate-400">{formatDistance(wf.network.radius)} radius</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Nodes" value={wf.network.stats.nodeCount.toLocaleString()} />
              <Stat label="Edges" value={wf.network.stats.edgeCount.toLocaleString()} />
              <Stat label="Roads" value={`${wf.network.stats.totalRoadKm.toFixed(0)} km`} />
              <Stat label="OSM ways" value={wf.network.stats.wayCount.toLocaleString()} />
              <Stat label="Signals" value={wf.network.stats.hasTrafficSignals ? wf.network.stats.signalCount.toLocaleString() : "none tagged"} />
              <Stat label="Payload" value={formatBytes(wf.network.rawBytes)} />
            </div>
            {wf.network.buildMs > 0 && (
              <div className="text-[11px] text-slate-500">Downloaded, parsed and preprocessed (ALT landmarks) in {(wf.network.buildMs / 1000).toFixed(1)} s.</div>
            )}
            <Button variant={wf.networkSaved ? "subtle" : "primary"} className="w-full" onClick={() => void wf.saveNetworkOffline()} disabled={wf.networkSaved || isBusy}>
              {wf.networkSaved ? "✓ Saved for offline use" : "Save city data for offline use"}
            </Button>
          </div>
        )}
      </Step>

      {/* ---------------- 3. Stops ---------------- */}
      <Step n={3} title="Start, stops & destination" status={pointsDone ? "done" : netDone ? "active" : "todo"}>
        {!netDone && <p className="text-xs text-slate-400">Load a road network first.</p>}
        {netDone && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1.5">
              {(["start", "stop", "end"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => wf.setPlacing(wf.placing === k ? null : k)}
                  disabled={isBusy}
                  className={cn(
                    "h-8 rounded-md border text-xs font-medium transition-colors",
                    wf.placing === k
                      ? "border-amber-400 bg-amber-400 text-slate-950"
                      : "border-slate-700 bg-slate-800/60 text-slate-200 hover:border-slate-500"
                  )}
                >
                  {k === "start" ? "Set start (A)" : k === "end" ? "Set end (B)" : "+ Add stop"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {wf.placing
                ? `Click the map to place ${wf.placing === "stop" ? "a stop (keeps adding — press Esc to stop)" : `the ${wf.placing}`}. Markers are draggable.`
                : "Pick a mode, then click the map inside the circle."}
            </p>

            <ol className="space-y-1">
              <PointRow label="A" color="bg-emerald-500 text-white" text={wf.start ? fmt(wf.start) : "Start not set"} muted={!wf.start} />
              {wf.stops.map((s, i) => (
                <PointRow
                  key={i}
                  label={`${i + 1}`}
                  color="bg-slate-100 text-slate-900"
                  text={fmt(s)}
                  actions={
                    <>
                      <button className="px-1 text-slate-400 hover:text-white disabled:opacity-30" onClick={() => wf.moveStop(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button className="px-1 text-slate-400 hover:text-white disabled:opacity-30" onClick={() => wf.moveStop(i, 1)} disabled={i === wf.stops.length - 1}>
                        ↓
                      </button>
                      <button className="px-1 text-red-300 hover:text-red-200" onClick={() => wf.removeStop(i)}>
                        ×
                      </button>
                    </>
                  }
                />
              ))}
              <PointRow label="B" color="bg-red-500 text-white" text={wf.end ? fmt(wf.end) : "Destination not set"} muted={!wf.end} />
            </ol>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={wf.swapEnds} disabled={!wf.start && !wf.end}>
                ⇅ Swap A/B
              </Button>
              <Button size="sm" variant="ghost" onClick={wf.resetPoints} disabled={!wf.start && !wf.end && wf.stops.length === 0}>
                Clear all
              </Button>
            </div>

            {wf.stops.length > 0 && (
              <div className="rounded-md border border-slate-700/80 p-2.5">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">Stop order</div>
                <div className="grid grid-cols-2 gap-1">
                  {(["fixed", "optimized"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => wf.setRouteMode(m)}
                      className={cn(
                        "rounded px-2 py-1.5 text-left text-xs",
                        wf.routeMode === m ? "bg-slate-100 text-slate-900" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      )}
                    >
                      <div className="font-semibold">{m === "fixed" ? "Fixed order" : "Optimised"}</div>
                      <div className={cn("text-[10px]", wf.routeMode === m ? "text-slate-600" : "text-slate-500")}>
                        {m === "fixed" ? "Visit stops as listed" : "Held-Karp path-TSP (≤10 stops)"}
                      </div>
                    </button>
                  ))}
                </div>
                {wf.routeMode === "optimized" && wf.stops.length > 10 && (
                  <div className="mt-2">
                    <Alert kind="error">
                      {wf.stops.length} stops exceeds the 10-stop cap for optimised ordering (2ⁿ·n² DP). Remove stops or use fixed order.
                    </Alert>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Step>

      {/* ---------------- 4. Routes ---------------- */}
      <Step n={4} title="Compute alternatives" status={wf.result ? "done" : pointsDone ? "active" : "todo"}>
        {!pointsDone && <p className="text-xs text-slate-400">Set a start and destination.</p>}
        {pointsDone && (
          <div className="space-y-3">
            <label className="block">
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-slate-300">Max alternatives</span>
                <span className="font-mono text-slate-100">{wf.maxRoutes}</span>
              </div>
              <input type="range" min={2} max={5} value={wf.maxRoutes} onChange={(e) => wf.setMaxRoutes(Number(e.target.value))} className="w-full accent-amber-400" />
            </label>
            <Button className="w-full" onClick={() => void wf.compute()} disabled={isBusy || (wf.routeMode === "optimized" && wf.stops.length > 10)}>
              {wf.busy?.kind === "route" ? <Spinner /> : "⟁"} Compute routes (ALT + Yen's K-shortest)
            </Button>
          </div>
        )}

        {wf.result && (
          <div className="mt-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold text-slate-200">
                {wf.result.routes.length} distinct route{wf.result.routes.length !== 1 && "s"}
              </h3>
              <span className="text-[11px] text-slate-500">computed in {(wf.result.computeMs / 1000).toFixed(2)} s</span>
            </div>
            {wf.result.order.length > 2 && wf.routeMode === "optimized" && (
              <div className="text-[11px] text-slate-400">
                Optimised visiting order: A →{" "}
                {wf.result.order
                  .slice(1, -1)
                  .map((i) => `stop ${i}`)
                  .join(" → ")}{" "}
                → B
              </div>
            )}
            {wf.result.routes.map((r) => (
              <RouteCard key={r.id} route={r} selected={wf.selectedRouteId === r.id} onSelect={() => wf.setSelectedRouteId(r.id)} wf={wf} />
            ))}
            {wf.result.notes.map((n, i) => (
              <Alert key={i} kind="info">
                {n}
              </Alert>
            ))}
          </div>
        )}
      </Step>
    </div>
  );
}

function fmt(ll: [number, number]) {
  return `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`;
}

function PointRow({ label, color, text, muted, actions }: { label: string; color: string; text: string; muted?: boolean; actions?: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-md bg-slate-800/50 px-2 py-1.5 text-xs">
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", color)}>{label}</span>
      <span className={cn("flex-1 truncate font-mono", muted ? "text-slate-500" : "text-slate-200")}>{text}</span>
      {actions && <span className="flex items-center">{actions}</span>}
    </li>
  );
}

export function RouteCard({
  route,
  selected,
  onSelect,
  wf,
  readonly,
}: {
  route: RouteResult;
  selected: boolean;
  onSelect: () => void;
  wf: Wayfinder;
  readonly?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const saved = wf.isRouteSaved(route);
  return (
    <div
      onClick={onSelect}
      className={cn(
        "cursor-pointer rounded-lg border p-3 transition-colors",
        selected ? "border-slate-500 bg-slate-800" : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
      )}
      style={{ borderLeftColor: route.color, borderLeftWidth: 4 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-100">{route.label}</div>
          {route.roadNames.length > 0 && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-400" title={route.roadNames.join(" → ")}>
              via {route.roadNames.slice(0, 3).join(" · ")}
              {route.roadNames.length > 3 && ` +${route.roadNames.length - 3}`}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tabular-nums text-slate-100">{formatDuration(route.time)}</div>
          <div className="text-[11px] tabular-nums text-slate-400">{formatDistance(route.distance)}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>
          <b className="text-slate-200">{route.turns}</b> turns
        </span>
        {wf.network?.stats.hasTrafficSignals && (
          <span>
            <b className="text-slate-200">{route.signals}</b> signals
          </span>
        )}
        {route.legs.length > 1 && (
          <span>
            <b className="text-slate-200">{route.legs.length}</b> legs
          </span>
        )}
        {route.overlapWithBest < 1 && <span>{Math.round((1 - route.overlapWithBest) * 100)}% unique vs. primary</span>}
      </div>
      {!readonly && selected && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant={saved ? "subtle" : "primary"}
            disabled={saved || saving}
            onClick={async (e) => {
              e.stopPropagation();
              setSaving(true);
              const name = `${wf.network?.name ?? "Route"} · ${route.label} · ${formatDistance(route.distance)}`;
              await wf.saveRouteToDb(route, name);
              setSaving(false);
            }}
          >
            {saved ? "✓ Saved" : "Save route offline"}
          </Button>
        </div>
      )}
    </div>
  );
}
