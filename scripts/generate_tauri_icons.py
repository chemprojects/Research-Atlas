#!/usr/bin/env python3
"""Generate src-tauri/icons/*.png and run: cd src-tauri && cargo tauri icon icons/app-icon.png"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"])
    from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"


def make(size: int) -> Image.Image:
    im = Image.new("RGBA", (size, size), (67, 56, 202, 255))
    d = ImageDraw.Draw(im)
    pad = max(2, size // 10)
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=max(4, size // 8),
        fill=(99, 102, 241, 255),
    )
    cx, cy = size // 2, size // 2
    w, h = size // 3, size // 2
    stroke = max(2, size // 24)
    x0, y0 = cx - w // 2, cy - h // 2
    x1, y1 = cx + w // 2, cy + h // 2
    d.rectangle([x0, y0, x1, y1], outline=(255, 255, 255, 255), width=stroke)
    d.line([cx, y0, cx, y1], fill=(255, 255, 255, 255), width=stroke)
    d.line([x0, cy - h // 6, x1, cy - h // 6], fill=(255, 255, 255, 255), width=max(1, stroke // 2))
    return im


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    make(32).save(ROOT / "32x32.png")
    make(128).save(ROOT / "128x128.png")
    make(256).save(ROOT / "128x128@2x.png")
    make(1024).save(ROOT / "app-icon.png")
    print(f"Wrote icons to {ROOT}")
    tauri_dir = ROOT.parent
    try:
        subprocess.run(
            ["cargo", "tauri", "icon", str(ROOT / "app-icon.png")],
            cwd=tauri_dir,
            check=True,
        )
        print("cargo tauri icon completed")
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print("Run manually: cd src-tauri && cargo tauri icon icons/app-icon.png", e)


if __name__ == "__main__":
    main()
