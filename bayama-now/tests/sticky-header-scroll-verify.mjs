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

async function probe(page, scrollY, label) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const header = document.getElementById('top');
    const services = document.getElementById('services');
    const results = document.getElementById('results');
    const heroRect = hero.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const servicesRect = services.getBoundingClientRect();
    const resultsRect = results.getBoundingClientRect();
    const heroVisible = heroRect.bottom > 0 && heroRect.top < window.innerHeight;
    const headerPinned = Math.abs(headerRect.top) < 2;
    const servicesVisible = servicesRect.top < window.innerHeight && servicesRect.bottom > 0;
    const resultsVisible = resultsRect.top < window.innerHeight && resultsRect.bottom > 0;
    return {
      scrollY: window.scrollY,
      heroVisible,
      headerPinned,
      headerTop: headerRect.top,
      headerHeight: headerRect.height,
      servicesVisible,
      resultsVisible,
      headerChildCount: header.children.length,
    };
  });
  const shot = `${outDir}/bayama-now-scroll-${label}-y${scrollY}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  return { label, scrollY, metrics, shot };
}

const report = { checks: [], pass: true };

async function runProfile(name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'networkidle' });

  const structure = await page.evaluate(() => ({
    headerChildCount: document.getElementById('top').children.length,
    heroParentTag: document.querySelector('.hero').parentElement.tagName,
  }));

  for (const y of [0, 1500, 3000]) {
    const row = await probe(page, y, `${name}`);
    const ok = y === 0
      ? row.metrics.headerPinned && structure.headerChildCount === 1
      : !row.metrics.heroVisible && row.metrics.headerPinned && (row.metrics.servicesVisible || row.metrics.resultsVisible);
    row.pass = ok;
    if (!ok) report.pass = false;
    report.checks.push(row);
  }

  await page.screenshot({
    path: `${outDir}/bayama-now-scroll-${name}-desktop-full.png`,
    fullPage: true,
  });

  report[`${name}Structure`] = structure;
  await context.close();
}

await runProfile('mobile', { ...devices['iPhone 13'], hasTouch: true, viewport: { width: 390, height: 844 } });
await runProfile('desktop', { viewport: { width: 1440, height: 900 }, hasTouch: false });

await browser.close();
server.close();

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;