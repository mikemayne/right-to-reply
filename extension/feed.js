'use strict';

const RightToReplyFeed = (() => {
  const exact = (object, keys) => object && typeof object === 'object' &&
    Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
  // Responses are rendered with textContent. Reject markup, common link forms and control characters.
  const blocked = /[<>\p{Cc}\p{Cf}]|(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:|data:|javascript:)|(?:[\p{L}\p{N}-]+\.)+(?:[\p{L}]{2,}|xn--[a-z\d-]+)(?=$|[^\p{L}\p{N}-])|(?:\/\/)|\]\(|(?:\d{1,3}\.){3}\d{1,3}/iu;
  const plain = (value, limit) => typeof value === 'string' && value.trim() === value &&
    value.length > 0 && Array.from(value).length <= limit && !blocked.test(value);

  function validate(data) {
    if (!exact(data, ['schemaVersion', 'parties']) || data.schemaVersion !== 1 ||
        !Array.isArray(data.parties) || data.parties.length > 100) throw new Error('Invalid response feed.');
    const ids = new Set();
    const names = new Set();
    for (const party of data.parties) {
      if (!(exact(party, ['id', 'name', 'color', 'responses']) || exact(party, ['id', 'name', 'color', 'identifiers', 'responses'])) || !plain(party.id, 64) ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(party.id) || ids.has(party.id) ||
          !plain(party.name, 100) || !/[\p{L}\p{N}]/u.test(party.name) ||
          names.has(party.name.normalize('NFKC').toLowerCase()) ||
          typeof party.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(party.color) ||
          !Array.isArray(party.responses) || party.responses.length > 100) {
        throw new Error('Invalid party in response feed.');
      }
      if ('identifiers' in party && (!Array.isArray(party.identifiers) || party.identifiers.length > 1000 ||
          !party.identifiers.every(name => plain(name, 100) && /[\p{L}\p{N}]/u.test(name)))) throw new Error('Invalid identifiers');
      ids.add(party.id);
      names.add(party.name.normalize('NFKC').toLowerCase());
      const keywords = new Set();
      for (const entry of party.responses) {
        if (!exact(entry, ['keyword', 'response', 'description']) || !plain(entry.keyword, 100) ||
            !/[\p{L}\p{N}]/u.test(entry.keyword) || !plain(entry.response, 128) ||
            !plain(entry.description, 255) || keywords.has(entry.keyword.normalize('NFKC').toLowerCase())) {
          throw new Error('Invalid keyword or response in ' + party.id + '.');
        }
        keywords.add(entry.keyword.normalize('NFKC').toLowerCase());
      }
    }
    return data;
  }

  const repository = value => typeof value === 'string' && /^[a-z0-9-]+\/[a-z0-9][a-z0-9_.-]*$/i.test(value);
  const keyword = value => plain(value, 100) && /[\p{L}\p{N}]/u.test(value) && !/[/\\]/u.test(value);
  function validateParty(party) {
    if (!exact(party, ['repository', 'id', 'name', 'color', 'identifiers', 'keywords']) ||
        !repository(party.repository) || !Array.isArray(party.keywords) ||
        new TextEncoder().encode(JSON.stringify(party.keywords)).length > 256 * 1024 ||
        !party.keywords.every(keyword) ||
        new Set(party.keywords.map(k => k.normalize('NFKC').toLowerCase())).size !== party.keywords.length ||
        !Array.isArray(party.identifiers) || !party.identifiers.includes(party.name)) {
      throw new Error('Invalid party metadata');
    }
    const { id, name, color, identifiers } = party;
    validate({ schemaVersion: 1, parties: [{ id, name, color, identifiers, responses: [] }] });
    return party;
  }
  function validateReply(body) {
    if (typeof body !== 'string') throw new Error('Invalid response');
    const lines = body.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    if (lines.length !== 3 || lines[1] !== '' || !plain(lines[0], 128) || !plain(lines[2], 255)) {
      throw new Error('Expected two size-limited plain-text paragraphs');
    }
    return { response: lines[0], description: lines[2] };
  }
  function matcher(data, reply) {
    return reply.create(data.parties);
  }

  return { validate, validateParty, validateReply, repository, keyword, matcher };
})();
if (typeof module === 'object') module.exports = RightToReplyFeed;
else globalThis.RightToReplyFeed = RightToReplyFeed;
