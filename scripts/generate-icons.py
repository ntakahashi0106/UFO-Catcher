# Resize the imagegen source for install icons. Requires Python + Pillow.
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = Image.open(root / "assets/branding/ufo-crane-source.webp").convert("RGB")
output = root / "public/icons"
output.mkdir(parents=True, exist_ok=True)
for name, size, maskable in [
    ("ufo-crane-64-v1.webp", 64, False),
    ("ufo-crane-192-v1.webp", 192, False),
    ("ufo-crane-512-v1.webp", 512, False),
    ("ufo-crane-maskable-512-v1.webp", 512, True),
    ("ufo-crane-apple-v1.png", 180, False),
]:
    # The generated symbol already fits inside the circular 80% safe area.
    image = source.resize((size, size), Image.Resampling.LANCZOS)
    path = output / name
    if path.suffix == ".webp":
        image.save(path, quality=85, method=6)
    else:
        image.quantize(colors=64).save(path, optimize=True)
    print(f"{name}: {size}x{size}, {path.stat().st_size} bytes")
