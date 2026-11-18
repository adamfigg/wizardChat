'use strict';

// The Gathering Hall: posts with images or recordings, reactions, and comments.

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { acceptUpload, removeUpload } = require('../uploads');
const { latestForHall } = require('./addresses');
const ledger = require('../ledger');
const bounties = require('../bounties');
const councilOf = require('../council');

const router = express.Router();
const PAGE_SIZE = 15;
const MAX_POST = 5000;
const MAX_COMMENT = 2000;

// The sigils with which members may respond to a post (src/sigils.js).
const { REACTIONS } = require('../sigils');
const REACTION_KEYS = new Set(REACTIONS.map((r) => r.key));

const AUTHOR_COLS = `u.name AS author_name, u.wizard_class AS author_class,
                     u.pinned AS author_pinned, u.avatar AS author_avatar, u.portrait AS author_portrait,
                     u.card_border AS author_border, u.card_charm AS author_charm`;

// Shapes the author columns into the object the profile-card partial expects.
function withAuthor(row) {
  row.author = {
    name: row.author_name,
    wizard_class: row.author_class,
    pinned: row.author_pinned,
    avatar: row.author_avatar,
    portrait: row.author_portrait,
    card_border: row.author_border,
    card_charm: row.author_charm,
  };
  return row;
}

// Attaches reaction counts (and which ones the viewer has given) to posts.
function attachReactions(posts, viewer) {
  if (!posts.length) return posts;
  const ids = posts.map((p) => p.id);
  const marks = ids.map(() => '?').join(',');
  const counts = db
    .prepare(`SELECT post_id, emoji, COUNT(*) AS n FROM reactions WHERE post_id IN (${marks}) GROUP BY post_id, emoji`)
    .all(...ids);
  const mine = viewer
    ? db.prepare(`SELECT post_id, emoji FROM reactions WHERE user_id = ? AND post_id IN (${marks})`).all(viewer.id, ...ids)
    : [];
  for (const p of posts) {
    p.reactions = {};
    p.myReactions = new Set();
  }
  const byId = new Map(posts.map((p) => [p.id, p]));
  for (const c of counts) byId.get(c.post_id).reactions[c.emoji] = c.n;
  for (const m of mine) byId.get(m.post_id).myReactions.add(m.emoji);
  return posts;
}

function getPost(id) {
  const row = db
    .prepare(
      `SELECT p.*, ${AUTHOR_COLS},
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .get(id);
  return row ? withAuthor(row) : null;
}

const canRemove = (user, ownerId) => !!user && (user.id === ownerId || !!user.is_admin);

// Only allow redirecting back to a path on this site.
function backTo(req, fallback) {
  const to = req.body && req.body.back;
  return typeof to === 'string' && /^\/(?!\/)[\w\-/?=&#]*$/.test(to) ? to : fallback;
}

// ── Feed ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = db
    .prepare(
      `SELECT p.*, ${AUTHOR_COLS},
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .all(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .map(withAuthor);
  const hasMore = rows.length > PAGE_SIZE;
  const posts = attachReactions(rows.slice(0, PAGE_SIZE), req.user);
  // The latest Steward's Address heads the first page of the Hall.
  const address = page === 1 ? latestForHall() : null;
  // The Council's scroll: its latest result and the vote now open, if any.
  const council = councilOf.forHall(req.user ? req.user.id : null);
  res.render('hall', { title: 'The Gathering Hall', posts, page, hasMore, canRemove, address, council });
});

// ── Create a post ────────────────────────────────────────────────────────────

router.post(
  '/posts',
  auth.requireMember,
  acceptUpload('media', { maxMb: 50 }),
  auth.requireCsrf,
  (req, res) => {
    const body = String(req.body.body || '').trim();
    let problem = req.uploadProblem;
    if (!problem && !body && !req.file) problem = 'A post requires words, an image, or a recording.';
    if (!problem && body.length > MAX_POST) problem = `A post may not exceed ${MAX_POST} characters.`;
    if (problem) {
      if (req.file) removeUpload(req.file.filename);
      req.flash('error', problem);
      return res.redirect('/');
    }
    const id = db
      .prepare('INSERT INTO posts (user_id, body, media, media_type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, body, req.file ? req.file.filename : null, req.file ? req.file.kind : null, Date.now())
      .lastInsertRowid;
    bounties.mark(req, res, 'post', { postId: Number(id), body, media: !!req.file });
    res.redirect(`/posts/${id}`);
  }
);

// ── A single post with its comments ──────────────────────────────────────────

router.get('/posts/:id', (req, res, next) => {
  const post = getPost(Number(req.params.id));
  if (!post) return next();
  attachReactions([post], req.user);
  const comments = db
    .prepare(
      `SELECT c.*, ${AUTHOR_COLS} FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at, c.id`
    )
    .all(post.id)
    .map(withAuthor);
  res.render('post', { title: `A post by ${post.author.name}`, post, comments, canRemove });
});

// ── React (toggles) ──────────────────────────────────────────────────────────

router.post('/posts/:id/react', auth.requireMember, auth.requireCsrf, (req, res, next) => {
  const post = getPost(Number(req.params.id));
  if (!post) return next();
  const emoji = String(req.body.emoji || '');
  if (REACTION_KEYS.has(emoji)) {
    const removed = db
      .prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?')
      .run(post.id, req.user.id, emoji).changes;
    if (!removed) {
      db.prepare('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)').run(post.id, req.user.id, emoji);
      // Power to the author, once for each other member on each post. It is
      // not taken back if the sigil is withdrawn, and so cannot be earned
      // again by withdrawing and replacing it.
      if (post.user_id !== req.user.id) {
        ledger.award(post.user_id, 'sigil-received', `post ${post.id} from member ${req.user.id}`);
      }
      bounties.mark(req, res, 'sigil', { postId: post.id, authorId: post.user_id, emoji });
    }
  }
  res.redirect(backTo(req, `/posts/${post.id}`));
});

// ── Comment ──────────────────────────────────────────────────────────────────

router.post('/posts/:id/comments', auth.requireMember, auth.requireCsrf, (req, res, next) => {
  const post = getPost(Number(req.params.id));
  if (!post) return next();
  const body = String(req.body.body || '').trim();
  if (!body || body.length > MAX_COMMENT) {
    req.flash('error', body ? `A comment may not exceed ${MAX_COMMENT} characters.` : 'A comment may not be empty.');
    return res.redirect(`/posts/${post.id}#respond`);
  }
  const id = db
    .prepare('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(post.id, req.user.id, body, Date.now()).lastInsertRowid;
  bounties.mark(req, res, 'response', { postId: post.id, authorId: post.user_id, body });
  res.redirect(`/posts/${post.id}#comment-${id}`);
});

// ── Removal (by the author, or by a Steward) ─────────────────────────────────

router.post('/posts/:id/delete', auth.requireLogin, auth.requireCsrf, (req, res, next) => {
  const post = getPost(Number(req.params.id));
  if (!post) return next();
  if (!canRemove(req.user, post.user_id)) return res.status(403).render('error', { title: 'Not Permitted', message: 'This post is not yours to withdraw.' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  removeUpload(post.media);
  req.flash('success', 'The post has been withdrawn.');
  res.redirect('/');
});

router.post('/comments/:id/delete', auth.requireLogin, auth.requireCsrf, (req, res, next) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id));
  if (!c) return next();
  if (!canRemove(req.user, c.user_id)) return res.status(403).render('error', { title: 'Not Permitted', message: 'This comment is not yours to withdraw.' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  req.flash('success', 'The comment has been withdrawn.');
  res.redirect(`/posts/${c.post_id}`);
});

module.exports = { router, REACTIONS, AUTHOR_COLS, withAuthor, canRemove };
