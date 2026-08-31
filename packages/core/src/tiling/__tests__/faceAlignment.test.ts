import { describe, expect, it } from "vitest";
import type { Placement, PlacementSide } from "../../types.js";
import { checkFaceAlignment } from "../faceAlignment.js";

function panel(side: PlacementSide, index: number, offsetAlongEdge: number): Placement {
  return {
    id: `placement:edge-1:${side}:${index}`,
    edgeId: "edge-1",
    wallId: "wall-1",
    pourId: "pour-1",
    side,
    faceIsInterior: side === "faceA",
    kind: "panel",
    panelType: "R75",
    offsetAlongEdge,
    width: 75,
    source: "auto",
    flags: [],
  };
}

function alignedRows(): Placement[] {
  return (["faceA", "faceB"] as const).flatMap((side) =>
    [0, 75, 150].map((offset, index) => panel(side, index, offset))
  );
}

describe("checkFaceAlignment", () => {
  it("returns no issues for two aligned rows", () => {
    expect(checkFaceAlignment(alignedRows())).toEqual([]);
  });

  it("reports one seam issue at the offset of a manually moved panel", () => {
    const placements = alignedRows().map((placement) =>
      placement.id === "placement:edge-1:faceB:1"
        ? { ...placement, offsetAlongEdge: 76, source: "manual" as const }
        : placement
    );

    expect(checkFaceAlignment(placements)).toEqual([
      { edgeId: "edge-1", offsetAlongEdge: 76, kind: "seam-mismatch" },
    ]);
  });

  it("distinguishes a panel-type mismatch from a seam mismatch", () => {
    const placements = alignedRows().map((placement) =>
      placement.id === "placement:edge-1:faceB:1"
        ? { ...placement, panelType: "R70", source: "manual" as const }
        : placement
    );

    expect(checkFaceAlignment(placements)).toEqual([
      { edgeId: "edge-1", offsetAlongEdge: 75, kind: "panel-type-mismatch" },
    ]);
  });

  it("reports a panel removed from inside the shared span as missing opposite", () => {
    const placements = alignedRows().filter(
      (placement) => placement.id !== "placement:edge-1:faceB:1"
    );

    expect(checkFaceAlignment(placements)).toEqual([
      { edgeId: "edge-1", offsetAlongEdge: 75, kind: "missing-opposite" },
    ]);
  });

  it("reports a panel inserted on only one face as missing opposite", () => {
    const placements = [
      ...alignedRows(),
      { ...panel("faceB", 3, 75), id: "manual-extra", source: "manual" as const },
    ];

    expect(checkFaceAlignment(placements)).toEqual([
      { edgeId: "edge-1", offsetAlongEdge: 75, kind: "missing-opposite" },
    ]);
  });

  it("ignores legitimate face-only ends and corner placements", () => {
    const placements = [
      ...alignedRows(),
      { ...panel("faceA", 3, -30), width: 30, panelType: "R30" },
      { ...panel("faceB", 3, 225), width: 30, panelType: "R30" },
      {
        ...panel("faceA", 4, -60),
        kind: "corner-panel" as const,
        panelType: "C30x30",
      },
    ];

    expect(checkFaceAlignment(placements)).toEqual([]);
  });
});
