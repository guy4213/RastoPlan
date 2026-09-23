import type {
  AccessoryRules,
  Diagnostic,
  Edge,
  NodeType,
  PanelCatalog,
  Placement,
  PlacementSide,
} from "../types.js";
import type { PanelAvailability } from "./selectPanels.js";
import { planRun, materialiseRun } from "./tileWall.js";
import type { RunPlan } from "./tileWall.js";
import { blockedSpansFor, subtractSpans } from "./manualPlacements.js";
import type { Span } from "./manualPlacements.js";

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
  /**
   * Stretches already occupied by hand-placed items (see blockedSpansFor).
   * They are left empty on BOTH faces and everything around them is tiled.
   */
  blocked?: readonly Span[];
  /** the hand-placed items behind `blocked`, used to report a face left bare opposite one */
  manualPlacements?: readonly Placement[];
  /**
   * Node types at the ends of this wall's drawn contours. Junction-restricted
   * panels (Panel.allowedAtNodeTypes) are selectable only when one qualifies;
   * omitted means "unknown", which allows no restricted panel.
   */
  endNodeTypes?: readonly NodeType[];
}

export interface TileWallPairResult {
  placements: Placement[];
  diagnostics: Diagnostic[];
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
  // Kept as a separate path so a wall without hand-placed items goes through
  // exactly the code that produced every layout before manual edits survived a
  // recompute — the golden engine test holds that output fixed.
  if (input.blocked && input.blocked.length > 0) return tileAroundBlocked(input, input.blocked);

  const { edge, wallId, pourId, faces, catalog, rules, availability } = input;
  const endNodeTypes = input.endNodeTypes ?? [];
  const diagnostics: Diagnostic[] = [];

  if (faces.length !== 2) {
    // One drawn line means one row of formwork; there is no far face to align
    // with, so each face is simply tiled on its own run.
    const placements = faces.flatMap((face) =>
      materialiseRun(planRun(face.clearLength, catalog, rules, availability, endNodeTypes), {
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
      materialiseRun(planRun(face.clearLength, catalog, rules, availability, endNodeTypes), {
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
  const sharedPlan = planRun(length(shared), catalog, rules, availability, endNodeTypes);
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
      const plan = planRun(length(segment), catalog, rules, availability, endNodeTypes);
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

/**
 * tileWallPair for a wall that already carries hand-placed items.
 *
 * The same two rules as the normal path, applied to what is left once the
 * blocked stretches are removed: where both faces are free together, each free
 * piece is planned ONCE and placed on both faces at identical offsets; what a
 * face holds beyond the shared stretch is tiled for that face alone. A piece the
 * catalog cannot fill is still materialised (as a flagged timber run) so the
 * hole stays visible next to the manual panel instead of silently vanishing.
 */
function tileAroundBlocked(input: TileWallPairInput, blocked: readonly Span[]): TileWallPairResult {
  const { edge, wallId, pourId, faces, catalog, rules, availability } = input;
  const endNodeTypes = input.endNodeTypes ?? [];
  const diagnostics: Diagnostic[] = [];
  const placements: Placement[] = [];
  // Selection for each free piece must see what earlier pieces already
  // reserved. The caller's ledger is left untouched until tileProject consumes
  // the final placements, so this local copy is both deterministic and avoids
  // double-decrementing stock.
  const remainingAvailability = availability ? { ...availability } : undefined;

  // A reserved stretch that this face's own manual items do not cover is left
  // bare on purpose (alignment wins), so the operator must be told about it.
  for (const face of faces) {
    const covered = blockedSpansFor(input.manualPlacements?.filter((p) => p.side === face.side) ?? []);
    const faceSpan = {
      lo: Math.round(face.startOffset),
      hi: Math.round(face.startOffset + face.clearLength),
    };
    for (const cut of blocked) {
      const within = subtractSpans(faceSpan, subtractSpans(faceSpan, [cut]));
      for (const bare of within.flatMap((piece) => subtractSpans(piece, covered))) {
        diagnostics.push({
          code: "manual-opposite-face-bare",
          severity: "warning",
          message: `בצד ${face.faceIsInterior ? "הפנימי" : "החיצוני"} של הקיר נשאר קטע ריק של ${length(bare)} ס״מ מול פריט שהוצב ידנית בצד השני — יש להשלים גם אותו ידנית`,
          wallIds: [wallId],
          nodeIds: [edge.nodeA, edge.nodeB],
        });
      }
    }
  }

  const spanOf = (f: WallFaceRun): Span => ({
    lo: Math.round(f.startOffset),
    hi: Math.round(f.startOffset + f.clearLength),
  });
  const reserve = (base: RunPlan): RunPlan => {
    if (!remainingAvailability || base.flags.length > 0) return base;
    const missingPanelsByType: Record<string, number> = {};
    for (const item of base.items) {
      if (item.kind !== "panel") continue;
      const type = item.panel.type;
      if ((remainingAvailability[type] ?? 0) > 0) {
        remainingAvailability[type] = remainingAvailability[type]! - 1;
      } else {
        missingPanelsByType[type] = (missingPanelsByType[type] ?? 0) + 1;
      }
    }
    return { ...base, missingPanelsByType };
  };
  const plan = (piece: Span): RunPlan =>
    planRun(length(piece), catalog, rules, remainingAvailability, endNodeTypes);

  const pair = faces.length === 2 ? (faces as [WallFaceRun, WallFaceRun]) : null;
  const shared: Span | null = pair
    ? {
        lo: Math.max(spanOf(pair[0]).lo, spanOf(pair[1]).lo),
        hi: Math.min(spanOf(pair[0]).hi, spanOf(pair[1]).hi),
      }
    : null;
  const aligned = shared !== null && length(shared) > 0;

  if (pair && !aligned) {
    diagnostics.push({
      code: "face-runs-disjoint",
      severity: "warning",
      message: "שני צדי הקיר אינם חופפים לאורכו — התבניות בכל צד נבחרו בנפרד",
      wallIds: [wallId],
      nodeIds: [edge.nodeA, edge.nodeB],
    });
  }

  // One panel arrangement per shared free piece, reused on both faces. Stock
  // is nevertheless reserved once per physical face, so one remaining panel
  // cannot silently satisfy both rows (or two separate free pieces).
  const sharedPieces = aligned
    ? subtractSpans(shared, blocked).map((piece) => {
        const piecePlan = plan(piece);
        if (piecePlan.flags.length > 0) {
          diagnostics.push({
            code: "shared-run-untileable",
            severity: "error",
            message: `לא נמצא שילוב תבניות לקטע המשותף באורך ${length(piece)} ס״מ`,
            wallIds: [wallId],
            nodeIds: [edge.nodeA, edge.nodeB],
          });
        }
        return {
          piece,
          plansBySide: Object.fromEntries(
            faces.map((face) => [face.side, reserve(piecePlan)])
          ) as Partial<Record<PlacementSide, RunPlan>>,
          exclusiveEnd: null as "head" | "tail" | null,
        };
      })
    : [];

  for (const face of faces) {
    const span = spanOf(face);
    const pieces: { piece: Span; plan: RunPlan; exclusiveEnd: "head" | "tail" | null }[] = [];
    const addExclusive = (segment: Span, end: "head" | "tail" | null) => {
      for (const piece of subtractSpans(segment, blocked)) {
        pieces.push({ piece, plan: reserve(plan(piece)), exclusiveEnd: end });
      }
    };

    if (aligned) {
      addExclusive({ lo: span.lo, hi: shared.lo }, "head");
      pieces.push(
        ...sharedPieces.map(({ piece, plansBySide, exclusiveEnd }) => ({
          piece,
          plan: plansBySide[face.side]!,
          exclusiveEnd,
        }))
      );
      addExclusive({ lo: shared.hi, hi: span.hi }, "tail");
    } else {
      addExclusive(span, null);
    }
    pieces.sort((a, b) => a.piece.lo - b.piece.lo);

    let index = 0;
    for (const { piece, plan: piecePlan, exclusiveEnd } of pieces) {
      const emitted = materialiseRun(piecePlan, {
        edgeId: edge.id,
        wallId,
        pourId,
        side: face.side,
        faceIsInterior: face.faceIsInterior,
        clearLength: length(piece),
        startOffset: piece.lo,
      }).map((p) => ({ ...p, id: `placement:${edge.id}:${face.side}:f${index++}` }));

      if (exclusiveEnd && piecePlan.flags.length > 0) {
        for (const p of emitted) p.flags = [...p.flags, "face-alignment-remainder"];
        diagnostics.push({
          code: "face-alignment-remainder",
          severity: "warning",
          message: `קטע ${exclusiveEnd === "head" ? "בתחילת" : "בסוף"} הקיר בצד ${
            face.faceIsInterior ? "הפנימי" : "החיצוני"
          } באורך ${length(piece)} ס״מ — אין שילוב תבניות שמכסה אותו`,
          wallIds: [wallId],
          nodeIds: [exclusiveEnd === "head" ? edge.nodeA : edge.nodeB],
        });
      }
      placements.push(...emitted);
    }
  }

  return { placements, diagnostics };
}
