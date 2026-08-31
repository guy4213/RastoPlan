import type {
  AccessoryRules,
  Diagnostic,
  Edge,
  PanelCatalog,
  Placement,
  PlacementSide,
} from "../types.js";
import type { PanelAvailability } from "./selectPanels.js";
import { planRun, materialiseRun } from "./tileWall.js";

/** One face's straight run, in the wall's shared along-axis frame. */
export interface WallFaceRun {
  side: PlacementSide;
  faceIsInterior: boolean;
  startOffset: number;
  clearLength: number;
}

export interface TileWallPairInput {
  edge: Edge;
  /** the ResolvedWall these faces belong to */
  wallId: string;
  pourId: string;
  /** the faces the user actually drew: one line -> one entry, two contours -> two */
  faces: WallFaceRun[];
  catalog: PanelCatalog;
  rules: AccessoryRules;
  availability?: PanelAvailability;
}

export interface TileWallPairResult {
  placements: Placement[];
  diagnostics: Diagnostic[];
}

/** A half-open stretch of the wall's along-axis frame, in whole centimetres. */
interface Span {
  lo: number;
  hi: number;
}

const length = (s: Span) => s.hi - s.lo;

/**
 * Tiles both faces of one wall as a single unit.
 *
 * The two faces are not independent walls. A Dywidag rod passes straight
 * through the wall via hole patterns fixed on each panel, so where the two
 * faces overlap their joints must fall at the same offsets — otherwise the rod
 * meets solid panel. Tiling each face on its own run, which is what the engine
 * did before, cannot guarantee that: the two runs get different lengths and the
 * selector picks a different combination for each.
 *
 * The fix is structural rather than a check after the fact. The stretch the two
 * faces share is planned ONCE and materialised on both faces at identical
 * offsets, so the rows cannot disagree. Whatever each face holds beyond that
 * stretch is its own, and is tiled separately on that face alone.
 *
 * Measured against the customer's reference drawing (see
 * docs/plan-parallel-formwork.md and spikes/extract-panel-rows.mjs), 166 of 166
 * wall pairs are built exactly this way: identical, aligned panels across the
 * shared stretch, plus extra panels only in the corner zones.
 *
 * Two things the reference disproved, and which this function therefore does
 * NOT assume:
 *
 * - That one face is the master. In 8 of those pairs both faces run to the same
 *   total length, each carrying its extra panel at the opposite end — there is
 *   no longer face to lead from. The shared stretch leads instead.
 * - That the shorter run sits inside the longer one. 30 of the pairs overlap
 *   only partially, so BOTH faces own an exclusive end. Tiling exclusive ends
 *   on one "master" face alone would leave the other face's end bare.
 */
export function tileWallPair(input: TileWallPairInput): TileWallPairResult {
  const { edge, wallId, pourId, faces, catalog, rules, availability } = input;
  const diagnostics: Diagnostic[] = [];

  if (faces.length !== 2) {
    // One drawn line means one row of formwork; there is no far face to align
    // with, so each face is simply tiled on its own run.
    const placements = faces.flatMap((face) =>
      materialiseRun(planRun(face.clearLength, catalog, rules, availability), {
        edgeId: edge.id,
        wallId,
        pourId,
        side: face.side,
        faceIsInterior: face.faceIsInterior,
        clearLength: face.clearLength,
        startOffset: face.startOffset,
      })
    );
    return { placements, diagnostics };
  }

  const [first, second] = faces as [WallFaceRun, WallFaceRun];
  const spanOf = (f: WallFaceRun): Span => ({
    // Whole centimetres: the tiling DP is indexed by them, and a fractional
    // boundary would put the two faces' seams a few millimetres apart — which
    // is the very thing this function exists to prevent.
    lo: Math.round(f.startOffset),
    hi: Math.round(f.startOffset + f.clearLength),
  });
  const spanA = spanOf(first);
  const spanB = spanOf(second);

  const shared: Span = {
    lo: Math.max(spanA.lo, spanB.lo),
    hi: Math.min(spanA.hi, spanB.hi),
  };

  if (length(shared) <= 0) {
    // The two faces do not meet along the wall at all. Nothing can be aligned,
    // so each is tiled alone and the operator is told why.
    diagnostics.push({
      code: "face-runs-disjoint",
      severity: "warning",
      message: "שני צדי הקיר אינם חופפים לאורכו — התבניות בכל צד נבחרו בנפרד",
      wallIds: [wallId],
      nodeIds: [edge.nodeA, edge.nodeB],
    });
    const placements = [first, second].flatMap((face) =>
      materialiseRun(planRun(face.clearLength, catalog, rules, availability), {
        edgeId: edge.id,
        wallId,
        pourId,
        side: face.side,
        faceIsInterior: face.faceIsInterior,
        clearLength: face.clearLength,
        startOffset: face.startOffset,
      })
    );
    return { placements, diagnostics };
  }

  // One plan, two rows. This single call is what makes the faces parallel.
  const sharedPlan = planRun(length(shared), catalog, rules, availability);
  if (sharedPlan.flags.length > 0) {
    diagnostics.push({
      code: "shared-run-untileable",
      severity: "error",
      message: `לא נמצא שילוב תבניות לקטע המשותף באורך ${length(shared)} ס״מ`,
      wallIds: [wallId],
      nodeIds: [edge.nodeA, edge.nodeB],
    });
  }

  const placements: Placement[] = [];
  for (const face of [first, second]) {
    const span = face === first ? spanA : spanB;
    const common = {
      edgeId: edge.id,
      wallId,
      pourId,
      side: face.side,
      faceIsInterior: face.faceIsInterior,
    };

    // head -> shared -> tail, in along-axis order, so a placement's index in its
    // id also orders it along the wall.
    let index = 0;
    const exclusive = (segment: Span, end: "head" | "tail") => {
      if (length(segment) <= 0) return;
      const plan = planRun(length(segment), catalog, rules, availability);
      const emitted = materialiseRun(plan, {
        ...common,
        clearLength: length(segment),
        startOffset: segment.lo,
        indexOffset: index,
      });
      if (plan.flags.length > 0) {
        // The shared stretch is still parallel; only this end could not be
        // filled from the catalog. Flagging it here rather than letting it
        // read as a generic tiling failure tells the operator that the wall's
        // alignment is fine and the corner zone is what needs attention.
        for (const p of emitted) p.flags = [...p.flags, "face-alignment-remainder"];
        diagnostics.push({
          code: "face-alignment-remainder",
          severity: "warning",
          message: `קטע ${end === "head" ? "בתחילת" : "בסוף"} הקיר בצד ${
            face.faceIsInterior ? "הפנימי" : "החיצוני"
          } באורך ${length(segment)} ס״מ — אין שילוב תבניות שמכסה אותו`,
          wallIds: [wallId],
          nodeIds: [end === "head" ? edge.nodeA : edge.nodeB],
        });
      }
      index += emitted.length;
      placements.push(...emitted);
    };

    exclusive({ lo: span.lo, hi: shared.lo }, "head");

    const sharedRow = materialiseRun(sharedPlan, {
      ...common,
      clearLength: length(shared),
      startOffset: shared.lo,
      indexOffset: index,
    });
    index += sharedRow.length;
    placements.push(...sharedRow);

    exclusive({ lo: shared.hi, hi: span.hi }, "tail");
  }

  return { placements, diagnostics };
}
