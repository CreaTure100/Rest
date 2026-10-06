'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { ROLES, isValidRole } = require('../lib/roles');
const { checkUserChange } = require('../lib/userRules');
const { normalizeEmail, validateEmail, validatePassword, validateName, isUuid } = require('../lib/validators');
const { toApiUser } = require('../lib/mappers');
const { revokeAllForUser } = require('../services/tokens');

const router = express.Router();
router.use(authenticate, requireRole(ROLES.ADMIN));

const parseUserId = (value) => {
  if (!isUuid(value)) throw badRequest('Некорректный идентификатор пользователя');
  return value;
};

router.get('/', async (req, res) => {
  const rows = await db('users').orderBy('created_at');
  res.json(rows.map(toApiUser));
});

router.get('/:id', async (req, res) => {
  const user = await db('users').where({ id: parseUserId(req.params.id) }).first();
  if (!user) throw notFound('Пользователь не найден');
  res.json(toApiUser(user));
});

router.post('/employee', async (req, res) => {
  const { name, email: rawEmail, password, role } = req.body || {};
  const email = normalizeEmail(rawEmail);
  const error = validateName(name) || validateEmail(email) || validatePassword(password);
  if (error) throw badRequest(error);
  if (!isValidRole(role)) throw badRequest('Некорректная роль');
  if (await db('users').where({ email }).first()) throw conflict('Пользователь с таким email уже существует');

  const [user] = await db('users')
    .insert({ name: name.trim(), email, password_hash: await bcrypt.hash(password, config.bcryptRounds), role })
    .returning('*');
  res.status(201).json({ message: 'Сотрудник создан', user: toApiUser(user) });
});

router.put('/:id', async (req, res) => {
  const id = parseUserId(req.params.id);
  const body = req.body || {};
  const changes = {};

  if (body.name !== undefined) {
    const err = validateName(body.name);
    if (err) throw badRequest(err);
    changes.name = body.name.trim();
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    const err = validateEmail(email);
    if (err) throw badRequest(err);
    changes.email = email;
  }
  if (body.role !== undefined) {
    if (!isValidRole(body.role)) throw badRequest('Некорректная роль');
    changes.role = body.role;
  }
  if (body.isBlocked !== undefined) {
    if (typeof body.isBlocked !== 'boolean') throw badRequest('isBlocked должен быть true или false');
    changes.isBlocked = body.isBlocked;
  }
  if (body.password !== undefined) {
    const err = validatePassword(body.password);
    if (err) throw badRequest(err);
  }

  await db.transaction(async (trx) => {
    const target = await trx('users').where({ id }).forUpdate().first();
    if (!target) throw notFound('Пользователь не найден');

    const [{ count }] = await trx('users').where({ role: ROLES.ADMIN, is_blocked: false }).whereNot({ id }).count('* as count');
    const rule = checkUserChange({
      actor: req.user,
      target: { id: target.id, role: target.role, isBlocked: target.is_blocked },
      changes,
      otherActiveAdmins: Number(count),
    });
    if (rule) throw badRequest(rule);

    if (changes.email && changes.email !== target.email && (await trx('users').where({ email: changes.email }).first())) {
      throw conflict('Пользователь с таким email уже существует');
    }

    const update = { updated_at: trx.fn.now() };
    if (changes.name !== undefined) update.name = changes.name;
    if (changes.email !== undefined) update.email = changes.email;
    if (changes.role !== undefined) update.role = changes.role;
    if (changes.isBlocked !== undefined) update.is_blocked = changes.isBlocked;
    if (body.password !== undefined) update.password_hash = await bcrypt.hash(body.password, config.bcryptRounds);
    await trx('users').where({ id }).update(update);

    // блокировка и смена пароля завершают все сессии пользователя
    if (changes.isBlocked === true || body.password !== undefined) await revokeAllForUser(trx, id);
  });

  res.json({ message: 'Пользователь обновлён', user: toApiUser(await db('users').where({ id }).first()) });
});

// "Удаление" пользователя = блокировка: заказы и брони остаются в истории
router.delete('/:id', async (req, res) => {
  const id = parseUserId(req.params.id);
  if (id === req.user.id) throw badRequest('Нельзя заблокировать самого себя');

  await db.transaction(async (trx) => {
    const target = await trx('users').where({ id }).forUpdate().first();
    if (!target) throw notFound('Пользователь не найден');
    if (target.role === ROLES.ADMIN) {
      const [{ count }] = await trx('users').where({ role: ROLES.ADMIN, is_blocked: false }).whereNot({ id }).count('* as count');
      if (Number(count) === 0) throw badRequest('Нельзя лишить доступа последнего администратора');
    }
    await trx('users').where({ id }).update({ is_blocked: true, updated_at: trx.fn.now() });
    await revokeAllForUser(trx, id);
  });
  res.json({ message: 'Пользователь заблокирован' });
});

module.exports = router;
