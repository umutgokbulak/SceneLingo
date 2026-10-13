# Puts the frames taken by `node test/pictures.js frames` together as the short film at the top
# of the README, drawing the pointer into each frame (a screenshot has none).
#
#   python test/animate.py        needs Pillow
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, '..', '.frames')
OUT = os.path.join(HERE, '..', 'docs', 'demo.webp')
WIDTH = 800          # of the finished film, in pixels
SPACING = 90         # least time between two frames that are kept, in milliseconds
LAST = 2600          # how long the last frame stays
ARROW = [(0, 0), (0, 17), (4.5, 13), (7.5, 20), (10, 19), (7, 12), (12.5, 12)]

taken = json.load(open(os.path.join(FRAMES, 'frames.json'), encoding='utf-8'))
kept = [taken[0]]
for frame in taken[1:-1]:
    if frame['t'] - kept[-1]['t'] >= SPACING:
        kept.append(frame)
kept.append(taken[-1])

images, durations = [], []
for i, frame in enumerate(kept):
    image = Image.open(os.path.join(FRAMES, frame['file'])).convert('RGB')
    scale = WIDTH / image.width
    image = image.resize((WIDTH, round(image.height * scale)), Image.LANCZOS)
    x, y = frame['pointer'][0] * scale, frame['pointer'][1] * scale
    ImageDraw.Draw(image).polygon([(x + px * 1.1, y + py * 1.1) for px, py in ARROW], fill='white', outline='black')
    images.append(image)
    durations.append(kept[i + 1]['t'] - frame['t'] if i + 1 < len(kept) else LAST)

images[0].save(OUT, save_all=True, append_images=images[1:], duration=durations, loop=0, quality=70, method=6, minimize_size=True)
print(len(images), 'frames,', round(sum(durations) / 1000, 1), 's,', round(os.path.getsize(OUT) / 1024), 'KB ->', os.path.normpath(OUT))
