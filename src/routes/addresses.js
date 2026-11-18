'use strict';

// The Steward's Address: articles written by a Steward. The most recent is
// featured at the top of the Gathering Hall; all of them are kept at /addresses.
// Anyone may read them. Only a Steward may write, amend, or withdraw them.

const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
const MAX_TITLE = 120;
const MAX_BODY = 20000;

const SELECT = `SELECT a.*, u.name AS author_name FROM addresses a JOIN users u ON u.id = a.user_id`;

// Turns the plain text a Steward writes into blocks for display:
//   - a blank line starts a new paragraph
//   - a line beginning with "## " becomes a sub-heading
// The text itself is always escaped by the template, so no HTML can be injected.
function toBlocks(body) {
  return String(body)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) =>
      chunk.startsWith('## ') && !chunk.includes('\n')
        ? { type: 'heading', text: chunk.slice(3).trim() }
        : { type: 'paragraph', text: chunk }
    );
}

// The most recent Address, for the top of the Gathering Hall.
// Long ones are cut to their opening paragraphs, with a link to the rest.
function latestForHall() {
  const address = db.prepare(`${SELECT} ORDER BY a.created_at DESC, a.id DESC LIMIT 1`).get();
  if (!address) return null;
  const blocks = toBlocks(address.body);
  const shown = [];
  let length = 0;
  for (const b of blocks) {
    if (shown.length >= 1 && (length + b.text.length > 900 || shown.length >= 4)) break;
    shown.push(b);
    length += b.text.length;
  }
  // Do not end the excerpt on a heading with nothing beneath it.
  while (shown.length > 1 && shown[shown.length - 1].type === 'heading') shown.pop();
  address.blocks = shown;
  address.truncated = shown.length < blocks.length;
  address.earlier = db.prepare('SELECT COUNT(*) AS n FROM addresses').get().n - 1;
  return address;
}

function readForm(req) {
  return {
    title: String(req.body.title || '').trim().replace(/\s+/g, ' '),
    body: String(req.body.body || '').replace(/\r\n/g, '\n').trim(),
  };
}

function formProblem({ title, body }) {
  if (title.length < 3 || title.length > MAX_TITLE) return `The title must be between 3 and ${MAX_TITLE} characters.`;
  if (body.length < 20 || body.length > MAX_BODY) return `The text must be between 20 and ${MAX_BODY.toLocaleString('en')} characters.`;
  return null;
}

// ── Reading (open to all) ────────────────────────────────────────────────────

router.get('/addresses', (req, res) => {
  const addresses = db.prepare(`${SELECT} ORDER BY a.created_at DESC, a.id DESC LIMIT 200`).all();
  for (const a of addresses) {
    const first = toBlocks(a.body).find((b) => b.type === 'paragraph');
    a.summary = first ? (first.text.length > 220 ? first.text.slice(0, 220).trimEnd() + '…' : first.text) : '';
  }
  res.render('addresses', { title: 'The Steward’s Addresses', addresses });
});

// ── Writing (Stewards only) ──────────────────────────────────────────────────

router.get('/addresses/new', auth.requireAdmin, (req, res) => {
  res.render('address-form', { title: 'Compose an Address', heading: 'Compose an Address', action: '/addresses', submit: 'Publish to the Hall', error: null, values: {} });
});

router.post('/addresses', auth.requireAdmin, auth.requireCsrf, (req, res) => {
  const values = readForm(req);
  const error = formProblem(values);
  if (error) {
    return res.status(400).render('address-form', { title: 'Compose an Address', heading: 'Compose an Address', action: '/addresses', submit: 'Publish to the Hall', error, values });
  }
  const id = db
    .prepare('INSERT INTO addresses (user_id, title, body, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, values.title, values.body, Date.now()).lastInsertRowid;
  req.flash('success', 'Your Address has been published and now stands at the head of the Gathering Hall.');
  res.redirect(`/addresses/${id}`);
});

router.get('/addresses/:id', (req, res, next) => {
  const address = db.prepare(`${SELECT} WHERE a.id = ?`).get(Number(req.params.id));
  if (!address) return next();
  res.render('address', { title: address.title, address, blocks: toBlocks(address.body) });
});

router.get('/addresses/:id/edit', auth.requireAdmin, (req, res, next) => {
  const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(req.params.id));
  if (!address) return next();
  res.render('address-form', { title: 'Amend an Address', heading: 'Amend an Address', action: `/addresses/${address.id}/edit`, submit: 'Save Amendments', error: null, values: address });
});

router.post('/addresses/:id/edit', auth.requireAdmin, auth.requireCsrf, (req, res, next) => {
  const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(req.params.id));
  if (!address) return next();
  const values = readForm(req);
  const error = formProblem(values);
  if (error) {
    return res.status(400).render('address-form', { title: 'Amend an Address', heading: 'Amend an Address', action: `/addresses/${address.id}/edit`, submit: 'Save Amendments', error, values });
  }
  db.prepare('UPDATE addresses SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(values.title, values.body, Date.now(), address.id);
  req.flash('success', 'The Address has been amended.');
  res.redirect(`/addresses/${address.id}`);
});

router.post('/addresses/:id/delete', auth.requireAdmin, auth.requireCsrf, (req, res, next) => {
  const address = db.prepare('SELECT id FROM addresses WHERE id = ?').get(Number(req.params.id));
  if (!address) return next();
  db.prepare('DELETE FROM addresses WHERE id = ?').run(address.id);
  req.flash('success', 'The Address has been withdrawn.');
  res.redirect('/addresses');
});

module.exports = { router, latestForHall };
