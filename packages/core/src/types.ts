// Core data model (spec section 2). All lengths/heights/coordinates are in
// centimeters. Types only — no logic here (Milestone 1 scope).

/** A 2D coordinate in centimeters. */
export interface Point {
  x: number;
  y: number;
}

/** A physical outside corner derived for K30 clamps. */
export interface ExternalCorner {
  point: Point;
  pourId: string;
}

/** A saved layout: pours, walls, and the resulting/edited panel placements. */
export interface Project {
  /** uuid */
  id: string;
  name: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
  /** Panels available to this project. */
  catalog: PanelCatalog;
  /** Accessory-calculation parameters for this project. */
  rules: AccessoryRules;
  pours: Pour[];
  walls: Wall[];
  /** Tiling engine output plus any manual edits. */
  placements: Placement[];
  /** Absent on projects saved before the contour layer; treated as 1. */
  schemaVersion?: number;
  /**
   * Everything the engine derived on the last compute. Written alongside
   * `placements` and cleared with them, so the canvas and the quantities panel
   * read one shared result instead of each re-deriving the graph.
   */
  layout?: ProjectLayout;
  /** Hand-typed quantities that replace the automatic count; never recomputed. */
  overrides?: QuantityOverrides;
  /**
   * Available units keyed by the exact Hebrew BOM product label. Imported from
   * the customer's Excel `מלאי` column. When this object exists, a missing
   * label means zero stock; projects without it retain the legacy unlimited
   * catalog until an inventory file is imported.
   */
  inventory?: Record<string, number>;
}

/**
 * Hand-typed quantities keyed by pourId. Absent or null means "use the engine's
 * number"; 0 is a legitimate override and must not be confused with absent.
 */
export interface QuantityOverrides {
  cornerClamps?: Record<string, number | null>;
  straightClamps?: Record<string, number | null>;
}

/** A single concrete pour within a project — walls belong to one pour each. */
export interface Pour {
  id: string;
  /** e.g. "יציקה 1" */
  name: string;
  /** hex color, used to color this pour's walls on the canvas */
  color: string;
  /** display order among a project's pours */
  order: number;
  /** @deprecated Kept only when loading older projects; new walls do not use it. */
  defaultThicknessCm?: number;
}

/** A wall segment. Only the inner face is user input; the outer face is derived. */
export interface Wall {
  id: string;
  /** the Pour this wall belongs to */
  pourId: string;
  /** the inner face centerline — this is the master geometry */
  innerLine: [Point, Point];
  /**
   * Distance in cm between this wall's two faces. On a wall drawn as a single
   * line the user types it and the far face is derived from it; on a wall
   * traced as two contours the engine measures it and writes it back here.
   */
  thickness: number;
  /**
   * False only for a newly drawn single line whose thickness has not been
   * entered yet. Absent means true for backwards compatibility. The numeric
   * thickness remains present as an internal engine placeholder, but must not
   * be displayed or computed until this becomes true or a contour pair is
   * measured.
   */
  thicknessSet?: boolean;
  /**
   * The other drawn contour of this same physical wall, on a two-contour plan.
   * Written by the engine on compute, on BOTH walls of the pair, so the pairing
   * survives `layout` being cleared. Must be dropped from both walls the moment
   * either one's geometry changes: a stale link would move a wall that is no
   * longer the partner.
   */
  pairedWallId?: string;
  // outerLine is derived: innerLine offset outward by `thickness`, not stored.
}

// ── Geometric graph — built automatically from walls, never persisted directly ──

/**
 * Node kind, from how many edges meet there and — for degree 2 — whether they
 * actually turn. 'straight-join' is the seam where one physical wall was drawn
 * as two collinear segments: it is NOT a corner, and treating it as one costs a
 * phantom corner panel, its clamps, and 60cm of tileable run.
 */
export type NodeType = "L" | "T" | "cross" | "end" | "straight-join";

/**
 * Concave ('inner', e.g. the notch of an L-shaped room) vs convex ('outer',
 * e.g. a regular box corner) relative to the wall loop's interior. Only
 * meaningful for 'L' nodes that sit on a fully closed loop of 'L' nodes —
 * left undefined otherwise (added in Milestone 2, geometry layer).
 */
export type CornerSide = "inner" | "outer";

/** A vertex in the wall graph (derived from wall endpoints/intersections). */
export interface Node {
  id: string;
  point: Point;
  type: NodeType;
  /**
   * Set for 'L' nodes that bound exactly one room region.
   * @deprecated Corners that bound two rooms have a different side per room —
   * read CornerAtNode (geometry/classifyCornerSides) for the full truth. Kept
   * populated for the single-region case.
   */
  cornerSide?: CornerSide;
  /** e.g. "unresolved-corner-side", "multi-region-corner", "degenerate-turn" */
  flags: string[];
}

/**
 * One corner of one region. A node where two walls meet is a corner of every
 * region that wraps around it, and a corner between two rooms is genuinely two
 * corners: each room gets its own corner panel, and the two can even differ in
 * side. This — not Node.cornerSide — is the corners layer's real input.
 */
export interface CornerAtNode {
  /** `corner:${nodeId}:${regionId}` — also the groupId of the panel placed here */
  id: string;
  nodeId: string;
  regionId: string;
  /** the boundary cycle this corner was measured on */
  cycleId: string;
  edgeAId: string;
  edgeBId: string;
  side: CornerSide;
  /** the region's own angle at this node: < 180 is convex, > 180 is concave */
  interiorAngleDeg: number;
  flags: string[];
}

/** A segment between two graph nodes, belonging to one wall. */
export interface Edge {
  id: string;
  wallId: string;
  /** Node id */
  nodeA: string;
  /** Node id */
  nodeB: string;
  /** length in cm after subtracting corner regions */
  clearLength: number;
  /** deferred-processing tags, e.g. "unresolved-T", "unresolved-cross" (added in Milestone 2, geometry layer) */
  flags: string[];
}

// ── Resolved geometry (contours layer) ──

/**
 * Perpendicular direction relative to a wall's own A→B, in the (dy,-dx) frame
 * used everywhere: +1 is the right-hand perpendicular. The contours layer
 * derives it from the wall loop rather than from the drag direction.
 */
export type OutwardSign = 1 | -1;

export interface ResolvedWallFace {
  id: PlacementSide;
  line: [Point, Point];
  /** the face borders a room, so it carries full tiling and corner panels */
  isInterior: boolean;
  regionId: string;
  /** set when the user actually drew a wall for this face (two-contour plans) */
  sourceWallId?: string;
}

/**
 * One physical wall with both faces resolved. On a plan traced as two contours
 * the two drawn walls collapse into one of these, and the second one's id lands
 * in `consumedWallIds` so it is never tiled again in its own right.
 */
export interface ResolvedWall {
  /** equals the primary source wall id, so edge ids stay `edge:${id}` */
  id: string;
  pourId: string;
  sourceWallId: string;
  consumedWallIds: string[];
  /** the primary source wall's innerLine, verbatim */
  centerline: [Point, Point];
  thickness: number;
  thicknessSource: "measured" | "declared";
  /**
   * Perpendicular distance from the centerline to face B, in cm. When the user
   * drew the far contour this is where that contour actually is, so its panels
   * land on the line they drew rather than on a line derived from the typed
   * thickness. Equals `thickness` when face B had to be derived.
   */
  faceBOffsetCm: number;
  /** direction from face A to face B */
  outwardSign: OutwardSign;
  faces: [ResolvedWallFace, ResolvedWallFace];
  flags: string[];
}

export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  /** Hebrew, rendered verbatim in the UI */
  message: string;
  wallIds: string[];
  nodeIds: string[];
}

/** Just enough of a Region for the UI; the boundary cycles stay in the engine. */
export interface RegionSummary {
  id: string;
  kind: "outside" | "wall-material" | "room" | "ambiguous";
  area: number;
}

/** Everything the engine derived on the last compute. */
export interface ProjectLayout {
  nodes: Node[];
  edges: Edge[];
  resolvedWalls: ResolvedWall[];
  regions: RegionSummary[];
  corners: CornerAtNode[];
  /** Unambiguous convex facade corners, recalculated from the current graph. */
  externalCorners: ExternalCorner[];
  diagnostics: Diagnostic[];
  /** bump to invalidate layouts saved by an older engine */
  engineVersion: number;
}

// ── Layout result ──

/**
 * Which face of the wall a placement sits on. 'faceA' is the drawn wall's own
 * innerLine; 'faceB' is the opposite face. Whether a face borders a room is a
 * SEPARATE question, answered by `faceIsInterior` — conflating the two is what
 * produced panels stacked twice on one side and none on the other.
 */
export type PlacementSide = "faceA" | "faceB";
export type PlacementKind = "panel" | "corner-panel" | "timber";
/** 'manual' placements were hand-edited and are colored differently in the UI. */
export type PlacementSource = "auto" | "manual";

/** One panel/timber instance placed along an edge. */
export interface Placement {
  id: string;
  edgeId: string;
  /** the ResolvedWall this sits on; the canvas resolves its render frame from this */
  wallId: string;
  pourId: string;
  side: PlacementSide;
  /** true when this face borders a room: full tiling and a corner panel, no overlap strip */
  faceIsInterior: boolean;
  kind: PlacementKind;
  /** catalog panel type id, e.g. "R75", "C30x30" */
  panelType: string;
  /**
   * Groups placements that are ONE physical unit. A corner panel wraps the
   * corner, so it emits one leg on each meeting wall — both legs share
   * `groupId` and must be counted (and priced) once. Undefined = standalone.
   */
  groupId?: string;
  /** offset in cm from nodeA along the edge */
  offsetAlongEdge: number;
  /** width in cm */
  width: number;
  source: PlacementSource;
  /** validation/warning tags, e.g. "unresolved-T", "gap-out-of-range" */
  flags: string[];
}

// ── Panel catalog ──

/** A formwork panel type available for tiling. */
export interface Panel {
  /** unique id, e.g. "R75" */
  type: string;
  /** width in cm; for a corner panel this is one leg */
  width: number;
  /** height in cm, always 300 for the current catalog — see AVAILABLE_PANEL_HEIGHTS */
  height: number;
  /** second leg in cm, corner panels only (C30x30 → 30). Straight panels leave it undefined. */
  secondLegWidth?: number;
  /** true = a leading panel type (emphasized by the customer) */
  isLeading: boolean;
  /**
   * Coarse legacy availability when no project inventory was imported. A
   * finite `Project.inventory` supersedes this flag for automatic tiling.
   */
  inStock: boolean;
  /** 'straight' fills a plain wall run; 'corner' (e.g. C30x30) wraps an L corner; 'corner-axial' is the axial corner variant, never auto-selected */
  kind: "straight" | "corner" | "corner-axial";
  /** exact row label in the customer's Priority BOM sheet, e.g. "פנאל 75/300" */
  bomLabel: string;
}

export interface PanelCatalog {
  panels: Panel[];
}

// ── Accessory rules (all configurable) ──

/** Tie-break order the tiling engine uses when choosing between candidate layouts. */
export type TilingPriority = "leading" | "min-panels" | "min-gap";

export interface AccessoryRules {
  /** K30 corner clamps per corner panel unit, default 3 */
  cornerClampsPerCorner: number;
  /** K10 straight clamps per straight panel, default 3 */
  clampsPerStraightJoint: number;
  /** dywidag rods per tie point, default 2 */
  dywidagPerRod: number;
  /** nuts per dywidag rod, default 2 */
  nutsPerDywidag: number;
  /** walls up to this thickness take the standard 1m dywidag rod; thicker walls need a longer rod, default 30 */
  dywidagStandardMaxThicknessCm: number;
  /** strut + walkway bracket spacing in cm, interior walls only, default 150 */
  strutSpacingCm: number;
  /** crane adapters needed per project, default 2 */
  craneAdaptersPerProject: number;
  /** minimum allowed timber filler gap in cm, default 5 */
  timberGapMin: number;
  /** maximum allowed timber filler gap in cm, default 9 */
  timberGapMax: number;
  /** standard outer-corner overlap in cm — also its upper bound, default 10 */
  outerCornerProtrusionCm: number;
  /** lower bound for the outer-corner overlap in cm, reached when timber fills the rest, default 5 */
  outerCornerProtrusionMinCm: number;
  /** neighbour thickness the standard overlap is quoted for, default 20 */
  outerCornerProtrusionReferenceThicknessCm: number;
  /**
   * Clearance in cm the LAPPED outer panel stops short of the lapping one at a
   * convex corner, default 2. With outerCornerProtrusionCm this is the whole
   * outer-corner joint: one panel runs past, the other stops just before it,
   * and exactly one of them covers the corner square itself.
   */
  outerCornerLapGapCm: number;
  /** tie-break order for the tiling engine, default ['leading', 'min-panels', 'min-gap'] */
  tilingPriority: TilingPriority[];
}
