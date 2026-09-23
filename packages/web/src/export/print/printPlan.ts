import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Placement, Pour, PrintPageSize, ProjectLayout, Wall } from "@rastoplan/core";
import { PRINT_PAGE_SIZES_MM } from "@rastoplan/core";
import { PlanSvg } from "./PlanSvg.js";

export interface PrintPlanInput {
  projectName: string;
  walls: Wall[];
  pours: Pour[];
  placements: Placement[];
  layout: ProjectLayout | undefined;
  page: PrintPageSize;
  cornerProtrusionCm: number;
  cornerLapGapCm: number;
  /** ISO date string; defaults to "now". Exposed so tests can pin the title block. */
  generatedAt?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The full standalone print document for one page size: `dir="rtl" lang="he"`
 * so the browser's own bidi engine (not this app) lays out Hebrew + digits +
 * Latin ids correctly, and an exact `@page size` so the browser's "Save as
 * PDF" produces that sheet rather than whatever default the OS print driver
 * picked. Split out from printPlan() so this — the part that actually
 * determines correctness — can be asserted on as a plain string, with no
 * iframe or real print dialog involved.
 */
export function buildPrintDocument(input: PrintPlanInput): string {
  const { widthMm, heightMm } = PRINT_PAGE_SIZES_MM[input.page];
  const svgMarkup = renderToStaticMarkup(createElement(PlanSvg, input));

  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.projectName)}</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { direction: rtl; background: #ffffff; }
  svg { display: block; }
</style>
</head>
<body>
${svgMarkup}
</body>
</html>`;
}

/**
 * Opens the browser's print dialog on a print-ready plan without navigating
 * the app away. A hidden same-origin iframe gets its own full document (the
 * exact `@page` size for the chosen sheet, `dir="rtl"`, and the rendered SVG)
 * and calls its OWN `window.print()` — the iframe's document is what Chrome's
 * print pipeline (and therefore "Save as PDF") reads the page size and
 * content from, which a `window.print()` on the host app's own document
 * could not give it without printing the whole app shell too.
 */
export function printPlan(input: PrintPlanInput): void {
  const hostDocument = window.document;
  const iframe = hostDocument.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  hostDocument.body.appendChild(iframe);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  const iframeWindow = iframe.contentWindow;
  const iframeDocument = iframe.contentDocument;
  if (!iframeWindow || !iframeDocument) {
    cleanup();
    return;
  }

  iframeDocument.open();
  iframeDocument.write(buildPrintDocument(input));
  iframeDocument.close();

  const triggerPrint = () => {
    iframeWindow.focus();
    iframeWindow.print();
    // `afterprint` is not reliably fired for a same-origin iframe across every
    // Chrome version, so a fallback timeout guarantees the hidden iframe is
    // removed either way instead of leaking one per export.
    window.setTimeout(cleanup, 60_000);
  };

  if (iframeDocument.readyState === "complete") {
    triggerPrint();
  } else {
    iframe.addEventListener("load", triggerPrint, { once: true });
  }
}
