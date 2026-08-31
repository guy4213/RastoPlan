import { describe, expect, it } from "vitest";
import type { Edge, Placement } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { tileWallPair } from "../tileWallPair.js";
import { REFERENCE_FACE_SPANS } from "./referenceFaceSpans.js";

/**
 * Runs the engine over every wall pair measured off the customer's reference
 * drawing and checks the one property the drawing establishes: across the
 * stretch two faces share, they carry the same panels at the same offsets.
 *
 * This is the acceptance test for the parallel-tiling requirement. The 166
 * spans include all three shapes the drawing contains — one face inside the
 * other (128), both the same length (8), and partial overlap where each face
 * owns an exclusive end (30) — so a regression in any of them fails here.
 */

const edge: Edge = { id: "edge:1", wallId: "wall:1", nodeA: "n0", nodeB: "n1", clearLength: 0, flags: [] };

function tile(aLo: number, aHi: number, bLo: number, bHi: number) {
  return tileWallPair({
    edge,
    wallId: "wall:1",
    pourId: "pour-1",
    faces: [
      { side: "faceA", faceIsInterior: true, startOffset: aLo, clearLength: aHi - aLo },
      { side: "faceB", faceIsInterior: false, startOffset: bLo, clearLength: bHi - bLo },
    ],
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
  });
}

const on = (placements: Placement[], side: string) =>
  placements.filter((p) => p.side === side).sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);

const within = (row: Placement[], lo: number, hi: number) =>
  row.filter((p) => p.offsetAlongEdge >= lo && p.offsetAlongEdge + p.width <= hi);

const signature = (row: Placement[]) =>
  row.map((p) => `${p.panelType}@${p.offsetAlongEdge}+${p.width}`).join(" ");

function gapsOrOverlaps(row: Placement[], lo: number, hi: number): string | null {
  if (row.length === 0) return "empty row";
  if (row[0]!.offsetAlongEdge !== lo) return `starts at ${row[0]!.offsetAlongEdge}, expected ${lo}`;
  for (let i = 1; i < row.length; i++) {
    const end = row[i - 1]!.offsetAlongEdge + row[i - 1]!.width;
    if (end !== row[i]!.offsetAlongEdge) return `discontinuity at ${end} -> ${row[i]!.offsetAlongEdge}`;
  }
  const last = row[row.length - 1]!;
  const end = last.offsetAlongEdge + last.width;
  return end === hi ? null : `ends at ${end}, expected ${hi}`;
}

describe("alignment against the reference drawing", () => {
  it("covers all 166 measured wall pairs", () => {
    expect(REFERENCE_FACE_SPANS).toHaveLength(166);
  });

  it("carries an identical, aligned row across every shared stretch", () => {
    const mismatched: string[] = [];
    for (const [aLo, aHi, bLo, bHi] of REFERENCE_FACE_SPANS) {
      const { placements } = tile(aLo, aHi, bLo, bHi);
      const lo = Math.max(aLo, bLo);
      const hi = Math.min(aHi, bHi);
      const a = signature(within(on(placements, "faceA"), lo, hi));
      const b = signature(within(on(placements, "faceB"), lo, hi));
      if (a !== b) mismatched.push(`[${aLo},${aHi}] vs [${bLo},${bHi}]\n  A: ${a}\n  B: ${b}`);
    }
    expect(mismatched).toEqual([]);
  });

  it("covers both faces end to end, leaving no gap and no overlap", () => {
    const broken: string[] = [];
    for (const [aLo, aHi, bLo, bHi] of REFERENCE_FACE_SPANS) {
      const { placements } = tile(aLo, aHi, bLo, bHi);
      const a = gapsOrOverlaps(on(placements, "faceA"), aLo, aHi);
      const b = gapsOrOverlaps(on(placements, "faceB"), bLo, bHi);
      if (a) broken.push(`faceA [${aLo},${aHi}]: ${a}`);
      if (b) broken.push(`faceB [${bLo},${bHi}]: ${b}`);
    }
    expect(broken).toEqual([]);
  });

  it("finds a buildable layout for all but three known end segments", () => {
    // 163 of the 166 pairs tile cleanly. The three that do not are both cases
    // where the exclusive end comes out shorter than any panel and longer than
    // the timber range, and they are left flagged rather than quietly absorbed:
    //
    //   A[0,195] B[10,160]  (x2) — a 10cm head on face A. The drawing builds
    //     this differently: it lets BOTH faces carry a head (40 and 30) that
    //     meet at a common seam at 40, instead of starting the shared stretch
    //     at the raw intersection. That is a rule this engine does not have.
    //   A[34,359] B[0,360]        — a 1cm tail on face B, which is measurement
    //     noise: the label-derived edges are only good to about a centimetre.
    //
    // Both are open questions for the next stage, not silent failures — see
    // docs/plan-parallel-formwork.md. Locking the count here means a fourth one
    // appearing is a regression somebody has to look at.
    const flagged: string[] = [];
    for (const [aLo, aHi, bLo, bHi] of REFERENCE_FACE_SPANS) {
      const { diagnostics } = tile(aLo, aHi, bLo, bHi);
      for (const d of diagnostics) flagged.push(`[${aLo},${aHi}] vs [${bLo},${bHi}]: ${d.code}`);
    }
    expect(flagged).toEqual([
      "[0,195] vs [10,160]: face-alignment-remainder",
      "[0,195] vs [10,160]: face-alignment-remainder",
      "[34,359] vs [0,360]: face-alignment-remainder",
    ]);
  });

  it("keeps the shared stretch aligned even on the three flagged pairs", () => {
    // The point of flagging an end rather than re-planning the wall: whatever
    // is wrong at one corner must not disturb the rest of the run.
    for (const [aLo, aHi, bLo, bHi] of [
      [0, 195, 10, 160],
      [34, 359, 0, 360],
    ] as const) {
      const { placements } = tile(aLo, aHi, bLo, bHi);
      const lo = Math.max(aLo, bLo);
      const hi = Math.min(aHi, bHi);
      const a = within(on(placements, "faceA"), lo, hi);
      const b = within(on(placements, "faceB"), lo, hi);
      expect(signature(a)).toBe(signature(b));
      expect(a.length).toBeGreaterThan(0);
    }
  });
});
