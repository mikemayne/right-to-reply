const fs = require('node:fs');
const sources = require('../extension/sources.js');
const validator = require('../extension/feed.js');
const directory = JSON.parse(fs.readFileSync('data/sources.json', 'utf8'));
(async () => {
  const { data, failed } = await sources.load(directory, validator);
  if (failed.length) throw new Error('Invalid or unavailable parties: ' + failed.join(', '));
  // Explicit validation tool checks every published response. The browser does not.
  for (const party of data.parties) {
    for (const keyword of party.keywords) await sources.loadReply(party.repository, keyword, validator);
  }
  console.log('Validated', data.parties.length, 'party sources and all listed responses.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
