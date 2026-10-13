# Presente brand kit: og-image 1200x630, monochrome manifest icon, notification badge.
# Usage: python tools/brand-kit.py <fonts dir with c300i.ttf (Cormorant Garamond 300 italic) and f2.ttf (Inter 400)>
# Same geometry as icon.svg: dark track r=170/512, stroke 64, gold quarter arc 12 -> 3.
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = __import__('os').path.join(__import__('os').path.dirname(__file__), '..') + '/'
FONTS = sys.argv[1]
BG = (5, 5, 7)
TRACK = (34, 33, 40)
GOLD = (255, 184, 0)
TEXT = (245, 242, 235)
DIM = (138, 133, 120)
SS = 4  # supersample


def ring(draw, cx, cy, r, w, track, arc, s=1):
    # PIL strokes grow inward from the box: push the box out by w/2 so the stroke is centred on r, as in SVG.
    R = r + w / 2
    box = [cx - R, cy - R, cx + R, cy + R]
    if track:
        draw.ellipse(box, outline=track, width=w)
    draw.arc(box, start=-90, end=0, fill=arc, width=w)
    # round caps at 12 and 3 o'clock
    for (x, y) in [(cx, cy - r), (cx + r, cy)]:
        draw.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=arc)


def og():
    W, H = 1200 * SS, 630 * SS
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    # mark on the left, scaled from the 512 icon (r 170, stroke 64)
    k = 1.25 * SS
    cx, cy = 300 * SS, H // 2
    ring(d, cx, cy, int(170 * k), int(64 * k), TRACK, GOLD)
    serif = ImageFont.truetype(FONTS + '/c300i.ttf', 150 * SS)
    sans = ImageFont.truetype(FONTS + '/f2.ttf', 34 * SS)
    x = 600 * SS
    d.text((x, 225 * SS), 'presente', font=serif, fill=TEXT, anchor='ls')
    d.text((x, 320 * SS), 'Un blocco alla volta.', font=sans, fill=GOLD, anchor='ls')
    d.text((x, 375 * SS), 'Timer per i tuoi task, con check-in', font=sans, fill=DIM, anchor='ls')
    d.text((x, 422 * SS), 'e archivio.', font=sans, fill=DIM, anchor='ls')
    im.resize((1200, 630), Image.LANCZOS).save(OUT + 'og-image.png', optimize=True)


def mono(size, name, pad_ratio):
    # Monochrome = white mark on transparent; the OS tints it. Track is dropped: only the arc + a faint ring.
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    scale = S * (1 - 2 * pad_ratio) / 512
    c = S / 2
    ring(d, c, c, int(170 * scale), int(64 * scale), (255, 255, 255, 90), (255, 255, 255, 255))
    im.resize((size, size), Image.LANCZOS).save(OUT + name, optimize=True)


og()
mono(512, 'icon-monochrome-512.png', 0.12)  # Android themed icon: safe zone like maskable
mono(96, 'badge-96.png', 0.0)               # notification status-bar badge
print('ok')
