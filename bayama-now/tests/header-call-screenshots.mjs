import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');
const outDir = '/opt/cursor/artifacts';

const mime = { '.html': 'text/html', '.webp': 'image/webp', '.md': 'text/markdown' };

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

async function snap(label, contextOptions, scrollY) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(350);
  const header = page.locator('#top');
  const path = `${outDir}/bayama-now-header-call-${label}.png`;
  await header.screenshot({ path });
  const contrast = await page.evaluate(() => {
    const btn = document.querySelector('#top .btn.call');
    const cs = getComputedStyle(btn);
    return { color: cs.color, backgroundImage: cs.backgroundImage, boxShadow: cs.boxShadow };
  });
  await context.close();
  return { path, contrast };
}

const shots = [];
shots.push(await snap('mobile-hero', { ...devices['iPhone 13'], hasTouch: true }, 0));
shots.push(await snap('mobile-solid', { ...devices['iPhone 13'], hasTouch: true }, 1200));
shots.push(await snap('desktop-hero', { viewport: { width: 1440, height: 900 } }, 0));
shots.push(await snap('desktop-solid', { viewport: { width: 1440, height: 900 } }, 1200));

await browser.close();
server.close();

console.log(JSON.stringify({ shots }, null, 2));