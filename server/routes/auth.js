'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { badRequest, unauthorized, forbidden, conflict } = require('../lib/errors');
const { normalizeEmail, validateEmail, validatePassword, validateName } = require('../lib/validators');
const { toApiUser } = require('../lib/mappers');
const { ROLES } = require('../lib/roles');
const tokens = require('../services/tokens');

const router = express.Router();

// Сравнение с фиктивным хешем при неизвестном email выравнивает время ответа (нет подсказки, существует ли аккаунт)
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', config.bcryptRounds);

router.post('/register', authLimiter, async (req, res) => {
  const { name, email: rawEmail, password } = req.body || {};
  const email = normalizeEmail(rawEmail);
  const error = validateName(name) || validateEmail(email) || validatePassword(password);
  if (error) throw badRequest(error);

  if (await db('users').where({ email }).first()) throw conflict('Пользователь с таким email уже существует');

  const [user] = await db('users')
    .insert({
      name: name.trim(),
      email,
      password_hash: await bcrypt.hash(password, config.bcryptRounds),
      role: ROLES.CLIENT,
    })
    .returning('*');
  res.status(201).json({ message: 'Регистрация прошла успешно', user: toApiUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const { email: rawEmail, password } = req.body || {};
  const email = normalizeEmail(rawEmail);
  if (!email || typeof password !== 'string' || !password) throw badRequest('Email и пароль обязательны');

  const user = await db('users').where({ email }).first();
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk) throw unauthorized('Неверный email или пароль');
  if (user.is_blocked) throw forbidden('Пользователь заблокирован', { code: 'USER_BLOCKED' });

  const issued = await tokens.issueTokens(db, user);
  tokens.purgeExpired().catch(() => {}); // фоновая уборка старых токенов, на ответ не влияет
  res.json({ ...issued, user: toApiUser(user) });
});

router.post('/refresh', async (req, res) => {
  const { user, tokens: issued } = await tokens.rotateRefreshToken((req.body || {}).refreshToken);
  res.json({ ...issued, user: toApiUser(user) });
});

// Выход не требует действующего access-токена: просроченный access не должен мешать завершить сессию.
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken === 'string' && refreshToken) await tokens.revokeRefreshToken(refreshToken);
  res.json({ message: 'Выход выполнен' });
});

router.get('/me', authenticate, async (req, res) => {
  const user = await db('users').where({ id: req.user.id }).first();
  res.json(toApiUser(user));
});

module.exports = router;
