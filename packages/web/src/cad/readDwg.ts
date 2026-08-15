import type { CadSegment, CadUnit } from "@rastoplan/core";
import type { WorkerRequest, WorkerResponse } from "./readDwg.worker.js";

/**
 * Reads a DWG or DXF file into flat straight segments.
 *
 * The actual work happens in a Web Worker (see readDwg.worker.ts) because a
 * large drawing takes over a minute to parse and would otherwise freeze the
 * tab. All this module does is drive that worker and translate its messages.
 *
 * NOTE ON LICENSING: @mlightcad/libredwg-web is GPL-3.0, and shipping it to the
 * browser counts as distribution. If that becomes a commercial problem, the
 * worker is the single piece to replace with a server endpoint.
 */

export type ReadStage = "loading-engine" | "parsing" | "flattening";

export interface ReadResult {
  segments: CadSegment[];
  /** what the file's header claims its units are — real files often lie */
  suggestedUnit: CadUnit;
  acadVersion: string;
  entityCount: number;
  skippedCurves: number;
}

/** $INSUNITS code -> our unit names. Advisory only. */
function unitFromHeader(insunits: number | undefined): CadUnit {
  switch (insunits) {
    case 4:
      return "mm";
    case 5:
      return "cm";
    case 6:
      return "m";
    default:
      return "cm";
  }
}

export function readCadFile(file: File, onStage?: (stage: ReadStage) => void): Promise<ReadResult> {
  return new Promise<ReadResult>((resolve, reject) => {
    const worker = new Worker(new URL("./readDwg.worker.js", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === "stage") {
        onStage?.(message.stage);
        return;
      }
      worker.terminate();
      if (message.kind === "error") {
        reject(new Error(message.message));
        return;
      }
      resolve({
        segments: message.segments,
        suggestedUnit: unitFromHeader(message.insunits),
        acadVersion: message.acadVersion,
        entityCount: message.entityCount,
        skippedCurves: message.skippedCurves,
      });
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "העובד שקורא את הקובץ נכשל"));
    };

    void file.arrayBuffer().then((buffer) => {
      const request: WorkerRequest = { buffer, isDxf: /\.dxf$/i.test(file.name) };
      // Transfer rather than copy — a 14MB drawing should not be cloned.
      worker.postMessage(request, [buffer]);
    }, reject);
  });
}
