export * from "./constants.js";
export { buildRegions, regionSegments, OUTSIDE_REGION_ID } from "./regions.js";
export type { BuildRegionsResult, Region, RegionKind, RegionSegment } from "./regions.js";
export { pairFaces } from "./pairFaces.js";
export type { FacePairing, PairFacesResult } from "./pairFaces.js";
export { resolveWalls } from "./resolveWalls.js";
export type {
  Diagnostic,
  OutwardSign,
  ResolvedWall,
  ResolvedWallFace,
  WallResolution,
} from "./resolveWalls.js";
