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
    return response;
  }
  const treeUrl = 'https://api.github.com/repos/' + source.repository + '/git/trees/' + source.commit + '?recursive=1';
  const listing = await fetch(treeUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!listing.ok) throw new Error('Cannot list ' + source.repository);
  const tree = await listing.json();
  if (tree.truncated) throw new Error('Incomplete source tree for ' + source.repository);
  const files = tree.tree.filter(item => item.path.startsWith('responses/'));
  if (files.length > 100) throw new Error('Too many response files');
  const [party, identifiers] = await Promise.all(['party.json', 'identifiers.json'].map(async name => (await load(name)).json()));
  if (Object.keys(party).sort().join(',') !== 'color,id,name') throw new Error('Invalid party.json metadata');
  if (!Array.isArray(identifiers) || !identifiers.includes(party.name)) throw new Error('Include the party name in identifiers.json');
  const responses = [];
  for (const file of files) {
    const match = /^responses\/([^/]+)\.md$/u.exec(file.path);
    if (!match || file.mode !== '100644') throw new Error('Expected an ordinary Markdown response file: ' + file.path);
    const keyword = match[1];
    const body = await (await load('responses/' + encodeURIComponent(keyword + '.md'))).text();
    const lines = body.replace(/\r\n/g, '\n').trimEnd().split('\n');
    if (lines.length !== 3 || lines[1] !== '') throw new Error('Expected two single-line paragraphs in ' + file.path);
    responses.push({ keyword, response: lines[0], description: lines[2] });
  }
  parties.push({ ...party, identifiers, responses });
}
const data = feed.validate({ schemaVersion: 1, parties });
const json = JSON.stringify(data);
if (Buffer.byteLength(json) > 1024 * 1024) throw new Error('Release exceeds extension download limit');
await writeFile('data/responses.json', json + '\n');
