'use strict';

// SQLite database (built into Node, no separate server to run).
// The file lives at data/wizardchat.db and is created on first start.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, 'wizardchat.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash    TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  is_admin     INTEGER NOT NULL DEFAULT 0,
  wizard_class TEXT,               -- null until the attunement is completed
  answers      TEXT,               -- JSON of attunement answers
  pinned       TEXT,               -- the pinned feature shown on the profile card
  avatar       TEXT,               -- filename in uploads/, or null
  created_at   INTEGER NOT NULL
);

-- One pending e-mail verification code per user. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS verifications (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL,
  send_count   INTEGER NOT NULL DEFAULT 0,   -- codes sent in the current hour
  window_start INTEGER NOT NULL DEFAULT 0    -- when that hour began
);

-- Someone part-way through verifying an address. They hold a cookie whose
-- hash is token_hash; they have no login session until the code is confirmed.
-- user_id is NULL when the address already belongs to a member: the page
-- behaves identically, so a stranger cannot learn who is a member.
CREATE TABLE IF NOT EXISTS pending_signups (
  token_hash   TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- Login sessions. Only a hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  media        TEXT,               -- filename in uploads/, or null
  media_type   TEXT,               -- 'image' | 'video' | null
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY,
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji        TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS ads (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  price        TEXT,
  contact      TEXT NOT NULL,      -- shown only to logged-in members
  created_at   INTEGER NOT NULL
);

-- The Steward's Address: articles written by a Steward and featured at the
-- top of the Gathering Hall to set the direction of discussion.
CREATE TABLE IF NOT EXISTS addresses (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER
);

-- The ledger of the four currencies (see src/ledger.js). One row for each
-- thing a member earned or spent; what a member holds is the sum of their
-- rows and is stored nowhere else. Rows are only ever added.
-- "reason" is the rule that paid it and "ref" the particular thing it was
-- for; together they are unique for a member, so nothing is paid twice.
CREATE TABLE IF NOT EXISTS ledger (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency     TEXT NOT NULL CHECK (currency IN ('gold', 'attunement', 'knowledge', 'power')),
  amount       INTEGER NOT NULL CHECK (amount <> 0),   -- above zero earned, below zero spent
  reason       TEXT NOT NULL,
  ref          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, reason, ref)
);

-- Bounties: small tasks set for each member, three at a time, each paying a
-- reward when done (see src/bounties.js). The reward is fixed when the
-- bounty is issued and is paid through the ledger.
CREATE TABLE IF NOT EXISTS bounties (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,              -- which sort of task
  param        TEXT,                       -- the word or sigil it names, if any
  goal         INTEGER NOT NULL,           -- how many times the thing must be done
  seen         TEXT NOT NULL DEFAULT '[]', -- JSON list of what has been counted so far
  currency     TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  issued_at    INTEGER NOT NULL,
  completed_at INTEGER                     -- null until fulfilled
);

-- The Council of Wizards (src/council.js): matters a Steward puts to a vote.
CREATE TABLE IF NOT EXISTS motions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the Steward who laid it
  title        TEXT NOT NULL,
  body         TEXT,
  options      TEXT NOT NULL,      -- JSON list of the outcomes that may be voted for
  created_at   INTEGER NOT NULL,
  closes_at    INTEGER NOT NULL,
  settled_at   INTEGER,            -- null while the vote is open
  winners      TEXT                -- once settled: JSON list of the winning outcomes' positions (empty if nobody voted)
);

-- One vote for each member on each motion; it cannot be changed.
CREATE TABLE IF NOT EXISTS votes (
  motion_id    INTEGER NOT NULL REFERENCES motions(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice       INTEGER NOT NULL,   -- position of the outcome in the motion's options
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (motion_id, user_id)
);

-- The Back Alley (src/wheel.js): each turn of the wheel. The stake is taken
-- when the row is made; "landed" stays null until the member has named a
-- resource and the wheel has been spun.
CREATE TABLE IF NOT EXISTS wagers (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency     TEXT NOT NULL,      -- what was staked
  amount       INTEGER NOT NULL,
  pick         TEXT,               -- the resource the member named
  landed       TEXT,               -- where the wheel came to rest
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER
);
-- A member may have only one turn in progress.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wagers_open ON wagers(user_id) WHERE landed IS NULL;

CREATE INDEX IF NOT EXISTS idx_bounties_member  ON bounties(user_id, id);
CREATE INDEX IF NOT EXISTS idx_ledger_holdings  ON ledger(user_id, currency);
CREATE INDEX IF NOT EXISTS idx_posts_created   ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post    ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ads_created      ON ads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
`);

// Columns added after the first version. "CREATE TABLE IF NOT EXISTS" leaves an
// existing table untouched, so a database made earlier needs them added.
function addColumn(table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('verifications', 'send_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('verifications', 'window_start', 'INTEGER NOT NULL DEFAULT 0');
// JSON of the Attunement answers given so far; cleared once a discipline is assigned.
addColumn('users', 'attune_draft', 'TEXT');
// What the member has chosen to show on their profile card.
addColumn('users', 'portrait', 'TEXT'); // one of the portraits in src/portraits.js, or null
addColumn('users', 'card_border', 'TEXT'); // an item bought at the Emporium (src/shop.js), or null
addColumn('users', 'card_charm', 'TEXT'); // likewise

module.exports = db;
