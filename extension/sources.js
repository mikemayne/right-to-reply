'use strict';

const RightToReplySources = (() => {
  const root = 'https://raw.githubusercontent.com/';
  const directoryUrl = root + 'mikemayne/right-to-reply/main/data/sources.json';

  async function load(directory, validator, request = fetch) {
    let remaining = 4 * 1024 * 1024;
    async function read(url, limit) {
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
          remaining -= value.length;
          if (Math.min(limit, remaining) < 0) throw new Error('Source exceeds size limit');
          text += decoder.decode(value, { stream: true });
        }
        return text + decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
    }
    const sources = directory === undefined ? JSON.parse(await read(directoryUrl, 65536)) : directory;
    if (!Array.isArray(sources) || sources.length > 100) throw new Error('Invalid source directory');
    const parties = [];
    for (const source of sources) {
      if (!source || Object.keys(source).length !== 2 || typeof source.repository !== 'string' ||
          !/^[a-z0-9-]+\/[a-z0-9][a-z0-9_.-]*$/i.test(source.repository) ||
          typeof source.commit !== 'string' || !/^[0-9a-f]{40}$/.test(source.commit)) throw new Error('Invalid source');
      const base = root + source.repository + '/' + source.commit + '/';
      const party = JSON.parse(await read(base + 'party.json', 65536));
      const identifiers = JSON.parse(await read(base + 'identifiers.json', 256 * 1024));
      if (Object.keys(party).sort().join(',') !== 'color,id,keywords,name' ||
          !Array.isArray(party.keywords) || party.keywords.length > 100 ||
          !Array.isArray(identifiers) || !identifiers.includes(party.name)) throw new Error('Invalid party metadata');
      const responses = [];
      for (const keyword of party.keywords) {
        if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 200 ||
            /[/\\\p{Cc}]/u.test(keyword)) throw new Error('Invalid keyword filename');
        const body = await read(base + 'responses/' + encodeURIComponent(keyword + '.md'), 8192);
        const lines = body.replace(/\r\n/g, '\n').trimEnd().split('\n');
        if (lines.length !== 3 || lines[1]) throw new Error('Expected two plain-text paragraphs');
        responses.push({ keyword, response: lines[0], description: lines[2] });
      }
      parties.push({ id: party.id, name: party.name, color: party.color, identifiers, responses });
    }
    return validator.validate({ schemaVersion: 1, parties });
  }
  return { load };
})();
if (typeof module === 'object') module.exports = RightToReplySources;
else globalThis.RightToReplySources = RightToReplySources;
