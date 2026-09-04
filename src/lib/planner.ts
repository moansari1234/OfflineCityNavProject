import { Router, type Path, type Weights } from "./pathfinding";
import type { Criterion, LatLng, RouteResult, RoutingRequest, RoutingResponse, SerializedGraph, WorkerProgress } from "./types";

export const CRITERIA: Record<Exclude<Criterion, "alternative">, { weights: Weights; label: string; color: string; blurb: string }> = {
  fastest: {
    weights: { dist: 0, time: 1, turn: 4, signal: 0 },
    label: "Fastest",
    color: "#2563eb",
    blurb: "Minimises estimated travel time from speed limits and road class",
  },
  shortest: {
    weights: { dist: 1, time: 0, turn: 0, signal: 0 },
    label: "Shortest",
    color: "#059669",
    blurb: "Minimises driving distance",
  },
  "fewest-turns": {
    weights: { dist: 1, time: 0, turn: 250, signal: 0 },
    label: "Fewest turns",
    color: "#d97706",
    blurb: "Each turn is weighted like 250 m of extra driving",
  },
  "fewest-signals": {
    weights: { dist: 1, time: 0, turn: 0, signal: 400 },
    label: "Fewest traffic lights",
    color: "#dc2626",
    blurb: "Avoids tagged traffic signals; each one weighted like 400 m",
  },
};

const ALT_COLORS = ["#9333ea", "#0891b2", "#db2777", "#4f46e5"];
const DUPLICATE_OVERLAP = 0.9; // routes sharing ≥90% of length are the same route
const DISTINCT_OVERLAP = 0.7; // alternates must share <70% with every accepted route

interface Candidate {
  key: string; // criterion key or alt-n
  criterion: Criterion;
  legs: number[][]; // per-leg edge lists
}

export class Planner {
  readonly router: Router;
  constructor(graph: SerializedGraph) {
    this.router = new Router(graph);
  }

  plan(req: RoutingRequest, onProgress: (p: WorkerProgress) => void): RoutingResponse {
    const t0 = performance.now();
    const r = this.router;
    const g = r.g;
    const notes: string[] = [];
    if (req.points.length < 2) throw new Error("Need at least a start and an end point.");
    const intermediates = req.points.length - 2;
    if (req.mode === "optimized" && intermediates > 10) {
      throw new Error(
        `Optimised ordering supports at most 10 intermediate stops (you have ${intermediates}). Remove stops or switch to fixed order.`
      );
    }

    // 1. snap
    onProgress({ phase: "Snapping points to road network", progress: 0.02 });
    const snapped = req.points.map((p) => {
      const s = r.snap(p[0], p[1]);
      return { input: p, node: [g.nodeLat[s.node], g.nodeLng[s.node]] as LatLng, distance: s.distance, idx: s.node };
    });
    snapped.forEach((s, i) => {
      if (s.distance > 400) notes.push(`Point ${i + 1} is ${Math.round(s.distance)} m from the nearest road node.`);
    });
    const nodes = snapped.map((s) => s.idx);

    // 2. determine visiting order
    let order = nodes.map((_, i) => i);
    if (req.mode === "optimized" && intermediates >= 2) {
      onProgress({ phase: "Solving stop order (Held-Karp)", progress: 0.06 });
      order = this.optimizeOrder(nodes, onProgress);
    }
    const seq = order.map((i) => nodes[i]);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i - 1]) {
        throw new Error(
          `Points ${order[i - 1] + 1} and ${order[i] + 1} snap to the same road node — move one of them further apart.`
        );
      }
    }

    // 3. per-leg candidates
    const legCount = seq.length - 1;
    const criteria: Exclude<Criterion, "alternative">[] = ["fastest", "shortest", "fewest-turns"];
    if (g.hasTrafficSignals) criteria.push("fewest-signals");
    const perLeg: Map<string, Path>[] = [];
    const legBudget = Math.max(600, Math.min(3500, 9000 / legCount));

    for (let li = 0; li < legCount; li++) {
      const s = seq[li];
      const t = seq[li + 1];
      const labelLeg = legCount > 1 ? ` (leg ${li + 1}/${legCount})` : "";
      const found = new Map<string, Path>();
      for (const c of criteria) {
        onProgress({
          phase: `Computing ${CRITERIA[c].label.toLowerCase()} route${labelLeg}`,
          progress: 0.1 + ((li + 0.3) / legCount) * 0.7,
        });
        const p = r.search(s, t, CRITERIA[c].weights);
        if (!p) {
          if (c === "fastest") {
            throw new Error(
              `No drivable path exists between point ${order[li] + 1} and point ${order[li + 1] + 1} inside the selected circle. ` +
                `Enlarge the circle or move the points — the search area is never expanded automatically.`
            );
          }
          continue;
        }
        found.set(c, p);
      }
      // Yen's K-shortest on the fastest metric for alternates
      onProgress({ phase: `Yen's K-shortest alternatives${labelLeg}`, progress: 0.1 + ((li + 0.6) / legCount) * 0.7 });
      const fastest = found.get("fastest")!;
      const wantK = Math.max(2, req.maxRoutes);
      const { paths: yenPaths, truncated } = r.yen(s, t, CRITERIA.fastest.weights, wantK + 2, legBudget);
      if (truncated) notes.push(`Yen's search hit its time budget${labelLeg}; alternates may be incomplete.`);
      const accepted: number[][] = [...found.values()].map((p) => p.edges);
      let altIdx = 0;
      for (const yp of yenPaths.slice(1)) {
        if (accepted.every((a) => r.overlap(yp.edges, a) < DISTINCT_OVERLAP)) {
          found.set(`alt-${altIdx++}`, yp);
          accepted.push(yp.edges);
        }
        if (altIdx >= 2) break;
      }
      // Diversity-penalty re-routing: if Yen produced mostly overlapping paths,
      // penalise already-used edges and re-run to force distinct alternates.
      if (altIdx < 2) {
        onProgress({ phase: `Diversity re-routing${labelLeg}`, progress: 0.1 + ((li + 0.85) / legCount) * 0.7 });
        const penalty = new Float32Array(g.edgeCount).fill(1);
        for (let iter = 0; iter < 4 && altIdx < 2; iter++) {
          for (const a of accepted) for (const e of a) penalty[e] = Math.min(penalty[e] * 1.7, 8);
          const p = r.search(s, t, CRITERIA.fastest.weights, { penalty });
          if (!p) break;
          const realCost = r.pathCost(p.edges, CRITERIA.fastest.weights);
          if (realCost > fastest.cost * 2.2) break; // absurd detour — stop
          if (accepted.every((a) => r.overlap(p.edges, a) < DISTINCT_OVERLAP)) {
            found.set(`alt-${altIdx++}`, { edges: p.edges, cost: realCost });
            accepted.push(p.edges);
          }
        }
      }
      perLeg.push(found);
    }

    // 4. compose multi-leg candidates by key
    onProgress({ phase: "Ranking routes", progress: 0.85 });
    const keys = ["fastest", "shortest", "fewest-turns", "fewest-signals", "alt-0", "alt-1"];
    const candidates: Candidate[] = [];
    for (const key of keys) {
      if (!perLeg.some((m) => m.has(key))) continue;
      const legs = perLeg.map((m) => (m.get(key) ?? m.get("fastest")!).edges);
      candidates.push({ key, criterion: key.startsWith("alt") ? "alternative" : (key as Criterion), legs });
    }

    // 5. dedupe near-identical routes (keep first / highest-priority label)
    const distinct: { cand: Candidate; mergedLabels: string[] }[] = [];
    for (const c of candidates) {
      const flat = c.legs.flat();
      const dup = distinct.find((d) => {
        const other = d.cand.legs.flat();
        return r.overlap(flat, other) >= DUPLICATE_OVERLAP && r.overlap(other, flat) >= DUPLICATE_OVERLAP;
      });
      if (dup) {
        if (c.criterion !== "alternative") dup.mergedLabels.push(CRITERIA[c.criterion as keyof typeof CRITERIA].label);
        continue;
      }
      distinct.push({ cand: c, mergedLabels: [] });
    }

    // 6. build results
    const primary = distinct[0].cand.legs.flat();
    let altCounter = 0;
    const routes: RouteResult[] = distinct.slice(0, Math.max(2, Math.min(5, req.maxRoutes))).map((d, i) => {
      const flat = d.cand.legs.flat();
      const legs = d.cand.legs.map((e) => ({ distance: r.pathLength(e), time: r.pathTime(e) }));
      let label: string;
      let color: string;
      if (d.cand.criterion === "alternative") {
        label = `Alternative ${++altCounter}`;
        color = ALT_COLORS[(altCounter - 1) % ALT_COLORS.length];
      } else {
        const def = CRITERIA[d.cand.criterion as keyof typeof CRITERIA];
        label = [def.label, ...d.mergedLabels].join(" · ");
        color = def.color;
      }
      const geometry: LatLng[] = [];
      d.cand.legs.forEach((e, li) => {
        const geo = r.pathGeometry(e);
        if (li > 0 && geo.length && geometry.length) geo.shift();
        geometry.push(...geo);
      });
      return {
        id: `${d.cand.key}-${i}`,
        label,
        criterion: d.cand.criterion,
        color,
        geometry,
        distance: legs.reduce((a, l) => a + l.distance, 0),
        time: legs.reduce((a, l) => a + l.time, 0),
        turns: r.pathTurns(flat),
        signals: r.pathSignals(flat),
        legs,
        overlapWithBest: i === 0 ? 1 : r.overlap(flat, primary),
        roadNames: r.pathRoadNames(flat),
      };
    });

    if (routes.length < 2) {
      notes.push("Only one distinct route exists inside this circle — every alternative overlaps it almost entirely.");
    }
    if (!g.hasTrafficSignals) {
      notes.push("No traffic-signal nodes are tagged in this download, so the fewest-traffic-lights criterion was skipped.");
    }

    return {
      routes,
      order,
      snapped: snapped.map(({ input, node, distance }) => ({ input, node, distance })),
      computeMs: performance.now() - t0,
      notes,
    };
  }

  /** Path-TSP with fixed start (index 0) and end (last) via Held-Karp DP on fastest-time costs. */
  private optimizeOrder(nodes: number[], onProgress: (p: WorkerProgress) => void): number[] {
    const r = this.router;
    const n = nodes.length;
    const w = CRITERIA.fastest.weights;
    const cost: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
    let done = 0;
    const total = n * (n - 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (j === 0 || i === n - 1) continue; // never travel into start or out of end
        const p = r.search(nodes[i], nodes[j], w);
        cost[i][j] = p ? p.cost : Infinity;
        done++;
        if ((done & 3) === 0)
          onProgress({ phase: "Solving stop order (pairwise costs)", progress: 0.06 + (done / total) * 0.04 });
      }
    }
    const m = n - 2; // intermediates 1..m
    const FULL = 1 << m;
    const dp = new Float64Array(FULL * m).fill(Infinity);
    const par = new Int32Array(FULL * m).fill(-1);
    for (let j = 0; j < m; j++) dp[(1 << j) * m + j] = cost[0][j + 1];
    for (let mask = 1; mask < FULL; mask++) {
      for (let j = 0; j < m; j++) {
        if (!(mask & (1 << j))) continue;
        const cur = dp[mask * m + j];
        if (cur === Infinity) continue;
        for (let k = 0; k < m; k++) {
          if (mask & (1 << k)) continue;
          const nm = mask | (1 << k);
          const c = cur + cost[j + 1][k + 1];
          if (c < dp[nm * m + k]) {
            dp[nm * m + k] = c;
            par[nm * m + k] = j;
          }
        }
      }
    }
    let bestJ = -1;
    let best = Infinity;
    for (let j = 0; j < m; j++) {
      const c = dp[(FULL - 1) * m + j] + cost[j + 1][n - 1];
      if (c < best) {
        best = c;
        bestJ = j;
      }
    }
    if (bestJ < 0) {
      throw new Error("Some stops cannot be reached from each other inside the selected circle, so no stop order is feasible.");
    }
    const order: number[] = [];
    let mask = FULL - 1;
    let j = bestJ;
    while (j >= 0) {
      order.push(j + 1);
      const pj = par[mask * m + j];
      mask &= ~(1 << j);
      j = pj;
    }
    order.reverse();
    return [0, ...order, n - 1];
  }
}
