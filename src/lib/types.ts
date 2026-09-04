export type LatLng = [number, number];

export interface GeocodeResult {
  displayName: string;
  name: string;
  lat: number;
  lng: number;
  boundingBox?: [number, number, number, number]; // south, north, west, east
}

export interface CircleArea {
  center: LatLng;
  radius: number; // meters
}

/**
 * Compact, structured-cloneable road graph.
 * Nodes are intersections / way endpoints. Edges are directed road segments
 * whose geometry (shape points) is stored so that routes render faithfully.
 */
export interface SerializedGraph {
  nodeCount: number;
  edgeCount: number;
  nodeLat: Float64Array;
  nodeLng: Float64Array;
  nodeOsmId: Float64Array;
  nodeSignal: Uint8Array; // 1 if node itself is a traffic signal
  // CSR adjacency (out edges)
  outOffsets: Int32Array;
  outEdges: Int32Array;
  // CSR adjacency (in edges) — used for reverse landmark search
  inOffsets: Int32Array;
  inEdges: Int32Array;
  // per-edge attributes
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeLength: Float32Array; // meters
  edgeTime: Float32Array; // seconds
  edgeSignals: Uint8Array; // traffic signals passed while traversing (excluding source node)
  edgeStartBearing: Float32Array; // degrees, bearing leaving from-node
  edgeEndBearing: Float32Array; // degrees, bearing arriving at to-node
  edgeWayId: Float64Array;
  edgeClass: Uint8Array; // road class index
  // edge geometry, flattened lat/lng pairs, offset per edge
  geomOffsets: Int32Array; // length edgeCount+1, offsets into geomCoords (in coordinate pairs)
  geomCoords: Float64Array; // [lat0,lng0,lat1,lng1,...] absolute coordinates
  hasTrafficSignals: boolean;
  wayNames: string[]; // indexed by edgeName
  edgeName: Int32Array; // index into wayNames or -1
  // Landmarks for ALT
  landmarkCount: number;
  landmarkNodes: Int32Array;
  landmarkFrom: Float32Array; // landmarkCount * nodeCount (distance from landmark to node)
  landmarkTo: Float32Array; // landmarkCount * nodeCount (distance from node to landmark)
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  totalRoadKm: number;
  signalCount: number;
  hasTrafficSignals: boolean;
  wayCount: number;
}

export type Criterion =
  | "fastest"
  | "shortest"
  | "fewest-turns"
  | "fewest-signals"
  | "alternative";

export interface RouteResult {
  id: string;
  label: string;
  criterion: Criterion;
  color: string;
  geometry: LatLng[];
  distance: number; // meters
  time: number; // seconds
  turns: number;
  signals: number;
  legs: { distance: number; time: number }[];
  overlapWithBest: number; // 0..1 shared length with primary route
  roadNames: string[];
}

export interface RoutingRequest {
  points: LatLng[]; // start, ...stops, end (user-clicked positions)
  mode: "fixed" | "optimized";
  maxRoutes: number;
}

export interface RoutingResponse {
  routes: RouteResult[];
  order: number[]; // order of input points visited
  snapped: { input: LatLng; node: LatLng; distance: number }[];
  computeMs: number;
  notes: string[];
}

export interface SavedCity {
  id: string;
  name: string;
  displayName: string;
  center: LatLng;
  radius: number;
  savedAt: number;
  stats: GraphStats;
  graph: SerializedGraph;
  rawBytes: number;
}

export interface SavedCityMeta {
  id: string;
  name: string;
  displayName: string;
  center: LatLng;
  radius: number;
  savedAt: number;
  stats: GraphStats;
  rawBytes: number;
}

export interface SavedRoute {
  id?: number;
  name: string;
  cityName: string;
  cityId: string;
  points: LatLng[];
  order: number[];
  mode: "fixed" | "optimized";
  route: RouteResult;
  savedAt: number;
}

export type WorkerProgress = {
  phase: string;
  detail?: string;
  progress?: number; // 0..1
};
