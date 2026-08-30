from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'shop' / 'assets' / 'product-previews'

SOURCES = {
    'hydrangea-front.webp': 'hydrangea-front-v3.webp',
    'axolotl-front.webp': 'axolotl-front-v3.webp',
    'mantis-front.webp': 'mantis-front-v3.webp',
    'queen-annes-lace-front.webp': 'queen-annes-lace-front-v3.webp',
    'thistle-front.webp': 'thistle-front-v3.webp',
    'jellyfish-front.webp': 'jellyfish-front-v3.webp',
    'dragonfly-front-v2.webp': 'dragonfly-front-v3.webp',
}

TARGET = 1400
PAD_FRAC = 0.055


def visible_bbox(im: Image.Image):
    rgba = im.convert('RGBA')
    alpha = rgba.getchannel('A')
    alpha_bbox = alpha.point(lambda v: 255 if v > 6 else 0).getbbox()
    if alpha_bbox and alpha_bbox != (0, 0, rgba.width, rgba.height):
        return alpha_bbox

    # Fallback for flattened white/near-white backgrounds.
    rgb = rgba.convert('RGB')
    bg = Image.new('RGB', rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, bg).convert('L')
    mask = diff.point(lambda v: 255 if v > 7 else 0)
    return mask.getbbox()


def build(src: Path, dst: Path):
    with Image.open(src) as im:
        rgba = im.convert('RGBA')

    bbox = visible_bbox(rgba)
    if not bbox:
        raise RuntimeError(f'No visible artwork detected in {src.name}')

    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    pad = max(8, round(max(w, h) * 0.025))
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(rgba.width, x1 + pad); y1 = min(rgba.height, y1 + pad)
    crop = rgba.crop((x0, y0, x1, y1))

    usable = round(TARGET * (1 - 2 * PAD_FRAC))
    scale = min(usable / crop.width, usable / crop.height)
    nw = max(1, round(crop.width * scale)); nh = max(1, round(crop.height * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)

    canvas = Image.new('RGBA', (TARGET, TARGET), (255, 255, 255, 0))
    pos = ((TARGET - nw) // 2, (TARGET - nh) // 2)
    canvas.alpha_composite(crop, pos)
    canvas.save(dst, 'WEBP', lossless=True, method=6)

    out_alpha = canvas.getchannel('A')
    out_bbox = out_alpha.point(lambda v: 255 if v > 6 else 0).getbbox()
    if not out_bbox:
        raise RuntimeError(f'Generated blank preview for {src.name}')
    ow = out_bbox[2] - out_bbox[0]; oh = out_bbox[3] - out_bbox[1]
    fill = max(ow, oh) / TARGET
    if fill < 0.82:
        raise RuntimeError(f'Artwork still too small for {src.name}: fill={fill:.3f}')
    print(f'{src.name} -> {dst.name}: source={rgba.size}, bbox={bbox}, output={canvas.size}, fill={fill:.3f}, bytes={dst.stat().st_size}')


for source_name, output_name in SOURCES.items():
    build(ASSETS / source_name, ASSETS / output_name)

print('PREVIEW_BUILD=PASS')
