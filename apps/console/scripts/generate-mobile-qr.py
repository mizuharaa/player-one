"""Regenerate the temporary mobile QR: python -m pip install qrcode, then run here.
The encoded URL must match APP_QR_DESTINATION in DownloadApp.tsx.
"""
from pathlib import Path
import qrcode

url='https://playerone-web-production.up.railway.app/discover'
qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,border=0)
qr.add_data(url)
qr.make(fit=True)
matrix=qr.get_matrix()
n=len(matrix)
unit=10
border=4
size=(n+border*2)*unit
parts=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="Open the PlayerOne website"><rect width="{size}" height="{size}" fill="white"/><g fill="#131517">']
finders=[(0,0),(n-7,0),(0,n-7)]
for y,row in enumerate(matrix):
    for x,on in enumerate(row):
        if not on or any(fx<=x<fx+7 and fy<=y<fy+7 for fx,fy in finders): continue
        # Rounded ends, connected modules: retain full edges shared by dark cells.
        px=(x+border)*unit;py=(y+border)*unit
        parts.append(f'<rect x="{px}" y="{py}" width="10" height="10" rx="2.5"/>')
        if x+1<n and matrix[y][x+1]: parts.append(f'<rect x="{px+5}" y="{py}" width="10" height="10"/>')
        if y+1<n and matrix[y+1][x]: parts.append(f'<rect x="{px}" y="{py+5}" width="10" height="10"/>')
for fx,fy in finders:
    x=(fx+border)*unit;y=(fy+border)*unit
    parts.append(f'<rect x="{x}" y="{y}" width="70" height="70" rx="15"/><rect x="{x+10}" y="{y+10}" width="50" height="50" rx="8" fill="white"/><rect x="{x+20}" y="{y+20}" width="30" height="30" rx="5"/>')
parts.append('</g></svg>')
target=Path(__file__).resolve().parents[1]/'public/discover-media/playerone-mobile-qr.svg'
target.write_text(''.join(parts),encoding='utf-8')
print(f'{n} modules, {target.stat().st_size} bytes; URL: {url}')
