import { describe, expect, it } from "vitest";
import { doubleContourRoomWallsAt } from "../../geometry/__tests__/fixtures.js";
import { previewPairings } from "../previewPairing.js";

describe("live thickness preview", () => {
  it("pairs the drawn segments of an open wrapping contour", () => {
    const walls = doubleContourRoomWallsAt(10);
    const partialOuter = [...walls.slice(0, 4), ...walls.slice(4, 7)];

    expect(previewPairings(partialOuter)).toEqual(
      expect.arrayContaining([
        { wallId: "in-bottom", partnerId: "out-bottom", thicknessCm: 10 },
        { wallId: "in-right", partnerId: "out-right", thicknessCm: 10 },
        { wallId: "in-top", partnerId: "out-top", thicknessCm: 10 },
      ])
    );
    expect(previewPairings(partialOuter)).toHaveLength(3);
  });

  it("does not guess while no contour is closed", () => {
    expect(previewPairings(doubleContourRoomWallsAt(20).slice(0, 3))).toEqual([]);
  });

  it("does not pair an attached partition with its enclosing room", () => {
    const walls = doubleContourRoomWallsAt(20).slice(0, 4);
    walls.push(
      {
        id: "partition-stem",
        pourId: walls[0]!.pourId,
        innerLine: [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
        ],
        thickness: 20,
      },
      {
        id: "partition",
        pourId: walls[0]!.pourId,
        innerLine: [
          { x: 0, y: 40 },
          { x: 400, y: 40 },
        ],
        thickness: 20,
      }
    );

    // This independent line is intentionally inside the room. It is not an
    // open second contour and must not steal the bottom wall's dimension.
    expect(previewPairings(walls)).toEqual([]);
  });
});
