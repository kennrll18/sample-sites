import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');
const outDir = '/opt/cursor/artifacts';
const mime = { '.html': 'text/html', '.webp': 'image/webp' };

const server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = join(root, decodeURIComponent(path));
    try {
      if (!filePath.startsWith(root) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});

const baseURL = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

const labels = ['carpet', 'tile', 'upholstery'];

async function verifyProfile(name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.locator('#results').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const sliders = page.locator('[data-compare]');
  const count = await sliders.count();
  const shots = [];
  const dims = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-compare] img')).map((img) => ({
      src: img.getAttribute('src'),
      w: img.naturalWidth,
      h: img.naturalHeight,
      alt: img.getAttribute('alt'),
    }));
  });

  for (let i = 0; i < count; i += 1) {
    const slider = sliders.nth(i);
    const cap = await slider.locator('xpath=ancestor::figure[1]//figcaption').innerText();
    const label = labels[i] || `slider-${i}`;
    const path = `${outDir}/bayama-now-ba-${name}-${label}-50.png`;
    await slider.screenshot({ path });
    const clip = await slider.evaluate((el) => {
      const after = el.querySelector('.after');
      const handle = el.querySelector('.handle');
      return {
        afterClip: after.style.clipPath,
        handleLeft: handle.style.left,
        handleValue: handle.getAttribute('aria-valuenow'),
      };
    });
    shots.push({ label, cap, path, clip });
  }

  await context.close();
  return { name, count, dims, shots };
}

const mobile = await verifyProfile('mobile', {
  ...devices['iPhone 13'],
  hasTouch: true,
  viewport: { width: 390, height: 844 },
});
const desktop = await verifyProfile('desktop', { viewport: { width: 1440, height: 900 } });

await browser.close();
server.close();

const pass =
  mobile.count === 3 &&
  desktop.count === 3 &&
  mobile.dims.every((d) => d.w === 1000 && d.h === 562) &&
  mobile.shots.every((s) => s.clip.handleValue === '50' && s.clip.afterClip.includes('50%'));

console.log(JSON.stringify({ pass, mobile, desktop }, null, 2));
if (!pass) process.exitCode = 1;