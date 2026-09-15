import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

await mkdir('artifacts/mobile-v3', { recursive: true });
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  for (const width of [320, 390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    await page.goto('http://localhost:5177/?screen=signin&lang=en');
    const mark = page.locator('div[role="img"][aria-label="Player One"]');
    await mark.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const rect = await mark.boundingBox();
    await mark.evaluate(node => { node.style.visibility = 'hidden'; });
    const path = `artifacts/mobile-v3/login-background-${width}.png`;
    await page.screenshot({ path });
    rows.push({ width, rect, path });
    await page.close();
  }
  await writeFile('artifacts/mobile-v3/login-contrast-regions.json', JSON.stringify(rows));
} finally { await browser.close(); }
// Pillow reads captured pixels; no source image is edited. Requires Python + Pillow.
const result = execFileSync('python', ['-X', 'utf8', '-c', `
from PIL import Image
import json, math
rows=json.load(open('artifacts/mobile-v3/login-contrast-regions.json'))
def luminance(rgb):
    linear=[c/255/12.92 if c/255<=.04045 else ((c/255+.055)/1.055)**2.4 for c in rgb]
    return sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))
for row in rows:
    im=Image.open(row['path']).convert('RGB');r=row['rect']
    box=(math.ceil(r['x']),math.ceil(r['y']),math.floor(r['x']+r['width']),math.floor(r['y']+r['height']))
    worst=max(luminance(px) for px in im.crop(box).get_flattened_data())
    row['minimumWhiteContrast']=round(1.05/(worst+.05),2)
with open('artifacts/mobile-v3/login-contrast.json','w') as f:json.dump(rows,f,indent=2)
print(json.dumps(rows,indent=2))
assert all(row['minimumWhiteContrast']>=4.5 for row in rows)
`], { encoding: 'utf8' });
console.log(result);
