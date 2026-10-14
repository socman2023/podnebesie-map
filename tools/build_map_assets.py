"""Generate visually optimized map assets without changing coordinate space.

map-preview.webp is a quarter-size quick preview (1668x1191 px).
map-full.webp is full resolution (6670x4764 px) for detail zoom.

Source map-base.png in the repository is the current published 12 MB map.
The 34 MB master from the private Drive remains the authoritative source.
Re-run with a local copy of the full master as map-base.png only on the
working branch (do not overwrite the published main branch).
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "map-base.png"
PREVIEW = ROOT / "map-preview.webp"
FULL = ROOT / "map-full.webp"
EXPECTED = (6670, 4764)

def main():
    with Image.open(SRC) as im:
        if im.size != EXPECTED:
            raise SystemExit(
                f"Unexpected map dimensions {im.size}; "
                f"existing 128 JSON coordinates require {EXPECTED}"
            )
        source = im.convert("RGB")
        preview = source.resize((1668, 1191), Image.Resampling.LANCZOS)
        preview.save(PREVIEW, "WEBP", quality=77, method=6)
        source.save(FULL, "WEBP", quality=84, method=6)

    for file in (PREVIEW, FULL):
        with Image.open(file) as image:
            print(file.name, image.size, file.stat().st_size, "bytes")
            assert image.format == "WEBP"

if __name__ == "__main__":
    main()
