import type { CadSegment } from "@rastoplan/core";

/**
 * Walks a parsed CAD database and flattens it to straight segments in world
 * coordinates, exploding block references as it goes.
 *
 * Pure: no wasm, no DOM, no Vite. That is deliberate — it is the part with all
 * the geometry subtleties, so it has to be runnable and testable outside a
 * browser.
 */

/**
 * libredwg stores every angle in radians and hands them through unconverted;
 * its type definitions do not say which unit it is. Reading them as degrees
 * silently mis-rotates every exploded block and the drawing comes out as
 * confetti. Do NOT try to detect the unit by magnitude — a single stray angle
 * above 2π flips the whole file.
 */
const ANGLES_ARE_RADIANS = true;

/** Sagitta tolerance when turning an arc into chords, in drawing units. */
const ARC_SAGITTA = 2;
const MAX_ARC_CHORDS = 64;
const MAX_BLOCK_DEPTH = 6;

interface Xf {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Xf = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function apply(t: Xf, x: number, y: number): { x: number; y: number } {
  return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
}

/** outer ∘ inner — inner applied first. */
function compose(outer: Xf, inner: Xf): Xf {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/**
 * Block definitions are authored around a base point that the INSERT pins to
 * its insertion point. libredwg reports that base point as (0,0) even when the
 * block's geometry sits far from the origin, which drops instances hundreds of
 * metres away — so measure the geometry's own lower-left corner instead.
 */
function anchorOf(entities: any[]): { x: number; y: number } {
  let minX = Infinity;
  let minY = Infinity;
  const note = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  };
  for (const e of entities ?? []) {
    if (e.type === "LINE" && e.startPoint && e.endPoint) {
      note(e.startPoint.x, e.startPoint.y);
      note(e.endPoint.x, e.endPoint.y);
    } else if (e.type === "LWPOLYLINE") {
      for (const v of e.vertices ?? []) note(v.x, v.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0 };
  return { x: minX, y: minY };
}

/**
 * libredwg reports an LWPOLYLINE's "closed" state as bit 0x200 of `flag`, not
 * the DXF group-70 bit 1 that the format documents. Testing the wrong bit drops
 * the closing side of every closed rectangle, so a room imports as three walls
 * and looks cut open.
 */
const LWPOLYLINE_CLOSED = 0x200;
const LWPOLYLINE_CLOSED_DXF = 0x1;

function isClosed(flag: unknown): boolean {
  if (typeof flag !== "number") return false;
  return (flag & LWPOLYLINE_CLOSED) !== 0 || (flag & LWPOLYLINE_CLOSED_DXF) !== 0;
}

export interface FlattenOptions {
  /**
   * Explode INSERTs into their block geometry. Off by default: in a formwork
   * drawing the blocks are catalog symbols (panels, clamps, props), which bury
   * the handful of real wall outlines under thousands of tiny detail lines and
   * throw off both scale detection and the layer list.
   */
  explodeBlocks?: boolean;
}

export interface FlattenResult {
  segments: CadSegment[];
  /** curves we cannot express as walls, reported so the user is not misled */
  skippedCurves: number;
  insertsExploded: number;
  /** how many identical segments were collapsed */
  duplicatesRemoved: number;
}

export function flattenEntities(db: any, options: FlattenOptions = {}): FlattenResult {
  const explodeBlocks = options.explodeBlocks ?? false;
  const blocks = new Map<string, { entities: any[]; ax: number; ay: number }>();
  for (const br of db?.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!br?.name) continue;
    const a = anchorOf(br.entities);
    blocks.set(String(br.name).toUpperCase(), { entities: br.entities ?? [], ax: a.x, ay: a.y });
  }

  const segments: CadSegment[] = [];
  let skippedCurves = 0;
  let insertsExploded = 0;

  const toRad = (v: number) => (ANGLES_ARE_RADIANS ? v : (v * Math.PI) / 180);

  const push = (t: Xf, x1: number, y1: number, x2: number, y2: number, layer: string) => {
    const p = apply(t, x1, y1);
    const q = apply(t, x2, y2);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
    if (Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9) return;
    segments.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, layer });
  };

  const walk = (entities: any[], t: Xf, depth: number, stack: string[]) => {
    for (const e of entities ?? []) {
      const layer = e.layer ?? "0";
      switch (e.type) {
        case "LINE": {
          if (e.startPoint && e.endPoint) {
            push(t, e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y, layer);
          }
          break;
        }

        case "LWPOLYLINE":
        case "POLYLINE2D":
        case "POLYLINE3D": {
          const vs = (e.vertices ?? []).map((v: any) => v.point ?? v);
          for (let i = 0; i + 1 < vs.length; i++) {
            push(t, vs[i].x, vs[i].y, vs[i + 1].x, vs[i + 1].y, layer);
          }
          if (isClosed(e.flag) && vs.length > 2) {
            const a = vs[vs.length - 1];
            const b = vs[0];
            // A polyline may be closed by the flag AND by repeating its first
            // vertex; emitting both would leave a zero-length segment, which
            // `push` drops anyway, but the check keeps the intent explicit.
            if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) {
              push(t, a.x, a.y, b.x, b.y, layer);
            }
          }
          break;
        }

        case "ARC": {
          const c = e.center;
          const r = e.radius;
          if (!c || !(r > 0)) break;
          let a0 = toRad(e.startAngle ?? 0);
          let a1 = toRad(e.endAngle ?? 0);
          while (a1 <= a0) a1 += Math.PI * 2;
          const step = Math.max(
            0.1,
            2 * Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(ARC_SAGITTA / r, 1))))
          );
          const n = Math.max(1, Math.min(MAX_ARC_CHORDS, Math.ceil((a1 - a0) / step)));
          for (let i = 0; i < n; i++) {
            const s = a0 + ((a1 - a0) * i) / n;
            const u = a0 + ((a1 - a0) * (i + 1)) / n;
            push(
              t,
              c.x + r * Math.cos(s),
              c.y + r * Math.sin(s),
              c.x + r * Math.cos(u),
              c.y + r * Math.sin(u),
              layer
            );
          }
          break;
        }

        case "SPLINE":
        case "ELLIPSE":
          skippedCurves++;
          break;

        case "INSERT": {
          if (!explodeBlocks || depth >= MAX_BLOCK_DEPTH) break;
          const name = String(e.name ?? "").toUpperCase();
          const block = blocks.get(name);
          // A block can reach itself through a chain of others; without the
          // stack check the walk never terminates.
          if (!block || stack.includes(name)) break;

          const ip = e.insertionPoint ?? { x: 0, y: 0 };
          const sx = e.xScale ?? 1;
          const sy = e.yScale ?? 1;
          const rot = toRad(e.rotation ?? 0);
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);

          const place: Xf = {
            a: cos * sx,
            b: sin * sx,
            c: -sin * sy,
            d: cos * sy,
            e: ip.x,
            f: ip.y,
          };
          const local = compose(place, { ...IDENTITY, e: -block.ax, f: -block.ay });
          insertsExploded++;
          walk(block.entities, compose(t, local), depth + 1, [...stack, name]);
          break;
        }

        default:
          break;
      }
    }
  };

  walk(db?.entities ?? [], IDENTITY, 0, []);

  const deduped = dedupe(segments);
  return {
    segments: deduped,
    skippedCurves,
    insertsExploded,
    duplicatesRemoved: segments.length - deduped.length,
  };
}

/**
 * Drops segments that trace the same line twice. Real drawings are full of
 * these — Drawing1.dwg holds one pour's outline both as a 5-vertex polyline
 * closed by a repeated point and as a 4-vertex polyline closed by its flag —
 * and each duplicate would otherwise become a second wall stacked on the first.
 */
function dedupe(segments: CadSegment[]): CadSegment[] {
  const seen = new Set<string>();
  const out: CadSegment[] = [];
  const key = (n: number) => Math.round(n * 100) / 100;
  for (const s of segments) {
    // Direction must not matter: the same edge drawn backwards is the same edge.
    const a = `${key(s.x1)},${key(s.y1)}`;
    const b = `${key(s.x2)},${key(s.y2)}`;
    const id = `${s.layer}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}
