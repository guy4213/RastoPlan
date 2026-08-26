const path = require("node:path");
const os = require("node:os");
const { chromium } = require("./.playwright-runner/node_modules/playwright");

const baseUrl = process.env.RASTOPLAN_URL ?? "http://127.0.0.1:4173";
const cliArgs = process.argv.slice(2);
const scenarioName = cliArgs.includes("simple")
  ? "simple"
  : cliArgs.includes("double-contour")
    ? "double-contour"
  : cliArgs.includes("reference")
    ? "reference"
    : cliArgs.includes("two-pours")
      ? "two-pours"
      : "exact";
const headless = cliArgs.includes("--headless");
const cdpUrl = process.env.RASTOPLAN_CDP_URL;
const keepOpenMs = Number(process.env.RASTOPLAN_KEEP_OPEN_MS ?? (headless ? 0 : 15_000));
const screenshotPath = path.join(os.tmpdir(), `rastoplan-${scenarioName}-room-current.png`);
const rawScreenshotPath = path.join(os.tmpdir(), `rastoplan-${scenarioName}-room-raw.png`);

const wall = (id, a, b, pourId = "pour-e2e") => ({
  id,
  pourId,
  innerLine: [a, b],
  thickness: 20,
  thicknessSet: true,
});

// Natural user input: the partition visually reaches the middle of the two
// perimeter walls, but those long walls were not manually split at x=300.
const simpleWalls = [
  wall("bottom", { x: 0, y: 0 }, { x: 600, y: 0 }),
  wall("right", { x: 600, y: 0 }, { x: 600, y: 400 }),
  wall("top", { x: 600, y: 400 }, { x: 0, y: 400 }),
  wall("left", { x: 0, y: 400 }, { x: 0, y: 0 }),
  wall("partition", { x: 300, y: 0 }, { x: 300, y: 400 }),
];

const rectangularRing = (prefix, x0, y0, x1, y1) => [
  wall(`${prefix}-top`, { x: x0, y: y0 }, { x: x1, y: y0 }),
  wall(`${prefix}-right`, { x: x1, y: y0 }, { x: x1, y: y1 }),
  wall(`${prefix}-bottom`, { x: x1, y: y1 }, { x: x0, y: y1 }),
  wall(`${prefix}-left`, { x: x0, y: y1 }, { x: x0, y: y0 }),
];

// Regression copied from the customer's screenshot: two genuinely drawn
// contours, with a different measured gap on each side. Both contours must be
// tiled exactly once; neither may disappear as a consumed-only helper line.
const doubleContourWalls = [
  ...rectangularRing("outer", 0, 0, 1692, 1288),
  ...rectangularRing("inner", 319, 385, 1210, 1001),
];

// A compact regression model of image.png: an orthogonal outline with several
// setbacks/projections, five partitions that terminate on wall midpoints, and
// one open-ended wall. The user should not have to pre-split any of these
// through-walls by hand.
const outlinePoints = [
  [0, 0], [700, 0], [700, 300], [600, 300], [600, 400],
  [750, 400], [750, 700], [600, 700], [600, 600], [500, 600],
  [500, 750], [350, 750], [350, 600], [250, 600], [250, 700],
  [0, 700], [0, 450], [100, 450], [100, 300], [0, 300],
].map(([x, y]) => ({ x, y }));
const referenceWalls = outlinePoints.map((point, index) =>
  wall(`outline-${index}`, point, outlinePoints[(index + 1) % outlinePoints.length])
);
referenceWalls.push(
  wall("partition-main", { x: 100, y: 300 }, { x: 600, y: 300 }),
  wall("partition-top", { x: 350, y: 0 }, { x: 350, y: 300 }),
  wall("partition-left", { x: 250, y: 300 }, { x: 250, y: 600 }),
  wall("partition-middle", { x: 250, y: 450 }, { x: 750, y: 450 }),
  wall("partition-lower", { x: 500, y: 450 }, { x: 500, y: 600 }),
  wall("open-branch", { x: 520, y: 0 }, { x: 520, y: 150 }),
);

// One-to-one trace of the magenta wall network in image.png. Coordinates are
// measured from the source pixels, translated to the origin and uniformly
// scaled. Each physical wall band becomes exactly one wall here; the gaps and
// open endpoints in the source image are deliberately preserved.
const sourceSegments = [
  [[535, 72], [791, 72]],
  [[535, 72], [535, 166]],
  [[535, 166], [482, 166]],
  [[482, 166], [482, 277]],
  [[482, 277], [661, 277]],
  [[661, 72], [661, 148]],
  [[661, 212], [661, 277]],
  [[791, 72], [791, 322]],
  [[661, 322], [791, 322]],
  [[690, 272], [690, 322]],
  [[661, 322], [661, 401]],
  [[765, 322], [765, 401]],
  [[661, 401], [765, 401]],
  [[605, 277], [605, 337]],
  [[461, 337], [605, 337]],
  [[520, 337], [520, 550]],
  [[595, 337], [595, 608]],
  [[520, 496], [595, 496]],
  [[595, 444], [765, 444]],
  [[765, 444], [765, 569]],
  [[765, 569], [837, 569]],
  [[837, 569], [837, 835]],
  [[667, 835], [837, 835]],
  [[667, 711], [667, 835]],
  [[761, 731], [761, 835]],
  [[761, 731], [837, 731]],
  [[459, 608], [619, 608]],
  [[619, 608], [619, 773]],
  [[397, 711], [397, 791]],
  [[397, 791], [489, 791]],
  [[489, 733], [489, 835]],
  [[489, 733], [619, 733]],
  [[569, 733], [569, 835]],
  [[489, 835], [569, 835]],
];
const SOURCE_ORIGIN = { x: 397, y: 72 };
const SOURCE_SCALE = 2;
const sourcePointToCanvas = ([x, y]) => ({
  x: (x - SOURCE_ORIGIN.x) * SOURCE_SCALE,
  y: (y - SOURCE_ORIGIN.y) * SOURCE_SCALE,
});
// Test oracle only: these points are never written into the project. The
// engine receives walls alone and the assertion below verifies that it found
// the same twelve corners the customer circled in the reference image.
const expectedExactExternalCornerKeys = [
  [535, 72], [791, 72], [482, 166], [482, 277], [661, 277], [765, 444],
  [837, 569], [397, 791], [489, 835], [569, 835], [667, 835], [837, 835],
].map(sourcePointToCanvas).map(({ x, y }) => `${x},${y}`).sort();
const exactReferenceWalls = sourceSegments.map(([a, b], index) =>
  wall(`ref-${String(index + 1).padStart(2, "0")}`, sourcePointToCanvas(a), sourcePointToCanvas(b))
);

// One physical line per gray wall run in image.png. Dark hatch gaps inside a
// continuous wall are joined; actual white openings stay separate. Lines
// underneath the magenta highlight are deliberately absent so no physical
// wall belongs to both pours.
const graySourceSegments = [
  [[175, 73], [426, 73]],
  [[175, 73], [175, 195]],
  [[175, 230], [175, 268]],
  [[175, 303], [175, 323]],
  [[426, 73], [426, 167]],
  [[426, 167], [482, 167]],
  [[301, 73], [301, 147]],
  [[301, 213], [301, 278]],
  [[301, 278], [375, 278]],
  [[401, 278], [482, 278]],
  [[175, 323], [272, 323]],
  [[272, 272], [272, 323]],
  [[201, 320], [201, 347]],
  [[201, 372], [201, 403]],
  [[201, 440], [201, 473]],
  [[201, 544], [201, 568]],
  [[124, 568], [204, 568]],
  [[128, 568], [128, 585]],
  [[128, 620], [128, 667]],
  [[128, 702], [128, 836]],
  [[128, 836], [299, 836]],
  [[296, 712], [296, 836]],
  [[128, 731], [206, 731]],
  [[293, 736], [391, 736]],
  [[301, 717], [301, 736]],
  [[347, 717], [347, 736]],
  [[348, 604], [348, 773]],
  [[348, 607], [459, 607]],
  [[195, 399], [303, 399]],
  [[195, 443], [371, 443]],
  [[301, 320], [301, 403]],
  [[358, 274], [358, 336]],
  [[355, 333], [425, 333]],
  [[422, 315], [422, 336]],
  [[368, 329], [368, 553]],
  [[368, 579], [368, 610]],
  [[403, 532], [462, 532]],
  [[406, 529], [406, 549]],
  [[460, 315], [460, 549]],
];
const grayReferenceWalls = graySourceSegments.map(([a, b], index) =>
  wall(
    `gray-${String(index + 1).padStart(2, "0")}`,
    sourcePointToCanvas(a),
    sourcePointToCanvas(b),
    "pour-gray"
  )
);
const walls = scenarioName === "simple"
  ? simpleWalls
  : scenarioName === "double-contour"
    ? doubleContourWalls
  : scenarioName === "reference"
    ? referenceWalls
    : scenarioName === "two-pours"
      ? [...exactReferenceWalls, ...grayReferenceWalls]
      : exactReferenceWalls;
const pours = scenarioName === "two-pours"
  ? [
      { id: "pour-e2e", name: "יציקה 1 — סגול", color: "#d946ef", order: 0 },
      { id: "pour-gray", name: "יציקה 2 — אפור", color: "#6b7280", order: 1 },
    ]
  : [{ id: "pour-e2e", name: "יציקה 1", color: "#2563eb", order: 0 }];
const expected = scenarioName === "simple"
  ? { rooms: 2, T: 2, end: 0 }
  : scenarioName === "reference"
    ? { rooms: 6, T: 11, end: 1 }
    : scenarioName === "exact"
      ? { rooms: 4, T: 15, end: 9 }
      : undefined;

async function seedProject(page) {
  await page.evaluate(async ({ seedWalls, seedScenarioName, seedPours }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("rastoplan", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const projects = await new Promise((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const base = projects[0];
    if (!base) throw new Error("seed project was not created");
    const project = {
      ...base,
      id: "playwright-complex-room",
      name: `Playwright — ${seedScenarioName} room`,
      updatedAt: new Date().toISOString(),
      walls: seedWalls,
      pours: seedPours,
      placements: [],
      layout: undefined,
      inventory: undefined,
      // Explicitly erase fixture data left by an older Playwright run. The
      // current product derives corners from `walls` during Calculate.
      externalCornerHints: undefined,
    };
    await new Promise((resolve, reject) => {
      const request = db.transaction("projects", "readwrite").objectStore("projects").put(project);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }, {
    seedWalls: walls,
    seedScenarioName: scenarioName,
    seedPours: pours,
  });
}

async function readProject(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("rastoplan", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("projects", "readonly")
        .objectStore("projects")
        .get("playwright-complex-room");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

(async () => {
  const browser = cdpUrl
    ? await chromium.connectOverCDP(cdpUrl)
    : await chromium.launch({
        headless,
        slowMo: headless ? 0 : 100,
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      });
  const context = cdpUrl
    ? browser.contexts()[0]
    : await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  if (!context) throw new Error("Chrome did not expose a browser context");
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.bringToFront();
  if (!headless) await page.waitForTimeout(1_000);
  await page.waitForTimeout(1000);
  await seedProject(page);
  await page.reload({ waitUntil: "networkidle" });
  if (!headless) await page.waitForTimeout(1_000);
  if (scenarioName === "two-pours") {
    // Pan only the camera so the wide two-colour source trace is fully visible;
    // never translate the user's geometry just to make a test screenshot fit.
    await page.mouse.move(1050, 850);
    await page.mouse.down();
    await page.mouse.move(1280, 850, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.screenshot({ path: rawScreenshotPath, fullPage: true });
  }
  await page.getByRole("button", { name: "חשב" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const project = await readProject(page);
  const nodeCounts = Object.fromEntries(
    [...new Set(project.layout.nodes.map((node) => node.type))].map((type) => [
      type,
      project.layout.nodes.filter((node) => node.type === type).length,
    ])
  );
  const untiledWallIds = project.layout.resolvedWalls.flatMap((resolvedWall) =>
    resolvedWall.faces
      .filter((face) => face.id === "faceA" || face.sourceWallId)
      .filter(
        (face) =>
          !project.placements.some(
            (placement) =>
              placement.wallId === resolvedWall.id && placement.side === face.id
          )
      )
      .map((face) => face.sourceWallId ?? resolvedWall.sourceWallId)
  );
  const duplicateFaceWallIds = project.layout.resolvedWalls
    .filter((wall) => {
      const sides = new Set(
        project.placements
          .filter((placement) => placement.wallId === wall.id)
          .map((placement) => placement.side)
      );
      const expectedSides = wall.faces
        .filter((face) => face.id === "faceA" || face.sourceWallId)
        .map((face) => face.id)
        .sort();
      return JSON.stringify([...sides].sort()) !== JSON.stringify(expectedSides);
    })
    .map((wall) => wall.id);
  const result = {
    screenshotPath,
    rawScreenshotPath: scenarioName === "two-pours" ? rawScreenshotPath : undefined,
    walls: project.walls.length,
    wallsByPour: Object.fromEntries(
      project.pours.map((pour) => [
        pour.id,
        project.walls.filter((wall) => wall.pourId === pour.id).length,
      ])
    ),
    placements: project.placements.length,
    placementsByPour: Object.fromEntries(
      project.pours.map((pour) => [
        pour.id,
        project.placements.filter((placement) => placement.pourId === pour.id).length,
      ])
    ),
    rooms: project.layout.regions.filter((region) => region.kind === "room").length,
    nodeCounts,
    diagnostics: project.layout.diagnostics,
    untiledWallIds,
    duplicateFaceWallIds,
    externalCorners: project.layout.externalCorners?.length ?? 0,
    externalCornersByPour: Object.fromEntries(
      project.pours.map((pour) => [
        pour.id,
        (project.layout.externalCorners ?? []).filter((corner) => corner.pourId === pour.id).length,
      ])
    ),
    externalCornerKeys: (project.layout.externalCorners ?? [])
      .map(({ point }) => `${point.x},${point.y}`)
      .sort(),
    consoleErrors,
    expected,
  };
  console.log(JSON.stringify(result, null, 2));
  if (expected) {
    for (const [key, value] of Object.entries(expected)) {
      const actual = key === "rooms" ? result.rooms : (result.nodeCounts[key] ?? 0);
      if (actual !== value) throw new Error(`${key}: expected ${value}, received ${actual}`);
    }
  }
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("layout contains engine errors");
  }
  if (untiledWallIds.length > 0) {
    throw new Error(`walls without formwork: ${untiledWallIds.join(", ")}`);
  }
  if (duplicateFaceWallIds.length > 0) {
    throw new Error(`walls with duplicated formwork faces: ${duplicateFaceWallIds.join(", ")}`);
  }
  if (scenarioName === "exact" && result.externalCorners !== 12) {
    throw new Error(`outside corners: expected 12, received ${result.externalCorners}`);
  }
  if (
    scenarioName === "exact" &&
    JSON.stringify(result.externalCornerKeys) !== JSON.stringify(expectedExactExternalCornerKeys)
  ) {
    throw new Error(
      `outside corner positions differ:\nexpected ${expectedExactExternalCornerKeys.join(" | ")}\nreceived ${result.externalCornerKeys.join(" | ")}`
    );
  }
  if (scenarioName === "two-pours") {
    if (project.pours.length !== 2) {
      throw new Error(`pours: expected 2, received ${project.pours.length}`);
    }
    if (result.externalCornersByPour["pour-e2e"] !== 12) {
      throw new Error(
        `purple outside corners: expected 12, received ${result.externalCornersByPour["pour-e2e"]}`
      );
    }
    for (const pour of project.pours) {
      if (result.wallsByPour[pour.id] === 0 || result.placementsByPour[pour.id] === 0) {
        throw new Error(`pour ${pour.id} was not fully created and tiled`);
      }
    }
  }
  if (scenarioName === "double-contour") {
    if (project.layout.resolvedWalls.length !== 4) {
      throw new Error(
        `resolved walls: expected 4, received ${project.layout.resolvedWalls.length}`
      );
    }
    const sides = new Set(project.placements.map((placement) => placement.side));
    if (!sides.has("faceA") || !sides.has("faceB")) {
      throw new Error(`both drawn contours were not tiled: ${[...sides].join(", ")}`);
    }
  }
  if (keepOpenMs > 0) {
    console.log(`Keeping the visible browser open for ${keepOpenMs}ms...`);
    await page.waitForTimeout(keepOpenMs);
  }
  if (cdpUrl) {
    console.log("Playwright finished; leaving the externally launched Chrome window open.");
    process.exit(0);
  }
  await browser.close();
})();
