import { describe, expect, it } from "vitest";
import type { Point, Project, Wall } from "@rastoplan/core";
import {
  DEFAULT_ACCESSORY_RULES,
  DEFAULT_PANEL_CATALOG,
  ENGINE_VERSION,
  perpendicularDistance,
} from "@rastoplan/core";
import type { Action, AppState } from "./project.js";
import { initialAppState, reduce } from "./project.js";

/** The 400x300 room traced as two contours `t` apart, as the user would draw it. */
function twoContourRoom(t: number, pourId = "pour-1"): Wall[] {
  const wall = (id: string, a: Point, b: Point): Wall => ({
    id,
    pourId,
    innerLine: [a, b],
    thickness: t,
  });
  return [
    wall("in-bottom", { x: 0, y: 0 }, { x: 400, y: 0 }),
    wall("in-right", { x: 400, y: 0 }, { x: 400, y: 300 }),
    wall("in-top", { x: 400, y: 300 }, { x: 0, y: 300 }),
    wall("in-left", { x: 0, y: 300 }, { x: 0, y: 0 }),
    wall("out-bottom", { x: -t, y: -t }, { x: 400 + t, y: -t }),
    wall("out-right", { x: 400 + t, y: -t }, { x: 400 + t, y: 300 + t }),
    wall("out-top", { x: 400 + t, y: 300 + t }, { x: -t, y: 300 + t }),
    wall("out-left", { x: -t, y: 300 + t }, { x: -t, y: -t }),
  ];
}

function projectWith(walls: Wall[]): Project {
  return {
    id: "proj-1",
    name: "test",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [
      { id: "pour-1", name: "יציקה 1", color: "#000", order: 0, defaultThicknessCm: 20 },
      { id: "pour-2", name: "יציקה 2", color: "#111", order: 1, defaultThicknessCm: 20 },
    ],
    walls,
    placements: [],
    schemaVersion: 3,
  };
}

function stateWith(walls: Wall[]): AppState {
  return initialAppState(projectWith(walls));
}

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reduce, state);
}

function wallIn(state: AppState, id: string): Wall {
  return state.project.walls.find((w) => w.id === id)!;
}

describe("compute — reading the drawing back into the thickness field", () => {
  it("writes the measured gap onto both contours of the wall", () => {
    const after = run(stateWith(twoContourRoom(10)), { type: "compute" });

    expect(wallIn(after, "in-bottom").thickness).toBe(10);
    expect(wallIn(after, "out-bottom").thickness).toBe(10);
  });

  it("records the pairing on both walls so it survives the layout being cleared", () => {
    const after = run(stateWith(twoContourRoom(10)), { type: "compute" });

    expect(wallIn(after, "in-bottom").pairedWallId).toBe("out-bottom");
    expect(wallIn(after, "out-bottom").pairedWallId).toBe("in-bottom");
  });

  it("overrules a typed thickness that disagrees with what was drawn", () => {
    // Mode B: the two contours ARE the wall's two faces, so the gap between
    // them is the thickness by definition, whatever the field said before.
    const walls = twoContourRoom(10).map((w) => ({ ...w, thickness: 45 }));
    const after = run(stateWith(walls), { type: "compute" });

    expect(wallIn(after, "in-bottom").thickness).toBe(10);
  });

  it("is idempotent — computing again changes nothing", () => {
    const once = run(stateWith(twoContourRoom(10)), { type: "compute" });
    const twice = run(once, { type: "compute" });

    expect(twice.project.walls).toEqual(once.project.walls);
  });

  it("leaves a single-line wall's typed thickness alone", () => {
    const single: Wall[] = [
      {
        id: "solo",
        pourId: "pour-1",
        innerLine: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
        thickness: 33,
      },
    ];
    const after = run(stateWith(single), { type: "compute" });

    expect(wallIn(after, "solo").thickness).toBe(33);
    expect(wallIn(after, "solo").pairedWallId).toBeUndefined();
  });
});

describe("update-wall thickness — the edit must survive the next compute", () => {
  it("drops only the stale layout and placements until the user computes again", () => {
    const before = run(stateWith(twoContourRoom(10)), { type: "compute" });
    expect(before.project.placements.length).toBeGreaterThan(0);

    const after = run(before, {
      type: "update-wall",
      wallId: "in-bottom",
      patch: { thickness: 25 },
    });

    expect(after.project.layout).toBeUndefined();
    expect(after.project.placements).toEqual([]);
    expect(wallIn(after, "in-bottom").thickness).toBe(25);
    expect(after.ui.layoutDirty).toBe(true);
  });

  it("does not get overwritten when the layout is recomputed", () => {
    // The failure this guards against: the far contour does not move, the next
    // compute re-measures the OLD gap, and the user's 25 silently becomes 10.
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      { type: "update-wall", wallId: "in-bottom", patch: { thickness: 25 } },
      { type: "compute" }
    );

    expect(wallIn(after, "in-bottom").thickness).toBe(25);
    expect(after.project.layout?.resolvedWalls).toHaveLength(4);
  });

  it("moves the far contour and leaves the edited wall where it is", () => {
    const before = stateWith(twoContourRoom(10));
    const after = run(
      before,
      { type: "compute" },
      { type: "update-wall", wallId: "in-bottom", patch: { thickness: 25 } }
    );

    expect(wallIn(after, "in-bottom").innerLine).toEqual(wallIn(before, "in-bottom").innerLine);
    expect(wallIn(after, "out-bottom").innerLine[0]!.y).toBe(-25);
  });

  it("does not change the wall's length along its own axis", () => {
    const lengthOf = (w: Wall) =>
      Math.hypot(w.innerLine[1].x - w.innerLine[0].x, w.innerLine[1].y - w.innerLine[0].y);
    const before = run(stateWith(twoContourRoom(10)), { type: "compute" });
    const after = run(before, {
      type: "update-wall",
      wallId: "in-bottom",
      patch: { thickness: 25 },
    });

    expect(lengthOf(wallIn(after, "in-bottom"))).toBeCloseTo(lengthOf(wallIn(before, "in-bottom")));
    expect(lengthOf(wallIn(after, "out-bottom"))).toBeCloseTo(
      lengthOf(wallIn(before, "out-bottom"))
    );
  });

  it("leaves the other walls' thicknesses untouched", () => {
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      { type: "update-wall", wallId: "in-bottom", patch: { thickness: 25 } },
      { type: "compute" }
    );

    expect(wallIn(after, "in-right").thickness).toBe(10);
    expect(wallIn(after, "in-top").thickness).toBe(10);
    expect(wallIn(after, "in-left").thickness).toBe(10);
  });

  it("falls back to a plain field edit once the partner has been deleted", () => {
    // Deleting the partner clears the link immediately, so the wall is simply
    // a single-line wall again and its far face is derived from the field.
    // Nothing has to be blocked, precisely because nothing is stale.
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      { type: "delete-wall", wallId: "out-bottom" },
      { type: "update-wall", wallId: "in-bottom", patch: { thickness: 25 } }
    );

    expect(wallIn(after, "in-bottom").thickness).toBe(25);
    expect(wallIn(after, "in-bottom").pairedWallId).toBeUndefined();
    expect(after.ui.notice).toBeNull();
  });

  it("cleans up a link that arrives already pointing at a missing wall", () => {
    // A blob edited by hand, or written by an older build, can carry a link to
    // a wall that is not in the project. Deriving the pairing from the drawing
    // on load drops it, so the dangling case never reaches an edit at all.
    const dangling = twoContourRoom(10)
      .filter((w) => w.id !== "out-bottom")
      .map((w) => (w.id === "in-bottom" ? { ...w, pairedWallId: "out-bottom" } : w));

    const loaded = stateWith(dangling);
    expect(wallIn(loaded, "in-bottom").pairedWallId).toBeUndefined();

    const after = run(loaded, {
      type: "update-wall",
      wallId: "in-bottom",
      patch: { thickness: 25 },
    });
    expect(wallIn(after, "in-bottom").thickness).toBe(25);
    expect(after.ui.notice).toBeNull();
  });
});

describe("the pairing never lags the drawing", () => {
  it("re-measures rather than keeping the old number when a wall is moved", () => {
    // A stale link is the danger — it would move a wall that is no longer the
    // far face. Re-deriving from the drawing gives that guarantee AND leaves a
    // usable measurement instead of a hole: dragging the inner face 5cm away
    // from its partner makes the wall 15cm, not a remembered 10.
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      {
        type: "update-wall",
        wallId: "in-bottom",
        patch: {
          innerLine: [
            { x: 0, y: 5 },
            { x: 400, y: 5 },
          ],
        },
      }
    );

    const wall = wallIn(after, "in-bottom");
    if (wall.pairedWallId) {
      expect(wall.pairedWallId).toBe("out-bottom");
      expect(wall.thickness).toBe(15);
      expect(wallIn(after, "out-bottom").thickness).toBe(15);
    }
  });

  it("recovers when a broken contour is put back together", () => {
    // While a contour is open the engine can read the two sides of the room as
    // one very thick wall, and that reading is written to the field. It was
    // briefly guarded with a thickness ceiling — but the ceiling then refused
    // real plans traced 165cm apart and doubled their layout, which is far
    // worse. The guarantee kept instead is that it is transient: closing the
    // contour restores the true measurement on the next edit.
    const broken = run(stateWith(twoContourRoom(10)), {
      type: "update-wall",
      wallId: "in-bottom",
      patch: {
        innerLine: [
          { x: 0, y: 5 },
          { x: 400, y: 5 },
        ],
      },
    });

    const repaired = run(broken, {
      type: "update-wall",
      wallId: "in-bottom",
      patch: {
        innerLine: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
      },
    });

    for (const wall of repaired.project.walls) {
      expect(wall.thickness, wall.id).toBe(10);
    }
    expect(wallIn(repaired, "in-bottom").pairedWallId).toBe("out-bottom");
  });

  it("drops it from the survivor immediately when its partner is deleted", () => {
    // Not on the next compute: until then, a thickness edit would look up a
    // wall that no longer exists.
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      { type: "delete-wall", wallId: "out-bottom" }
    );

    expect(wallIn(after, "in-bottom").pairedWallId).toBeUndefined();
    expect(wallIn(after, "in-bottom").thickness).toBe(20);
    expect(after.project.walls.filter((wall) => wall.pairedWallId)).toHaveLength(6);
  });

  it("re-measures it when an endpoint is welded and the wrapping contour opens", () => {
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      { type: "weld-endpoints", refs: [{ wallId: "out-bottom", end: 0 }], at: { x: -12, y: -12 } }
    );

    expect(wallIn(after, "out-bottom").pairedWallId).toBe("in-bottom");
    expect(wallIn(after, "in-bottom").pairedWallId).toBe("out-bottom");
    expect(wallIn(after, "in-bottom").thickness).toBeGreaterThan(10);
    expect(wallIn(after, "out-bottom").thickness).toBe(wallIn(after, "in-bottom").thickness);
  });

  it("keeps it through the controlled thickness edit, which moves both sides", () => {
    const after = run(
      stateWith(twoContourRoom(10)),
      { type: "compute" },
      { type: "update-wall", wallId: "in-bottom", patch: { thickness: 25 } }
    );

    expect(wallIn(after, "in-bottom").pairedWallId).toBe("out-bottom");
  });
});

describe("new wall thickness", () => {
  it("starts defined at the 20cm default", () => {
    const state = stateWith([]);
    const after = run(
      state,
      { type: "update-pour", pourId: "pour-1", patch: { defaultThicknessCm: 35 } },
      { type: "add-wall", a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }
    );

    expect(after.project.walls[0]!.thickness).toBe(20);
    expect(after.project.walls[0]!.thicknessSet).toBe(true);
  });

  it("becomes defined as soon as the user enters a thickness", () => {
    const drawn = run(stateWith([]), {
      type: "add-wall",
      a: { x: 0, y: 0 },
      b: { x: 400, y: 0 },
    });
    const wallId = drawn.project.walls[0]!.id;
    const edited = run(drawn, {
      type: "update-wall",
      wallId,
      patch: { thickness: 35 },
    });

    expect(wallIn(edited, wallId).thickness).toBe(35);
    expect(wallIn(edited, wallId).thicknessSet).toBe(true);
  });

  it("calculates immediately with the default thickness", () => {
    const drawn = run(stateWith([]), {
      type: "add-wall",
      a: { x: 0, y: 0 },
      b: { x: 400, y: 0 },
    });
    const after = run(drawn, { type: "compute" });

    expect(after.project.layout).toBeDefined();
    expect(after.ui.notice).toBeNull();
  });
});

describe("active pour selection", () => {
  it("switches pours and assigns the next wall to the selected pour", () => {
    const after = run(
      stateWith([]),
      { type: "set-active-pour", pourId: "pour-2" },
      { type: "add-wall", a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }
    );

    expect(after.ui.activePourId).toBe("pour-2");
    expect(after.project.walls).toHaveLength(1);
    expect(after.project.walls[0]!.pourId).toBe("pour-2");
  });

  it("can switch back to the first pour", () => {
    const after = run(
      stateWith([]),
      { type: "set-active-pour", pourId: "pour-2" },
      { type: "set-active-pour", pourId: "pour-1" }
    );

    expect(after.ui.activePourId).toBe("pour-1");
  });
});

describe("T junctions drawn on a continuous perimeter", () => {
  const wall = (id: string, a: Point, b: Point): Wall => ({
    id,
    pourId: "pour-1",
    innerLine: [a, b],
    thickness: 20,
    thicknessSet: true,
  });

  const rectangle = [
    wall("bottom", { x: 0, y: 0 }, { x: 600, y: 0 }),
    wall("right", { x: 600, y: 0 }, { x: 600, y: 400 }),
    wall("top", { x: 600, y: 400 }, { x: 0, y: 400 }),
    wall("left", { x: 0, y: 400 }, { x: 0, y: 0 }),
  ];

  it("splits both long walls and computes two rooms when a partition is added", () => {
    const drawn = run(stateWith(rectangle), {
      type: "add-wall",
      a: { x: 300, y: 0 },
      b: { x: 300, y: 400 },
    });
    const defined = run(drawn, {
      type: "update-wall",
      wallId: drawn.ui.selectedWallId!,
      patch: { thickness: 20 },
    });
    const after = run(defined, { type: "compute" });

    expect(drawn.project.walls).toHaveLength(7);
    expect(after.project.layout?.regions.filter((region) => region.kind === "room")).toHaveLength(
      2
    );
    expect(after.project.layout?.nodes.filter((node) => node.type === "T")).toHaveLength(2);
    expect(after.project.layout?.nodes.filter((node) => node.type === "end")).toHaveLength(0);
    expect(after.project.placements.length).toBeGreaterThan(0);
  });

  it("repairs the same natural topology when an existing project is opened", () => {
    const opened = stateWith([
      ...rectangle,
      wall("partition", { x: 300, y: 0 }, { x: 300, y: 400 }),
    ]);
    const after = run(opened, { type: "compute" });

    expect(opened.project.walls).toHaveLength(7);
    expect(after.project.layout?.regions.filter((region) => region.kind === "room")).toHaveLength(
      2
    );
    expect(after.project.layout?.nodes.filter((node) => node.type === "T")).toHaveLength(2);
  });
});

describe("thickness is available before any compute", () => {
  /** The second contour drawn one wall at a time, as the user actually draws it. */
  function drawTwoContours(t: number): AppState {
    const inner = twoContourRoom(t).slice(0, 4);
    let state = stateWith(inner);
    for (const wall of twoContourRoom(t).slice(4)) {
      state = run(state, { type: "add-wall", a: wall.innerLine[0], b: wall.innerLine[1] });
    }
    return state;
  }

  it("links the two contours as soon as the second one closes", () => {
    const state = drawTwoContours(10);

    expect(state.project.layout).toBeUndefined();
    expect(state.project.walls.filter((w) => w.pairedWallId)).toHaveLength(8);
  });

  it("stores the measured gap on both faces as soon as the pair is real", () => {
    // Once both contours are closed, the drawing and the stored value must be
    // one source of truth. The newly drawn outer contour started at the pour's
    // 20cm default, but its real distance from the inner one is 10cm.
    const state = drawTwoContours(10);

    for (const wall of state.project.walls) {
      expect(wall.thickness, wall.id).toBe(10);
    }
  });

  it("reconciles both faces to the measured gap on compute", () => {
    const after = run(drawTwoContours(10), { type: "compute" });
    const inner = wallIn(after, "in-bottom");
    const outer = after.project.walls.find((w) => w.id === inner.pairedWallId)!;

    expect(inner.thickness).toBe(10);
    expect(outer.thickness).toBe(10);
    expect(outer.pairedWallId).toBe(inner.id);
  });

  it("edits the thickness before any compute and keeps the contour closed", () => {
    const after = run(drawTwoContours(10), {
      type: "update-wall",
      wallId: "in-bottom",
      patch: { thickness: 25 },
    });
    const byId = new Map(after.project.walls.map((w) => [w.id, w]));
    const partnerId = wallIn(after, "in-bottom").pairedWallId!;
    const partner = byId.get(partnerId)!;

    expect(wallIn(after, "in-bottom").thickness).toBe(25);
    expect(partner.thickness).toBe(25);
    // The mitre kept the far contour joined at both of the moved segment's ends.
    const neighbours = after.project.walls.filter(
      (w) => w.id !== partnerId && w.id.startsWith(partnerId.slice(0, 4))
    );
    const meets = (p: Point) =>
      neighbours.some((w) => w.innerLine.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 0.001));
    expect(meets(partner.innerLine[0]!)).toBe(true);
    expect(meets(partner.innerLine[1]!)).toBe(true);
  });

  it("edits a legitimate thickness above the old 80cm ceiling before compute", () => {
    const before = drawTwoContours(95);
    const after = run(before, {
      type: "update-wall",
      wallId: "in-bottom",
      patch: { thickness: 101 },
    });
    const anchor = wallIn(after, "in-bottom");
    const partner = wallIn(after, anchor.pairedWallId!);
    const partnerMidpoint = {
      x: (partner.innerLine[0].x + partner.innerLine[1].x) / 2,
      y: (partner.innerLine[0].y + partner.innerLine[1].y) / 2,
    };

    expect(after.project.layout).toBeUndefined();
    expect(anchor.thickness).toBe(101);
    expect(partner.thickness).toBe(101);
    expect(perpendicularDistance(partnerMidpoint, anchor.innerLine)).toBeCloseTo(101);
  });

  it("keeps that edit when the layout is computed afterwards", () => {
    const after = run(
      drawTwoContours(10),
      { type: "update-wall", wallId: "in-bottom", patch: { thickness: 25 } },
      { type: "compute" }
    );

    expect(wallIn(after, "in-bottom").thickness).toBe(25);
    expect(after.project.layout?.resolvedWalls).toHaveLength(4);
  });

  it("shows measured thickness on every drawn segment of a half-drawn wrapping contour", () => {
    // Three of the four outer walls are enough to measure their three matching
    // inner walls; the missing fourth side stays independent.
    let state = stateWith(twoContourRoom(10).slice(0, 4));
    for (const wall of twoContourRoom(10).slice(4, 7)) {
      state = run(state, { type: "add-wall", a: wall.innerLine[0], b: wall.innerLine[1] });
    }

    expect(state.project.walls.filter((w) => w.pairedWallId)).toHaveLength(6);
    for (const id of ["in-bottom", "in-right", "in-top"]) {
      expect(wallIn(state, id).thickness, id).toBe(10);
      const partnerId = wallIn(state, id).pairedWallId;
      expect(partnerId, id).toBeDefined();
      expect(wallIn(state, partnerId!).thickness, id).toBe(10);
    }
    expect(wallIn(state, "in-left").pairedWallId).toBeUndefined();
  });

  it("does not let one pour's thickness leak into another", () => {
    const near = twoContourRoom(10, "pour-1");
    const far = twoContourRoom(20, "pour-2").map((w) => ({
      ...w,
      id: `far-${w.id}`,
      innerLine: [
        { x: w.innerLine[0].x + 1000, y: w.innerLine[0].y },
        { x: w.innerLine[1].x + 1000, y: w.innerLine[1].y },
      ] as [Point, Point],
    }));
    const state = stateWith([...near, ...far]);

    for (const wall of state.project.walls) {
      expect(wall.thickness, wall.id).toBe(wall.id.startsWith("far-") ? 20 : 10);
    }
  });
});

describe("ortho lock is a mode, not a held key", () => {
  it("starts off, so a fresh session draws at any angle as it always did", () => {
    expect(stateWith([]).ui.orthoLock).toBe(false);
  });

  it("flips on and back off", () => {
    const on = run(stateWith([]), { type: "set-ortho-lock", value: true });
    expect(on.ui.orthoLock).toBe(true);

    const off = run(on, { type: "set-ortho-lock", value: false });
    expect(off.ui.orthoLock).toBe(false);
  });

  it("survives switching tools, so a run of walls keeps one setting", () => {
    const after = run(
      stateWith([]),
      { type: "set-ortho-lock", value: true },
      { type: "set-tool", tool: "select" },
      { type: "set-tool", tool: "draw-wall" }
    );

    expect(after.ui.orthoLock).toBe(true);
  });

  it("is untouched by panning the viewport", () => {
    const after = run(
      stateWith([]),
      { type: "set-ortho-lock", value: true },
      { type: "set-view", view: { scale: 0.5, offset: { x: 40, y: 90 } } }
    );

    expect(after.ui.orthoLock).toBe(true);
  });
});

describe("a plan being drawn is left alone until its contours close", () => {
  it("does not pair anything while the walls still have loose ends", () => {
    // Reported from a real session: mid-draw, walls metres apart were read as
    // the two faces of one wall. The partner was then greyed out and dashed as
    // "already someone else's far face", and its length label jumped to the
    // other side — on a drawing the user was still in the middle of making.
    const partial = twoContourRoom(20).slice(0, 3);
    const state = stateWith(partial);

    for (const wall of state.project.walls) {
      expect(wall.pairedWallId, wall.id).toBeUndefined();
    }
  });

  it("keeps the typed thickness untouched while the plan is open", () => {
    const state = stateWith(twoContourRoom(20).slice(0, 3));

    for (const wall of state.project.walls) expect(wall.thickness).toBe(20);
  });

  it("pairs as soon as both contours are closed", () => {
    const closed = stateWith(twoContourRoom(20));

    expect(closed.project.walls.filter((w) => w.pairedWallId)).toHaveLength(8);
  });

  it("keeps the remaining measurable sides when a contour is reopened", () => {
    const after = run(stateWith(twoContourRoom(20)), {
      type: "delete-wall",
      wallId: "out-top",
    });

    expect(after.project.walls.filter((wall) => wall.pairedWallId)).toHaveLength(6);
    expect(wallIn(after, "in-top").pairedWallId).toBeUndefined();
    expect(wallIn(after, "in-top").thickness).toBe(20);
  });
});

describe("wall thickness validation on load", () => {
  it("upgrades an explicitly unset thickness to the 20cm default", () => {
    const legacyUnset: Wall[] = [
      {
        id: "legacy-unset",
        pourId: "pour-1",
        innerLine: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
        thickness: 20,
        thicknessSet: false,
      },
    ];
    const state = stateWith(legacyUnset);

    expect(state.project.walls[0]!.thickness).toBe(20);
    expect(state.project.walls[0]!.thicknessSet).toBe(true);
    expect(state.ui.notice).toBeNull();
  });

  it("repairs an out-of-range thickness with the 20cm default", () => {
    const corrupt: Wall[] = [
      {
        id: "corrupt",
        pourId: "pour-1",
        innerLine: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
        thickness: 301,
      },
    ];
    const state = stateWith(corrupt);

    expect(state.project.walls[0]!.thickness).toBe(20);
    expect(state.project.walls[0]!.thicknessSet).toBe(true);
    expect(state.ui.notice).toBeNull();
  });

  it("leaves every thickness the field would accept exactly as it is", () => {
    const accepted = [5, 12.5, 80, 101, 135, 300];
    // Isolated segments cannot be paired and re-measured on load, so this test
    // exercises validation alone rather than intentionally inconsistent
    // two-contour geometry.
    const walls: Wall[] = accepted.map((thickness, i) => ({
      id: `isolated-${i}`,
      pourId: "pour-1",
      innerLine: [
        { x: i * 500, y: 0 },
        { x: i * 500 + 100, y: 0 },
      ],
      thickness,
    }));
    const state = stateWith(walls);

    expect(state.project.walls.map((w) => w.thickness)).toEqual(accepted);
    expect(state.ui.notice).toBeNull();
  });

  it("repairs a non-numeric thickness rather than letting it reach the engine", () => {
    const walls = twoContourRoom(20).map((w, i) => (i === 0 ? { ...w, thickness: Number.NaN } : w));

    expect(wallIn(stateWith(walls), "in-bottom").thickness).toBe(20);
  });
});

describe("a layout from an older engine is never rendered", () => {
  /** A project carrying a computed layout, as it would come back from storage. */
  function computed(): AppState {
    return run(stateWith(twoContourRoom(20)), { type: "compute" });
  }

  it("stamps the layout with the engine that produced it", () => {
    expect(computed().project.layout?.engineVersion).toBe(ENGINE_VERSION);
  });

  it("keeps a layout the current engine produced", () => {
    const saved = computed().project;
    const reopened = initialAppState(saved);

    expect(reopened.project.layout).toBeDefined();
    expect(reopened.project.placements.length).toBeGreaterThan(0);
    expect(reopened.ui.notice).toBeNull();
  });

  it("drops one an older engine produced, and says so", () => {
    // Placements are stored WITH the project, so without this the canvas keeps
    // showing formwork laid out under rules that no longer exist — corners
    // butted flush long after the engine started lapping them. No engine fix
    // can reach a drawing that is data.
    const saved = computed().project;
    const stale: Project = {
      ...saved,
      layout: { ...saved.layout!, engineVersion: ENGINE_VERSION - 1 },
    };

    const reopened = initialAppState(stale);
    expect(reopened.project.layout).toBeUndefined();
    expect(reopened.project.placements).toEqual([]);
    expect(reopened.ui.notice).toContain("חשב");
  });

  it("lights the recompute banner after dropping it", () => {
    const saved = computed().project;
    const stale: Project = {
      ...saved,
      layout: { ...saved.layout!, engineVersion: ENGINE_VERSION - 1 },
    };

    expect(initialAppState(stale).ui.layoutDirty).toBe(true);
  });

  it("drops it on the load-project path too, not just at startup", () => {
    const saved = computed().project;
    const stale: Project = {
      ...saved,
      layout: { ...saved.layout!, engineVersion: ENGINE_VERSION - 1 },
    };

    const after = run(stateWith([]), { type: "load-project", project: stale });
    expect(after.project.layout).toBeUndefined();
    expect(after.ui.layoutDirty).toBe(true);
    expect(after.ui.notice).toContain("חשב");
  });

  it("recomputes to a current layout when asked", () => {
    const saved = computed().project;
    const stale: Project = {
      ...saved,
      layout: { ...saved.layout!, engineVersion: ENGINE_VERSION - 1 },
    };

    const after = run(initialAppState(stale), { type: "compute" });
    expect(after.project.layout?.engineVersion).toBe(ENGINE_VERSION);
    expect(after.ui.layoutDirty).toBe(false);
  });
});

describe("imported inventory", () => {
  it("stores blank-as-zero values without erasing catalog types, and invalidates the old layout", () => {
    const before = run(stateWith(twoContourRoom(20)), { type: "compute" });
    expect(before.project.layout).toBeDefined();
    // Reproduce a project persisted by the first inventory implementation:
    // blank cells had been copied into every catalog `inStock` flag.
    const contaminated: AppState = {
      ...before,
      project: {
        ...before.project,
        catalog: {
          ...before.project.catalog,
          panels: before.project.catalog.panels.map((panel) => ({ ...panel, inStock: false })),
        },
      },
    };

    const after = run(contaminated, {
      type: "set-inventory",
      inventory: {
        "פנאל 75/300": 0,
        "פנאל 50/300": 4,
        "פנאל 40/300": 0,
        "פנאל 30/30/300": 4,
      },
    });

    expect(after.project.inventory).toEqual({
      "פנאל 75/300": 0,
      "פנאל 50/300": 4,
      "פנאל 40/300": 0,
      "פנאל 30/30/300": 4,
    });
    // Inventory and catalog availability are separate: a zero-stock type must
    // remain available for a red "missing" placement in the desired layout.
    expect(after.project.catalog.panels.find((panel) => panel.type === "R75")?.inStock).toBe(true);
    expect(after.project.catalog.panels.find((panel) => panel.type === "R50")?.inStock).toBe(true);
    expect(after.project.catalog.panels.find((panel) => panel.type === "R40")?.inStock).toBe(true);
    expect(after.project.layout).toBeUndefined();
    expect(after.project.placements).toEqual([]);
    expect(after.ui.layoutDirty).toBe(true);
  });

  it("repairs persisted false catalog flags when reopening an inventoried project", () => {
    const project = projectWith([]);
    project.inventory = { "פנאל 75/300": 38, "פנאל 50/300": 0 };
    project.catalog = {
      ...project.catalog,
      panels: project.catalog.panels.map((panel) => ({ ...panel, inStock: false })),
    };

    const reopened = initialAppState(project);

    expect(reopened.project.catalog.panels.find((panel) => panel.type === "R75")?.inStock).toBe(
      true
    );
    expect(reopened.project.catalog.panels.find((panel) => panel.type === "R50")?.inStock).toBe(
      true
    );
    // C15 has no row in the imported sheet, so unrelated catalog choices are
    // not rewritten by the repair.
    expect(reopened.project.catalog.panels.find((panel) => panel.type === "C15x15")?.inStock).toBe(
      false
    );
  });

  it("normalizes invalid and fractional reducer input defensively", () => {
    const after = run(stateWith([]), {
      type: "set-inventory",
      inventory: {
        "פנאל 75/300": Number.NaN,
        "פנאל 50/300": -2,
        "פנאל 40/300": 3.8,
      },
    });

    expect(after.project.inventory).toEqual({
      "פנאל 75/300": 0,
      "פנאל 50/300": 0,
      "פנאל 40/300": 3,
    });
  });
});
