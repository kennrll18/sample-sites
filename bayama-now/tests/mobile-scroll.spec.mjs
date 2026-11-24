import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

const mime = {
  '.html': 'text/html',
  '.webp': 'image/webp',
  '.md': 'text/markdown',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = join(root, decodeURIComponent(path));
      try {
        if (!filePath.startsWith(root) || !statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = extname(filePath);
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(readFileSync(filePath));
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseURL: `http://127.0.0.1:${port}/` });
    });
  });
}

async function verticalSwipe(page, x, y, deltaY) {
  await page.evaluate(({ x, y, deltaY }) => {
    const target = document.elementFromPoint(x, y) || document.body;
    const touches = [
      new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y })
    ];
    const makeTouch = (ny) => new Touch({
      identifier: 1,
      target,
      clientX: x,
      clientY: ny,
      pageX: x,
      pageY: ny,
    });

    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches }));
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      const ny = y + (deltaY * i) / steps;
      const moveTouches = [makeTouch(ny)];
      document.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: moveTouches }));
    }
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
  }, { x, y, deltaY });
}

async function touchScrollDown(page, x, y, distance) {
  const endY = y - distance;
  await verticalSwipe(page, x, y, -distance);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 14 });
  await page.mouse.up();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.synthesizeScrollGesture', {
    x: Math.round(x),
    y: Math.round(y),
    xDistance: 0,
    yDistance: -distance,
    speed: 450,
    repeatCount: 1,
  });
}

const { server, baseURL } = await startServer();
const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],
  hasTouch: true,
});
const page = await context.newPage();

try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const compare = page.locator('[data-compare]').first();
  await compare.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(200);

  const box = await compare.boundingBox();
  if (!box) throw new Error('compare box missing');

  const x = box.x + box.width * 0.22;
  const y = box.y + box.height * 0.55;

  const overlayInputs = await page.evaluate(() => document.querySelectorAll('[data-compare] input').length);
  const before = await page.evaluate(() => window.scrollY);
  await touchScrollDown(page, x, y, 160);
  await page.waitForTimeout(450);
  const afterSwipe = await page.evaluate(() => window.scrollY);

  const handle = compare.locator('.handle');
  const beforeHandle = Number(await handle.getAttribute('aria-valuenow'));
  await handle.dragTo(compare, {
    sourcePosition: { x: 12, y: 40 },
    targetPosition: { x: 140, y: 40 },
    force: true,
  });
  await page.waitForTimeout(120);
  const afterPointer = Number(await handle.getAttribute('aria-valuenow'));
  const keyboardHandleWorks = await compare.evaluate((root) => {
    const h = root.querySelector('.handle');
    const before = Number(h.getAttribute('aria-valuenow'));
    h.focus();
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    return Number(h.getAttribute('aria-valuenow')) > before;
  });
  const horizontalHandleDragWorks = Math.abs(afterPointer - beforeHandle) >= 3 || keyboardHandleWorks;

  const footer = page.locator('footer');
  await footer.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const atFooter = await page.evaluate(() => {
    const f = document.querySelector('footer');
    const r = f.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 4;
  });
  const footerText = await footer.innerText();
  const screenshotPath = '/opt/cursor/artifacts/bayama-now-scroll-fix-mobile.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const passedScroll = afterSwipe > before + 20;
  const passedFooter = atFooter && footerText.includes('Bayama Now');

  console.log(JSON.stringify({
    device: 'iPhone 13',
    hasTouch: true,
    scrollYBefore: before,
    scrollYAfterVerticalSwipeOnCompare: afterSwipe,
    compareOverlayInputs: overlayInputs,
    verticalScrollFromCompare: passedScroll,
    horizontalHandleDragWorks,
    handleAriaBefore: beforeHandle,
    handleAriaAfterPointer: afterPointer,
    keyboardHandleWorks,
    footerReachable: passedFooter,
    screenshot: screenshotPath,
    pass: passedScroll && passedFooter && horizontalHandleDragWorks,
  }, null, 2));

  if (!passedScroll || !passedFooter || !horizontalHandleDragWorks) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}