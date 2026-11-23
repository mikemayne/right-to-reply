'use strict';


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
  if (typeof importScripts === 'function') importScripts('feed.js', 'sources.js');
  const api = globalThis.browser ?? globalThis.chrome;
  const sync = createSync(api.storage.local, () => RightToReplySources.load(undefined, RightToReplyFeed));
  api.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== api.runtime.id || request?.type !== 'refresh-responses') return;
    const force = request.force === true && sender.url === api.runtime.getURL('settings.html');
    sync(force).then(respond, () => respond({ ok: false, state: 'unavailable' }));
    return true;
  });
}
