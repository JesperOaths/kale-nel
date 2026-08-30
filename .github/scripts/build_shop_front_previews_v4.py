from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'shop' / 'assets' / 'product-previews'

SOURCES = {
    'hydrangea-front-v3.webp': 'hydrangea-front-v4.webp',
    'axolotl-front-v3.webp': 'axolotl-front-v4.webp',
    'mantis-front-v3.webp': 'mantis-front-v4.webp',
    'queen-annes-lace-front-v3.webp': 'queen-annes-lace-front-v4.webp',
    'thistle-front-v3.webp': 'thistle-front-v4.webp',
    'jellyfish-front-v3.webp': 'jellyfish-front-v4.webp',
    'dragonfly-front-v3.webp': 'dragonfly-front-v4.webp',
}

TARGET = 1400
PAD_FRAC = 0.008


def alpha_bbox(im: Image.Image):
    return im.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox()


def remove_edge_white(im: Image.Image) -> Image.Image:
    rgba = im.convert('RGBA')
    bbox = alpha_bbox(rgba)
    if not bbox:
        raise RuntimeError('No visible pixels')
    rgba = rgba.crop(bbox)
    px = rgba.load()
    w, h = rgba.size

    def candidate(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and min(r, g, b) >= 250 and (max(r, g, b) - min(r, g, b)) <= 6

    seen = bytearray(w * h)
    q = deque()

    def seed(x, y):
        idx = y * w + x
        if not seen[idx] and candidate(x, y):
            seen[idx] = 1
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        if h > 1:
            seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        if w > 1:
            seed(w - 1, y)

    removed = 0
    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        removed += 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                idx = ny * w + nx
                if not seen[idx] and candidate(nx, ny):
                    seen[idx] = 1
                    q.append((nx, ny))

    return rgba, removed


def build(src: Path, dst: Path):
    with Image.open(src) as im:
        rgba, removed = remove_edge_white(im)

    bbox = alpha_bbox(rgba)
    if not bbox:
        raise RuntimeError(f'Background removal made {src.name} blank')
    crop = rgba.crop(bbox)

    usable = round(TARGET * (1 - 2 * PAD_FRAC))
    scale = min(usable / crop.width, usable / crop.height)
    nw = max(1, round(crop.width * scale))
    nh = max(1, round(crop.height * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)

    canvas = Image.new('RGBA', (TARGET, TARGET), (0, 0, 0, 0))
    pos = ((TARGET - nw) // 2, (TARGET - nh) // 2)
    canvas.alpha_composite(crop, pos)
    canvas.save(dst, 'WEBP', lossless=True, method=6)

    out_bbox = alpha_bbox(canvas)
    if not out_bbox:
        raise RuntimeError(f'Generated blank preview for {src.name}')
    ow = out_bbox[2] - out_bbox[0]
    oh = out_bbox[3] - out_bbox[1]
    fill = max(ow, oh) / TARGET
    if fill < 0.965:
        raise RuntimeError(f'Artwork still has too much outer space for {src.name}: fill={fill:.3f}')

    # Confirm the outer corners are actually transparent rather than opaque white.
    corners = [canvas.getpixel((0, 0)), canvas.getpixel((TARGET - 1, 0)), canvas.getpixel((0, TARGET - 1)), canvas.getpixel((TARGET - 1, TARGET - 1))]
    if any(a != 0 for _, _, _, a in corners):
        raise RuntimeError(f'Preview corners are not transparent for {src.name}: {corners}')

    print(f'{src.name} -> {dst.name}: removed_edge_white={removed}, source_crop={bbox}, output={canvas.size}, fill={fill:.3f}, bytes={dst.stat().st_size}')


for source_name, output_name in SOURCES.items():
    build(ASSETS / source_name, ASSETS / output_name)

print('PREVIEW_V4_BUILD=PASS')
