const fs = require('node:fs');
const sources = require('../extension/sources.js');
const validator = require('../extension/feed.js');
const directory = JSON.parse(fs.readFileSync('data/sources.json', 'utf8'));
sources.load(directory, validator).then(data => console.log('Validated', data.parties.length, 'party sources.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
