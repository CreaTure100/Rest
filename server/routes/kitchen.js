'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { badRequest } = require('../lib/errors');
const { ROLES } = require('../lib/roles');
const { toPositiveInt } = require('../lib/validators');
const kitchen = require('../services/kitchen');

const router = express.Router();
router.use(authenticate, requireRole(ROLES.CHEF, ROLES.ADMIN));

const parseId = (raw) => {
  const id = toPositiveInt(raw);
  if (!id) throw badRequest('Некорректный идентификатор');
  return id;
};

router.get('/queue', async (req, res) => {
  res.json(await kitchen.getQueue());
});

router.get('/recipe/:dishId', async (req, res) => {
  res.json(await kitchen.getRecipe(parseId(req.params.dishId)));
});

router.put('/dish/:queueId/start', async (req, res) => {
  res.json({ message: 'Приготовление начато', item: await kitchen.start(parseId(req.params.queueId)) });
});

router.put('/dish/:queueId/complete', async (req, res) => {
  res.json({ message: 'Блюдо готово', item: await kitchen.complete(parseId(req.params.queueId)) });
});

module.exports = router;
