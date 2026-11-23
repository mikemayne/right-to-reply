const { readFileSync } = require('node:fs');
const { validate } = require('../extension/feed.js');

const filename = process.argv[2] ?? 'data/responses.json';
const data = validate(JSON.parse(readFileSync(filename, 'utf8')));
console.log('Validated', data.parties.length, 'parties.');
