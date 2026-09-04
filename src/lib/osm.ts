import type { GeocodeResult } from "./types";

/* ------------------------------------------------------------------ */
/* Nominatim — geocoding. Public usage policy: max 1 request / second, */
/* identify the application, show attribution.                         */
/* ------------------------------------------------------------------ */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
let lastNominatimCall = 0;

async function respectNominatimRate() {
  const now = Date.now();
  const wait = 1100 - (now - lastNominatimCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();
}

export async function geocodeCity(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  await respectNominatimRate();
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    addressdetails: "0",
    "accept-language": "en",
  });
  let res: Response;
  try {
    res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      signal,
      headers: { Accept: "application/json" },
      referrerPolicy: "strict-origin-when-cross-origin",
    });
  } catch (e) {
    throw new Error("Network error while contacting Nominatim. Check your connection.");
  }
  if (res.status === 429) throw new Error("Nominatim rate limit hit — please wait a moment and retry.");
  if (!res.ok) throw new Error(`Nominatim responded with HTTP ${res.status}.`);
  const data = (await res.json()) as Array<{
    display_name: string;
    name?: string;
    lat: string;
    lon: string;
    boundingbox?: string[];
    type?: string;
    class?: string;
  }>;
  return data.map((d) => ({
    displayName: d.display_name,
    name: d.name || d.display_name.split(",")[0],
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
    boundingBox: d.boundingbox
      ? [
          parseFloat(d.boundingbox[0]),
          parseFloat(d.boundingbox[1]),
          parseFloat(d.boundingbox[2]),
          parseFloat(d.boundingbox[3]),
        ]
      : undefined,
  }));
}

/* ------------------------------------------------------------------ */
/* Overpass — road network download                                    */
/* ------------------------------------------------------------------ */

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const DRIVING_HIGHWAYS = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
  "living_street",
  "road",
];

export function buildOverpassQuery(lat: number, lng: number, radius: number): string {
  const r = Math.round(radius);
  const regex = `^(${DRIVING_HIGHWAYS.join("|")})$`;
  // Include service roads only when the circle is small — they bloat large downloads.
  const serviceClause =
    radius <= 4000
      ? `way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"](around:${r},${lat},${lng});`
      : "";
  return `[out:json][timeout:180][maxsize:536870912];
(
  way["highway"~"${regex}"]["area"!="yes"](around:${r},${lat},${lng});
  ${serviceClause}
);
(._;>;);
out body qt;`;
}

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

export async function downloadRoadNetwork(
  lat: number,
  lng: number,
  radius: number,
  onProgress: (bytes: number, endpoint: string) => void,
  signal?: AbortSignal
): Promise<{ text: string; bytes: number; endpoint: string }> {
  const query = buildOverpassQuery(lat, lng, radius);
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) throw new Error("Download cancelled.");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal,
      });
      if (res.status === 429) {
        lastError = new Error(`Overpass (${new URL(endpoint).host}) is rate-limiting requests.`);
        continue;
      }
      if (res.status === 504 || res.status === 502 || res.status === 503) {
        lastError = new Error(`Overpass (${new URL(endpoint).host}) is overloaded (HTTP ${res.status}).`);
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        lastError = new Error(`Overpass responded HTTP ${res.status}: ${t.slice(0, 200)}`);
        continue;
      }
      if (!res.body) {
        const text = await res.text();
        return { text, bytes: text.length, endpoint };
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          bytes += value.byteLength;
          onProgress(bytes, endpoint);
        }
      }
      const merged = new Uint8Array(bytes);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      const text = new TextDecoder().decode(merged);
      return { text, bytes, endpoint };
    } catch (e) {
      if (signal?.aborted) throw new Error("Download cancelled.");
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed.");
}
