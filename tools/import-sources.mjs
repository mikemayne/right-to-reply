import { readFile, writeFile } from 'node:fs/promises';
import feed from '../extension/feed.js';

const sources = JSON.parse(await readFile('data/sources.json', 'utf8'));
if (!Array.isArray(sources) || sources.length > 100) throw new Error('Invalid source directory');
const parties = [];
for (const source of sources) {
  if (!source || Object.keys(source).length !== 2 ||
      !/^[a-z0-9-]+\/[a-z0-9][a-z0-9_.-]*$/i.test(source.repository) ||
      !/^[0-9a-f]{40}$/.test(source.commit)) throw new Error('Invalid repository or revision');
  const base = 'https://raw.githubusercontent.com/' + source.repository + '/' + source.commit + '/';
  async function load(name) {
    const response = await fetch(base + name, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Cannot read ' + source.repository + '/' + name);
    return response.json();
  }
  const [party, identifiers] = await Promise.all([load('responses.json'), load('identifiers.json')]);
  if (!Array.isArray(identifiers) || !identifiers.includes(party.name)) throw new Error('Include the party name in identifiers.json');
  parties.push({ ...party, identifiers });
}
const data = feed.validate({ schemaVersion: 1, parties });
const json = JSON.stringify(data);
if (Buffer.byteLength(json) > 1024 * 1024) throw new Error('Release exceeds extension download limit');
await writeFile('data/responses.json', json + '\n');
