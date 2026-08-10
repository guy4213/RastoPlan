import { describe, expect, it } from "vitest";
import type { Placement } from "../../types.js";
import { collapsePlacementUnits, countCornerUnits } from "../units.js";

function leg(overrides: Partial<Placement>): Placement {
  return {
    id: "p",
    edgeId: "edge:w1",
    wallId: "w1",
    pourId: "pour-1",
    side: "faceA",
    faceIsInterior: true,
    kind: "corner-panel",
    panelType: "C30x30",
    groupId: "corner:node:0:region:0",
    offsetAlongEdge: 0,
    width: 30,
    source: "auto",
    flags: [],
    ...overrides,
  };
}

describe("collapsePlacementUnits", () => {
  it("collapses the two legs of one corner panel into a single unit", () => {
    const units = collapsePlacementUnits([
      leg({ id: "a", edgeId: "edge:w1" }),
      leg({ id: "b", edgeId: "edge:w2" }),
    ]);

    expect(units).toHaveLength(1);
  });

  it("collapses legs that sit on different FACES of their respective walls", () => {
    // At a corner between two walls drawn in opposite directions, one leg lands
    // on faceA and the other on faceB even though they are one physical panel.
    // Keying the collapse on `side` used to split them into two units.
    const units = collapsePlacementUnits([
      leg({ id: "a", edgeId: "edge:w1", side: "faceA" }),
      leg({ id: "b", edgeId: "edge:w2", side: "faceB" }),
    ]);

    expect(units).toHaveLength(1);
    expect(countCornerUnits(units)).toBe(1);
  });

  it("keeps corner panels of different rooms apart at a shared corner", () => {
    const units = collapsePlacementUnits([
      leg({ id: "a", groupId: "corner:node:0:region:0" }),
      leg({ id: "b", groupId: "corner:node:0:region:1" }),
    ]);

    expect(countCornerUnits(units)).toBe(2);
  });

  it("leaves ungrouped placements alone", () => {
    const units = collapsePlacementUnits([
      leg({ id: "s1", kind: "panel", panelType: "R75", groupId: undefined }),
      leg({ id: "s2", kind: "panel", panelType: "R75", groupId: undefined }),
    ]);

    expect(units).toHaveLength(2);
  });

  it("picks a stable representative regardless of input order", () => {
    const legs = [leg({ id: "a", edgeId: "edge:w1" }), leg({ id: "b", edgeId: "edge:w2" })];

    expect(collapsePlacementUnits(legs)[0]!.id).toBe(
      collapsePlacementUnits([...legs].reverse())[0]!.id
    );
  });
});
