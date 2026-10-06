'use strict';

/** Ошибка с HTTP-статусом, безопасная для показа клиенту. */
class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.extra = extra;
  }
}

const badRequest = (msg, extra) => new AppError(400, msg, extra);
const unauthorized = (msg = 'Требуется аутентификация', extra) => new AppError(401, msg, extra);
const forbidden = (msg = 'Недостаточно прав для выполнения операции', extra) => new AppError(403, msg, extra);
const notFound = (msg = 'Не найдено', extra) => new AppError(404, msg, extra);
const conflict = (msg, extra) => new AppError(409, msg, extra);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
