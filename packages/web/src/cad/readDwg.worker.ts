/// <reference lib="webworker" />
import { flattenEntities } from "./flattenEntities.js";

/**
 * Parses a CAD file off the main thread.
 *
 * A 14MB DWG takes 70-100 seconds through the wasm reader. On the main thread
 * that freezes the whole tab — no spinner, no repaint, eventually the browser's
 * "page unresponsive" prompt — so the import looks broken when it is merely
 * slow. Here the UI stays alive and can report what stage it is at.
 */

export interface WorkerRequest {
  buffer: ArrayBuffer;
  isDxf: boolean;
}

export type WorkerResponse =
  | { kind: "stage"; stage: "loading-engine" | "parsing" | "flattening" }
  | {
      kind: "done";
      segments: import("@rastoplan/core").CadSegment[];
      insunits: number | undefined;
      acadVersion: string;
      entityCount: number;
      skippedCurves: number;
    }
  | { kind: "error"; message: string };

/** Below this, model space is effectively empty and the content is in blocks. */
const MIN_USABLE_SEGMENTS = 8;

const post = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { buffer, isDxf } = event.data;
  try {
    post({ kind: "stage", stage: "loading-engine" });
    const { LibreDwg, Dwg_File_Type } = await import("@mlightcad/libredwg-web");
    // No path: emscripten then resolves the binary through
    // `new URL("libredwg-web.wasm", import.meta.url)`, which Vite rewrites to
    // the hashed asset it emits.
    const libredwg = await LibreDwg.create();

    post({ kind: "stage", stage: "parsing" });
    const ptr = libredwg.dwg_read_data(buffer, isDxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
    if (ptr === undefined || ptr === 0) {
      post({ kind: "error", message: "לא הצלחתי לקרוא את הקובץ. ודא שזה DWG או DXF תקין." });
      return;
    }

    const db: any = libredwg.convert(ptr);
    libredwg.dwg_free(ptr);

    post({ kind: "stage", stage: "flattening" });
    // Model-space geometry first. Only if there is almost nothing there do we
    // explode the blocks — that is the case where the drawing really is built
    // out of block references rather than out of catalog symbols.
    let flat = flattenEntities(db, { explodeBlocks: false });
    if (flat.segments.length < MIN_USABLE_SEGMENTS) {
      flat = flattenEntities(db, { explodeBlocks: true });
    }
    const { segments, skippedCurves } = flat;

    post({
      kind: "done",
      segments,
      insunits: db?.header?.INSUNITS,
      acadVersion: db?.header?.ACADVER ?? "?",
      entityCount: db?.entities?.length ?? 0,
      skippedCurves,
    });
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
