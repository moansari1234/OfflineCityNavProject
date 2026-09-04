/// <reference lib="webworker" />
import { buildGraph } from "../lib/graph";
import type { OverpassResponse } from "../lib/osm";
import { Planner } from "../lib/planner";
import type { RoutingRequest, SerializedGraph } from "../lib/types";

let planner: Planner | null = null;

type Msg =
  | { type: "build"; id: number; text: string; center: [number, number]; radius: number }
  | { type: "load"; id: number; graph: SerializedGraph }
  | { type: "route"; id: number; request: RoutingRequest }
  | { type: "clear"; id: number };

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  const id = msg.id;
  const progress = (phase: string, progress?: number, detail?: string) =>
    post({ type: "progress", id, phase, progress, detail });
  try {
    switch (msg.type) {
      case "build": {
        progress("Parsing Overpass JSON", 0);
        let json: OverpassResponse;
        try {
          json = JSON.parse(msg.text) as OverpassResponse;
        } catch {
          throw new Error("Overpass returned malformed JSON (the server may have timed out mid-response). Try again or reduce the radius.");
        }
        if (!json.elements) {
          throw new Error(json.remark ? `Overpass error: ${json.remark}` : "Overpass returned no elements.");
        }
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
          throw new Error(`Overpass error: ${json.remark}`);
        }
        const { graph, stats } = buildGraph(json.elements, msg.center, msg.radius, (p) =>
          progress(p.phase, p.progress, p.detail)
        );
        planner = new Planner(graph);
        post({ type: "done", id, result: { graph, stats, elementCount: json.elements.length } });
        break;
      }
      case "load": {
        progress("Loading saved graph", 0.5);
        planner = new Planner(msg.graph);
        post({ type: "done", id, result: { ok: true } });
        break;
      }
      case "route": {
        if (!planner) throw new Error("No road network loaded.");
        const res = planner.plan(msg.request, (p) => progress(p.phase, p.progress, p.detail));
        post({ type: "done", id, result: res });
        break;
      }
      case "clear": {
        planner = null;
        post({ type: "done", id, result: { ok: true } });
        break;
      }
    }
  } catch (e) {
    post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
};
