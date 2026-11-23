'use strict';

const CheckPolicyReply = (() => {
  const tokenize = text => Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu), match => ({
    key: match[0].normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(),
    start: match.index, end: match.index + match[0].length
  }));

  function keywordNode() {
    return { children: new Map(), policies: new Set() };
  }

  // Traverse normalized characters but only start and finish on whole source tokens.
  function addKeyword(root, phrase, policy) {
    let node = root;
    for (const token of tokenize(phrase)) {
      for (const letter of token.key) {
        if (!node.children.has(letter)) node.children.set(letter, keywordNode());
        node = node.children.get(letter);
      }
    }
    if (node !== root) node.policies.add(policy);
  }

  function keywordHits(text, root) {
    const words = tokenize(text);
    const found = [];
    for (let start = 0; start < words.length; start++) {
      let node = root;
      for (let end = start; end < words.length; end++) {
        if (end > start && !/^[\s\p{Pd}_'’/\u00ad\u200b]+$/u.test(
          text.slice(words[end - 1].end, words[end].start))) break;
        for (const letter of words[end].key) {
          node = node.children.get(letter);
          if (!node) break;
        }
        if (!node) break;
        for (const value of node.policies) {
          found.push({ start: words[start].start, end: words[end].end, value });
        }
      }
    }
    return found;
  }

  function create(catalog, registry) {
    const names = keywordNode();
    const nameParts = keywordNode();
    const splitNames = [];
    const keywords = keywordNode();
    const parties = new Map(catalog.parties.map(party => [party.id, party]));
    const policies = new Map(catalog.policies.map(policy => [policy.id, policy]));
    for (const entry of registry) {
      const party = parties.get(entry.partyId);
      if (!party || entry.active !== true) continue;
      for (const name of new Set([party.name, ...entry.partyAliases,
        ...entry.representatives.flatMap(person => [person.name, ...person.aliases])])) {
        addKeyword(names, name, party.id);
        const parts = name.trim().split(/\s+/u);
        if (name.toLowerCase() !== party.name.toLowerCase() && parts.length >= 2) {
          const first = parts[0];
          const last = parts.at(-1);
          addKeyword(nameParts, first, first);
          addKeyword(nameParts, last, last);
          splitNames.push({ first, last, partyId: party.id });
        }
      }
      for (const id of entry.policyIds) {
        const policy = policies.get(id);
        if (policy?.partyId !== party.id) continue;
        for (const keyword of policy.search) addKeyword(keywords, keyword, policy);
      }
    }

    function identify(blocks) {
      const eligible = new Set();
      const seenParts = new Set();
      for (const text of blocks) {
        for (const hit of keywordHits(text, nameParts)) seenParts.add(hit.value);
        const mentions = keywordHits(text, names);
        for (const match of mentions) {
          if (mentions.some(other => other.value !== match.value && other.start <= match.start &&
            other.end >= match.end)) continue;
          eligible.add(match.value);
        }
      }
      for (const { first, last, partyId } of splitNames) {
        if (seenParts.has(first) && seenParts.has(last)) eligible.add(partyId);
      }
      return eligible;
    }

    function find(text, eligible) {
      if (!eligible.size) return [];
      const groups = [];
      for (const match of keywordHits(text, keywords)) {
        if (!eligible.has(match.value.partyId)) continue;
        const current = groups.at(-1);
        if (current && current.end > match.start) {
          current.end = Math.max(current.end, match.end);
          current.policies.set(match.value.id, match.value);
        } else {
          groups.push({ start: match.start, end: match.end, policies: new Map([[match.value.id, match.value]]) });
        }
      }
      return groups.map(({ start, end, policies }) => {
        const candidates = [...policies.values()];
        const parties = new Set(candidates.map(policy => policy.partyId));
        return { start, end, candidates, color: parties.size === 1 ? catalog.brands?.[candidates[0].partyId]?.color : undefined };
      });
    }

    return { identify, find };
  }

  return { create };
})();
if (typeof module === 'object') module.exports = CheckPolicyReply;
else globalThis.CheckPolicyReply = CheckPolicyReply;
