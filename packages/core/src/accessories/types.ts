/**
 * The customer's bill-of-quantities counts. Every field is a raw count in
 * discrete units (pieces / rods / nuts / adapters); `timberLengthCm` is
 * total centimeters of on-site-cut timber.
 */
export interface AccessoryCount {
  /** cornerClampsPerCorner × number of L corners in the graph. */
  cornerClamps: number;
  /** clampsPerStraightJoint × number of panel-to-panel joints on the inner face. */
  straightClamps: number;
  /** dywidagPerRod × number of tie points (currently: one tie point per straight joint). */
  dywidagRods: number;
  /** nutsPerDywidag × dywidagRods. */
  nuts: number;
  /** Sum over edges of ceil(clearLength / strutSpacingCm) — inner side only. */
  struts: number;
  /** craneAdaptersPerProject — fixed regardless of project size. */
  craneAdapters: number;
}

export interface PanelCount {
  /** panelType (e.g. "R75", "C30x30") → number of physical panels placed. */
  byType: Record<string, number>;
  /** Number of on-site timber filler pieces. */
  timberPieces: number;
  /** Total linear cm of on-site timber (sum of timber piece widths). */
  timberLengthCm: number;
}

/**
 * Per-pour breakdown plus a project-wide `total`. Every field of `total`
 * equals sum(byPour[...][field]) EXCEPT `craneAdapters`: crane adapters are
 * project-scoped and not naturally attributable to a single pour — the
 * per-pour value is 0 for every pour and `total.craneAdapters` carries the
 * whole project count.
 */
export interface CountByPour<T> {
  byPour: Record<string, T>;
  total: T;
}
