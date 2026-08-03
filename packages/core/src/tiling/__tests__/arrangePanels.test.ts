import { describe, expect, it } from "vitest";
import type { Panel } from "../../types.js";
import { arrangePanels } from "../arrangePanels.js";

function panel(width: number, type = `R${width}`): Panel {
  return {
    type,
    width,
    height: 300,
    isLeading: width === 75,
    inStock: true,
    kind: "straight",
    bomLabel: `פנאל ${width}/300`,
  };
}

describe("arrangePanels", () => {
  it("odd panel count: the single smallest panel sits exactly in the middle", () => {
    const items = arrangePanels([panel(75), panel(75), panel(75), panel(75), panel(40)], 0);

    expect(items.map((i) => i.width)).toEqual([75, 75, 40, 75, 75]);
    expect(items.map((i) => i.offsetAlongEdge)).toEqual([0, 75, 150, 190, 265]);
  });

  it("even panel count: the two smallest panels land in the two central positions", () => {
    const items = arrangePanels([panel(75), panel(75), panel(60), panel(60)], 0);

    expect(items.map((i) => i.width)).toEqual([75, 60, 60, 75]);
    expect(items.map((i) => i.offsetAlongEdge)).toEqual([0, 75, 135, 195]);
  });

  it("places the timber gap at the center seam, alongside the smallest panel", () => {
    const items = arrangePanels([panel(75)], 7);

    expect(items).toEqual([
      { kind: "panel", width: 75, offsetAlongEdge: 0, panel: panel(75) },
      { kind: "timber", width: 7, offsetAlongEdge: 75 },
    ]);
  });
});
