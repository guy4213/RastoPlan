export { selectPanels } from "./selectPanels.js";
export type { SelectPanelsResult } from "./selectPanels.js";
export { arrangePanels } from "./arrangePanels.js";
export type { ArrangedItem } from "./arrangePanels.js";
export { tileWall } from "./tileWall.js";
export { planRun, materialiseRun } from "./tileWall.js";
export type { RunPlan, TileWallTarget, MaterialiseTarget } from "./tileWall.js";
export { tileWallPair } from "./tileWallPair.js";
export type { TileWallPairInput, TileWallPairResult, WallFaceRun } from "./tileWallPair.js";
export { blockedSpansFor, isPreservedManualPlacement, subtractSpans } from "./manualPlacements.js";
export type { Span } from "./manualPlacements.js";
export {
  JUNCTION_RESTRICTED_FLAG,
  panelAllowedAtEnds,
  restrictedPanelMayLandOffJunction,
  withJunctionRestrictionFlag,
} from "./junctionRestriction.js";
export { checkFaceAlignment } from "./faceAlignment.js";
export type { FaceAlignmentIssue, FaceAlignmentIssueKind } from "./faceAlignment.js";
