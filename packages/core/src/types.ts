// Core data model (spec section 2). All lengths/heights/coordinates are in
// centimeters. Types only — no logic here (Milestone 1 scope).

/** A 2D coordinate in centimeters. */
export interface Point {
  x: number;
  y: number;
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
}

/** A wall segment. Only the inner face is user input; the outer face is derived. */
export interface Wall {
  id: string;
  /** the Pour this wall belongs to */
  pourId: string;
  /** the inner face centerline — this is the master geometry */
  innerLine: [Point, Point];
  /** wall thickness in cm, manually entered by the user */
  thickness: number;
  // outerLine is derived: innerLine offset outward by `thickness`, not stored.
}

// ── Geometric graph — built automatically from walls, never persisted directly ──

/** Node kind, determined by how many edges meet there. */
export type NodeType = "L" | "T" | "cross" | "end";

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
  /** set by the geometry layer for classifiable 'L' nodes; see CornerSide. */
  cornerSide?: CornerSide;
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

// ── Layout result ──

export type PlacementSide = "inner" | "outer";
export type PlacementKind = "panel" | "corner-panel" | "timber";
/** 'manual' placements were hand-edited and are colored differently in the UI. */
export type PlacementSource = "auto" | "manual";

/** One panel/timber instance placed along an edge. */
export interface Placement {
  id: string;
  edgeId: string;
  pourId: string;
  side: PlacementSide;
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
  /** false = not allowed for auto-tiling (manual exception only) */
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
  /** tie-break order for the tiling engine, default ['leading', 'min-panels', 'min-gap'] */
  tilingPriority: TilingPriority[];
}
