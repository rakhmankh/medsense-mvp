from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'public'
for size in (192, 512):
    scale = 3
    canvas = Image.new('RGB', (size*scale, size*scale), '#2563eb')
    draw = ImageDraw.Draw(canvas)
    points = [(100,256),(186,256),(228,152),(292,360),(337,256),(412,256)]
    factor = size*scale/512
    draw.line([(round(x*factor),round(y*factor)) for x,y in points], fill='white', width=round(22*factor), joint='curve')
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(root/f'icon-{size}.png')
