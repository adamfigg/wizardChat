'use strict';

// The Notice Board: the bounties set for each member (src/bounties.js), and
// beneath them the notices that members post for one another.

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const ledger = require('../ledger');
const bounties = require('../bounties');
const { AUTHOR_COLS, withAuthor, canRemove } = require('./hall');

const router = express.Router();

const CATEGORIES = [
  'Reagents & Materials',
  'Tomes & Scrolls',
  'Staves, Wands & Implements',
  'Orbs & Scrying',
  'Familiars',
  'Towers & Lodgings',
  'Services Offered',
  'Apprenticeships',
  'Sought',
  'Lost & Found',
];

router.get('/notices', (req, res) => {
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const ads = db
    .prepare(
      `SELECT a.*, ${AUTHOR_COLS} FROM ads a JOIN users u ON u.id = a.user_id
       ${category ? 'WHERE a.category = ?' : ''}
       ORDER BY a.created_at DESC, a.id DESC LIMIT 100`
    )
    .all(...(category ? [category] : []))
    .map(withAuthor);
  // The member's own bounties (none for a visitor who is not logged in).
  const board = req.user ? bounties.boardFor(req.user.id) : null;
  const icons = Object.fromEntries(ledger.CURRENCIES.map((c) => [c.key, c.icon]));
  res.render('board', { title: 'The Notice Board', ads, CATEGORIES, category, board, icons });
});

router.get('/notices/new', auth.requireMember, (req, res) => {
  res.render('notice-new', { title: 'Post a Notice', CATEGORIES, error: null, values: {} });
});

router.post('/notices', auth.requireMember, auth.requireCsrf, (req, res) => {
  const values = {
    category: String(req.body.category || ''),
    title: String(req.body.title || '').trim(),
    body: String(req.body.body || '').trim(),
    price: String(req.body.price || '').trim(),
    contact: String(req.body.contact || '').trim(),
  };
  let error = null;
  if (!CATEGORIES.includes(values.category)) error = 'Select a category for your notice.';
  else if (values.title.length < 4 || values.title.length > 100) error = 'The heading must be between 4 and 100 characters.';
  else if (values.body.length < 10 || values.body.length > 3000) error = 'The particulars must be between 10 and 3,000 characters.';
  else if (values.price.length > 60) error = 'The terms must not exceed 60 characters.';
  else if (values.contact.length < 3 || values.contact.length > 200) error = 'State a means by which interested parties may reach you (3 to 200 characters).';
  if (error) return res.status(400).render('notice-new', { title: 'Post a Notice', CATEGORIES, error, values });

  const id = db
    .prepare('INSERT INTO ads (user_id, category, title, body, price, contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, values.category, values.title, values.body, values.price || null, values.contact, Date.now())
    .lastInsertRowid;
  bounties.mark(req, res, 'notice', { noticeId: Number(id) });
  res.redirect(`/notices/${id}`);
});

router.get('/notices/:id', (req, res, next) => {
  const ad = db
    .prepare(`SELECT a.*, ${AUTHOR_COLS} FROM ads a JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .get(Number(req.params.id));
  if (!ad) return next();
  res.render('notice', { title: ad.title, ad: withAuthor(ad), canRemove });
});

router.post('/notices/:id/delete', auth.requireLogin, auth.requireCsrf, (req, res, next) => {
  const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(Number(req.params.id));
  if (!ad) return next();
  if (!canRemove(req.user, ad.user_id)) return res.status(403).render('error', { title: 'Not Permitted', message: 'This notice is not yours to take down.' });
  db.prepare('DELETE FROM ads WHERE id = ?').run(ad.id);
  req.flash('success', 'The notice has been taken down.');
  res.redirect('/notices');
});

module.exports = router;
