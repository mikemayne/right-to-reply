import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.RIGHT_TO_REPLY_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'right-to-reply-'));
const extension = join(temp, 'extension');
cpSync(join(root, 'dist', process.env.RIGHT_TO_REPLY_TARGET || 'chrome'), extension, { recursive: true });
const manifestPath = join(extension, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
manifest.key = der.toString('base64');
const id = createHash('sha256').update(der).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
writeFileSync(manifestPath, JSON.stringify(manifest));
const server = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(readFileSync(join(root, 'demo/index.html')));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let context;
try {
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    executablePath: process.env.RIGHT_TO_REPLY_BROWSER || undefined,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    hasTouch: true
  });
  const settings = context.pages()[0];
  await settings.goto('chrome-extension://' + id + '/settings.html');
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  if (process.env.RIGHT_TO_REPLY_LIVE) {
    await settings.waitForFunction(async () => {
      const { snapshot } = await chrome.storage.local.get('snapshot');
      return snapshot?.checkedAt > 0 && snapshot.data.parties.length === 0;
    });
  }
  const mark = page.locator('#match [data-check-policy-mark]');
  assert.equal(await mark.count(), 0);
  await settings.evaluate(() => chrome.storage.local.set({ demo: true }));
  await mark.waitFor();
  assert.equal(await mark.evaluate(node => node.style.getPropertyValue('--check-policy-color')), '#3468ac');
  assert.equal(await page.locator('nav [data-check-policy-mark],#negative [data-check-policy-mark]').count(), 0);
  await mark.press('Enter');
  // Use the browser accessibility tree because page JavaScript cannot inspect the closed shadow.
  const cdp = await context.newCDPSession(page);
  const inspectDialog = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    assert.ok(nodes.some(node => node.role.value === 'dialog'));
    const names = nodes.map(node => node.name?.value).join(' ');
    assert.match(names, /Your one line response to the keyword goes here/);
    assert.match(names, /An extended description/);
  };
  await inspectDialog();
  assert.equal(await page.evaluate(() => document.body.lastElementChild.shadowRoot), null);
  await page.keyboard.press('Escape');
  await page.locator('#linked a').tap();
  assert.equal(new URL(page.url()).hash, '#match');
  await page.locator('#linked [data-check-policy-control]').press('Enter');
  await inspectDialog();
  await settings.evaluate(() => chrome.storage.local.set({ demo: false }));
  await mark.waitFor({ state: 'detached' });
  console.log('Browser demo passed, including popup, native link, and empty approved feed.');
} finally {
  await context?.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
