export * from "./constants.js";
export { buildRegions, regionSegments, OUTSIDE_REGION_ID } from "./regions.js";
export type { BuildRegionsResult, Region, RegionKind, RegionSegment } from "./regions.js";
export { pairFaces } from "./pairFaces.js";
export type {
  FacePairing,
  PairFacesContext,
  PairFacesResult,
  PairNearMiss,
  PairRejectionReason,
} from "./pairFaces.js";
export { previewPairings, previewPairingByWallId } from "./previewPairing.js";
export type { WallPairPreview } from "./previewPairing.js";
export { retargetPairedWall, retargetWallThickness } from "./retargetPairedWall.js";
export type { RetargetResult, RetargetThicknessResult } from "./retargetPairedWall.js";
export { resolveWalls } from "./resolveWalls.js";
export type {
  Diagnostic,
  OutwardSign,
  ResolvedWall,
  ResolvedWallFace,
  WallResolution,
} from "./resolveWalls.js";
