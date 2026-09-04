import { angleDiff, fastDistance } from "./geo";
import { MAX_SPEED_MS } from "./graph";
import { MinHeap } from "./heap";
import type { SerializedGraph } from "./types";

/**
 * Cost model. A route's cost is:
 *   Σ_edges ( dist·length + time·travelTime + signal·signalsOnEdge + [turn if heading changes > TURN_DEG] )
 * All weights are ≥ 0 so a landmark lower bound on *distance* scaled by
 * (dist + time / MAX_SPEED) remains an admissible & consistent heuristic.
 */
export interface Weights {
  dist: number; // per meter
  time: number; // per second
  turn: number; // per turn
  signal: number; // per traffic signal
}

export const TURN_DEG = 40;
const UTURN_DEG = 165;

export interface Path {
  edges: number[];
  cost: number;
}

export interface SearchOptions {
  prevEdge?: number; // edge we arrived on at the source (for turn cost continuity)
  bannedEdges?: Uint8Array | null;
  bannedNodes?: Uint8Array | null;
  penalty?: Float32Array | null; // multiplicative per-edge penalty ≥ 1
}

export class Router {
  readonly g: SerializedGraph;
  private gCost: Float64Array;
  private parent: Int32Array;
  private stamp: Int32Array;
  private closed: Uint8Array;
  private hCache: Float64Array;
  private hStamp: Int32Array;
  private heap = new MinHeap(8192);
  private gen = 0;
  /** Number of states settled in the last search — for diagnostics. */
  lastSettled = 0;

  constructor(g: SerializedGraph) {
    this.g = g;
    this.gCost = new Float64Array(g.edgeCount);
    this.parent = new Int32Array(g.edgeCount);
    this.stamp = new Int32Array(g.edgeCount);
    this.closed = new Uint8Array(g.edgeCount);
    this.hCache = new Float64Array(g.nodeCount);
    this.hStamp = new Int32Array(g.nodeCount);
  }

  /** ALT lower bound on road distance (meters) from v to t. */
  private lowerBound(v: number, t: number): number {
    const g = this.g;
    const n = g.nodeCount;
    let h = fastDistance(g.nodeLat[v], g.nodeLng[v], g.nodeLat[t], g.nodeLng[t]);
    const lf = g.landmarkFrom;
    const lt = g.landmarkTo;
    for (let l = 0; l < g.landmarkCount; l++) {
      const base = l * n;
      const toV = lt[base + v];
      const toT = lt[base + t];
      if (toV !== Infinity && toT !== Infinity) {
        const a = toV - toT;
        if (a > h) h = a;
      }
      const fromV = lf[base + v];
      const fromT = lf[base + t];
      if (fromV !== Infinity && fromT !== Infinity) {
        const b = fromT - fromV;
        if (b > h) h = b;
      }
    }
    return h;
  }

  edgeCost(e: number, prev: number, w: Weights, penalty: Float32Array | null | undefined): number {
    const g = this.g;
    let c = w.dist * g.edgeLength[e] + w.time * g.edgeTime[e] + w.signal * g.edgeSignals[e];
    if (prev >= 0) {
      const d = Math.abs(angleDiff(g.edgeEndBearing[prev], g.edgeStartBearing[e]));
      const isUturn = (g.edgeFrom[prev] === g.edgeTo[e] && g.edgeTo[prev] === g.edgeFrom[e]) || d > UTURN_DEG;
      if (isUturn) c += w.dist * 600 + w.time * 120 + w.turn * 3;
      else if (d > TURN_DEG) c += w.turn;
    }
    if (penalty) c *= penalty[e];
    return c;
  }

  pathCost(edges: number[], w: Weights, penalty?: Float32Array | null, prevEdge = -1): number {
    let c = 0;
    let prev = prevEdge;
    for (const e of edges) {
      c += this.edgeCost(e, prev, w, penalty);
      prev = e;
    }
    return c;
  }

  /**
   * Edge-based A* with ALT heuristic. State = "arrived at edgeTo[e] via e",
   * which allows exact turn penalties. Returns the edge sequence or null.
   */
  search(s: number, t: number, w: Weights, opts: SearchOptions = {}): Path | null {
    if (s === t) return { edges: [], cost: 0 };
    const g = this.g;
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    const { gCost, parent, stamp, closed, hCache, hStamp } = this;
    const banE = opts.bannedEdges ?? null;
    const banN = opts.bannedNodes ?? null;
    const pen = opts.penalty ?? null;
    const prev0 = opts.prevEdge ?? -1;
    const hFactor = w.dist + w.time / MAX_SPEED_MS;

    const heuristic = (v: number): number => {
      if (hStamp[v] === gen) return hCache[v];
      const h = hFactor > 0 ? this.lowerBound(v, t) * hFactor : 0;
      hCache[v] = h;
      hStamp[v] = gen;
      return h;
    };

    const relax = (e: number, prev: number, base: number) => {
      if (banE && banE[e]) return;
      const v = g.edgeTo[e];
      if (banN && banN[v] && v !== t) return;
      const nc = base + this.edgeCost(e, prev, w, pen);
      if (stamp[e] === gen) {
        if (closed[e] || nc >= gCost[e]) return;
      } else {
        stamp[e] = gen;
        closed[e] = 0;
      }
      gCost[e] = nc;
      parent[e] = prev;
      heap.push(nc + heuristic(v), e);
    };

    for (let i = g.outOffsets[s]; i < g.outOffsets[s + 1]; i++) relax(g.outEdges[i], prev0, 0);

    let settled = 0;
    let goal = -1;
    while (heap.size > 0) {
      const e = heap.pop();
      if (closed[e]) continue;
      closed[e] = 1;
      settled++;
      const u = g.edgeTo[e];
      if (u === t) {
        goal = e;
        break;
      }
      const base = gCost[e];
      for (let i = g.outOffsets[u]; i < g.outOffsets[u + 1]; i++) relax(g.outEdges[i], e, base);
    }
    this.lastSettled = settled;
    if (goal < 0) return null;
    const edges: number[] = [];
    let e = goal;
    while (e >= 0 && e !== prev0) {
      edges.push(e);
      e = parent[e];
      if (e === prev0) break;
    }
    edges.reverse();
    return { edges, cost: gCost[goal] };
  }

  /**
   * Yen's K-shortest simple paths on top of the ALT search.
   * For very long root paths we sample spur nodes uniformly (MAX_SPUR) to
   * bound the number of sub-searches; a wall-clock budget also applies.
   */
  yen(
    s: number,
    t: number,
    w: Weights,
    K: number,
    budgetMs: number,
    penalty?: Float32Array | null
  ): { paths: Path[]; truncated: boolean } {
    const g = this.g;
    const first = this.search(s, t, w, { penalty });
    if (!first) return { paths: [], truncated: false };
    const A: Path[] = [first];
    const B: Path[] = [];
    const seen = new Set<string>([first.edges.join(",")]);
    const bannedEdges = new Uint8Array(g.edgeCount);
    const bannedNodes = new Uint8Array(g.nodeCount);
    const MAX_SPUR = 48;
    const start = performance.now();
    let truncated = false;

    outer: for (let k = 1; k < K; k++) {
      const prev = A[k - 1].edges;
      const L = prev.length;
      const step = L > MAX_SPUR ? L / MAX_SPUR : 1;
      for (let fi = 0; fi < L; fi += step) {
        const i = Math.floor(fi);
        if (performance.now() - start > budgetMs) {
          truncated = true;
          break outer;
        }
        const spurNode = i === 0 ? g.edgeFrom[prev[0]] : g.edgeTo[prev[i - 1]];
        const root = prev.slice(0, i);
        bannedEdges.fill(0);
        bannedNodes.fill(0);
        for (const p of A) {
          if (p.edges.length > i && sharesPrefix(p.edges, root, i)) bannedEdges[p.edges[i]] = 1;
        }
        // Ban root path nodes (except spur node) to keep paths simple.
        if (i > 0) {
          bannedNodes[g.edgeFrom[root[0]]] = 1;
          for (let j = 0; j < i - 1; j++) bannedNodes[g.edgeTo[root[j]]] = 1;
        }
        const spur = this.search(spurNode, t, w, {
          prevEdge: i > 0 ? prev[i - 1] : -1,
          bannedEdges,
          bannedNodes,
          penalty,
        });
        if (!spur) continue;
        const total = root.concat(spur.edges);
        const key = total.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        B.push({ edges: total, cost: this.pathCost(total, w, penalty) });
      }
      if (B.length === 0) break;
      B.sort((a, b) => a.cost - b.cost);
      A.push(B.shift()!);
    }
    return { paths: A, truncated };
  }

  /* ---------------- metrics & helpers ---------------- */

  pathLength(edges: number[]): number {
    let d = 0;
    for (const e of edges) d += this.g.edgeLength[e];
    return d;
  }
  pathTime(edges: number[]): number {
    let d = 0;
    for (const e of edges) d += this.g.edgeTime[e];
    return d;
  }
  pathSignals(edges: number[]): number {
    let d = 0;
    for (const e of edges) d += this.g.edgeSignals[e];
    return d;
  }
  pathTurns(edges: number[]): number {
    const g = this.g;
    let turns = 0;
    for (let i = 1; i < edges.length; i++) {
      const d = Math.abs(angleDiff(g.edgeEndBearing[edges[i - 1]], g.edgeStartBearing[edges[i]]));
      if (d > TURN_DEG) turns++;
    }
    return turns;
  }
  pathGeometry(edges: number[]): [number, number][] {
    const g = this.g;
    const out: [number, number][] = [];
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k];
      const a = g.geomOffsets[e];
      const b = g.geomOffsets[e + 1];
      for (let i = a; i < b; i++) {
        if (k > 0 && i === a) continue; // skip duplicate join point
        out.push([g.geomCoords[i * 2], g.geomCoords[i * 2 + 1]]);
      }
    }
    return out;
  }
  pathRoadNames(edges: number[]): string[] {
    const g = this.g;
    const names: string[] = [];
    let last = "";
    for (const e of edges) {
      const ni = g.edgeName[e];
      if (ni < 0) continue;
      const nm = g.wayNames[ni];
      if (nm !== last) {
        names.push(nm);
        last = nm;
      }
    }
    return names;
  }

  /** Fraction of path `a`'s length that runs on road segments also used by `b` (either direction). */
  overlap(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const g = this.g;
    const keys = new Set<string>();
    for (const e of b) keys.add(undirectedKey(g, e));
    let shared = 0;
    let total = 0;
    for (const e of a) {
      total += g.edgeLength[e];
      if (keys.has(undirectedKey(g, e))) shared += g.edgeLength[e];
    }
    return total > 0 ? shared / total : 0;
  }

  /**
   * Snap a coordinate to the graph: find the nearest road shape point, then
   * choose the nearer endpoint of that road segment. Returns node index and
   * the straight-line distance from the input to the snapped node.
   */
  snap(lat: number, lng: number): { node: number; distance: number } {
    const g = this.g;
    let bestE = -1;
    let bestD = Infinity;
    const gc = g.geomCoords;
    for (let e = 0; e < g.edgeCount; e++) {
      const a = g.geomOffsets[e];
      const b = g.geomOffsets[e + 1];
      for (let i = a; i < b; i++) {
        const d = fastDistance(lat, lng, gc[i * 2], gc[i * 2 + 1]);
        if (d < bestD) {
          bestD = d;
          bestE = e;
        }
      }
    }
    if (bestE < 0) return { node: 0, distance: Infinity };
    const from = g.edgeFrom[bestE];
    const to = g.edgeTo[bestE];
    const dFrom = fastDistance(lat, lng, g.nodeLat[from], g.nodeLng[from]);
    const dTo = fastDistance(lat, lng, g.nodeLat[to], g.nodeLng[to]);
    return dFrom <= dTo ? { node: from, distance: dFrom } : { node: to, distance: dTo };
  }
}

function sharesPrefix(a: number[], b: number[], n: number): boolean {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

function undirectedKey(g: SerializedGraph, e: number): string {
  const a = g.edgeFrom[e];
  const b = g.edgeTo[e];
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
