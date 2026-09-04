import type { OverpassElement } from "./osm";
import type { GraphStats, SerializedGraph, WorkerProgress } from "./types";
import { bearing, fastDistance, haversine } from "./geo";
import { MinHeap } from "./heap";

export const ROAD_CLASSES = [
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
  "service",
  "road",
];

// Default free-flow speeds (km/h) by class when no maxspeed tag is present.
const DEFAULT_SPEED: Record<string, number> = {
  motorway: 80,
  trunk: 65,
  primary: 50,
  secondary: 45,
  tertiary: 40,
  unclassified: 35,
  residential: 30,
  motorway_link: 60,
  trunk_link: 50,
  primary_link: 40,
  secondary_link: 35,
  tertiary_link: 30,
  living_street: 15,
  service: 20,
  road: 30,
};

export const MAX_SPEED_KMH = 80;
export const MAX_SPEED_MS = MAX_SPEED_KMH / 3.6;

function parseMaxspeed(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const m = v.match(/(\d+(\.\d+)?)/);
  if (!m) return fallback;
  let kmh = parseFloat(m[1]);
  if (/mph/i.test(v)) kmh *= 1.609;
  if (kmh <= 0 || kmh > 130) return fallback;
  return kmh;
}

type ProgressFn = (p: WorkerProgress) => void;

interface WayInfo {
  id: number;
  nodes: number[];
  classIdx: number;
  speedMs: number;
  oneway: 0 | 1 | -1;
  name: string | null;
}

export function buildGraph(
  elements: OverpassElement[],
  center: [number, number],
  radius: number,
  onProgress: ProgressFn
): { graph: SerializedGraph; stats: GraphStats } {
  onProgress({ phase: "Indexing OSM nodes", progress: 0 });

  // --- 1. index nodes ------------------------------------------------------
  const nodeLatMap = new Map<number, number>();
  const nodeLngMap = new Map<number, number>();
  const signalSet = new Set<number>();
  const insideSet = new Set<number>();
  const ways: WayInfo[] = [];
  let nodeElems = 0;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      nodeLatMap.set(el.id, el.lat);
      nodeLngMap.set(el.id, el.lon);
      if (el.tags?.highway === "traffic_signals" || el.tags?.crossing === "traffic_signals") {
        signalSet.add(el.id);
      }
      if (haversine(center[0], center[1], el.lat, el.lon) <= radius) insideSet.add(el.id);
      nodeElems++;
    } else if (el.type === "way" && el.nodes && el.tags) {
      const t = el.tags;
      const hw = t.highway;
      if (!hw) continue;
      const classIdx = ROAD_CLASSES.indexOf(hw);
      if (classIdx < 0) continue;
      if (t.area === "yes") continue;
      // access restrictions relevant to motor vehicles
      const access = t.motor_vehicle ?? t.motorcar ?? t.vehicle ?? t.access;
      if (access && /^(no|private|customers|delivery|agricultural|forestry|military)$/.test(access)) {
        if (!(t.motor_vehicle === "yes" || t.motorcar === "yes")) continue;
      }
      let oneway: 0 | 1 | -1 = 0;
      const ow = t.oneway;
      if (ow === "yes" || ow === "1" || ow === "true") oneway = 1;
      else if (ow === "-1" || ow === "reverse") oneway = -1;
      else if (t.junction === "roundabout" || t.junction === "circular") oneway = 1;
      if (hw === "motorway" && ow === undefined) oneway = 1;
      const speed = parseMaxspeed(t.maxspeed, DEFAULT_SPEED[hw] ?? 30);
      ways.push({
        id: el.id,
        nodes: el.nodes,
        classIdx,
        speedMs: speed / 3.6,
        oneway,
        name: t.name ?? t.ref ?? null,
      });
    }
    if ((i & 0x3fff) === 0) onProgress({ phase: "Indexing OSM nodes", progress: (i / elements.length) * 0.25 });
  }

  // --- 2. count node usage to find intersections ---------------------------
  onProgress({ phase: "Detecting intersections", progress: 0.25 });
  const usage = new Map<number, number>();
  for (const w of ways) {
    for (const n of w.nodes) usage.set(n, (usage.get(n) ?? 0) + 1);
  }

  // --- 3. build edges ------------------------------------------------------
  onProgress({ phase: "Building road segments", progress: 0.3 });
  const osmToIdx = new Map<number, number>();
  const nLat: number[] = [];
  const nLng: number[] = [];
  const nOsm: number[] = [];
  const nSig: number[] = [];
  const getNodeIdx = (osmId: number): number => {
    let idx = osmToIdx.get(osmId);
    if (idx === undefined) {
      idx = nLat.length;
      osmToIdx.set(osmId, idx);
      nLat.push(nodeLatMap.get(osmId)!);
      nLng.push(nodeLngMap.get(osmId)!);
      nOsm.push(osmId);
      nSig.push(signalSet.has(osmId) ? 1 : 0);
    }
    return idx;
  };

  const eFrom: number[] = [];
  const eTo: number[] = [];
  const eLen: number[] = [];
  const eTime: number[] = [];
  const eSig: number[] = [];
  const eSB: number[] = [];
  const eEB: number[] = [];
  const eWay: number[] = [];
  const eClass: number[] = [];
  const eName: number[] = [];
  const gOff: number[] = [0];
  const gCoords: number[] = [];
  const wayNames: string[] = [];
  const nameIdx = new Map<string, number>();
  let totalLen = 0;

  const pushEdge = (
    run: number[], // osm node ids of the segment, from -> to
    w: WayInfo,
    nameId: number
  ) => {
    const from = getNodeIdx(run[0]);
    const to = getNodeIdx(run[run.length - 1]);
    if (from === to && run.length < 3) return;
    let len = 0;
    let sig = 0;
    for (let i = 0; i < run.length; i++) {
      const lat = nodeLatMap.get(run[i])!;
      const lng = nodeLngMap.get(run[i])!;
      if (i > 0) {
        len += fastDistance(nodeLatMap.get(run[i - 1])!, nodeLngMap.get(run[i - 1])!, lat, lng);
        if (signalSet.has(run[i])) sig++;
      }
      gCoords.push(lat, lng);
    }
    if (len <= 0) len = 0.1;
    const sb = bearing(
      nodeLatMap.get(run[0])!,
      nodeLngMap.get(run[0])!,
      nodeLatMap.get(run[1])!,
      nodeLngMap.get(run[1])!
    );
    const eb = bearing(
      nodeLatMap.get(run[run.length - 2])!,
      nodeLngMap.get(run[run.length - 2])!,
      nodeLatMap.get(run[run.length - 1])!,
      nodeLngMap.get(run[run.length - 1])!
    );
    eFrom.push(from);
    eTo.push(to);
    eLen.push(len);
    // Add small intersection delay per signal to time estimate
    eTime.push(len / w.speedMs + sig * 20);
    eSig.push(sig);
    eSB.push(sb);
    eEB.push(eb);
    eWay.push(w.id);
    eClass.push(w.classIdx);
    eName.push(nameId);
    gOff.push(gCoords.length / 2);
    totalLen += len;
  };

  for (let wi = 0; wi < ways.length; wi++) {
    const w = ways[wi];
    let nameId = -1;
    if (w.name) {
      const existing = nameIdx.get(w.name);
      if (existing === undefined) {
        nameId = wayNames.length;
        wayNames.push(w.name);
        nameIdx.set(w.name, nameId);
      } else nameId = existing;
    }
    // Split into runs of consecutive nodes that exist and lie inside the circle.
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        // break run at intersections
        let seg: number[] = [run[0]];
        for (let i = 1; i < run.length; i++) {
          seg.push(run[i]);
          const isLast = i === run.length - 1;
          if (isLast || (usage.get(run[i]) ?? 0) > 1) {
            if (w.oneway >= 0) pushEdge(seg, w, nameId);
            if (w.oneway <= 0) pushEdge([...seg].reverse(), w, nameId);
            seg = [run[i]];
          }
        }
      }
      run = [];
    };
    for (const n of w.nodes) {
      if (nodeLatMap.has(n) && insideSet.has(n)) run.push(n);
      else flush();
    }
    flush();
    if ((wi & 0x3ff) === 0)
      onProgress({ phase: "Building road segments", progress: 0.3 + (wi / ways.length) * 0.35 });
  }

  const nodeCount = nLat.length;
  const edgeCount = eFrom.length;
  if (nodeCount === 0 || edgeCount === 0) {
    throw new Error("No drivable roads found inside the circle. Try a larger radius or different center.");
  }

  // --- 4. CSR adjacency ----------------------------------------------------
  onProgress({ phase: "Compacting adjacency", progress: 0.66 });
  const outOffsets = new Int32Array(nodeCount + 1);
  const inOffsets = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    outOffsets[eFrom[e] + 1]++;
    inOffsets[eTo[e] + 1]++;
  }
  for (let i = 0; i < nodeCount; i++) {
    outOffsets[i + 1] += outOffsets[i];
    inOffsets[i + 1] += inOffsets[i];
  }
  const outEdges = new Int32Array(edgeCount);
  const inEdges = new Int32Array(edgeCount);
  const outFill = outOffsets.slice(0, nodeCount);
  const inFill = inOffsets.slice(0, nodeCount);
  for (let e = 0; e < edgeCount; e++) {
    outEdges[outFill[eFrom[e]]++] = e;
    inEdges[inFill[eTo[e]]++] = e;
  }

  const graph: SerializedGraph = {
    nodeCount,
    edgeCount,
    nodeLat: Float64Array.from(nLat),
    nodeLng: Float64Array.from(nLng),
    nodeOsmId: Float64Array.from(nOsm),
    nodeSignal: Uint8Array.from(nSig),
    outOffsets,
    outEdges,
    inOffsets,
    inEdges,
    edgeFrom: Int32Array.from(eFrom),
    edgeTo: Int32Array.from(eTo),
    edgeLength: Float32Array.from(eLen),
    edgeTime: Float32Array.from(eTime),
    edgeSignals: Uint8Array.from(eSig.map((s) => Math.min(255, s))),
    edgeStartBearing: Float32Array.from(eSB),
    edgeEndBearing: Float32Array.from(eEB),
    edgeWayId: Float64Array.from(eWay),
    edgeClass: Uint8Array.from(eClass),
    geomOffsets: Int32Array.from(gOff),
    geomCoords: Float64Array.from(gCoords),
    hasTrafficSignals: false,
    wayNames,
    edgeName: Int32Array.from(eName),
    landmarkCount: 0,
    landmarkNodes: new Int32Array(0),
    landmarkFrom: new Float32Array(0),
    landmarkTo: new Float32Array(0),
  };

  const distinctSignals = countDistinctSignals(elements, insideSet);
  graph.hasTrafficSignals = distinctSignals > 0;

  // --- 5. ALT landmarks ----------------------------------------------------
  onProgress({ phase: "Preprocessing landmarks (ALT)", progress: 0.72 });
  computeLandmarks(graph, (p) => onProgress({ phase: "Preprocessing landmarks (ALT)", progress: 0.72 + p * 0.28 }));

  const stats: GraphStats = {
    nodeCount,
    edgeCount,
    totalRoadKm: totalLen / 2 / 1000, // most edges are bidirectional; approximate directed→undirected
    signalCount: distinctSignals,
    hasTrafficSignals: distinctSignals > 0,
    wayCount: ways.length,
  };
  void nodeElems;
  onProgress({ phase: "Graph ready", progress: 1 });
  return { graph, stats };
}

function countDistinctSignals(elements: OverpassElement[], inside: Set<number>): number {
  let c = 0;
  for (const el of elements) {
    if (el.type === "node" && inside.has(el.id) && el.tags?.highway === "traffic_signals") c++;
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* Landmark preprocessing for ALT                                      */
/* ------------------------------------------------------------------ */

function dijkstraDistances(g: SerializedGraph, source: number, reverse: boolean, out: Float32Array, offset: number) {
  const n = g.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(4096);
  dist[source] = 0;
  heap.push(0, source);
  const offsets = reverse ? g.inOffsets : g.outOffsets;
  const edges = reverse ? g.inEdges : g.outEdges;
  const other = reverse ? g.edgeFrom : g.edgeTo;
  const len = g.edgeLength;
  while (heap.size > 0) {
    const u = heap.pop();
    const d = heap.lastKey;
    if (d > dist[u]) continue;
    for (let i = offsets[u]; i < offsets[u + 1]; i++) {
      const e = edges[i];
      const v = other[e];
      const nd = d + len[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        heap.push(nd, v);
      }
    }
  }
  for (let i = 0; i < n; i++) out[offset + i] = dist[i];
  return dist;
}

export function computeLandmarks(g: SerializedGraph, onProgress: (p: number) => void) {
  const n = g.nodeCount;
  const k = n < 2000 ? 4 : n < 20000 ? 8 : 12;
  // Start from the node closest to the centroid so we stay in the main component.
  let cLat = 0;
  let cLng = 0;
  for (let i = 0; i < n; i++) {
    cLat += g.nodeLat[i];
    cLng += g.nodeLng[i];
  }
  cLat /= n;
  cLng /= n;
  let seed = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = fastDistance(cLat, cLng, g.nodeLat[i], g.nodeLng[i]);
    if (d < best) {
      best = d;
      seed = i;
    }
  }
  const landmarkNodes: number[] = [];
  const from = new Float32Array(k * n);
  const to = new Float32Array(k * n);
  const minDist = new Float64Array(n).fill(Infinity);
  const isLandmark = new Uint8Array(n);

  const farthest = (d: ArrayLike<number>): number => {
    let far = -1;
    let farD = -1;
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (v !== Infinity && v > farD && !isLandmark[i]) {
        farD = v;
        far = i;
      }
    }
    return far;
  };

  // Farthest-point landmark selection (forward distances), storing the
  // forward table as a by-product of the selection sweep.
  const scratch = new Float32Array(n);
  const seedDist = dijkstraDistances(g, seed, false, scratch, 0);
  let current = farthest(seedDist);
  if (current < 0) current = seed;
  for (let li = 0; li < k; li++) {
    landmarkNodes.push(current);
    isLandmark[current] = 1;
    const d = dijkstraDistances(g, current, false, from, li * n);
    for (let i = 0; i < n; i++) if (d[i] < minDist[i]) minDist[i] = d[i];
    const far = farthest(minDist);
    onProgress(((li + 1) / k) * 0.5);
    if (far < 0) break;
    current = far;
  }

  for (let li = 0; li < landmarkNodes.length; li++) {
    dijkstraDistances(g, landmarkNodes[li], true, to, li * n);
    onProgress(0.5 + ((li + 1) / landmarkNodes.length) * 0.5);
  }
  g.landmarkCount = landmarkNodes.length;
  g.landmarkNodes = Int32Array.from(landmarkNodes);
  g.landmarkFrom = from.subarray(0, landmarkNodes.length * n).slice();
  g.landmarkTo = to.subarray(0, landmarkNodes.length * n).slice();
}
