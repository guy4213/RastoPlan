import { describe, expect, it } from "vitest";
import type { Placement } from "../../types.js";
import { syncOuterPlacements } from "../syncOuterPlacements.js";

function inner(id: string, offset: number, width: number, panelType = "R75"): Placement {
  return {
    id,
    edgeId: "edge:bottom",
    pourId: "pour-1",
    side: "inner",
    kind: "panel",
    panelType,
    offsetAlongEdge: offset,
    width,
    source: "auto",
    flags: [],
  };
}

describe("syncOuterPlacements", () => {
  it("mirrors every offsetAlongEdge exactly — this is the Dywidag alignment invariant", () => {
    const inners = [inner("a", 0, 75), inner("b", 75, 75), inner("c", 150, 40, "R40")];
    const outers = syncOuterPlacements(inners);
    expect(outers.map((p) => p.offsetAlongEdge)).toEqual(inners.map((p) => p.offsetAlongEdge));
    expect(outers.map((p) => p.width)).toEqual(inners.map((p) => p.width));
    expect(outers.map((p) => p.panelType)).toEqual(inners.map((p) => p.panelType));
  });

  it("flips side to 'outer' while keeping kind/pourId/edgeId/source/flags", () => {
    const inners = [inner("a", 0, 75)];
    const [out] = syncOuterPlacements(inners);
    expect(out?.side).toBe("outer");
    expect(out?.kind).toBe("panel");
    expect(out?.pourId).toBe("pour-1");
    expect(out?.edgeId).toBe("edge:bottom");
    expect(out?.source).toBe("auto");
    expect(out?.flags).toEqual([]);
  });

  it("issues a distinct id per outer placement (not the inner id verbatim)", () => {
    const inners = [inner("a", 0, 75), inner("b", 75, 75)];
    const outers = syncOuterPlacements(inners);
    expect(outers[0]?.id).not.toBe(inners[0]?.id);
    expect(new Set(outers.map((p) => p.id)).size).toBe(outers.length);
  });

  it("preserves corner-panel kind through sync (inner C30x30 → outer C30x30 at same offset)", () => {
    const c30: Placement = {
      id: "placement:edge:1:corner:A",
      edgeId: "edge:1",
      pourId: "pour-1",
      side: "inner",
      kind: "corner-panel",
      panelType: "C30x30",
      offsetAlongEdge: -30,
      width: 30,
      source: "auto",
      flags: [],
    };
    const [out] = syncOuterPlacements([c30]);
    expect(out?.kind).toBe("corner-panel");
    expect(out?.panelType).toBe("C30x30");
    expect(out?.offsetAlongEdge).toBe(-30);
    expect(out?.side).toBe("outer");
  });
});
