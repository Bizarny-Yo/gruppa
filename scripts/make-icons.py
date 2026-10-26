"""Генерация PNG-иконок PWA из геометрии (без внешних ассетов)."""

from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "public"

TOP = np.array([0x8D, 0xA5, 0xFF], dtype=float)
BOTTOM = np.array([0x4F, 0x6F, 0xE0], dtype=float)
DARK = (0x0D, 0x0F, 0x15, 210)
GREEN = (0x38, 0xD3, 0x9F, 255)


def gradient(size: int) -> Image.Image:
    y = np.linspace(0, 1, size)[:, None]
    x = np.linspace(0, 1, size)[None, :]
    t = np.clip((x + y) / 2, 0, 1)[..., None]
    rgb = (TOP * (1 - t) + BOTTOM * t).astype(np.uint8)
    return Image.fromarray(rgb, "RGB").convert("RGBA")


def draw_mark(img: Image.Image, scale: float, rounded: bool) -> Image.Image:
    size = img.size[0]
    pad = (1 - scale) / 2 * size
    inner = size - 2 * pad

    def px(v: float) -> float:
        return pad + v * inner

    d = ImageDraw.Draw(img)
    bars = [(14, 17, 24), (14, 28, 36), (14, 39, 17)]
    for x, y, w in bars:
        d.rounded_rectangle(
            [px(x / 64), px(y / 64), px((x + w) / 64), px((y + 6) / 64)],
            radius=px(3 / 64),
            fill=DARK,
        )
    cx, cy, r = px(47 / 64), px(42 / 64), px(6 / 64)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    return img


def make(name: str, size: int, radius_ratio: float | None, scale: float) -> None:
    S = size * 4
    base = gradient(S)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    if radius_ratio is None:
        img.alpha_composite(base)
    else:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=255)
        img.paste(base, (0, 0), mask)

    draw_mark(img, scale, radius_ratio is not None)
    img.resize((size, size), Image.LANCZOS).save(OUT / name)
    print("saved", name, size)


if __name__ == "__main__":
    make("icon-192.png", 192, 0.24, 1.0)
    make("icon-512.png", 512, 0.24, 1.0)
    make("icon-maskable.png", 512, None, 0.78)
    make("apple-touch-icon.png", 180, None, 1.0)
