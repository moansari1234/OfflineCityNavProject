import { formatBytes, formatDistance, formatDuration } from "@/lib/geo";
import type { Wayfinder } from "@/hooks/useWayfinder";
import { cn } from "@/utils/cn";
import { Button } from "./ui";

export function SavedPanel({ wf }: { wf: Wayfinder }) {
  const isBusy = !!wf.busy;
  return (
    <div className="space-y-6 px-4 py-4">
      <section>
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-200">Offline city data</h2>
          <span className="text-[11px] text-slate-500">{wf.savedCities.length} saved</span>
        </header>
        {wf.savedCities.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
            No road networks saved yet. Download a city, then press “Save city data for offline use”.
          </p>
        )}
        <ul className="space-y-1.5">
          {wf.savedCities.map((c) => {
            const active = wf.network?.id === c.id;
            return (
              <li key={c.id} className={cn("rounded-md border px-3 py-2", active ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-800 bg-slate-900/40")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100">{c.name}</div>
                    <div className="truncate text-[11px] text-slate-400" title={c.displayName}>
                      {c.displayName}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {formatDistance(c.radius)} radius · {c.stats.nodeCount.toLocaleString()} nodes · {c.stats.edgeCount.toLocaleString()} edges ·{" "}
                      {formatBytes(c.rawBytes)} raw · {new Date(c.savedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" variant={active ? "subtle" : "primary"} disabled={isBusy || active} onClick={() => void wf.loadSavedCity(c)}>
                      {active ? "Loaded" : "Load"}
                    </Button>
                    <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void wf.deleteSavedCity(c.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-200">Saved routes</h2>
          <span className="text-[11px] text-slate-500">{wf.savedRoutes.length} saved</span>
        </header>
        {wf.savedRoutes.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
            No routes saved. Compute routes, select one and press “Save route offline”.
          </p>
        )}
        <ul className="space-y-1.5">
          {wf.savedRoutes.map((s) => {
            const viewing = wf.viewingSaved?.id === s.id;
            return (
              <li
                key={s.id}
                className={cn(
                  "cursor-pointer rounded-md border px-3 py-2 transition-colors",
                  viewing ? "border-slate-500 bg-slate-800" : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                )}
                style={{ borderLeftColor: s.route.color, borderLeftWidth: 4 }}
                onClick={() => wf.viewSavedRoute(s)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100">{s.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {s.cityName} · {s.points.length - 2 > 0 ? `${s.points.length - 2} stop${s.points.length - 2 > 1 ? "s" : ""} (${s.mode})` : "direct"} ·{" "}
                      {new Date(s.savedAt).toLocaleString()}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-300">
                      <b>{formatDuration(s.route.time)}</b> · {formatDistance(s.route.distance)} · {s.route.turns} turns
                      {s.route.signals > 0 && ` · ${s.route.signals} signals`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s.id !== undefined) void wf.deleteSavedRoute(s.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {wf.storage && wf.storage.quota > 0 && (
        <div className="text-[11px] text-slate-500">
          Browser storage: {formatBytes(wf.storage.usage)} used of {formatBytes(wf.storage.quota)} available (IndexedDB “wayfinder-offline”).
        </div>
      )}
    </div>
  );
}
