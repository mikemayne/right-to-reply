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
  let releaseReady = false;
  if (process.env.RIGHT_TO_REPLY_STAGED_RELEASE) {
    await context.route('https://github.com/mikemayne/right-to-reply/releases/latest/download/responses.json',
      route => releaseReady ? route.fulfill({ path: join(root, 'data/responses.json'), contentType: 'application/json' }) : route.fulfill({ json: { schemaVersion: 1, parties: [] } }));
  }
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  const mark = page.locator('#match [data-check-policy-mark]');
  if (process.env.RIGHT_TO_REPLY_STAGED_RELEASE) {
    await settings.waitForFunction(async () => (await chrome.storage.local.get('snapshot')).snapshot?.data.parties.length === 0);
    assert.equal(await mark.count(), 0);
    releaseReady = true;
    await settings.locator('#refresh').click();
  }
  await mark.waitFor();
  assert.equal(await mark.evaluate(node => node.style.getPropertyValue('--check-policy-color')), '#000000');
  assert.equal(await page.locator('nav [data-check-policy-mark],#negative [data-check-policy-mark]').count(), 0);
  await mark.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Lorem ipsum dolor sit amet/);
  assert.match(await dialog.innerText(), /Consectetur adipiscing elit/);
  assert.equal(await dialog.locator('a').count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('#linked a').tap();
  assert.equal(new URL(page.url()).hash, '#match');
  await page.locator('#linked [data-check-policy-control]').press('Enter');
  await dialog.waitFor();
  await settings.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await mark.waitFor({ state: 'detached' });
  console.log('External response displayed with a working popup and native article link.');
} finally {
  await context?.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
