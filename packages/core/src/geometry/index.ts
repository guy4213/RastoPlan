export { buildGraph, SNAP_TOLERANCE_CM } from "./buildGraph.js";
export type { BuildGraphResult } from "./buildGraph.js";
export { classifyNodes, STRAIGHT_JOIN_TOLERANCE_DEG } from "./classifyNodes.js";
export type { ClassifyNodesOptions } from "./classifyNodes.js";
export { classifyCornerSides } from "./classifyCornerSides.js";
export type { ClassifyCornerSidesResult, CornerRegionLookup } from "./classifyCornerSides.js";
export { buildPlanarFaces } from "./planarFaces.js";
export type { BoundaryCycle, Dart, PlanarFacesResult } from "./planarFaces.js";
export {
  angleBetweenDeg,
  interiorSamplePoint,
  isOnPolygonBoundary,
  isStrictlyInside,
  perpendicularDistance,
  pointAlong,
  pointInPolygon,
  polygonPerimeter,
  projectedOverlap,
  segmentAngleDeg,
  unitNormal,
} from "./polygon.js";
export { otherWallThicknessAt } from "./neighborThickness.js";
export { splitWallsAtJunctions } from "./splitWallsAtJunctions.js";
export type { SplitWallsAtJunctionsResult } from "./splitWallsAtJunctions.js";
export { detectExternalCorners } from "./detectExternalCorners.js";
