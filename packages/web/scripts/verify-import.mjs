/**
 * End-to-end check of the import/export pipeline against a real drawing,
 * outside the browser. Runs the same modules the app uses: flattenEntities ->
 * summarizeLayers -> segmentsToWalls -> buildDxf.
 *
 * Usage: npx tsx scripts/verify-import.mjs "<path to .dwg or .dxf>"
 * (tsx, because it imports the app's TypeScript modules directly.)
 */
import { createRequire } from "node:module";
import { readFileSync, copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/verify-import.mjs "<file.dwg>"');
  process.exit(1);
}

/** AutoCAD keeps an exclusive lock on an open .dwg; fall back to the .bak. */
function readMaybeLocked(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    const bak = path.replace(/\.dwg$/i, ".bak");
    if (!existsSync(bak)) throw err;
    const scratch = join(mkdtempSync(join(tmpdir(), "rasto-")), "copy.dwg");
    copyFileSync(bak, scratch);
    console.log("  ! file is locked by AutoCAD — read the .bak instead");
    return readFileSync(scratch);
  }
}

const { flattenEntities } = await import("../src/cad/flattenEntities.ts");
const { summarizeLayers, segmentsToWalls, boundsOf, buildDxf } = await import(
  "@rastoplan/core"
);

const entry = require.resolve("@mlightcad/libredwg-web");
const wasmDir = join(dirname(dirname(entry)), "wasm") + "/";
const { LibreDwg, Dwg_File_Type } = await import("@mlightcad/libredwg-web");

console.log(`\nreading ${basename(source)} ...`);
const bytes = readMaybeLocked(source);
const ab = new ArrayBuffer(bytes.byteLength);
new Uint8Array(ab).set(bytes);

const libredwg = await LibreDwg.create(wasmDir);
const isDxf = /\.dxf$/i.test(source);
const ptr = libredwg.dwg_read_data(ab, isDxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
if (!ptr) throw new Error("libredwg refused the file");
const db = libredwg.convert(ptr);
libredwg.dwg_free(ptr);

const { segments, skippedCurves, insertsExploded } = flattenEntities(db);
console.log(`  version ${db?.header?.ACADVER}, $INSUNITS ${db?.header?.INSUNITS}`);
console.log(`  ${db?.entities?.length ?? 0} model entities, ${insertsExploded} INSERTs exploded`);
console.log(`  ${segments.length.toLocaleString()} segments, ${skippedCurves} curves skipped`);

for (const unit of ["mm", "cm", "m"]) {
  const b = boundsOf(segments, unit);
  if (b) {
    console.log(
      `  as ${unit}: whole drawing is ${(b.widthCm / 100).toFixed(1)} x ${(b.heightCm / 100).toFixed(1)} m`
    );
  }
}

const layers = summarizeLayers(segments, "cm");
console.log(`\n  ${layers.length} layers. Top 12 by segment count:`);
for (const l of layers.slice(0, 12)) {
  console.log(
    `    ${l.name.slice(0, 30).padEnd(31)} ${String(l.segments).padStart(8)} segs   ${(l.totalLengthCm / 100).toFixed(0)} m`
  );
}

// Import the two busiest layers, exactly as picking two layers in the dialog does.
const picked = layers.slice(0, 2);
const pourByLayer = {};
picked.forEach((l, i) => (pourByLayer[l.name] = `pour-${i}`));

const { walls, offsetCm, skippedShort } = segmentsToWalls(segments, {
  pourByLayer,
  unit: "cm",
  thicknessCm: 20,
  makeId: (i) => `w${i}`,
});
console.log(
  `\n  imported "${picked.map((l) => l.name).join('" + "')}" -> ${walls.length} walls ` +
    `(${skippedShort} too short), shifted by (${offsetCm.x.toFixed(0)}, ${offsetCm.y.toFixed(0)})`
);

const project = {
  id: "verify",
  name: "verify",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  catalog: { panels: [] },
  rules: {},
  pours: picked.map((l, i) => ({ id: `pour-${i}`, name: l.name, color: "#dc2626", order: i })),
  walls,
  placements: [],
  cadOffsetCm: offsetCm,
};

const dxf = buildDxf(project, { offsetCm });
const lines = dxf.split("\r\n").filter((l) => l !== "");
const entities = lines.filter((_, i) => i % 2 === 0 && lines[i] === "0").length;
console.log(`\n  exported DXF: ${(dxf.length / 1024).toFixed(0)} KB, ${lines.length / 2} tags`);
console.log(`  well-formed: ${lines.length % 2 === 0 ? "yes" : "NO — odd tag count"}`);
console.log(`  ends with EOF: ${dxf.trimEnd().endsWith("EOF") ? "yes" : "NO"}`);

// The exported coordinates must land back on the source drawing.
const xs = [];
for (let i = 0; i + 1 < lines.length; i += 2) {
  if (lines[i] === "10") xs.push(Number(lines[i + 1]));
}
if (xs.length) {
  console.log(
    `  first vertex x range: ${Math.min(...xs).toFixed(0)} .. ${Math.max(...xs).toFixed(0)} (source coordinates)`
  );
}
console.log("\nOK");
