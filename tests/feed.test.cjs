const assert = require('node:assert/strict');
const test = require('node:test');
const feed = require('../extension/feed.js');
const reply = require('../extension/article-reply.js');
const sources = require('../extension/sources.js');
const { createSync } = require('../extension/sync.js');
require('./sample-data.js');
const sample = globalThis.RightToReplyDemo;
const empty = { schemaVersion: 1, parties: [] };

test('fictional article requires a party mention and literal whole keywords', () => {
  const matcher = feed.matcher(feed.validate(sample), reply);
  assert.equal(matcher.find('example keyword', matcher.identify(['Unrelated Party'])).length, 0);
  const parties = matcher.identify(['Example Party']);
  assert.equal(matcher.find('example keywords', parties).length, 0);
  const [match] = matcher.find('An example keyword.', parties);
  assert.equal(match.color, '#000000');
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

test('bad updates keep the approved snapshot and empty releases remove all responses', async () => {
  const state = {};
  const storage = {
    get: async () => structuredClone(state),
    set: async fields => Object.assign(state, structuredClone(fields))
  };
  let time = 10000;
  let data = sample;
  let requests = 0;
  const sync = createSync(storage, async () => { requests++; return data; }, () => time++);
  assert.equal((await sync(false)).ok, true);
  assert.equal((await sync(false)).state, 'cached');
  assert.equal(requests, 1);
  data = { schemaVersion: 2, parties: [] };
  assert.equal((await sync(true)).ok, false);
  assert.equal(state.snapshot.data.parties.length, 1);
  data = empty;
  assert.equal((await sync(true)).ok, true);
  assert.equal(state.snapshot.data.parties.length, 0);
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

test('shared matches shuffle the two responses and the two party colours independently', () => {
  const data = structuredClone(sample);
  data.parties.push({ ...structuredClone(data.parties[0]), id: 'other', name: 'Other Party', color: '#abcdef' });
  const matcher = feed.matcher(feed.validate(data), reply);
  const eligible = matcher.identify(['Example Party and Other Party']);
  const original = Math.random;
  try {
    for (const first of [0, 0.99]) for (const second of [0, 0.99]) {
      const rolls = [first, second];
      Math.random = () => rolls.shift();
      const [match] = matcher.find('example keyword', eligible);
      assert.equal(match.candidates.length, 2);
      const expected = match.candidates.map(candidate => data.parties.find(p => p.id === candidate.partyId).color);
      assert.deepEqual(match.colors, second ? expected : expected.reverse());
    }
  } finally { Math.random = original; }
});


test('source directory loads main and publishes edits without directory changes', async () => {
  const repo = 'owner/example-party';
  const directory = [{ repository: repo }];
  const directoryUrl = 'https://raw.githubusercontent.com/mikemayne/right-to-reply/main/data/sources.json';
  const base = 'https://raw.githubusercontent.com/' + repo + '/main/';
  const calls = [];
  let response = 'Original response.';
  const request = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    const files = {
      [directoryUrl]: JSON.stringify(directory),
      [base + 'party.json']: JSON.stringify({ id: 'example-party', name: 'Example Party', color: '#000000', keywords: ['example keyword'] }),
      [base + 'identifiers.json']: JSON.stringify(['Example Party']),
      [base + 'responses/example%20keyword.md']: response + '\n\nExtended description.\n'
    };
    assert.ok(Object.hasOwn(files, url), url);
    return new Response(files[url]);
  };
  for (const expected of ['Original response.', 'Updated response.']) {
    response = expected;
    calls.length = 0;
    const result = await sources.load(undefined, feed, request);
    assert.equal(result.parties[0].responses[0].response, expected);
    assert.deepEqual(calls, [directoryUrl, base + 'party.json', base + 'identifiers.json', base + 'responses/example%20keyword.md']);
  }
  await assert.rejects(sources.load([{ repository: repo, commit: 'a'.repeat(40) }], feed, request), /Invalid source/);
  await assert.rejects(sources.load([{ repository: '../bad' }], feed, request), /Invalid source/);
  await assert.rejects(sources.load([...directory, { repository: 'OWNER/EXAMPLE-PARTY' }], feed, request), /Invalid source/);
});
