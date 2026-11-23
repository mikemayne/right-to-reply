'use strict';

const CACHE_MS = 15 * 60 * 1000;
const MAX_AGE = 24 * 60 * 60 * 1000;
const REPLY_MS = 5 * 60 * 1000;

function createSync(storage, fetchFeed, now = Date.now) {
  let pending;
  async function refresh(force) {
    const { snapshot, lastAttempt } = await storage.get(['snapshot', 'lastAttempt']);
    const time = now();
    const valid = snapshot?.data?.schemaVersion === 2 && time - snapshot.checkedAt < MAX_AGE;
    if (!valid && snapshot) await storage.set({ snapshot: null });
    if (!force && ((valid && !snapshot.failed?.length && time - snapshot.checkedAt < CACHE_MS) ||
                   (valid && time - (lastAttempt ?? -Infinity) < 60000))) {
      return { ok: true, state: 'cached' };
    }
    if (!force && !valid && !snapshot && time - (lastAttempt ?? -Infinity) < 60000) {
      return { ok: false, state: 'unavailable' };
    }
    await storage.set({ lastAttempt: time });
    try {
      const { data, failed } = await fetchFeed();
      if (data.schemaVersion !== 2) throw new Error('Invalid metadata');
      const same = valid && JSON.stringify(snapshot.data) === JSON.stringify(data);
      await storage.set({ snapshot: { data, failed, checkedAt: now(), version: same ? snapshot.version : time } });
      return { ok: true, state: failed.length ? 'partial' : 'refreshed' };
    } catch {
      return { ok: false, state: valid ? 'cached' : 'unavailable' };
    }
  }
  return force => {
    if (!pending) pending = refresh(force).finally(() => { pending = undefined; });
    return pending;
  };
}

// Cache only successfully validated, explicitly requested replies. No article
// text or page URL leaves the extension. Missing or malformed files never fall
// back to an old response. The current approved directory authorises every read.
function createReplyLoader(storage, fetchReply, now = Date.now) {
  const cache = new Map();
  const pending = new Map();
  function allowed(snapshot, repository, keyword) {
    return snapshot?.data?.schemaVersion === 2 && now() - snapshot.checkedAt < MAX_AGE &&
      snapshot.data.parties.some(p => p.repository === repository && p.keywords.includes(keyword));
  }
  return async (repository, keyword) => {
    if (typeof repository !== 'string' || typeof keyword !== 'string') return null;
    const { snapshot } = await storage.get('snapshot');
    if (!allowed(snapshot, repository, keyword)) return null;
    const key = JSON.stringify([repository, keyword, snapshot.checkedAt]);
    const old = cache.get(key);
    if (old && now() - old.time < REPLY_MS) return old.reply;
    if (!pending.has(key)) {
      // Bound simultaneous background requests and cache growth.
      if (pending.size >= 12) return null;
      pending.set(key, (async () => {
        try {
          const reply = await fetchReply(repository, keyword);
          const { snapshot: current } = await storage.get('snapshot');
          if (!allowed(current, repository, keyword) || current.checkedAt !== snapshot.checkedAt) return null;
          cache.delete(key);
          cache.set(key, { time: now(), reply });
          if (cache.size > 256) cache.delete(cache.keys().next().value);
          return reply;
        } catch { return null; }
        finally { pending.delete(key); }
      })());
    }
    return pending.get(key);
  };
}

if (typeof module === 'object') {
  module.exports = { createSync, createReplyLoader };
} else {
  if (typeof importScripts === 'function') importScripts('feed.js', 'sources.js');
  const api = globalThis.browser ?? globalThis.chrome;
  const sync = createSync(api.storage.local, () => RightToReplySources.load(undefined, RightToReplyFeed));
  const loadReply = createReplyLoader(api.storage.local, (repository, keyword) =>
    RightToReplySources.loadReply(repository, keyword, RightToReplyFeed));
  api.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    if (request?.type === 'refresh-responses') {
      const force = request.force === true && sender.url === api.runtime.getURL('settings.html');
      sync(force).then(respond, () => respond({ ok: false, state: 'unavailable' }));
      return true;
    }
    if (request?.type === 'load-reply') {
      loadReply(request.repository, request.keyword).then(respond, () => respond(null));
      return true;
    }
  });
}
