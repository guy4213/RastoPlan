/**
 * Stage 0 evidence extractor: reads the customer's reference formwork DWG and
 * recovers, per wall, the panel row on each face.
 *
 * Why this exists: the parallel-tiling requirement (docs/plan-parallel-formwork.md)
 * turns on three facts that cannot be read off a screenshot — whether the leading
 * panel is R75 or R70, whether the two faces' seams line up, and whether the
 * shorter face's run is always contained in the longer one. All three are settled
 * here from the drawing itself.
 *
 * Usage:
 *   node spikes/extract-panel-rows.mjs "<file.dwg>" [outDir]
 *
 * Depends on the libredwg build already vendored under spikes/dwg-roundtrip.
 */
import { createReadStream, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBREDWG = resolve(HERE, 'dwg-roundtrip/node_modules/@mlightcad/libredwg-web/dist/libredwg-web.js');

// Panel labels are MTEXT whose content is the inline alignment code \A1; followed
// by the width in whole centimetres. Built from a char code so the literal
// backslash survives every quoting layer between here and the comparison.
const TAG = String.fromCharCode(92) + 'A1;';

// packages/core/src/defaults.ts STRAIGHT_PANEL_WIDTHS
const CATALOG = new Set([20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]);

/**
 * Two label rows count as opposite faces of one wall when their perpendicular
 * separation falls in this band: wider than a drafting offset, narrower than the
 * gap to the next parallel wall.
 */
const FACE_GAP_MIN = 40;
const FACE_GAP_MAX = 110;

async function dwgToDxf(dwgPath) {
  const { LibreDwg } = await import(pathToFileURL(LIBREDWG).href);
  const lib = await LibreDwg.create();
  const buf = readFileSync(dwgPath);
  const dxf = lib.dwg_write_dxf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (!dxf) throw new Error('libredwg could not convert this DWG');
  const out = join(mkdtempSync(join(tmpdir(), 'dwg-')), 'out.dxf');
  writeFileSync(out, Buffer.from(dxf));
  return out;
}

/**
 * Streams the DXF group-code pairs and returns every panel label with its
 * insertion point and text direction. MTEXT repeats codes 10/20/11/21 inside its
 * "Embedded Object" (code 101) block, so only the first value of each code is
 * kept — the later ones belong to the embedded copy, not to the label.
 */
async function readPanelLabels(dxfPath) {
  const rl = createInterface({ input: createReadStream(dxfPath), crlfDelay: Infinity });
  const labels = [];
  let code = null;
  let cur = null;
  let embedded = false;
  const first = (o, k, v) => {
    if (o[k] === undefined) o[k] = v;
  };
  const flush = () => {
    if (!cur) return;
    const body = cur.text.startsWith(TAG) ? cur.text.slice(TAG.length) : null;
    if (body && /^[0-9]+$/.test(body) && cur['10'] !== undefined) {
      labels.push({
        w: Number(body),
        layer: cur.layer ?? '',
        x: cur['10'],
        y: cur['20'],
        dx: cur['11'] ?? 1,
        dy: cur['21'] ?? 0,
      });
    }
  };
  for await (const raw of rl) {
    const line = raw.trim();
    if (code === null) {
      code = line;
      continue;
    }
    const value = line;
    const c = code;
    code = null;
    if (c === '0') {
      flush();
      cur = value === 'MTEXT' || value === 'TEXT' ? { text: '' } : null;
      embedded = false;
      continue;
    }
    if (c === '101') {
      embedded = true;
      continue;
    }
    if (!cur || embedded) continue;
    if (c === '8') first(cur, 'layer', value);
    else if (c === '1' || c === '3') cur.text += value;
    else if (['10', '20', '11', '21'].includes(c)) first(cur, c, parseFloat(value));
  }
  flush();
  return labels;
}

/**
 * Groups labels into rows of panels that physically touch.
 *
 * The plan is drawn rotated (~5 degrees in the reference), so each label is
 * projected onto its OWN text direction rather than onto the world axes —
 * bucketing by raw x/y finds nothing at all on a rotated drawing.
 */
function buildRows(labels) {
  for (const p of labels) {
    const n = Math.hypot(p.dx, p.dy) || 1;
    const ux = p.dx / n;
    const uy = p.dy / n;
    p.ang = ((((Math.atan2(uy, ux) * 180) / Math.PI) % 180) + 180) % 180;
    p.along = p.x * ux + p.y * uy;
    p.cross = -p.x * uy + p.y * ux;
  }
  const groups = new Map();
  for (const p of labels) {
    const k = `${p.layer}|${Math.round(p.ang / 0.5) * 0.5}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(p);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const lanes = new Map();
    for (const p of list) {
      const lane = Math.round(p.cross / 3);
      (lanes.get(lane) ?? lanes.set(lane, []).get(lane)).push(p);
    }
    for (const lane of lanes.values()) {
      if (lane.length < 3) continue;
      lane.sort((a, b) => a.along - b.along);
      let run = [lane[0]];
      const close = () => {
        if (run.length < 3) return;
        const ws = run.map((p) => p.w);
        if (!ws.every((w) => CATALOG.has(w))) return;
        const sum = ws.reduce((a, b) => a + b, 0);
        const left = run[0].along - ws[0] / 2;
        rows.push({ key, ang: run[0].ang, cross: run[0].cross, ws, sum, left, right: left + sum });
      };
      for (let i = 1; i < lane.length; i++) {
        // touching panels put their labels exactly half-a-panel apart on each side
        const gap = lane[i].along - lane[i - 1].along;
        if (Math.abs(gap - (lane[i].w + lane[i - 1].w) / 2) <= 2.5) run.push(lane[i]);
        else {
          close();
          run = [lane[i]];
        }
      }
      close();
    }
  }
  return rows;
}

/** Matches each row with the row on the far face of the same wall. */
function pairFaces(rows) {
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.key !== b.key) continue;
      const gap = Math.abs(a.cross - b.cross);
      if (gap < FACE_GAP_MIN || gap > FACE_GAP_MAX) continue;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 30) continue;
      const id = `${Math.round(a.left)}|${Math.round(a.cross)}|${Math.round(b.left)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const aInB = a.left >= b.left - 2 && a.right <= b.right + 2;
      const bInA = b.left >= a.left - 2 && b.right <= a.right + 2;
      pairs.push({
        ang: Number(a.ang.toFixed(3)),
        faceGap: Math.round(gap),
        containment: aInB && bInA ? 'identical' : aInB || bInA ? 'contained' : 'partial',
        a: { ws: a.ws, sum: a.sum, left: Math.round(a.left), right: Math.round(a.right) },
        b: { ws: b.ws, sum: b.sum, left: Math.round(b.left), right: Math.round(b.right) },
        exclusiveHead: Math.round(b.left - a.left),
        exclusiveTail: Math.round(b.right - a.right),
      });
    }
  }
  return pairs;
}

function histogram(values) {
  const h = new Map();
  for (const v of values) h.set(v, (h.get(v) ?? 0) + 1);
  return [...h].sort((x, y) => y[1] - x[1]);
}

const dwgPath = process.argv[2];
const outDir = process.argv[3] ?? HERE;
if (!dwgPath) {
  console.error('usage: node spikes/extract-panel-rows.mjs "<file.dwg>" [outDir]');
  process.exit(1);
}
const dxf = await dwgToDxf(dwgPath);
const labels = await readPanelLabels(dxf);
const rows = buildRows(labels);
const pairs = pairFaces(rows);

console.log(`panel labels        : ${labels.length}`);
console.log(`contiguous rows     : ${rows.length}`);
console.log(`opposite-face pairs : ${pairs.length}`);

console.log('\ncatalog widths used (count):');
for (const [w, n] of histogram(labels.map((l) => l.w)).sort((a, b) => a[0] - b[0])) {
  if (CATALOG.has(w)) console.log(`  R${String(w).padEnd(3)} ${n}`);
}
console.log('\ncontainment of the shorter face run inside the longer:');
for (const [k, n] of histogram(pairs.map((p) => p.containment))) console.log(`  ${k.padEnd(10)} ${n}`);
console.log('\nexclusive end-segment lengths (cm):');
for (const [len, n] of histogram(
  pairs
    .flatMap((p) => [Math.abs(p.exclusiveHead), Math.abs(p.exclusiveTail)])
    .filter((v) => v > 0 && v < 200)
).slice(0, 15)) {
  console.log(`  ${String(len).padStart(4)} -> ${n}`);
}
console.log('\nperpendicular gap between the two face rows (cm):');
for (const [g, n] of histogram(pairs.map((p) => p.faceGap))) console.log(`  ${String(g).padStart(4)} -> ${n}`);

const out = join(outDir, 'reference-panel-rows.json');
writeFileSync(out, JSON.stringify({ source: dwgPath, labelCount: labels.length, pairs }, null, 2));
console.log(`\nwrote ${out}`);
