'use strict';

const RightToReplyMatcher = (() => {
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

  function shuffled(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function create(parties) {
    const names = keywordNode();
    const keywords = keywordNode();
    const colors = new Map();
    for (const party of parties) {
      colors.set(party.id, party.color);
      for (const name of new Set([party.name, ...(party.identifiers ?? [])])) {
        addKeyword(names, name, party.id);
      }
      for (const entry of party.responses) {
        addKeyword(keywords, entry.keyword, {
          partyId: party.id, partyName: party.name,
          keyword: entry.keyword, response: entry.response, description: entry.description
        });
      }
    }

    function identify(blocks) {
      const eligible = new Set();
      for (const text of blocks) {
        const mentions = keywordHits(text, names);
        for (const match of mentions) {
          // A longer identifier for another party takes precedence; an identical
          // ambiguous identifier is not enough to qualify either party.
          if (mentions.some(other => other.value !== match.value && other.start <= match.start &&
            other.end >= match.end)) continue;
          eligible.add(match.value);
        }
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
          current.responses.add(match.value);
        } else {
          groups.push({ start: match.start, end: match.end, responses: new Set([match.value]) });
        }
      }
      return groups.map(({ start, end, responses }) => {
        const candidates = shuffled(responses);
        const partyIds = new Set(candidates.map(response => response.partyId));
        const matchedColors = shuffled(partyIds).map(id => colors.get(id));
        return { start, end, candidates, colors: matchedColors,
          color: matchedColors.length === 1 ? matchedColors[0] : undefined };
      });
    }

    return { identify, find };
  }

  return { create };
})();
if (typeof module === 'object') module.exports = RightToReplyMatcher;
else globalThis.RightToReplyMatcher = RightToReplyMatcher;
