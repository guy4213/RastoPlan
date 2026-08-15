/**
 * Prints what a drawing actually contains, straight from the same modules the
 * app uses. Diagnostic aid — run it when an import does not look like the
 * source.
 *
 * Usage: npx tsx scripts/inspect.mjs "<file.dwg>"
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = process.argv[2];
if (!source) {
  console.error('usage: npx tsx scripts/inspect.mjs "<file.dwg>"');
  process.exit(1);
}

const { flattenEntities } = await import("../src/cad/flattenEntities.ts");
const { summarizeLayers, boundsOf, pickUnit, segmentsToWalls, clusterPours, measureThickness } =
  await import("@rastoplan/core");

const entry = require.resolve("@mlightcad/libredwg-web");
const wasmDir = join(dirname(dirname(entry)), "wasm") + "/";
const { LibreDwg, Dwg_File_Type } = await import("@mlightcad/libredwg-web");

const bytes = readFileSync(source);
const ab = new ArrayBuffer(bytes.byteLength);
new Uint8Array(ab).set(bytes);

const libredwg = await LibreDwg.create(wasmDir);
const ptr = libredwg.dwg_read_data(ab, /\.dxf$/i.test(source) ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
if (!ptr) throw new Error("could not read file");
const db = libredwg.convert(ptr);
libredwg.dwg_free(ptr);

console.log(`\n=== ${basename(source)} ===`);
console.log(`ACADVER ${db?.header?.ACADVER}   $INSUNITS ${db?.header?.INSUNITS}`);

// Raw model-space entities, before any flattening.
const byType = new Map();
for (const e of db.entities ?? []) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
console.log(`\nmodel-space entities (${db.entities?.length ?? 0}):`);
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${t.padEnd(16)} ${n}`);
}

// Closed-ness matters: an unclosed polyline imports as an open shape.
console.log(`\npolylines in model space:`);
for (const e of db.entities ?? []) {
  if (e.type !== "LWPOLYLINE" && e.type !== "POLYLINE2D") continue;
  const vs = (e.vertices ?? []).map((v) => v.point ?? v);
  const xs = vs.map((v) => v.x);
  const ys = vs.map((v) => v.y);
  console.log(
    `   ${e.type} layer=${String(e.layer).padEnd(12)} verts=${vs.length} closed=${(e.flag & 1) === 1}` +
      `  ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)} x ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}`
  );
}

const { segments, skippedCurves } = flattenEntities(db);
console.log(`\nflattened: ${segments.length} segments, ${skippedCurves} curves skipped`);

const chosen = pickUnit(segments, db?.header?.INSUNITS === 4 ? "mm" : db?.header?.INSUNITS === 6 ? "m" : "cm");
console.log(`pickUnit -> ${chosen}`);
for (const unit of ["mm", "cm", "m"]) {
  const b = boundsOf(segments, unit);
  console.log(`   as ${unit}: ${(b.widthCm / 100).toFixed(2)} x ${(b.heightCm / 100).toFixed(2)} m`);
}

console.log(`\nlayers:`);
for (const l of summarizeLayers(segments, chosen)) {
  console.log(`   ${l.name.padEnd(18)} ${String(l.segments).padStart(5)} segs   ${(l.totalLengthCm / 100).toFixed(2)} m`);
}

console.log(`\nsegment lengths in ${chosen} (this is what the 20cm filter sees):`);
const k = { mm: 0.1, cm: 1, m: 100 }[chosen];
const lens = segments.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * k).sort((a, b) => a - b);
console.log(`   min ${lens[0]?.toFixed(1)}   median ${lens[Math.floor(lens.length / 2)]?.toFixed(1)}   max ${lens[lens.length - 1]?.toFixed(1)}`);
console.log(`   under 20cm: ${lens.filter((l) => l < 20).length} of ${lens.length}`);

const clusters = clusterPours(segments, chosen);

// Route each cluster to its own pour, exactly as the import dialog does.
const pourByLayer = {};
const tagged = clusters.flatMap((group, i) => {
  pourByLayer[`__pour${i}`] = `pour-${i + 1}`;
  return group.map((s) => ({ ...s, layer: `__pour${i}` }));
});
const { walls: rawWalls, skippedShort } = segmentsToWalls(tagged, {
  pourByLayer,
  unit: chosen,
  thicknessCm: 20,
  makeId: (i) => `w${i}`,
});
const { walls, measured } = measureThickness(rawWalls);
console.log(`\npours detected: ${clusters.length}`);
clusters.forEach((c, i) => {
  const b = boundsOf(c, chosen);
  console.log(
    `   יציקה ${i + 1}: ${c.length} segments, ${(b.widthCm / 100).toFixed(2)} x ${(b.heightCm / 100).toFixed(2)} m`
  );
});

console.log(`\nimport result: ${walls.length} walls, ${skippedShort} dropped as too short`);
console.log(`thickness measured from the drawing for ${measured} of ${walls.length} walls`);
for (const w of walls) {
  const [a, b] = w.innerLine;
  console.log(
    `   ${w.pourId}  (${a.x.toFixed(0)}, ${a.y.toFixed(0)}) -> (${b.x.toFixed(0)}, ${b.y.toFixed(0)})` +
      `   len ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(0)}   thickness ${w.thickness} cm`
  );
}
