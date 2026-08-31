import type { Placement, PlacementSide } from "../types.js";

export type FaceAlignmentIssueKind =
  | "seam-mismatch"
  | "panel-type-mismatch"
  | "missing-opposite";

export interface FaceAlignmentIssue {
  edgeId: string;
  offsetAlongEdge: number;
  kind: FaceAlignmentIssueKind;
}

interface ComparablePlacement {
  placement: Placement;
  start: number;
  end: number;
}

const EPSILON_CM = 0.01;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON_CM;
}

function isComparable(placement: Placement): boolean {
  return (
    placement.kind !== "corner-panel" &&
    !placement.flags.includes("outer-corner-protrusion") &&
    Number.isFinite(placement.offsetAlongEdge) &&
    Number.isFinite(placement.width) &&
    placement.width > EPSILON_CM
  );
}

function rowSpan(row: ComparablePlacement[]): { lo: number; hi: number } {
  return {
    lo: Math.min(...row.map((item) => item.start)),
    hi: Math.max(...row.map((item) => item.end)),
  };
}

function sameGeometry(a: ComparablePlacement, b: ComparablePlacement): boolean {
  return nearlyEqual(a.start, b.start) && nearlyEqual(a.end, b.end);
}

function samePanelType(a: Placement, b: Placement): boolean {
  return a.kind === b.kind && a.panelType === b.panelType;
}

function issueOffset(a: ComparablePlacement, b: ComparablePlacement): number {
  if (!nearlyEqual(a.start, b.start)) return Math.max(a.start, b.start);
  return Math.min(a.end, b.end);
}

/**
 * Checks the two formwork rows on each edge without consulting the saved
 * layout. That makes the result reflect hand edits immediately, even though a
 * hand edit deliberately does not run the tiling engine again.
 *
 * Corner legs and the small outside-corner overlap markers have no opposite
 * unit by design. Straight panels and timber are compared only in the span
 * covered by both rows, so legitimate face-only corner zones are ignored.
 */
export function checkFaceAlignment(placements: Placement[]): FaceAlignmentIssue[] {
  const byEdge = new Map<string, Record<PlacementSide, ComparablePlacement[]>>();

  for (const placement of placements) {
    if (!isComparable(placement)) continue;
    const rows = byEdge.get(placement.edgeId) ?? { faceA: [], faceB: [] };
    rows[placement.side].push({
      placement,
      start: placement.offsetAlongEdge,
      end: placement.offsetAlongEdge + placement.width,
    });
    byEdge.set(placement.edgeId, rows);
  }

  const issues: FaceAlignmentIssue[] = [];
  const edgeIds = [...byEdge.keys()].sort();

  for (const edgeId of edgeIds) {
    const rows = byEdge.get(edgeId)!;
    if (rows.faceA.length === 0 || rows.faceB.length === 0) continue;

    const spanA = rowSpan(rows.faceA);
    const spanB = rowSpan(rows.faceB);
    const overlap = { lo: Math.max(spanA.lo, spanB.lo), hi: Math.min(spanA.hi, spanB.hi) };
    if (overlap.hi - overlap.lo <= EPSILON_CM) continue;

    const inOverlap = (item: ComparablePlacement) =>
      item.end > overlap.lo + EPSILON_CM && item.start < overlap.hi - EPSILON_CM;
    const faceA = rows.faceA.filter(inOverlap).sort((a, b) => a.start - b.start || a.end - b.end);
    const faceB = rows.faceB.filter(inOverlap).sort((a, b) => a.start - b.start || a.end - b.end);
    const matchedB = new Set<number>();
    const unmatchedA: ComparablePlacement[] = [];

    // Exact geometric matches are authoritative. This lets one missing panel
    // be reported as missing rather than shifting every later pair by one.
    for (const itemA of faceA) {
      const matchIndex = faceB.findIndex(
        (itemB, index) => !matchedB.has(index) && sameGeometry(itemA, itemB)
      );
      if (matchIndex < 0) {
        unmatchedA.push(itemA);
        continue;
      }
      matchedB.add(matchIndex);
      const itemB = faceB[matchIndex]!;
      if (!samePanelType(itemA.placement, itemB.placement)) {
        issues.push({ edgeId, offsetAlongEdge: itemA.start, kind: "panel-type-mismatch" });
      }
    }

    const unmatchedB = faceB.filter((_item, index) => !matchedB.has(index));
    const pairedCount = Math.min(unmatchedA.length, unmatchedB.length);
    for (let index = 0; index < pairedCount; index++) {
      issues.push({
        edgeId,
        offsetAlongEdge: issueOffset(unmatchedA[index]!, unmatchedB[index]!),
        kind: "seam-mismatch",
      });
    }
    for (const item of unmatchedA.slice(pairedCount)) {
      issues.push({ edgeId, offsetAlongEdge: item.start, kind: "missing-opposite" });
    }
    for (const item of unmatchedB.slice(pairedCount)) {
      issues.push({ edgeId, offsetAlongEdge: item.start, kind: "missing-opposite" });
    }
  }

  return issues.sort(
    (a, b) =>
      a.edgeId.localeCompare(b.edgeId) ||
      a.offsetAlongEdge - b.offsetAlongEdge ||
      a.kind.localeCompare(b.kind)
  );
}
