from pathlib import Path
from PIL import Image, ImageChops

ASSET_DIR = Path('shop/assets/product-previews')
PAIRS = {
    'hydrangea-front-back.webp': 'hydrangea-front.webp',
    'axolotl-front-back.webp': 'axolotl-front.webp',
    'mantis-front-back.webp': 'mantis-front.webp',
    'queen-annes-lace-front-back.webp': 'queen-annes-lace-front.webp',
    'thistle-front-back.webp': 'thistle-front.webp',
    'jellyfish-front-back.webp': 'jellyfish-front.webp',
    'weevil-front-back.webp': 'weevil-front.webp',
}


def front_only(source: Path, target: Path) -> None:
    image = Image.open(source).convert('RGB')
    width, height = image.size

    # The existing temporary preview is a fixed two-panel FRONT | BACK layout.
    # Keep only the left panel, remove its heading, then tightly frame the actual
    # artwork so the first shop slide shows the front print large and clearly.
    panel = image.crop((0, int(height * 0.09), int(width * 0.49), height))

    background_sample = panel.crop((0, 0, max(8, panel.width // 12), max(8, panel.height // 12)))
    background = tuple(int(sum(channel) / len(channel)) for channel in zip(*background_sample.getdata()))
    flat_background = Image.new('RGB', panel.size, background)
    difference = ImageChops.difference(panel, flat_background).convert('L')
    mask = difference.point(lambda value: 255 if value > 10 else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise RuntimeError(f'No front artwork detected in {source}')

    left, top, right, bottom = bbox
    art_w = right - left
    art_h = bottom - top
    pad = max(10, int(max(art_w, art_h) * 0.08))
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(panel.width, right + pad)
    bottom = min(panel.height, bottom + pad)
    art = panel.crop((left, top, right, bottom))

    canvas = Image.new('RGB', (1200, 1200), background)
    art.thumbnail((1080, 1080), Image.Resampling.LANCZOS)
    x = (canvas.width - art.width) // 2
    y = (canvas.height - art.height) // 2
    canvas.paste(art, (x, y))
    canvas.save(target, 'WEBP', quality=92, method=6)
    print(f'{source.name} -> {target.name}: {target.stat().st_size} bytes')


for source_name, target_name in PAIRS.items():
    front_only(ASSET_DIR / source_name, ASSET_DIR / target_name)
