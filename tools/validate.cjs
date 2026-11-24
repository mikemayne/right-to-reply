const fs = require('node:fs');
const sources = require('../extension/sources.js');
const validator = require('../extension/feed.js');
const directory = JSON.parse(fs.readFileSync('data/sources.json', 'utf8'));
(async () => {
  validator.validateDisclaimer(JSON.parse(fs.readFileSync('data/disclaimer.json', 'utf8')));
  const { data, failed } = await sources.load(directory, validator);
  if (failed.length) throw new Error('Invalid or unavailable parties: ' + failed.join(', '));
  // The same complete bundles are validated by every extension installation.
  console.log('Validated', data.parties.length, 'party sources and all listed responses.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
