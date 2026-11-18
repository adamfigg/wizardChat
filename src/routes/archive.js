'use strict';

// The Advice Archive: articles kept in src/articles.js.

const express = require('express');
const ARTICLES = require('../articles');
const ledger = require('../ledger');
const bounties = require('../bounties');

const router = express.Router();

router.get('/archive', (req, res) => {
  res.render('archive', { title: 'The Advice Archive', articles: ARTICLES });
});

router.get('/archive/:slug', (req, res, next) => {
  const article = ARTICLES.find((a) => a.slug === req.params.slug);
  if (!article) return next();
  // Knowledge, once for each article a member opens.
  if (req.user) ledger.award(req.user.id, 'article-read', article.slug);
  bounties.mark(req, res, 'article', { slug: article.slug }, { now: true });
  res.render('article', { title: article.title, article, others: ARTICLES.filter((a) => a !== article).slice(0, 3) });
});

module.exports = router;
