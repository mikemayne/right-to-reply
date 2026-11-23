export const validateFeed = RightToReplyFeed.validate;

export function createScanner(data) {
  const matcher = RightToReplyFeed.matcher(validateFeed(data), RightToReplyMatcher);
  return ({ headline = '', blocks = [] }) => {
    const eligible = matcher.identify([headline, ...blocks]);
    return {
      parties: data.parties.filter(party => eligible.has(party.id)).map(({ id, name }) => ({ id, name })),
      headlineMatches: matcher.find(headline, eligible),
      blockMatches: blocks.map(block => matcher.find(block, eligible))
    };
  };
}
