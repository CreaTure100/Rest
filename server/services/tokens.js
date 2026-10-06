'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized } = require('../lib/errors');

/** В БД хранится только SHA-256 от refresh-токена: утечка таблицы не даёт рабочих токенов. */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const REUSE_GRACE_MS = 10 * 1000; // параллельный refresh из двух вкладок не считаем кражей токена

function signAccessToken(user) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.accessExpiresIn,
    algorithm: 'HS256',
  });
}

async function issueTokens(conn, user) {
  // jti делает каждый токен уникальным, даже если выданы в одну секунду
  const refreshToken = jwt.sign({ jti: crypto.randomUUID() }, config.refreshSecret, {
    subject: user.id,
    expiresIn: config.refreshExpiresIn,
    algorithm: 'HS256',
  });
  const { exp } = jwt.decode(refreshToken);
  await conn('refresh_tokens').insert({
    user_id: user.id,
    token_hash: hashToken(refreshToken),
    expires_at: new Date(exp * 1000),
  });
  return { accessToken: signAccessToken(user), refreshToken };
}

const revokeAllForUser = (conn, userId) =>
  conn('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: conn.fn.now() });

const purgeExpired = () =>
  db('refresh_tokens').whereRaw(`expires_at < now() - interval '7 days'`).del();

/** Ротация: старый refresh-токен отзывается, выдаётся новая пара. Повторное использование = отзыв всех сессий. */
async function rotateRefreshToken(refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken) throw unauthorized('Refresh токен обязателен');
  try {
    jwt.verify(refreshToken, config.refreshSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Недействительный refresh токен');
  }

  const outcome = await db.transaction(async (trx) => {
    const row = await trx('refresh_tokens').where({ token_hash: hashToken(refreshToken) }).forUpdate().first();
    if (!row) return { error: 'Недействительный refresh токен' };

    if (row.revoked_at) {
      if (Date.now() - new Date(row.revoked_at).getTime() > REUSE_GRACE_MS) await revokeAllForUser(trx, row.user_id);
      return { error: 'Refresh токен отозван' };
    }
    if (new Date(row.expires_at) <= new Date()) return { error: 'Refresh токен истёк' };

    const user = await trx('users').where({ id: row.user_id }).first();
    if (!user || user.is_blocked) {
      await revokeAllForUser(trx, row.user_id);
      return { error: 'Пользователь недоступен' };
    }
    await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now() });
    return { user, tokens: await issueTokens(trx, user) };
  });

  if (outcome.error) throw unauthorized(outcome.error);
  return outcome;
}

const revokeRefreshToken = (refreshToken) =>
  db('refresh_tokens')
    .where({ token_hash: hashToken(String(refreshToken)) })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });

module.exports = { hashToken, issueTokens, rotateRefreshToken, revokeRefreshToken, revokeAllForUser, purgeExpired };
