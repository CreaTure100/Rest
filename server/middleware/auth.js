'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../lib/errors');
const { isUuid } = require('../lib/validators');

function extractBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Проверяет access-токен и актуальное состояние пользователя в БД (роль и блокировка действуют сразу). */
async function resolveUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    throw unauthorized(expired ? 'Токен истёк' : 'Недействительный токен', {
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }
  if (!isUuid(payload.sub)) throw unauthorized('Недействительный токен', { code: 'TOKEN_INVALID' });

  const row = await db('users').where({ id: payload.sub }).first();
  if (!row) throw unauthorized('Пользователь не найден', { code: 'USER_NOT_FOUND' });
  if (row.is_blocked) throw forbidden('Пользователь заблокирован', { code: 'USER_BLOCKED' });
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

async function authenticate(req, res, next) {
  const token = extractBearer(req);
  if (!token) throw unauthorized('Токен не предоставлен', { code: 'NO_TOKEN' });
  req.user = await resolveUser(token);
  next();
}

/** Для публичных маршрутов, которые отдают больше данных авторизованным сотрудникам. */
async function optionalAuth(req, res, next) {
  req.user = null;
  const token = extractBearer(req);
  if (token) {
    try {
      req.user = await resolveUser(token);
    } catch {
      req.user = null;
    }
  }
  next();
}

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };

module.exports = { authenticate, optionalAuth, requireRole };
