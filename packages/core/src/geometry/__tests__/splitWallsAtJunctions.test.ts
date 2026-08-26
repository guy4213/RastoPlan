import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { splitWallsAtJunctions } from "../splitWallsAtJunctions.js";

function wall(id: string, ax: number, ay: number, bx: number, by: number): Wall {
  return {
    id,
    pourId: "pour-1",
    innerLine: [{ x: ax, y: ay }, { x: bx, y: by }],
    thickness: 20,
    thicknessSet: true,
  };
}

describe("splitWallsAtJunctions", () => {
  it("turns a natural endpoint-on-wall drawing into a real T node", () => {
    const source = [
      wall("through", 0, 0, 400, 0),
      wall("branch", 200, 200, 200, 0),
    ];

    const result = splitWallsAtJunctions(source);
    const graph = buildGraph(result.walls);
    const nodes = classifyNodes(graph.nodes, graph.edges);

    expect(result.changed).toBe(true);
    expect(result.walls).toHaveLength(3);
    expect(nodes.filter((node) => node.type === "T")).toHaveLength(1);
    expect(result.walls.find((item) => item.id === "through")?.innerLine).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it("snaps a near miss onto the segment before splitting it", () => {
    const result = splitWallsAtJunctions([
      wall("through", 0, 0, 400, 0),
      wall("branch", 201, 200, 201, 1.5),
    ]);
    const branch = result.walls.find((item) => item.id === "branch")!;

    expect(branch.innerLine[1]?.x).toBeCloseTo(201);
    expect(branch.innerLine[1]?.y).toBeCloseTo(0);
    const graph = buildGraph(result.walls);
    expect(classifyNodes(graph.nodes, graph.edges).filter((node) => node.type === "T")).toHaveLength(1);
  });

  it("splits both walls at a proper crossing", () => {
    const result = splitWallsAtJunctions([
      wall("horizontal", 0, 0, 400, 0),
      wall("vertical", 200, -200, 200, 200),
    ]);
    const graph = buildGraph(result.walls);

    expect(result.walls).toHaveLength(4);
    expect(classifyNodes(graph.nodes, graph.edges).filter((node) => node.type === "cross")).toHaveLength(1);
  });

  it("is idempotent and preserves the original id and wall properties", () => {
    const source = [
      { ...wall("through", 0, 0, 400, 0), pourId: "pour-2", thickness: 35 },
      wall("branch", 200, 200, 200, 0),
    ];
    const once = splitWallsAtJunctions(source);
    const twice = splitWallsAtJunctions(once.walls);

    expect(twice.changed).toBe(false);
    expect(twice.walls).toBe(once.walls);
    expect(once.walls.find((item) => item.id === "through")).toMatchObject({
      pourId: "pour-2",
      thickness: 35,
    });
  });
});
