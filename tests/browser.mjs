import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const testDisclaimer = process.env.RIGHT_TO_REPLY_TEST_DISCLAIMER === '1';
const storeAssets = process.env.RIGHT_TO_REPLY_STORE_ASSETS;
if (storeAssets && (testDisclaimer || process.env.RIGHT_TO_REPLY_LIVE)) throw new Error('Store captures require deterministic demo data');
if (storeAssets) mkdirSync(storeAssets, { recursive: true });
const shortReply = storeAssets ? 'We support improving local bus services.' : 'Duis aute irure dolor in reprehenderit.';
const longReply = storeAssets ? 'Our fictional policy is to prioritise reliable, accessible buses and publish service performance data.' : 'Excepteur sint occaecat cupidatat non proident.';
if (!process.env.RIGHT_TO_REPLY_LIVE) {
  // Exercise the actual background loader with deterministic network replies.
  const fixture = {
    'mikemayne/right-to-reply/main/data/disclaimer.json': JSON.stringify(testDisclaimer ? {message:'Owner notice <b>plain text</b>',link:'https://example.org/notice',linkText:'Further information'} : {}),
    'mikemayne/right-to-reply/main/data/sources.json': JSON.stringify([
      { repository: 'owner/broken' }, { repository: 'owner/example-party' }
    ]),
    'owner/example-party/main/party.json': JSON.stringify({
      id: 'example-party', name: 'Example Party', color: '#000000'
    }),
    'owner/example-party/main/identifiers.json': JSON.stringify(['Example Party']),
    'owner/example-party/keyword-index/responses.json': JSON.stringify([
      ['example keyword', shortReply + '\n\n' + longReply + '\n'],
      ...(storeAssets ? [['public transport', shortReply + '\n\n' + longReply + '\n']] : [])
    ])
  };
  const sourcePath = join(extension, 'sources.js');
  writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8') + '\n;globalThis.testRequests = [];\n' +
    'globalThis.fetch = async url => { globalThis.testRequests.push(url); const files = ' +
    JSON.stringify(fixture) + '; const key = url.replace("https://raw.githubusercontent.com/", "");' +
    'return Object.hasOwn(files, key) ? new Response(files[key]) : new Response("", { status: 404 }); };\n');
}
const server = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  let html = readFileSync(join(root, 'demo/index.html'), 'utf8');
  if (storeAssets) html = html.replaceAll('example keyword', 'public transport')
    .replace('<main>', '<style>body{margin:0;background:#f5f5f2;color:#202124;font:20px/1.65 system-ui,sans-serif}main{max-width:850px;margin:64px auto;padding:36px 48px;background:white;border:1px solid #ddd}h1{font-size:42px;line-height:1.16;margin:24px 0}nav{border-bottom:1px solid #ddd;padding-bottom:20px;font-size:15px}nav a{color:inherit}p{margin:24px 0}</style><main>')
    .replace('Navigation public transport', 'Fictional news article — demonstration only')
    .replace('Example Party mentioned in a fictional article', 'Example Party discusses local services')
    .replace('The meeting discussed the <em>public transport</em>.', 'At a community meeting, the Example Party discussed plans for <em>public transport</em> in the local area.')
    .replace('The minutes also mention', 'The meeting also covered future investment in')
    .replace('The next meeting is Tuesday.', 'Residents will have a chance to discuss the proposals at the next community meeting. All names and policies in this demonstration are fictional.');
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let context;
try {
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    executablePath: process.env.RIGHT_TO_REPLY_BROWSER || undefined,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    hasTouch: true,
    ...(storeAssets ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } : {})
  });
  const settings = context.pages()[0];
  await settings.goto('chrome-extension://' + id + '/settings.html');
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  const mark = page.locator('#match [data-right-to-reply-mark]');
  await mark.waitFor();
  assert.equal(await mark.evaluate(node => getComputedStyle(node).textDecorationColor), await mark.evaluate(node => getComputedStyle(node).color));
  assert.equal(await mark.evaluate(node => node.hasAttribute('data-reply-segments')), false);
  assert.equal(await page.locator('nav [data-right-to-reply-mark],#negative [data-right-to-reply-mark]').count(), 0);
  let beforePopup;
  if (!process.env.RIGHT_TO_REPLY_LIVE) {
    const worker = context.serviceWorkers()[0];
    assert.ok(worker);
    assert.equal(await worker.evaluate(() => testRequests.filter(url => url.includes('/responses/')).length), 0);
    assert.equal(await worker.evaluate(() => testRequests.filter(url => url.endsWith('/responses.json') && url.includes('example-party')).length), 1);
    beforePopup = await worker.evaluate(() => testRequests.length);
  }
  if (storeAssets) await page.screenshot({ path: join(storeAssets, '01-keyword.png') });
  await mark.press('Enter');
  // Use the browser accessibility tree because page JavaScript cannot inspect the closed shadow.
  const cdp = await context.newCDPSession(page);
  let captured = false;
  const inspectDialog = async () => {
    const dialogNames = async () => {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const dialog = nodes.find(node => node.role.value === 'dialog');
      if (!dialog) return '';
      const byId = new Map(nodes.map(node => [node.nodeId, node]));
      const descendants = [dialog];
      for (const node of descendants) {
        if (node.role.value === 'link') {
          assert.equal(testDisclaimer, true, 'only the owner disclaimer may supply a link');
          assert.equal(node.name?.value, 'Further information');
        }
        for (const id of node.childIds ?? []) descendants.push(byId.get(id));
      }
      return descendants.map(node => node.name?.value).join(' ');
    };
    let names = '';
    for (let i = 0; i < 100; i++) {
      names = await dialogNames();
      if (names.includes(shortReply.slice(0,-1))) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(names.includes(shortReply.slice(0,-1)), names);
    assert.match(names, /Independent\s+browser\s+extension/i);
    assert.match(names, /Not supplied by this publication/);
    assert.doesNotMatch(names, /Example Party/);
    assert.ok(!names.includes(longReply.slice(0,-1)), names);
    if (storeAssets && !captured) await page.screenshot({ path: join(storeAssets, '02-short-reply.png') });
    if (testDisclaimer) {
      assert.match(names, /Owner notice <b>plain text<\/b>/);
      assert.match(names, /Further information/);
      await page.keyboard.press('Tab'); // optional owner link precedes the replies
    }
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    for (let i = 0; i < 100; i++) {
      names = await dialogNames();
      if (names.includes(longReply.slice(0,-1))) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(names, /Example Party/);
    assert.ok(names.includes(longReply.slice(0,-1)), names);
    if (storeAssets && !captured) {
      await page.screenshot({ path: join(storeAssets, '03-expanded-reply.png') });
      captured = true;
    }
  };
  await inspectDialog();
  if (!process.env.RIGHT_TO_REPLY_LIVE) {
    assert.equal(await context.serviceWorkers()[0].evaluate(() => testRequests.length), beforePopup, 'Opening and expanding a reply must make no network requests');
  }
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
  if (storeAssets) {
    const promo = await context.newPage();
    await promo.setViewportSize({ width: 440, height: 280 });
    const logo = readFileSync(join(extension, 'icon-128.png'));
    writeFileSync(join(storeAssets, 'store-icon.png'), logo);
    await promo.setContent('<html><body style="margin:0;background:#202124;color:white;display:grid;place-items:center;height:280px;font-family:system-ui,sans-serif"><div style="display:grid;justify-items:center;gap:16px"><div style="background:white;border-radius:12px;width:104px;height:104px;display:grid;place-items:center"><img width="88" height="88" alt="R2R" src="data:image/png;base64,' + logo.toString('base64') + '"></div><strong style="font-size:30px;letter-spacing:.02em">Right to Reply</strong><span style="font-size:15px;color:#ddd">Read the response. Decide for yourself.</span></div></body></html>');
    await promo.screenshot({ path: join(storeAssets, 'small-promo-440x280.png') });
    await promo.close();
  }
  console.log('External response displayed with a working popup and native article link.');
} finally {
  await context?.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
