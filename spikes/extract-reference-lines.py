"""Extract the orthogonal magenta trace from image.png for the Playwright fixture."""

from __future__ import annotations

import json
import argparse
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


@dataclass
class Run:
    axis: int
    start: int
    end: int


def is_magenta(rgb: tuple[int, int, int]) -> bool:
    red, green, blue = rgb
    return red > 170 and blue > 120 and green < 150 and red - green > 60


def is_gray(rgb: tuple[int, int, int]) -> bool:
    """The source DWG's warm gray linework, excluding white antialiasing."""
    red, green, blue = rgb
    average = (red + green + blue) / 3
    return 65 <= average <= 225 and max(rgb) - min(rgb) <= 22


def dense_runs(values: list[bool], max_gap: int = 5, min_span: int = 18) -> list[tuple[int, int]]:
    hits = [index for index, value in enumerate(values) if value]
    if not hits:
        return []
    groups: list[list[int]] = [[hits[0]]]
    for hit in hits[1:]:
        if hit - groups[-1][-1] <= max_gap:
            groups[-1].append(hit)
        else:
            groups.append([hit])
    result: list[tuple[int, int]] = []
    for group in groups:
        start, end = group[0], group[-1]
        span = end - start + 1
        if span >= min_span and len(group) / span >= 0.22:
            result.append((start, end))
    return result


def scan(mask: list[list[bool]], horizontal: bool) -> list[Run]:
    height = len(mask)
    width = len(mask[0])
    result: list[Run] = []
    outer = height if horizontal else width
    inner = width if horizontal else height
    for axis in range(outer):
        values = [mask[axis][at] if horizontal else mask[at][axis] for at in range(inner)]
        result.extend(Run(axis, start, end) for start, end in dense_runs(values))
    return result


def overlap_ratio(first: Run, second: Run) -> float:
    overlap = max(0, min(first.end, second.end) - max(first.start, second.start))
    shorter = max(1, min(first.end - first.start, second.end - second.start))
    return overlap / shorter


def cluster(runs: list[Run]) -> list[dict[str, int]]:
    clusters: list[list[Run]] = []
    for run in sorted(runs, key=lambda item: (item.axis, item.start)):
        best: list[Run] | None = None
        for candidate in clusters:
            representative = candidate[-1]
            if run.axis - representative.axis > 10:
                continue
            if overlap_ratio(run, representative) < 0.72:
                continue
            if abs(run.start - representative.start) > 14 or abs(run.end - representative.end) > 14:
                continue
            best = candidate
            break
        if best is None:
            clusters.append([run])
        else:
            best.append(run)

    lines: list[dict[str, int]] = []
    for group in clusters:
        if len(group) < 2:
            continue
        axes = sorted(run.axis for run in group)
        starts = sorted(run.start for run in group)
        ends = sorted(run.end for run in group)
        lines.append(
            {
                "axis": axes[len(axes) // 2],
                "start": starts[len(starts) // 2],
                "end": ends[len(ends) // 2],
                "support": len(group),
            }
        )
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--color", choices=("magenta", "gray"), default="magenta")
    args = parser.parse_args()
    image_path = Path(__file__).resolve().parents[1] / "image.png"
    image = Image.open(image_path).convert("RGB")
    predicate = is_magenta if args.color == "magenta" else is_gray
    mask = [
        [predicate(image.getpixel((x, y))) for x in range(image.width)]
        for y in range(image.height)
    ]
    horizontal = cluster(scan(mask, horizontal=True))
    vertical = cluster(scan(mask, horizontal=False))
    print(json.dumps({"horizontal": horizontal, "vertical": vertical}, indent=2))


if __name__ == "__main__":
    main()
