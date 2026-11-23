'use strict';

const RightToReplySources = (() => {
  const root = 'https://raw.githubusercontent.com/';
  const directoryUrl = root + 'mikemayne/right-to-reply/main/data/sources.json';

  async function read(url, limit, request) {
    const response = await request(url, { credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', cache: 'no-cache', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw new Error('Cannot read ' + url);
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
          const [party, identifiers] = await Promise.all([
            read(base + 'party.json', 65536, request).then(JSON.parse),
            read(base + 'identifiers.json', 256 * 1024, request).then(JSON.parse)
          ]);
          if (!party || Object.keys(party).sort().join(',') !== 'color,id,keywords,name') throw new Error('Invalid party metadata');
          results[index] = validator.validateParty({ ...party, repository, identifiers });
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

  async function loadReply(repository, keyword, validator, request = fetch) {
    if (!validator.repository(repository) || !validator.keyword(keyword)) throw new Error('Invalid reply path');
    const url = root + repository + '/main/responses/' + encodeURIComponent(keyword + '.md');
    return validator.validateReply(await read(url, 8192, request));
  }

  return { load, loadReply };
})();
if (typeof module === 'object') module.exports = RightToReplySources;
else globalThis.RightToReplySources = RightToReplySources;
