'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/menu', require('./menu'));
router.use('/tables', require('./tables'));
router.use('/orders', require('./orders'));
router.use('/kitchen', require('./kitchen'));
router.use('/admin', require('./admin'));

module.exports = router;
