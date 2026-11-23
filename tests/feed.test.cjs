const assert = require('node:assert/strict');
const test = require('node:test');
const feed = require('../extension/feed.js');
const reply = require('../extension/article-reply.js');
const { createSync } = require('../extension/sync.js');
require('../extension/demo-data.js');
const sample = globalThis.RightToReplyDemo;
const empty = { schemaVersion: 1, parties: [] };

test('fictional article requires a party mention and literal whole keywords', () => {
  const matcher = feed.matcher(feed.validate(sample), reply);
  assert.equal(matcher.find('example keyword', matcher.identify(['Unrelated Party'])).length, 0);
  const parties = matcher.identify(['Example Party']);
  assert.equal(matcher.find('example keywords', parties).length, 0);
  const [match] = matcher.find('An example keyword.', parties);
  assert.equal(match.color, '#3468ac');
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
