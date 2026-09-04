import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { destinationPoint, fastDistance, formatDistance } from "@/lib/geo";
import type { CircleArea, LatLng, RouteResult } from "@/lib/types";

export type PointKind = "start" | "stop" | "end";

interface MapViewProps {
  view: { center: LatLng; zoom: number; key: number } | null;
  circle: CircleArea | null;
  circleLocked: boolean;
  onCircleChange: (c: CircleArea) => void;
  start: LatLng | null;
  end: LatLng | null;
  stops: LatLng[];
  order: number[] | null;
  onMapClick: (ll: LatLng) => void;
  onMovePoint: (kind: PointKind, index: number, ll: LatLng) => void;
  routes: RouteResult[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  snapped: { input: LatLng; node: LatLng; distance: number }[];
  placing: PointKind | null;
}

function pinIcon(kind: PointKind, label: string) {
  const bg = kind === "start" ? "#10b981" : kind === "end" ? "#ef4444" : "#f8fafc";
  const fg = kind === "stop" ? "#0f172a" : "#ffffff";
  return L.divIcon({
    className: "",
    html: `<div class="wf-pin" style="--bg:${bg};--fg:${fg}"><span>${label}</span></div>`,
    iconSize: [28, 38],
    iconAnchor: [14, 36],
  });
}

const centerIcon = L.divIcon({
  className: "",
  html: `<div class="wf-handle wf-handle-center" title="Drag to move search area"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
const radiusIcon = L.divIcon({
  className: "",
  html: `<div class="wf-handle wf-handle-radius" title="Drag to resize radius"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ViewController({ view }: { view: MapViewProps["view"] }) {
  const map = useMap();
  const last = useRef(-1);
  useEffect(() => {
    if (view && view.key !== last.current) {
      last.current = view.key;
      map.flyTo(view.center, view.zoom, { duration: 1.1 });
    }
  }, [view, map]);
  return null;
}

function ClickHandler({ onClick, placing }: { onClick: (ll: LatLng) => void; placing: PointKind | null }) {
  const map = useMapEvents({
    click(e) {
      onClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = placing ? "crosshair" : "";
  }, [placing, map]);
  return null;
}

function FitRoutes({ routes }: { routes: RouteResult[] }) {
  const map = useMap();
  const sig = routes.map((r) => r.id).join("|");
  useEffect(() => {
    if (!routes.length) return;
    const b = L.latLngBounds(routes.flatMap((r) => r.geometry));
    if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [440, 40], paddingBottomRight: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  return null;
}

export function MapView(p: MapViewProps) {
  const computedHandle = useMemo<LatLng | null>(
    () => (p.circle ? destinationPoint(p.circle.center[0], p.circle.center[1], 90, p.circle.radius) : null),
    [p.circle]
  );
  // While the user drags the radius handle we must not push a new position
  // prop into the marker (it would snap back to due-east every frame).
  const [draggingHandle, setDraggingHandle] = useState(false);
  const frozenHandle = useRef<LatLng | null>(null);
  const radiusHandle = draggingHandle ? frozenHandle.current : computedHandle;

  const orderedRoutes = useMemo(() => {
    const sel = p.routes.find((r) => r.id === p.selectedRouteId);
    const rest = p.routes.filter((r) => r.id !== p.selectedRouteId);
    return sel ? [...rest.slice().reverse(), sel] : rest.slice().reverse();
  }, [p.routes, p.selectedRouteId]);

  const stopLabel = (i: number) => {
    if (!p.order) return `${i + 1}`;
    const pos = p.order.indexOf(i + 1);
    return pos > 0 ? `${pos}` : `${i + 1}`;
  };

  return (
    <MapContainer center={[17.385, 78.4867]} zoom={5} zoomControl={false} className="h-full w-full bg-slate-900" preferCanvas>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Geocoding by <a href="https://nominatim.org">Nominatim</a> · Data via <a href="https://overpass-api.de">Overpass API</a>'
        maxZoom={19}
      />
      <ViewController view={p.view} />
      <ClickHandler onClick={p.onMapClick} placing={p.placing} />
      <FitRoutes routes={p.routes} />

      {p.circle && (
        <>
          <Circle
            center={p.circle.center}
            radius={p.circle.radius}
            pathOptions={{
              color: p.circleLocked ? "#fbbf24" : "#38bdf8",
              weight: 2,
              dashArray: p.circleLocked ? undefined : "6 6",
              fillColor: p.circleLocked ? "#fbbf24" : "#38bdf8",
              fillOpacity: 0.06,
              interactive: false,
            }}
          />
          {!p.circleLocked && (
            <>
              <Marker
                position={p.circle.center}
                icon={centerIcon}
                draggable
                zIndexOffset={500}
                eventHandlers={{
                  drag: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    p.onCircleChange({ center: [ll.lat, ll.lng], radius: p.circle!.radius });
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                  Drag to move · radius {formatDistance(p.circle.radius)}
                </Tooltip>
              </Marker>
              {radiusHandle && (
                <Marker
                  position={radiusHandle}
                  icon={radiusIcon}
                  draggable
                  zIndexOffset={500}
                  eventHandlers={{
                    dragstart: () => {
                      frozenHandle.current = radiusHandle;
                      setDraggingHandle(true);
                    },
                    drag: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      const c = p.circle!.center;
                      const r = fastDistance(c[0], c[1], ll.lat, ll.lng);
                      p.onCircleChange({ center: c, radius: Math.max(300, Math.min(15000, r)) });
                    },
                    dragend: () => setDraggingHandle(false),
                  }}
                >
                  <Tooltip direction="right" offset={[10, 0]} opacity={0.9} permanent>
                    {formatDistance(p.circle.radius)}
                  </Tooltip>
                </Marker>
              )}
            </>
          )}
        </>
      )}

      {/* snap connectors */}
      {p.snapped.map((s, i) =>
        s.distance > 15 ? (
          <Polyline key={`snap-${i}`} positions={[s.input, s.node]} pathOptions={{ color: "#64748b", weight: 2, dashArray: "3 5", interactive: false }} />
        ) : null
      )}

      {/* routes: casing then color, unselected dimmed */}
      {orderedRoutes.map((r) => {
        const selected = r.id === p.selectedRouteId;
        return (
          <Polyline
            key={`case-${r.id}`}
            positions={r.geometry}
            pathOptions={{ color: "#0f172a", weight: selected ? 10 : 7, opacity: selected ? 0.55 : 0.25, interactive: false, lineCap: "round", lineJoin: "round" }}
          />
        );
      })}
      {orderedRoutes.map((r) => {
        const selected = r.id === p.selectedRouteId;
        return (
          <Polyline
            key={r.id}
            positions={r.geometry}
            pathOptions={{ color: r.color, weight: selected ? 6 : 4, opacity: selected ? 1 : 0.55, lineCap: "round", lineJoin: "round" }}
            eventHandlers={{ click: () => p.onSelectRoute(r.id) }}
          >
            <Tooltip sticky opacity={0.95}>
              <b>{r.label}</b> · {formatDistance(r.distance)}
            </Tooltip>
          </Polyline>
        );
      })}

      {p.start && (
        <Marker
          position={p.start}
          icon={pinIcon("start", "A")}
          draggable
          zIndexOffset={1000}
          eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); p.onMovePoint("start", 0, [ll.lat, ll.lng]); } }}
        />
      )}
      {p.stops.map((s, i) => (
        <Marker
          key={`stop-${i}`}
          position={s}
          icon={pinIcon("stop", stopLabel(i))}
          draggable
          zIndexOffset={900}
          eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); p.onMovePoint("stop", i, [ll.lat, ll.lng]); } }}
        />
      ))}
      {p.end && (
        <Marker
          position={p.end}
          icon={pinIcon("end", "B")}
          draggable
          zIndexOffset={1000}
          eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); p.onMovePoint("end", 0, [ll.lat, ll.lng]); } }}
        />
      )}
    </MapContainer>
  );
}
