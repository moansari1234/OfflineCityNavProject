import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SavedCity, SavedCityMeta, SavedRoute, SerializedGraph } from "./types";

/**
 * IndexedDB layout ("wayfinder-offline"):
 *  - cities : lightweight metadata per saved city/circle (listed on start-up)
 *  - graphs : the heavy typed-array road graph, keyed by the same id
 *  - routes : saved route geometries + metadata
 */
interface WayfinderDB extends DBSchema {
  cities: { key: string; value: SavedCityMeta; indexes: { byName: string } };
  graphs: { key: string; value: { id: string; graph: SerializedGraph } };
  routes: { key: number; value: SavedRoute; indexes: { byCity: string } };
}

let dbPromise: Promise<IDBPDatabase<WayfinderDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<WayfinderDB>("wayfinder-offline", 1, {
      upgrade(d) {
        const cities = d.createObjectStore("cities", { keyPath: "id" });
        cities.createIndex("byName", "name");
        d.createObjectStore("graphs", { keyPath: "id" });
        const routes = d.createObjectStore("routes", { keyPath: "id", autoIncrement: true });
        routes.createIndex("byCity", "cityId");
      },
    });
  }
  return dbPromise;
}

export function cityId(name: string, center: [number, number], radius: number) {
  return `${name.toLowerCase().trim()}|${center[0].toFixed(5)}|${center[1].toFixed(5)}|${Math.round(radius)}`;
}

export async function saveCity(city: SavedCity): Promise<void> {
  const d = await db();
  const { graph, ...meta } = city;
  const tx = d.transaction(["cities", "graphs"], "readwrite");
  await Promise.all([tx.objectStore("cities").put(meta), tx.objectStore("graphs").put({ id: city.id, graph }), tx.done]);
}

export async function listCities(): Promise<SavedCityMeta[]> {
  const d = await db();
  const all = await d.getAll("cities");
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getCity(id: string): Promise<SavedCity | undefined> {
  const d = await db();
  const [meta, g] = await Promise.all([d.get("cities", id), d.get("graphs", id)]);
  if (!meta || !g) return undefined;
  return { ...meta, graph: g.graph };
}

export async function findCitiesByName(name: string): Promise<SavedCityMeta[]> {
  const all = await listCities();
  const q = name.toLowerCase().trim();
  const first = q.split(",")[0].trim();
  return all.filter(
    (c) =>
      c.name.toLowerCase().includes(first) ||
      c.displayName.toLowerCase().includes(first) ||
      first.includes(c.name.toLowerCase())
  );
}

export async function deleteCity(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["cities", "graphs"], "readwrite");
  await Promise.all([tx.objectStore("cities").delete(id), tx.objectStore("graphs").delete(id), tx.done]);
}

export async function saveRoute(route: SavedRoute): Promise<number> {
  const d = await db();
  return d.add("routes", route);
}

export async function listRoutes(): Promise<SavedRoute[]> {
  const d = await db();
  const all = await d.getAll("routes");
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteRoute(id: number): Promise<void> {
  const d = await db();
  await d.delete("routes", id);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
