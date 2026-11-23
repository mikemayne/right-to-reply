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
  // By default use an approved-format local fixture, not the availability
  // of a live GitHub repository. Set RIGHT_TO_REPLY_LIVE=1 for a live smoke test.
  if (!process.env.RIGHT_TO_REPLY_LIVE) {
    require('./sample-data.js');
    const data = globalThis.RightToReplyDemo;
    data.parties[0].responses[0].response = 'Duis aute irure dolor in reprehenderit.';
    data.parties[0].responses[0].description = 'Excepteur sint occaecat cupidatat non proident.';
    await settings.evaluate(data => chrome.storage.local.set({
      snapshot: { data, checkedAt: Date.now(), version: 1 }, lastAttempt: Date.now()
    }), data);
  }
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  const mark = page.locator('#match [data-right-to-reply-mark]');
  await mark.waitFor();
  assert.equal(await mark.evaluate(node => node.style.getPropertyValue('--right-to-reply-color')), '#000000');
  assert.equal(await page.locator('nav [data-right-to-reply-mark],#negative [data-right-to-reply-mark]').count(), 0);
  await mark.press('Enter');
  // Use the browser accessibility tree because page JavaScript cannot inspect the closed shadow.
  const cdp = await context.newCDPSession(page);
  const inspectDialog = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const dialog = nodes.find(node => node.role.value === 'dialog');
    assert.ok(dialog);
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    const descendants = [dialog];
    for (const node of descendants) {
      assert.notEqual(node.role.value, 'link');
      for (const id of node.childIds ?? []) descendants.push(byId.get(id));
    }
    const names = descendants.map(node => node.name?.value).join(' ');
    assert.match(names, /Duis aute irure dolor in reprehenderit/);
    assert.match(names, /Excepteur sint occaecat cupidatat non proident/);
  };
  await inspectDialog();
  assert.equal(await page.evaluate(() => document.body.lastElementChild.shadowRoot), null);
  await page.keyboard.press('Escape');
  await page.locator('#linked a').tap();
  assert.equal(new URL(page.url()).hash, '#match');
  await page.locator('#linked [data-right-to-reply-control]').press('Enter');
  await inspectDialog();
  await page.keyboard.press('Escape');
  const originalMark = await mark.elementHandle();
  await page.evaluate(() => {
    const other = document.createElement('article');
    other.id = 'other-article';
    other.innerHTML = '<p id="other-keyword">An example keyword.</p><p hidden>Example Party</p>';
    document.querySelector('main').append(other);
    const unrelated = document.createElement('section');
    unrelated.id = 'unrelated';
    unrelated.innerHTML = '<p>Example Party</p><p id="unrelated-keyword">example keyword</p>';
    document.querySelector('main').append(unrelated);
  });
  // Wait for a positive control in the new article, then verify that
  // article scope and visibility prevent unrelated responses.
  await page.evaluate(() => {
    const positive = document.createElement('article');
    positive.id = 'positive-article';
    positive.innerHTML = '<h2>Example Party</h2><p>example keyword</p>';
    document.querySelector('main').append(positive);
  });
  const positiveMark = page.locator('#positive-article [data-right-to-reply-mark]');
  await positiveMark.waitFor();
  assert.equal(await page.locator('#other-keyword [data-right-to-reply-mark], #unrelated-keyword [data-right-to-reply-mark]').count(), 0);
  assert.ok(await originalMark.evaluate(node => node.isConnected), 'Unrelated article updates must not replace existing marks');
  await page.evaluate(() => { document.querySelector('#other-article p[hidden]').hidden = false; });
  const otherMark = page.locator('#other-keyword [data-right-to-reply-mark]');
  await otherMark.waitFor();
  await page.evaluate(() => { document.querySelector('#other-article p:last-child').textContent = 'Different Party'; });
  await otherMark.waitFor({ state: 'detached' });
  assert.ok(await originalMark.evaluate(node => node.isConnected));
  await page.evaluate(() => { document.querySelector('#positive-article h2').textContent = 'Another Party'; });
  await positiveMark.waitFor({ state: 'detached' });
  assert.ok(await originalMark.evaluate(node => node.isConnected));
  await settings.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await mark.waitFor({ state: 'detached' });
  console.log('External response displayed with a working popup and native article link.');
} finally {
  await context?.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
