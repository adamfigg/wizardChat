'use strict';

// Gives a member currency. For the site's owner, on the machine that holds
// the database: for trying out the Emporium, or making good a mistake.
// The gift is entered in the ledger (reason "steward-grant"), so it shows in
// the member's history like anything they earned.
//
//   npm run grant -- --name "Their Name" --gold 1000
//   npm run grant -- --email them@example.com --gold 500 --power 250
//   npm run grant -- --name "Their Name" --all 1000
//
//   --name or --email   which member (one of the two is required)
//   --gold, --attunement, --knowledge, --power   how much of each to give
//   --all               that much of every currency
//   --note              a few words on why, kept with the entry

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const db = require('../src/db');
const ledger = require('../src/ledger');

function stop(message) {
  console.error(message);
  process.exit(1);
}

const KEYS = ledger.CURRENCIES.map((c) => c.key);
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const option = argv[i].replace(/^--/, '');
  if (!argv[i].startsWith('--') || !['name', 'email', 'note', 'all', ...KEYS].includes(option)) {
    stop(`Unrecognised option: ${argv[i]}`);
  }
  if (argv[i + 1] === undefined) stop(`${argv[i]} needs a value.`);
  args[option] = argv[i + 1];
}

if (!args.name && !args.email) stop('Say which member, with --name "Their Name" or --email their@address.');
const member = args.email
  ? db.prepare('SELECT id, name FROM users WHERE email = ? AND verified = 1').get(args.email)
  : db.prepare('SELECT id, name FROM users WHERE name = ? AND verified = 1').get(args.name);
if (!member) stop('No confirmed member was found by that name or address.');

const gifts = [];
for (const key of KEYS) {
  const given = args[key] !== undefined ? args[key] : args.all;
  if (given === undefined) continue;
  const amount = Number(given);
  if (!Number.isInteger(amount) || amount <= 0) stop(`The amount of ${key} must be a whole number above zero.`);
  gifts.push([key, amount]);
}
if (!gifts.length) stop('Say how much, for example --gold 1000 or --all 1000.');

for (const [key, amount] of gifts) ledger.grant(member.id, key, amount, args.note);

const held = ledger.balances(member.id);
console.log(`Granted to ${member.name}: ${gifts.map(([key, amount]) => `${amount.toLocaleString('en-GB')} ${key}`).join(', ')}.`);
console.log(`They now hold: ${KEYS.map((key) => `${held[key].toLocaleString('en-GB')} ${key}`).join(', ')}.`);
