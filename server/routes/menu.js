'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { badRequest, notFound } = require('../lib/errors');
const { ROLES } = require('../lib/roles');
const { validateMenuInput, toPositiveInt } = require('../lib/validators');
const { toApiMenuItem } = require('../lib/mappers');

const router = express.Router();

// Рецепт — рабочая информация кухни: он есть в ответе только для повара и администратора.
const canSeeRecipe = (user) => Boolean(user) && [ROLES.CHEF, ROLES.ADMIN].includes(user.role);

const COLUMN = {
  name: 'name', price: 'price', category: 'category', weight: 'weight', description: 'description',
  image: 'image', recipe: 'recipe', cookingTime: 'cooking_time', ingredients: 'ingredients',
};
const toColumns = (value) => Object.fromEntries(Object.entries(value).map(([k, v]) => [COLUMN[k], v]));

const parseId = (raw) => {
  const id = toPositiveInt(raw);
  if (!id) throw badRequest('Некорректный идентификатор блюда');
  return id;
};

router.get('/', optionalAuth, async (req, res) => {
  const rows = await db('menu_items').where({ is_active: true }).orderBy('id');
  const includeRecipe = canSeeRecipe(req.user);
  res.json(rows.map((row) => toApiMenuItem(row, { includeRecipe })));
});

router.get('/:id', optionalAuth, async (req, res) => {
  const row = await db('menu_items').where({ id: parseId(req.params.id), is_active: true }).first();
  if (!row) throw notFound('Блюдо не найдено');
  res.json(toApiMenuItem(row, { includeRecipe: canSeeRecipe(req.user) }));
});

router.post('/', authenticate, requireRole(ROLES.ADMIN), async (req, res) => {
  const { value, error } = validateMenuInput(req.body);
  if (error) throw badRequest(error);
  const [row] = await db('menu_items').insert(toColumns(value)).returning('*');
  res.status(201).json(toApiMenuItem(row, { includeRecipe: true }));
});

router.put('/:id', authenticate, requireRole(ROLES.ADMIN), async (req, res) => {
  const id = parseId(req.params.id);
  const { value, error } = validateMenuInput(req.body, { partial: true });
  if (error) throw badRequest(error);

  const [row] = await db('menu_items')
    .where({ id, is_active: true })
    .update({ ...toColumns(value), updated_at: db.fn.now() })
    .returning('*');
  if (!row) throw notFound('Блюдо не найдено');
  res.json(toApiMenuItem(row, { includeRecipe: true }));
});

// Блюдо скрывается из меню (is_active=false), а не стирается: заказы и рецепт для кухни сохраняются
router.delete('/:id', authenticate, requireRole(ROLES.ADMIN), async (req, res) => {
  const id = parseId(req.params.id);
  const [row] = await db('menu_items')
    .where({ id, is_active: true })
    .update({ is_active: false, updated_at: db.fn.now() })
    .returning('*');
  if (!row) throw notFound('Блюдо не найдено');
  const [{ count }] = await db('menu_items').where({ is_active: true }).count('* as count');
  res.json({ message: 'Блюдо удалено из меню', deletedItem: toApiMenuItem(row, { includeRecipe: true }), remainingCount: Number(count) });
});

module.exports = router;
