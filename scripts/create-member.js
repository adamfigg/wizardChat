'use strict';

// Creates a member whose address is already confirmed, without sending a
// verification e-mail. For the site's owner, on the machine that holds the
// database: it is how the first Steward account is made before e-mail is
// connected, and how a lost passphrase is replaced until password reset exists.
//
//   npm run member -- --email you@example.com --name "Your Name" --steward
//
//   --email             the address the member logs in with (required)
//   --name              the name shown on the site (required for a new member;
//                       for an existing one, renames them)
//   --steward           makes the member a Steward
//   --reset-passphrase  gives an existing member a new passphrase
//
// A new passphrase is generated here and written to a file in data/ (which git
// ignores). It is never printed. Read the file, log in, then delete it.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{N} .'’-]{2,29}$/u;

function stop(message) {
  console.error(message);
  process.exit(1);
}

function readArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--steward') out.steward = true;
    else if (arg === '--reset-passphrase') out.reset = true;
    else if (arg === '--email' || arg === '--name') out[arg.slice(2)] = argv[++i];
    else stop(`Unrecognised option: ${arg}`);
  }
  return out;
}

// Twenty characters in groups of four, from an alphabet with no look-alikes
// (no 0/o, 1/l/i). About 99 bits of randomness.
function newPassphrase() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 20; i++) {
    if (i && i % 4 === 0) out += '-';
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const email = String(args.email || '').trim().toLowerCase();
  const name = String(args.name || '').trim().replace(/\s+/g, ' ');

  if (!EMAIL_RE.test(email)) stop('Give the member\'s address with --email you@example.com');
  if (name && !NAME_RE.test(name))
    stop('The name must be 3 to 30 characters, begin with a letter, and contain only letters, numerals, spaces, periods, apostrophes, and hyphens.');

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!existing && !name) stop('A new member needs a name: add --name "Their Name"');
  if (name) {
    const holder = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
    if (holder && (!existing || holder.id !== existing.id)) stop(`The name "${name}" is already borne by another member.`);
  }

  let passphrase = null;
  let id;
  if (existing) {
    id = existing.id;
    if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
    if (args.steward) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
    if (!existing.verified) db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(id);
    if (args.reset) {
      passphrase = newPassphrase();
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(passphrase), id);
      // A new passphrase ends every session opened with the old one.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    console.log(`Updated the member with that address (now named "${name || existing.name}").`);
  } else {
    passphrase = newPassphrase();
    id = db
      .prepare('INSERT INTO users (email, name, pass_hash, verified, is_admin, created_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(email, name, await hashPassword(passphrase), args.steward ? 1 : 0, Date.now()).lastInsertRowid;
    console.log(`Created "${name}" as a confirmed member${args.steward ? ' and Steward' : ''}.`);
  }

  if (passphrase) {
    const file = path.join(root, 'data', `passphrase-member-${id}.txt`);
    fs.writeFileSync(
      file,
      `WizardChat passphrase for member ${id}\n\n${passphrase}\n\nLog in with the member's e-mail address and this passphrase, then delete this file.\n`
    );
    console.log(`The passphrase is in ${path.relative(root, file)}. Delete that file once it has been used.`);
  }
}

main().catch((err) => stop(err.message));
