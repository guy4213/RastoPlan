import { buildDxf, type BuildDxfOptions, type Project } from "@rastoplan/core";

/**
 * Triggers a browser download of the project as .dxf.
 *
 * AutoCAD opens DXF directly with File > Open — there is no DWG writer here
 * because DWG is a closed binary format with no usable open implementation.
 */
export function downloadDxf(
  project: Project,
  fileName: string,
  options: BuildDxfOptions = {}
): void {
  const text = buildDxf(project, options);
  // No byte-order mark. A DXF has to begin with the group code `0`; a BOM in
  // front of it makes AutoCAD fail on the very first tag and open an empty
  // drawing, which looks like the export produced nothing.
  const blob = new Blob([text], { type: "application/dxf" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".dxf") ? fileName : `${fileName}.dxf`;
  // Attach before clicking — Firefox ignores clicks on detached anchors — and
  // defer the revoke so browsers that dispatch the download asynchronously can
  // still read the blob URL.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
