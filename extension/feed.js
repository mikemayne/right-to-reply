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
            !/[\p{L}\p{N}]/u.test(entry.keyword) || !plain(entry.response, 160) ||
            !plain(entry.description, 255) || keywords.has(entry.keyword.normalize('NFKC').toLowerCase())) {
          throw new Error('Invalid keyword or response in ' + party.id + '.');
        }
        keywords.add(entry.keyword.normalize('NFKC').toLowerCase());
      }
    }
    return data;
  }

  function matcher(data, reply) {
    const catalog = { parties: data.parties, policies: [], brands: Object.create(null) };
    const registry = data.parties.map(party => {
      catalog.brands[party.id] = { color: party.color };
      const policyIds = party.responses.map((entry, index) => {
        const id = party.id + '/' + index;
        catalog.policies.push({
          id, partyId: party.id, partyName: party.name,
          search: [entry.keyword], response: entry.response, description: entry.description
        });
        return id;
      });
      return { partyId: party.id, active: true, partyAliases: party.identifiers ?? [], representatives: [], policyIds };
    });
    return reply.create(catalog, registry);
  }

  return { validate, matcher };
})();
if (typeof module === 'object') module.exports = RightToReplyFeed;
else globalThis.RightToReplyFeed = RightToReplyFeed;
