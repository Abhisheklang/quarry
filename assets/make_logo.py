#!/usr/bin/env python3
"""Render the Quarry logo PNGs from the brand geometry.
Badge: dark slate rounded square. Mark: a magnifier whose lens holds three
amber strata layers — searching down through the layers of the docs.
Run: python3 assets/make_logo.py
"""
from PIL import Image, ImageDraw

S = 4  # supersample factor
W = 512 * S

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# --- background: vertical gradient slate, rounded-square mask ---
top, bottom = (30, 41, 59), (15, 23, 42)  # slate-800 -> slate-900
bg = Image.new("RGB", (W, W))
px = bg.load()
for y in range(W):
    c = lerp(top, bottom, y / W)
    for x in range(0, W, S):
        for dx in range(S):
            px[x + dx, y] = c

mask = Image.new("L", (W, W), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, W - 1, W - 1], radius=110 * S, fill=255)
badge = Image.new("RGBA", (W, W), (0, 0, 0, 0))
badge.paste(bg, (0, 0), mask)

d = ImageDraw.Draw(badge)

CX, CY, R = 225 * S, 212 * S, 108 * S  # lens geometry
# --- strata bars inside the lens (drawn, then masked to the lens circle) ---
strata = Image.new("RGBA", (W, W), (0, 0, 0, 0))
sd = ImageDraw.Draw(strata)
bars = [
    (168, 178, 292, "#f59e0b"),
    (152, 214, 300, "#d97706"),
    (172, 250, 282, "#b45309"),
]
for x0, y, x1, colour in bars:
    sd.rounded_rectangle(
        [x0 * S, y * S, x1 * S, (y + 17) * S], radius=8 * S, fill=colour
    )
lens_mask = Image.new("L", (W, W), 0)
ld = ImageDraw.Draw(lens_mask)
ld.ellipse([CX - R, CY - R, CX + R, CY + R], fill=255)
# Clip by the lens AND by the strata's own alpha, so transparent parts of
# the strata layer don't paint black over the badge gradient.
from PIL import ImageChops

strata.putalpha(ImageChops.darker(strata.split()[3], lens_mask))
badge.paste(strata, (0, 0), strata)
d = ImageDraw.Draw(badge)

# --- magnifier ring + handle (off-white) ---
ring = "#f8fafc"
d.ellipse([CX - R, CY - R, CX + R, CY + R], outline=ring, width=25 * S)
d.line(
    [(CX + int(R * 0.72), CY + int(R * 0.72)), (392 * S, 388 * S)],
    fill=ring,
    width=32 * S,
)
d.ellipse([392 * S - 16 * S, 388 * S - 16 * S, 392 * S + 16 * S, 388 * S + 16 * S], fill=ring)

out = badge.resize((512, 512), Image.LANCZOS)
out.save("assets/logo.png")
out.save("assets/favicon.png")
print("wrote assets/logo.png and assets/favicon.png (512x512)")
