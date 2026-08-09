# 用 Pillow 把发财牌 PNG 合成到绿色圆角底，导出多尺寸 .ico（桌面图标）
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
tile = Image.open(os.path.join(HERE, '_facai_tile.png')).convert('RGBA')

S = 256
bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(bg)
# 麻将桌深绿圆角底
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=52, fill=(15, 110, 50, 255))
# 内层高光线，增加立体感
d.rounded_rectangle([6, 6, S - 7, S - 7], radius=46, outline=(255, 255, 255, 60), width=3)

# 将发财牌缩放并居中（占底图 ~80%）
tw, th = tile.size
scale = (S * 0.80) / max(tw, th)
nw, nh = int(round(tw * scale)), int(round(th * scale))
tile = tile.resize((nw, nh), Image.LANCZOS)
x = (S - nw) // 2
y = (S - nh) // 2
bg.alpha_composite(tile, (x, y))

out = os.path.join(HERE, 'icon_facai.ico')
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
bg.save(out, format='ICO', sizes=sizes)
print('icon ->', out, 'sizes', sizes)
