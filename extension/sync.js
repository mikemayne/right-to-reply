'use strict';

const RELEASE_URL = 'https://github.com/mikemayne/right-to-reply/releases/latest/download/responses.json';
const CACHE_MS = 15 * 60 * 1000;

function createSync(storage, fetchFeed, now = Date.now) {
  let pending;
  async function refresh(force) {
    const { snapshot, lastAttempt } = await storage.get(['snapshot', 'lastAttempt']);
    const time = now();
    if (!force && (time - (snapshot?.checkedAt ?? -Infinity) < CACHE_MS ||
                   time - (lastAttempt ?? -Infinity) < 60000)) {
      return { ok: Boolean(snapshot), state: 'cached' };
    }
    await storage.set({ lastAttempt: time });
    try {
      const data = RightToReplyFeed.validate(await fetchFeed());
      const same = JSON.stringify(snapshot?.data) === JSON.stringify(data);
      await storage.set({ snapshot: { data, checkedAt: time, version: same ? snapshot.version : time } });
      return { ok: true, state: 'refreshed' };
    } catch {
      return { ok: false, state: snapshot ? 'cached' : 'unavailable' };
    }
  }

  return force => {
    if (!pending) pending = refresh(force).finally(() => { pending = undefined; });
    return pending;
  };
}

if (typeof module === 'object') {
  globalThis.RightToReplyFeed = require('./feed.js');
  module.exports = { createSync };
} else {
  if (typeof importScripts === 'function') importScripts('feed.js');
  const api = globalThis.browser ?? globalThis.chrome;
  const sync = createSync(api.storage.local, async () => {
    const response = await fetch(RELEASE_URL, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok || new URL(response.url).protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']
      .includes(new URL(response.url).hostname)) throw new Error('Approved release unavailable.');
    const reader = response.body.getReader();
    let size = 0;
    let body = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error('Release too large.');
        body += decoder.decode(value, { stream: true });
      }
      return JSON.parse(body + decoder.decode());
    } finally {
      await reader.cancel().catch(() => {});
    }
  });
  api.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== api.runtime.id || request?.type !== 'refresh-responses') return;
    const force = request.force === true && sender.url === api.runtime.getURL('settings.html');
    sync(force).then(respond, () => respond({ ok: false, state: 'unavailable' }));
    return true;
  });
}
