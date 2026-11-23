'use strict';

const RightToReplySources = (() => {
  const root = 'https://raw.githubusercontent.com/';
  const directoryUrl = root + 'mikemayne/right-to-reply/main/data/sources.json';
  const disclaimerUrl = root + 'mikemayne/right-to-reply/main/data/disclaimer.json';
  const backoff = new Map();

  async function read(url, limit, request) {
    // Honour browser/CDN HTTP caching and throttle only the affected repository.
    const scope = url.slice(root.length).split('/').slice(0, 2).join('/').toLowerCase();
    if ((backoff.get(scope) ?? 0) > Date.now()) throw new Error('Source temporarily rate limited');
    const response = await request(url, { credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', cache: 'default', signal: AbortSignal.timeout(15000) });
    if (response.status === 429 || response.status === 503) {
      const header = response.headers.get('Retry-After');
      const seconds = header && /^\d+$/.test(header) ? Number(header) :
        header ? (Date.parse(header) - Date.now()) / 1000 : NaN;
      const delay = Number.isFinite(seconds) ? Math.max(1, Math.min(3600, seconds)) : 60;
      backoff.delete(scope);
      backoff.set(scope, Date.now() + delay * 1000);
      if (backoff.size > 256) backoff.delete(backoff.keys().next().value);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Cannot read ' + url);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        limit -= value.length;
        if (limit < 0) throw new Error('Source exceeds size limit');
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
  }

  async function load(directory, validator, request = fetch) {
    const sources = directory === undefined ? JSON.parse(await read(directoryUrl, 65536, request)) : directory;
    if (!Array.isArray(sources) || sources.length > 100) throw new Error('Invalid source directory');
    const repositories = new Set();
    for (const source of sources) {
      if (!source || Object.keys(source).length !== 1 || !validator.repository(source.repository) ||
          repositories.has(source.repository.toLowerCase())) throw new Error('Invalid source directory entry');
      repositories.add(source.repository.toLowerCase());
    }
    // Six independent metadata jobs at most; one broken source cannot reject the directory.
    const results = new Array(sources.length);
    let next = 0;
    async function worker() {
      while (next < sources.length) {
        const index = next++;
        const { repository } = sources[index];
        try {
          const base = root + repository + '/main/';
          const [party, identifiers, keywords] = await Promise.all([
            read(base + 'party.json', 65536, request).then(JSON.parse),
            read(base + 'identifiers.json', 256 * 1024, request).then(JSON.parse),
            read(root + repository + '/keyword-index/keywords.json', 256 * 1024, request).then(JSON.parse)
          ]);
          const fields = party && Object.keys(party).sort().join(',');
          // Ignore the old manual list during migration; never use it for discovery.
          if (fields !== 'color,id,name' && fields !== 'color,id,keywords,name') throw new Error('Invalid party metadata');
          results[index] = validator.validateParty({
            id: party.id, name: party.name, color: party.color, repository, identifiers, keywords
          });
        } catch { /* Invalid or unavailable party; leave other parties alone. */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, sources.length) }, worker));
    const parties = [];
    const failed = [];
    const ids = new Set(), names = new Set();
    for (const [index, source] of sources.entries()) {
      const party = results[index];
      const name = party?.name.normalize('NFKC').toLowerCase();
      if (!party || ids.has(party.id) || names.has(name)) {
        failed.push(source.repository);
        continue;
      }
      ids.add(party.id);
      names.add(name);
      parties.push(party);
    }
    return { data: { schemaVersion: 2, parties }, failed };
  }

  async function loadDisclaimer(validator, request = fetch) {
    return validator.validateDisclaimer(JSON.parse(await read(disclaimerUrl, 65536, request)));
  }

  async function loadReply(repository, keyword, validator, request = fetch) {
    if (!validator.repository(repository) || !validator.keyword(keyword)) throw new Error('Invalid reply path');
    const url = root + repository + '/main/responses/' + encodeURIComponent(keyword + '.md');
    return validator.validateReply(await read(url, 8192, request));
  }

  return { load, loadReply, loadDisclaimer };
})();
if (typeof module === 'object') module.exports = RightToReplySources;
else globalThis.RightToReplySources = RightToReplySources;
