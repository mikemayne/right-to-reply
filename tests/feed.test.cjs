const assert = require('node:assert/strict');
const test = require('node:test');
const feed = require('../extension/feed.js');
const reply = require('../extension/article-reply.js');
const sources = require('../extension/sources.js');
const { createSync, createReplyLoader } = require('../extension/sync.js');
require('./sample-data.js');
const sample = globalThis.RightToReplyDemo;
const empty = { schemaVersion: 1, parties: [] };

test('fictional article requires a party mention and literal whole keywords', () => {
  const matcher = feed.matcher(feed.validate(sample), reply);
  assert.equal(matcher.find('example keyword', matcher.identify(['Unrelated Party'])).length, 0);
  const parties = matcher.identify(['Example Party']);
  assert.equal(matcher.find('example keywords', parties).length, 0);
  const [match] = matcher.find('An example keyword.', parties);
  assert.equal('color' in match, false);
  assert.equal(match.candidates[0].response, sample.parties[0].responses[0].response);
  assert.equal(feed.matcher(feed.validate(empty), reply).identify(['Example Party']).size, 0);
});

test('strict plain-text schema rejects links, excess fields, markup and long descriptions', () => {
  for (const description of ['Visit https://example.org', 'Open example.org', '<b>bad</b>', 'a\nb', 'a'.repeat(256)]) {
    const data = structuredClone(sample);
    data.parties[0].responses[0].description = description;
    assert.throws(() => feed.validate(data));
  }
  const data = structuredClone(sample);
  data.parties[0].responses[0].url = 'https://example.org';
  assert.throws(() => feed.validate(data));
});

const metadata = { schemaVersion: 2, parties: [{
  repository: 'owner/example-party', id: 'example-party', name: 'Example Party',
  color: '#000000', identifiers: ['Example Party'], keywords: ['example keyword']
}] };
function memoryStorage() {
  const state = {};
  return { state, get: async () => structuredClone(state),
    set: async fields => Object.assign(state, structuredClone(fields)) };
}

test('metadata refresh preserves a bounded directory cache, publishes partial updates and removes withdrawals', async () => {
  const storage = memoryStorage();
  let time = 10000;
  let data = metadata;
  let failed = [];
  let broken = false;
  let requests = 0;
  const sync = createSync(storage, async () => {
    requests++;
    if (broken) throw new Error('directory down');
    return { data, failed };
  }, () => time);
  assert.equal((await sync(false)).ok, true);
  assert.equal((await sync(false)).state, 'cached');
  assert.equal(requests, 1);
  broken = true;
  assert.equal((await sync(true)).state, 'cached');
  assert.equal(storage.state.snapshot.data.parties.length, 1);
  time += 24 * 60 * 60 * 1000;
  assert.equal((await sync(true)).state, 'unavailable');
  assert.equal(storage.state.snapshot, null);
  broken = false;
  data = { schemaVersion: 2, parties: [] };
  failed = ['owner/broken'];
  assert.equal((await sync(true)).state, 'partial');
  assert.deepEqual(storage.state.snapshot.data.parties, []);
  time += 61000;
  assert.equal((await sync(false)).state, 'partial');
});

test('reply requests are authorised, deduplicated, cached briefly, and invalidated by refresh or removal', async () => {
  const storage = memoryStorage();
  let time = 10000;
  storage.state.snapshot = { data: metadata, checkedAt: time };
  let requests = 0;
  let broken = false;
  const get = createReplyLoader(storage, async () => {
    requests++;
    if (broken) throw new Error('missing reply');
    return { response: 'Reply ' + requests, description: 'Description.' };
  }, () => time);
  const repo = metadata.parties[0].repository;
  const keyword = 'example keyword';
  assert.equal(await get('owner/unapproved', keyword), null);
  assert.equal(await get(repo, 'other keyword'), null);
  assert.equal(requests, 0);
  const [a, b] = await Promise.all([get(repo, keyword), get(repo, keyword)]);
  assert.deepEqual(a, b);
  assert.equal(requests, 1);
  assert.deepEqual(await get(repo, keyword), a);
  time += 5 * 60 * 1000;
  assert.equal((await get(repo, keyword)).response, 'Reply 2');
  time++;
  storage.state.snapshot.checkedAt = time;
  broken = true;
  assert.equal(await get(repo, keyword), null);
  broken = false;
  assert.equal((await get(repo, keyword)).response, 'Reply 4');
  storage.state.snapshot.data = { schemaVersion: 2, parties: [] };
  assert.equal(await get(repo, keyword), null);
  assert.equal(requests, 4);
});

test('metadata-only matcher returns references without response text', () => {
  const matcher = feed.matcher(metadata, reply);
  const [match] = matcher.find('example keyword', matcher.identify(['Example Party']));
  assert.deepEqual(match.candidates[0], {
    partyId: 'example-party', partyName: 'Example Party', keyword: 'example keyword',
    repository: 'owner/example-party'
  });
});

test('keyword variants preserve offsets and whole-word boundaries', () => {
  const variants = ['example-keyword', 'exampleKeyword', 'examplekeyword', 'example  keyword',
    'EXAMPLE_KEYWORD', '#ExampleKeyword', 'example—keyword', 'example/keyword',
    'example\u00a0keyword', 'example\u200bkeyword', 'Éxample Keyword', 'ｅｘａｍｐｌｅＫｅｙｗｏｒｄ'];
  for (const keyword of ['example keyword', 'example-keyword', 'exampleKeyword', 'examplekeyword']) {
    const data = structuredClone(sample);
    data.parties[0].responses[0].keyword = keyword;
    const matcher = feed.matcher(feed.validate(data), reply);
    const parties = matcher.identify(['Example Party']);
    for (const variant of variants) {
      const text = '😀 ' + variant + '!';
      const [match] = matcher.find(text, parties);
      assert.equal(text.slice(match.start, match.end), variant.replace(/^#/, ''));
    }
    for (const text of ['examplekeywords', 'preexampleKeyword', 'example. Keyword', 'keyword example']) {
      assert.equal(matcher.find(text, parties).length, 0, text);
    }
  }
});

test('identifiers require complete approved names or explicitly listed aliases', () => {
  const data = structuredClone(sample);
  data.parties[0].identifiers = ['Example Party', 'Alex Robin Exampleton', 'Alex Exampleton', 'Jamie Smith-Jones'];
  const matcher = feed.matcher(feed.validate(data), reply);
  for (const blocks of [
    ['exampleParty'], ['EXAMPLE_PARTY'], ['AlexRobinExampleton'], ['Alex-Robin-Exampleton'],
    ['Alex Exampleton spoke.'], ['Jamie SmithJones agreed.']
  ]) assert.equal(matcher.identify(blocks).size, 1);
  for (const blocks of [['Alex alone'], ['Exampleton alone'], ['Alexandra Exampleton'],
    ['Alex and Smith-Jones'], ['Example yesterday', 'Party today'],
    ['Exampleton spoke.', 'Later Alex replied.'], ['Jamie spoke to Smith-Jones'],
    ['Alex told Exampleton the news.']]) {
    assert.equal(matcher.identify(blocks).size, 0);
  }
});

test('longer or ambiguous identifiers do not qualify the wrong party', () => {
  const data = structuredClone(sample);
  data.parties[0].identifiers = ['Example Party', 'Alex Exampleton', 'Shared Alias'];
  data.parties.push({ ...structuredClone(data.parties[0]), id: 'other', name: 'Other Party',
    identifiers: ['Other Party', 'New Example Party', 'Shared Alias'] });
  const matcher = feed.matcher(feed.validate(data), reply);
  assert.deepEqual([...matcher.identify(['New Example Party'])], ['other']);
  assert.equal(matcher.identify(['Shared Alias']).size, 0);
  assert.deepEqual([...matcher.identify(['Shared Alias', 'Other Party'])], ['other']);
});

test('shared matches shuffle responses without exposing party colours in match styling', () => {
  const data = structuredClone(sample);
  data.parties.push({ ...structuredClone(data.parties[0]), id: 'other', name: 'Other Party', color: '#abcdef' });
  const matcher = feed.matcher(feed.validate(data), reply);
  const eligible = matcher.identify(['Example Party and Other Party']);
  const original = Math.random;
  try {
    for (const roll of [0, 0.99]) {
      Math.random = () => roll;
      const [match] = matcher.find('example keyword', eligible);
      assert.equal(match.candidates.length, 2);
      assert.deepEqual(match.candidates.map(candidate => candidate.partyId), roll ? ['example-party', 'other'] : ['other', 'example-party']);
      assert.equal('colors' in match, false);
      assert.equal('color' in match, false);
    }
  } finally { Math.random = original; }
});


test('metadata loads no response files and isolates malformed or unavailable parties', async () => {
  const repo = 'owner/example-party';
  const directory = [{ repository: 'owner/broken' }, { repository: repo }, { repository: 'owner/invalid' }];
  const directoryUrl = 'https://raw.githubusercontent.com/mikemayne/right-to-reply/main/data/sources.json';
  const base = 'https://raw.githubusercontent.com/' + repo + '/main/';
  const calls = [];
  let response = 'Original response.';
  const request = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'default');
    const files = {
      [directoryUrl]: JSON.stringify(directory),
      [base + 'party.json']: JSON.stringify({ id: 'example-party', name: 'Example Party', color: '#000000', keywords: ['ignored legacy keyword'] }),
      [base + 'identifiers.json']: JSON.stringify(['Example Party']),
      ['https://raw.githubusercontent.com/' + repo + '/keyword-index/keywords.json']: JSON.stringify(['example keyword']),
      [base + 'responses/example%20keyword.md']: response + '\n\nExtended description.\n',
      ['https://raw.githubusercontent.com/owner/invalid/main/party.json']: '{}',
      ['https://raw.githubusercontent.com/owner/invalid/main/identifiers.json']: '[]'
    };
    return Object.hasOwn(files, url) ? new Response(files[url]) : new Response('', { status: 404 });
  };
  const result = await sources.load(undefined, feed, request);
  assert.deepEqual(result.failed, ['owner/broken', 'owner/invalid']);
  assert.deepEqual(result.data, metadata);
  assert.equal(calls.length, 10);
  assert.ok(!calls.some(url => url.includes('/responses/')));
  for (const expected of ['Original response.', 'Updated response.']) {
    response = expected;
    const reply = await sources.loadReply(repo, 'example keyword', feed, request);
    assert.equal(reply.response, expected);
  }
  response = '<script>';
  await assert.rejects(sources.loadReply(repo, 'example keyword', feed, request));
  await assert.rejects(sources.loadReply(repo, '../escape', feed, request));
  await assert.rejects(sources.load([{ repository: repo, commit: 'a'.repeat(40) }], feed, request), /Invalid source/);
  await assert.rejects(sources.load([{ repository: '../bad' }], feed, request), /Invalid source/);
  await assert.rejects(sources.load([...directory, { repository: 'OWNER/EXAMPLE-PARTY' }], feed, request), /Invalid source/);
});

test('reply size boundaries apply to both inline and on-demand data', () => {
  const data = structuredClone(sample);
  data.parties[0].responses[0].response = 'a'.repeat(128);
  assert.doesNotThrow(() => feed.validate(data));
  data.parties[0].responses[0].response += 'a';
  assert.throws(() => feed.validate(data));
  assert.doesNotThrow(() => feed.validateReply('a'.repeat(128) + '\n\n' + 'b'.repeat(255) + '\n'));
  for (const body of ['a'.repeat(129) + '\n\nb', 'a\n\n' + 'b'.repeat(256), 'a\n\nhttps://example.com', 'a\n\nb\n\nc']) {
    assert.throws(() => feed.validateReply(body));
  }
});


test('large keyword indices work without a fixed 100-keyword limit', () => {
  const party = structuredClone(metadata.parties[0]);
  party.keywords = Array.from({ length: 2000 }, (_, i) => 'keyword ' + i);
  assert.doesNotThrow(() => feed.validateParty(party));
  const matcher = feed.matcher({ schemaVersion: 2, parties: [party] }, reply);
  assert.equal(matcher.find('keyword 1999', matcher.identify(['Example Party']))[0].candidates[0].keyword, 'keyword 1999');
  party.keywords = Array.from({ length: 4000 }, (_, i) => 'a'.repeat(80) + i);
  assert.throws(() => feed.validateParty(party));
});

test('rate limiting backs off the affected repository without blocking others', async () => {
  const calls = [];
  const request = async url => {
    calls.push(url);
    return url.includes('/limited/') ?
      new Response('', { status: 429, headers: { 'Retry-After': '60' } }) :
      new Response('Reply.\n\nDescription.\n');
  };
  await assert.rejects(sources.loadReply('owner/limited', 'keyword', feed, request));
  await assert.rejects(sources.loadReply('owner/limited', 'another keyword', feed, request));
  assert.equal(calls.length, 1);
  assert.equal((await sources.loadReply('owner/working', 'keyword', feed, request)).response, 'Reply.');
  assert.equal(calls.length, 2);
});


test('owner disclaimer accepts only inert text and a validated HTTPS link', async () => {
  assert.deepEqual(feed.validateDisclaimer({}), {});
  const notice = {message: '<b>plain text</b>', link: 'https://example.org/notice', linkText: 'Details'};
  assert.deepEqual(feed.validateDisclaimer(notice), notice);
  assert.deepEqual(feed.validateDisclaimer({message: '  Notice  '}), {message: 'Notice'});
  for (const data of [[], null, {html: '<script>'}, {message: 5}, {linkText:'Details'},
      {link:'javascript:alert(1)'}, {link:'https://user:pass@example.org'},
      {link:'https://example.org:invalid'}, {link:'//example.org'}, {link:'https://example.org\\@evil.org'},
      {message:'a'.repeat(4097)}, {message:'a\u202eb'}]) {
    assert.throws(() => feed.validateDisclaimer(data));
  }
  const request = async url => {
    assert.equal(url, 'https://raw.githubusercontent.com/mikemayne/right-to-reply/main/data/disclaimer.json');
    return new Response(JSON.stringify(notice));
  };
  assert.deepEqual(await sources.loadDisclaimer(feed, request), notice);
  await assert.rejects(sources.loadDisclaimer(feed, async () => new Response('{"link":"javascript:alert(1)"}')));
});

test('disclaimer changes and withdrawals refresh snapshot without an extension update', async () => {
  const storage = memoryStorage();
  let time = 10000;
  let notice = {};
  let broken = false;
  const sync = createSync(storage, async () => {
    if (broken) throw new Error('disclaimer unavailable');
    return {data: {...metadata, disclaimer: feed.validateDisclaimer(notice)}, failed: []};
  }, () => time);
  await sync(false);
  const version = storage.state.snapshot.version;
  notice = {message:'Owner notice'};
  time += 15 * 60 * 1000;
  await sync(false);
  assert.deepEqual(storage.state.snapshot.data.disclaimer, notice);
  assert.notEqual(storage.state.snapshot.version, version);
  broken = true;
  assert.equal((await sync(true)).state, 'cached');
  assert.deepEqual(storage.state.snapshot.data.disclaimer, notice);
  broken = false;
  notice = {};
  time += 15 * 60 * 1000;
  await sync(false);
  assert.deepEqual(storage.state.snapshot.data.disclaimer, {});
});
