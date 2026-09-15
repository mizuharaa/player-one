import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Samples the supplied clip, not the poster; no native performance claim.
await mkdir('artifacts/mobile-v3', { recursive: true });
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  for (const width of [320, 390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'no-preference' });
    await page.goto('http://localhost:5177/?screen=landing&lang=vi');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 3);
    await page.waitForTimeout(1200);
    const regions = await page.evaluate(() => {
      const ink = getComputedStyle(document.querySelector('[role="heading"]')).color;
      return [...document.querySelectorAll('*')].filter(node =>
        [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) && getComputedStyle(node).color === ink,
      ).map(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        node.style.color = 'transparent';
        return { text: node.textContent, ink: ink.match(/\d+/g).map(Number), rect: { x, y, width, height } };
      });
    });
    if (!regions.length) throw new Error('No film text regions');
    for (let second = 0; second < 7; second++) {
      await page.evaluate(async time => {
        const video = document.querySelector('video');
        video.pause();
        await new Promise(resolve => {
          video.addEventListener('seeked', resolve, { once: true });
          video.currentTime = time + 0.01;
        });
      }, second);
      const path = `artifacts/mobile-v3/film-${width}-${second}.png`;
      await page.screenshot({ path });
      rows.push({ width, second, path, regions });
    }
    await page.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/mobile-v3/film-regions.json', JSON.stringify(rows));
// Pillow reads captured pixels; it never edits the source asset.
console.log(execFileSync('python', ['-X', 'utf8', '-c', `
from PIL import Image
import json,math
rows=json.load(open('artifacts/mobile-v3/film-regions.json'))
def lum(rgb):
    linear=[v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in rgb]
    return sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))
results=[]
for row in rows:
    im=Image.open(row['path']).convert('RGB')
    for region in row['regions']:
        r=region['rect']
        box=(math.ceil(r['x']),math.ceil(r['y']),math.floor(r['x']+r['width']),math.floor(r['y']+r['height']))
        bright=max(lum(px) for px in im.crop(box).get_flattened_data())
        contrast=(lum(region['ink'])+.05)/(bright+.05)
        results.append({'width':row['width'],'second':row['second'],'text':region['text'],'contrast':round(contrast,2)})
with open('artifacts/mobile-v3/film-text-contrast.json','w',encoding='utf8') as f:
    json.dump(results,f,indent=2,ensure_ascii=False)
print(json.dumps({'frames':len(rows),'regions':len(results),'minimumContrast':min(r['contrast'] for r in results)}))
assert all(r['contrast']>=4.5 for r in results)
`], { encoding: 'utf8' }));
