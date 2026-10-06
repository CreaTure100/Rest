'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/** Ограничение частоты для входа и регистрации (защита от перебора паролей). */
const authLimiter = config.rateLimitEnabled
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Слишком много попыток. Повторите позже' },
    })
  : (req, res, next) => next();

module.exports = { authLimiter };
