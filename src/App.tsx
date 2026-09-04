import { useState } from "react";
import { MapView } from "@/components/MapView";
import { PlanPanel } from "@/components/PlanPanel";
import { SavedPanel } from "@/components/SavedPanel";
import { Alert, ProgressBar, Spinner } from "@/components/ui";
import { useWayfinder } from "@/hooks/useWayfinder";
import { formatDistance, formatDuration } from "@/lib/geo";
import { cn } from "@/utils/cn";

export default function App() {
  const wf = useWayfinder();
  const [tab, setTab] = useState<"plan" | "saved">("plan");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Map fills viewport */}
      <div className="absolute inset-0">
        <MapView
          view={wf.view}
          circle={wf.circle}
          circleLocked={!!wf.network}
          onCircleChange={wf.setCircle}
          start={wf.start}
          end={wf.end}
          stops={wf.stops}
          order={wf.result?.order ?? wf.viewingSaved?.order ?? null}
          onMapClick={wf.onMapClick}
          onMovePoint={wf.onMovePoint}
          routes={wf.displayedRoutes}
          selectedRouteId={wf.selectedRouteId}
          onSelectRoute={wf.setSelectedRouteId}
          snapped={wf.result?.snapped ?? []}
          placing={wf.placing}
        />
      </div>

      {/* Collapse / expand toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "absolute top-3 z-[1100] flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/90 text-slate-300 shadow-lg backdrop-blur transition-all hover:text-white",
          collapsed ? "left-3" : "left-[412px]"
        )}
        title={collapsed ? "Show panel" : "Hide panel"}
        aria-label={collapsed ? "Show panel" : "Hide panel"}
      >
        <svg viewBox="0 0 24 24" className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          "absolute bottom-3 left-3 top-3 z-[1000] flex w-[400px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/92 shadow-2xl shadow-black/50 backdrop-blur transition-transform duration-200",
          collapsed && "-translate-x-[calc(100%+1rem)]"
        )}
      >
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400 text-slate-950">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19 10 5l4 9 6-9" />
              <circle cx="4" cy="19" r="1.4" fill="currentColor" />
              <circle cx="20" cy="5" r="1.4" fill="currentColor" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-tight tracking-tight">Wayfinder</h1>
            <p className="truncate text-[11px] text-slate-400">In-browser OSM routing · ALT + Yen's K-shortest · offline-capable</p>
          </div>
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              wf.online ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
            )}
            title={wf.online ? "Browser reports network connectivity" : "Browser is offline — only saved data can be used"}
          >
            {wf.online ? "online" : "offline"}
          </span>
        </header>

        <nav className="grid grid-cols-2 border-b border-slate-800 text-xs font-semibold">
          {(["plan", "saved"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-9 border-b-2 transition-colors",
                tab === t ? "border-amber-400 text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300"
              )}
            >
              {t === "plan" ? "Plan" : `Saved (${wf.savedCities.length + wf.savedRoutes.length})`}
            </button>
          ))}
        </nav>

        <div className="wf-scroll flex-1 overflow-y-auto">
          {tab === "plan" ? <PlanPanel wf={wf} /> : <SavedPanel wf={wf} />}
          <div className="px-4 py-3 text-[10px] leading-relaxed text-slate-500">
            Data © <a className="text-slate-400 underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>. Geocoding by{" "}
            <a className="text-slate-400 underline" href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a> (≤1 req/s). Road data via the{" "}
            <a className="text-slate-400 underline" href="https://wiki.openstreetmap.org/wiki/Overpass_API" target="_blank" rel="noreferrer">Overpass API</a>. All routing runs in your browser — no directions service is used.
          </div>
        </div>

        {/* Status footer */}
        {(wf.busy || wf.error) && (
          <footer className="border-t border-slate-800 px-4 py-3">
            {wf.busy && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Spinner className="text-amber-400" />
                  <span className="font-medium text-slate-100">{wf.busy.phase}</span>
                  {wf.busy.detail && <span className="ml-auto truncate font-mono text-[11px] text-slate-400">{wf.busy.detail}</span>}
                </div>
                <ProgressBar value={wf.busy.progress} indeterminate={wf.busy.progress === undefined} />
              </div>
            )}
            {wf.error && !wf.busy && (
              <Alert kind="error" onClose={() => wf.setError(null)}>
                {wf.error}
              </Alert>
            )}
          </footer>
        )}
      </aside>

      {/* Legend */}
      {wf.displayedRoutes.length > 0 && (
        <div className="absolute bottom-6 right-3 z-[1000] w-64 rounded-xl border border-slate-800 bg-slate-950/90 p-3 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{wf.viewingSaved ? "Saved route" : "Route legend"}</span>
            {wf.viewingSaved && (
              <button className="text-[11px] text-slate-400 hover:text-white" onClick={() => wf.resetPoints()}>
                close
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {wf.displayedRoutes.map((r) => {
              const sel = r.id === wf.selectedRouteId;
              return (
                <li
                  key={r.id}
                  onClick={() => wf.setSelectedRouteId(r.id)}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs", sel ? "bg-slate-800" : "hover:bg-slate-900")}
                >
                  <span className="h-1.5 w-6 shrink-0 rounded-full" style={{ background: r.color, opacity: sel ? 1 : 0.7 }} />
                  <span className={cn("flex-1 truncate", sel ? "text-slate-100" : "text-slate-300")}>{r.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">
                    {formatDuration(r.time)} · {formatDistance(r.distance)}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 border-t border-slate-800 pt-2 text-[10px] text-slate-500">Click a route or legend row to bring it forward.</div>
        </div>
      )}

      {/* Placing hint */}
      {wf.placing && wf.network && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full border border-amber-400/40 bg-slate-950/90 px-4 py-1.5 text-xs text-amber-200 shadow-lg backdrop-blur">
          Click inside the circle to place {wf.placing === "start" ? "the start (A)" : wf.placing === "end" ? "the destination (B)" : "a stop"} · Esc to cancel
        </div>
      )}
    </div>
  );
}
