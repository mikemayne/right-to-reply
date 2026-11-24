'use strict';

const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_AGE = CACHE_MS;
const ALARM = 'r2r-daily-refresh';

function createSync(storage, fetchFeed, now = Date.now) {
  let pending;
  async function refresh(force) {
    const { snapshot, lastAttempt } = await storage.get(['snapshot', 'lastAttempt']);
    const time = now();
    const valid = snapshot?.data?.schemaVersion === 3 && time - snapshot.checkedAt < MAX_AGE;
    if (!valid && snapshot) await storage.set({ snapshot: null });
    if (!force && time - (lastAttempt ?? -Infinity) < CACHE_MS) {
      return { ok: valid, state: valid ? 'cached' : 'unavailable' };
    }
    await storage.set({ lastAttempt: time });
    try {
      const { data, failed } = await fetchFeed();
      if (data.schemaVersion !== 3 || new TextEncoder().encode(JSON.stringify(data)).length > 8 * 1024 * 1024) {
        throw new Error('Invalid or oversized complete response snapshot');
      }
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

// This function has no network dependency: every reply is already on the device.
function createReplyLoader(storage, now = Date.now) {
  return async (repository, keyword) => {
    if (typeof repository !== 'string' || typeof keyword !== 'string') return null;
    const { snapshot } = await storage.get('snapshot');
    if (snapshot?.data?.schemaVersion !== 3 || now() - snapshot.checkedAt >= MAX_AGE) return null;
    const party = snapshot.data.parties.find(p => p.repository === repository);
    const entry = party?.replies?.find(r => r.keyword === keyword);
    return entry ? { response: entry.response, description: entry.description } : null;
  };
}

if (typeof module === 'object') {
  module.exports = { createSync, createReplyLoader };
} else {
  if (typeof importScripts === 'function') importScripts('feed.js', 'sources.js');
  const api = globalThis.browser ?? globalThis.chrome;
  const sync = createSync(api.storage.local, async () => {
    const [{ data, failed }, disclaimer] = await Promise.all([
      RightToReplySources.load(undefined, RightToReplyFeed),
      RightToReplySources.loadDisclaimer(RightToReplyFeed)
    ]);
    return { data: { ...data, disclaimer }, failed };
  });
  const loadReply = createReplyLoader(api.storage.local);
  // Only browser lifecycle events, the daily alarm, and an explicit settings
  // action may initiate a network refresh. Article content never initiates one.
  async function ensureAlarm() {
    if (!(await api.alarms.get(ALARM))) await api.alarms.create(ALARM, { periodInMinutes: 1440 });
  }
  const initialise = () => {
    ensureAlarm().catch(() => {});
    sync(false).catch(() => {});
  };
  api.runtime.onInstalled.addListener(() => {
    // Migrate old metadata-only installations immediately.
    ensureAlarm().catch(() => {});
    sync(true).catch(() => {});
  });
  api.runtime.onStartup.addListener(initialise);
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) sync(true).catch(() => {});
  });
  ensureAlarm().catch(() => {});
  api.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    if (request?.type === 'refresh-responses' && request.force === true &&
        sender.url === api.runtime.getURL('settings.html')) {
      sync(true).then(respond, () => respond({ ok: false, state: 'unavailable' }));
      return true;
    }
    if (request?.type === 'load-reply') {
      loadReply(request.repository, request.keyword).then(respond, () => respond(null));
      return true;
    }
  });
}
