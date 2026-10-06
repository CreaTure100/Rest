'use strict';

const config = require('../config');
const { AppError } = require('../lib/errors');

const notFoundHandler = (req, res) => res.status(404).json({ error: 'Маршрут не найден' });

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большое тело запроса' });
  // Страховка на уровне БД: ограничения уникальности и непересечения броней
  if (err.code === '23505') return res.status(409).json({ error: 'Такая запись уже существует' });
  if (err.code === '23P01') return res.status(409).json({ error: 'Это время уже забронировано' });

  if (!config.isTest) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  // Стек и детали никогда не уходят клиенту; в разработке показываем только сообщение.
  const body = { error: 'Внутренняя ошибка сервера' };
  if (!config.isProduction) body.detail = err.message;
  return res.status(500).json(body);
}

module.exports = { errorHandler, notFoundHandler };
