"""Generate a transparent 512x512 hexagonal NPC tile from any portrait image.
Usage: python hex_token_builder.py portrait.png output.png [label]
Requires Pillow (pip install pillow)."""
import sys, math
from PIL import Image, ImageDraw, ImageFont, ImageOps

def create(input_path,output_path,label='NPC'):
 size=512; source=Image.open(input_path).convert('RGBA');source=ImageOps.fit(source,(size,size),method=Image.Resampling.LANCZOS,centering=(.5,.48));
 points=[(int(size/2+size*.47*math.cos(math.radians(-90+i*60))),int(size/2+size*.47*math.sin(math.radians(-90+i*60)))) for i in range(6)]
 mask=Image.new('L',(size,size),0);d=ImageDraw.Draw(mask);d.polygon(points,fill=255)
 result=Image.new('RGBA',(size,size),(0,0,0,0));result.paste(source,(0,0),mask)
 draw=ImageDraw.Draw(result);draw.line(points+[points[0]],fill=(5,8,12,255),width=30,joint='curve')
 draw.line(points+[points[0]],fill=(197,163,96,255),width=7,joint='curve')
 if label:
  draw.rounded_rectangle((size*.30,size*.77,size*.70,size*.87),radius=7,fill=(6,11,15,215))
  draw.text((size/2,size*.82),label[:18],anchor='mm',fill=(240,245,249,255),font=ImageFont.load_default(size=22))
 result.save(output_path)
if __name__=='__main__':
 if len(sys.argv)<3:raise SystemExit('Usage: python hex_token_builder.py input.png output.png [label]')
 create(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else 'NPC')
