"""Redraw the bitmap icons in the colours from theme/colors.js: the monogram in paper on an accent tile.

Run from the repo root with the backend's environment, which already has Pillow:

    uv run --project backend python theme/icons.py

monogram-mask.png is the monogram's alpha mask, rendered once from the logo SVG.
"""

import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

THEME = Path(__file__).resolve().parent
ROOT = THEME.parent
MASK = Image.open(THEME / "monogram-mask.png").convert("L")


def load_colors() -> dict:
    script = "process.stdout.write(JSON.stringify(require(process.argv[1]).colors))"
    # A fixed command reading our own file; node comes from the developer's PATH like the rest of the tooling.
    command = ["node", "-e", script, str(THEME / "colors.js")]
    out = subprocess.run(command, check=True, capture_output=True, text=True)  # noqa: S603
    return json.loads(out.stdout)


def rgba(hex_color: str) -> tuple[int, int, int, int]:
    return (*(int(hex_color[i : i + 2], 16) for i in (1, 3, 5)), 255)


def monogram(width: int, color: tuple[int, int, int, int]) -> Image.Image:
    height = round(width * MASK.size[1] / MASK.size[0])
    layer = Image.new("RGBA", (width, height), color)
    layer.putalpha(MASK.resize((width, height), Image.LANCZOS))
    return layer


def tile(size: int, mono_fraction: float, background, foreground, radius_fraction: float = 0.0) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if background:
        supersample = 4
        shape = Image.new("L", (size * supersample, size * supersample), 0)
        edge = size * supersample - 1
        ImageDraw.Draw(shape).rounded_rectangle(
            [0, 0, edge, edge], radius=int(size * supersample * radius_fraction), fill=255
        )
        fill = Image.new("RGBA", (size, size), background)
        fill.putalpha(shape.resize((size, size), Image.LANCZOS))
        canvas.alpha_composite(fill)
    mark = monogram(round(size * mono_fraction), foreground)
    canvas.alpha_composite(mark, ((size - mark.size[0]) // 2, (size - mark.size[1]) // 2))
    return canvas


def main() -> None:
    colors = load_colors()
    accent, paper = rgba(colors["accent"]["DEFAULT"]), rgba(colors["paper"])
    web, app = ROOT / "frontend" / "public", ROOT / "mobile" / "assets"

    tile(180, 0.60, accent, paper).convert("RGB").save(web / "apple-icon.png")
    tile(256, 0.62, accent, paper, 0.22).save(web / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    # iOS wants an opaque square; Android draws the foreground over the accent set in app.config.js.
    tile(1024, 0.58, accent, paper).convert("RGB").save(app / "icon.png")
    tile(1024, 0.48, None, paper).save(app / "adaptive-icon.png")
    # The splash shows the monogram alone on the paper background set in app.config.js.
    monogram(1024, accent).save(app / "splash.png")
    tile(48, 0.62, accent, paper, 0.22).save(app / "favicon.png")
    print("icons: redrew apple-icon.png, favicon.ico, icon.png, adaptive-icon.png, splash.png, favicon.png")


if __name__ == "__main__":
    main()
