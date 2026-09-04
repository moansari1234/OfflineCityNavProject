import RoutingWorker from "../workers/routing.worker?worker&inline";
import type { GraphStats, RoutingRequest, RoutingResponse, SerializedGraph, WorkerProgress } from "./types";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (p: WorkerProgress) => void;
};

/**
 * Promise-based facade over the routing Web Worker. All heavy work — JSON
 * parsing, graph construction, landmark preprocessing and pathfinding — runs
 * off the main thread so the UI never freezes.
 */
export class RoutingWorkerClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new RoutingWorker();
    this.worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; id: number; [k: string]: unknown };
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") {
        p.onProgress?.({ phase: m.phase as string, progress: m.progress as number | undefined, detail: m.detail as string | undefined });
      } else if (m.type === "done") {
        this.pending.delete(m.id);
        p.resolve(m.result);
      } else if (m.type === "error") {
        this.pending.delete(m.id);
        p.reject(new Error(m.message as string));
      }
    };
    this.worker.onerror = (e) => {
      for (const [id, p] of this.pending) {
        p.reject(new Error(e.message || "Worker crashed"));
        this.pending.delete(id);
      }
    };
  }

  private call<T>(msg: Record<string, unknown>, onProgress?: (p: WorkerProgress) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.worker.postMessage({ ...msg, id });
    });
  }

  build(text: string, center: [number, number], radius: number, onProgress: (p: WorkerProgress) => void) {
    return this.call<{ graph: SerializedGraph; stats: GraphStats; elementCount: number }>(
      { type: "build", text, center, radius },
      onProgress
    );
  }

  load(graph: SerializedGraph, onProgress?: (p: WorkerProgress) => void) {
    return this.call<{ ok: true }>({ type: "load", graph }, onProgress);
  }

  route(request: RoutingRequest, onProgress: (p: WorkerProgress) => void) {
    return this.call<RoutingResponse>({ type: "route", request }, onProgress);
  }

  clear() {
    return this.call<{ ok: true }>({ type: "clear" });
  }

  /** Cancel by terminating and re-creating the worker (state is lost). */
  terminate() {
    this.worker.terminate();
    for (const [id, p] of this.pending) {
      p.reject(new Error("Cancelled"));
      this.pending.delete(id);
    }
  }
}
