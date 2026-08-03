import { describe, expect, it } from "vitest";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { tJunctionWalls } from "./fixtures.js";

describe("classifyNodes", () => {
  it("classifies a 3-wall junction as 'T' and the loose wall ends as 'end'", () => {
    const { nodes, edges } = buildGraph(tJunctionWalls());
    const classified = classifyNodes(nodes, edges);

    expect(classified.filter((n) => n.type === "T")).toHaveLength(1);
    expect(classified.filter((n) => n.type === "end")).toHaveLength(3);
  });
});
