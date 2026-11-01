# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow==11.1.0"]
# ///
"""Make the banner's copies from its source: uv run scripts/banner.py

The source, branding/dji-thermal-analyzer.jpg, is kept as it was made. Its copies are in docs/assets/, which the
documentation publishes and the wheel carries: 1600 px wide for the README and the docs' home page, and 2400 px for
sharp screens there. The README shows the docs site's copy, as the repository is private and PyPI shows the README.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "branding" / "dji-thermal-analyzer.jpg"
WIDTHS = [1600, 2400]


def main() -> None:
    with Image.open(SOURCE) as im:
        for width in WIDTHS:
            out = ROOT / "docs" / "assets" / f"banner-{width}.jpg"
            copy = im.convert("RGB").resize((width, round(im.height * width / im.width)), Image.Resampling.LANCZOS)
            copy.save(out, quality=82, optimize=True, progressive=True)
            print(f"{out.relative_to(ROOT)}: {copy.width} × {copy.height}, {out.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
