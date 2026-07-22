import { Line } from "react-konva";

interface Props {
  widthPx: number;
  heightPx: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Grid in cm — 50cm minor lines, 100cm major lines. */
export function Grid({ widthPx, heightPx, scale, offsetX, offsetY }: Props) {
  const minorCm = 50;
  const majorCm = 100;
  // Only draw grid lines that fall inside the viewport (in world cm).
  const worldLeft = -offsetX / scale;
  const worldTop = -offsetY / scale;
  const worldRight = worldLeft + widthPx / scale;
  const worldBottom = worldTop + heightPx / scale;

  const firstX = Math.floor(worldLeft / minorCm) * minorCm;
  const firstY = Math.floor(worldTop / minorCm) * minorCm;

  const lines: JSX.Element[] = [];
  for (let x = firstX; x <= worldRight; x += minorCm) {
    const major = x % majorCm === 0;
    lines.push(
      <Line
        key={`vx-${x}`}
        points={[x, worldTop, x, worldBottom]}
        stroke={major ? "#cbd5e1" : "#e2e8f0"}
        strokeWidth={major ? 1 / scale : 0.5 / scale}
        listening={false}
      />
    );
  }
  for (let y = firstY; y <= worldBottom; y += minorCm) {
    const major = y % majorCm === 0;
    lines.push(
      <Line
        key={`hy-${y}`}
        points={[worldLeft, y, worldRight, y]}
        stroke={major ? "#cbd5e1" : "#e2e8f0"}
        strokeWidth={major ? 1 / scale : 0.5 / scale}
        listening={false}
      />
    );
  }
  return <>{lines}</>;
}
