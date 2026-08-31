/**
 * Stage 2 visual verification for the parallel-tiling work.
 *
 * Seeds a plan into the running app, presses Calculate, and captures the canvas
 * — a full view plus a zoomed corner, so the joints on the two faces of a wall
 * can actually be compared by eye. Read-only with respect to the engine: it
 * drives the product exactly as a user would.
 *
 * Needs the built app being served:
 *   pnpm --filter @rastoplan/web build
 *   pnpm --filter @rastoplan/web preview --port 4173 --host 127.0.0.1
 *
 * Usage:
 *   node spikes/stage2-screenshots.cjs [rect|double|lshape|all] [--headed]
 */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("./.playwright-runner/node_modules/playwright");

const baseUrl = process.env.RASTOPLAN_URL ?? "http://127.0.0.1:4173";
const args = process.argv.slice(2);
const headless = !args.includes("--headed");
const outDir = path.join(__dirname, "screenshots");

const wall = (id, a, b, thickness = 20) => ({
  id,
  pourId: "pour-stage2",
  innerLine: [a, b],
  thickness,
  thicknessSet: true,
});
const ring = (prefix, x0, y0, x1, y1, t = 20) => [
  wall(`${prefix}-top`, { x: x0, y: y0 }, { x: x1, y: y0 }, t),
  wall(`${prefix}-right`, { x: x1, y: y0 }, { x: x1, y: y1 }, t),
  wall(`${prefix}-bottom`, { x: x1, y: y1 }, { x: x0, y: y1 }, t),
  wall(`${prefix}-left`, { x: x0, y: y1 }, { x: x0, y: y0 }, t),
];
const loop = (prefix, points, t = 20) =>
  points.map((point, i) =>
    wall(`${prefix}-${i}`, point, points[(i + 1) % points.length], t)
  );

const SCENARIOS = {
  // A plain room drawn as ONE contour: each wall gets a single row, so this is
  // the control case — nothing here should have changed.
  rect: {
    title: "single-contour rectangle 400x300, t=20",
    walls: ring("r", 0, 0, 400, 300),
  },
  // The two-contour plan the plan document uses as its fixture. Every wall has
  // two drawn faces, so every wall exercises the paired tiler.
  double: {
    title: "double contour 499x390 inner / 539x430 outer, t=20",
    walls: [...ring("inner", 0, 0, 499, 390), ...ring("outer", -20, -20, 519, 410)],
  },
  // An L: five convex corners and one re-entrant one. The concave corner is the
  // case Stage 3 is about; here it only needs to be visible.
  lshape: {
    title: "L-shaped single contour, t=20",
    walls: loop("l", [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 300 },
      { x: 350, y: 300 },
      { x: 350, y: 500 },
      { x: 0, y: 500 },
    ]),
  },
};

async function seed(page, name, walls) {
  await page.evaluate(
    async ({ seedWalls, seedName }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("rastoplan", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const existing = await new Promise((resolve, reject) => {
        const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const base = existing[0];
      if (!base) throw new Error("the app did not create a starting project");
      const project = {
        ...base,
        id: "stage2-visual",
        name: `Stage 2 — ${seedName}`,
        updatedAt: new Date().toISOString(),
        walls: seedWalls,
        pours: [{ id: "pour-stage2", name: "יציקה 1", thickness: 20 }],
        placements: [],
        layout: undefined,
        inventory: undefined,
      };
      await new Promise((resolve, reject) => {
        const request = db.transaction("projects", "readwrite").objectStore("projects").put(project);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
    { seedWalls: walls, seedName: name }
  );
}

/** Reads back what the engine actually produced, so the picture has numbers beside it. */
async function readLayout(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("rastoplan", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const project = await new Promise((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").get("stage2-visual");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const byEdge = new Map();
    for (const p of project.placements ?? []) {
      if (p.kind === "corner-panel") continue;
      byEdge.set(p.edgeId, [...(byEdge.get(p.edgeId) ?? []), p]);
    }
    const walls = [];
    for (const [edgeId, row] of byEdge) {
      const sort = (s) =>
        row.filter((p) => p.side === s).sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
      const a = sort("faceA");
      const b = sort("faceB");
      const span = (r) =>
        r.length ? [r[0].offsetAlongEdge, r[r.length - 1].offsetAlongEdge + r[r.length - 1].width] : null;
      const sa = span(a);
      const sb = span(b);
      let aligned = null;
      let shared = null;
      if (sa && sb) {
        const lo = Math.max(sa[0], sb[0]);
        const hi = Math.min(sa[1], sb[1]);
        shared = [lo, hi];
        const sig = (r) =>
          r
            .filter((p) => p.offsetAlongEdge >= lo && p.offsetAlongEdge + p.width <= hi)
            .map((p) => `${p.panelType || p.kind}@${p.offsetAlongEdge}`)
            .join(" ");
        aligned = sig(a) === sig(b);
      }
      walls.push({
        edgeId,
        faceA: sa,
        faceB: sb,
        shared,
        aligned,
        rowA: a.map((p) => p.panelType || p.kind),
        rowB: b.map((p) => p.panelType || p.kind),
      });
    }
    return {
      placements: (project.placements ?? []).length,
      diagnostics: (project.layout?.diagnostics ?? []).map((d) => d.code),
      flagged: (project.placements ?? []).filter((p) => p.flags.length).length,
      walls,
    };
  });
}

async function capture(page, file, clip) {
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, file);
  await page.screenshot({ path: target, ...(clip ? { clip } : {}) });
  return target;
}

/** Zooms the canvas in on a point, the way a user scrolls the wheel. */
async function zoomAt(page, x, y, steps) {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
}

(async () => {
  const wanted = args.find((a) => SCENARIOS[a]) ?? "all";
  const names = wanted === "all" ? Object.keys(SCENARIOS) : [wanted];

  const browser = await chromium.launch({
    headless,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const report = {};

  for (const name of names) {
    const scenario = SCENARIOS[name];
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await seed(page, name, scenario.walls);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "חשב" }).click();
    await page.waitForTimeout(900);

    const files = [await capture(page, `${name}-full.png`)];
    const layout = await readLayout(page);

    // A corner close-up: zoom into the canvas near the top-left of the plan,
    // where two walls meet and both faces are visible at once.
    const box = await page.locator("canvas").first().boundingBox();
    if (box) {
      const focus = { x: box.x + box.width * 0.34, y: box.y + box.height * 0.2 };
      await zoomAt(page, focus.x, focus.y, 6);
      files.push(await capture(page, `${name}-corner.png`));

      // Deeper still, cropped tight: at this scale the panel labels are legible
      // and a joint that did NOT line up across the wall would be obvious.
      await zoomAt(page, focus.x, focus.y, 7);
      files.push(
        await capture(page, `${name}-seam.png`, {
          x: Math.max(box.x, focus.x - 460),
          y: Math.max(box.y, focus.y - 200),
          width: 900,
          height: 520,
        })
      );
    }

    report[name] = { title: scenario.title, files, ...layout };
    console.log(`\n=== ${name}: ${scenario.title} ===`);
    console.log(`  placements ${layout.placements}, flagged ${layout.flagged}`);
    console.log(`  diagnostics: ${layout.diagnostics.join(", ") || "(none)"}`);
    for (const w of layout.walls) {
      const status = w.aligned === null ? "single row" : w.aligned ? "ALIGNED" : "MISALIGNED";
      console.log(
        `  ${w.edgeId}: ${status}` +
          (w.shared ? `  A${JSON.stringify(w.faceA)} B${JSON.stringify(w.faceB)} shared${JSON.stringify(w.shared)}` : "")
      );
    }
    for (const f of files) console.log(`  -> ${path.relative(process.cwd(), f)}`);
  }

  await browser.close();
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
})();
