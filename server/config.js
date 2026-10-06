'use strict';

require('dotenv').config();
const { getDatabaseUrl } = require('./dbConfig');
const { DEFAULT_TZ } = require('./lib/dates');

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function secret(name) {
  const value = env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  if (isProduction && (value.length < 32 || /^change-me/i.test(value))) {
    throw new Error(`${name} небезопасен: в production нужен случайный секрет длиной от 32 символов`);
  }
  return value;
}

const bool = (value, fallback) => (value === undefined ? fallback : value === 'true');
const int = (value, fallback) => (value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback);

const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: int(env.PORT, 3001),
  databaseUrl: getDatabaseUrl(env),
  dbPoolMax: int(env.DB_POOL_MAX, 10),
  jwtSecret: secret('JWT_SECRET'),
  refreshSecret: secret('REFRESH_SECRET'),
  accessExpiresIn: env.ACCESS_TOKEN_TTL || '45m',
  refreshExpiresIn: env.REFRESH_TOKEN_TTL || '1d',
  bcryptRounds: int(env.BCRYPT_ROUNDS, 10),
  restaurantTz: env.RESTAURANT_TZ || DEFAULT_TZ,
  // Список разрешённых Origin через запятую. В production без значения cross-origin запросы запрещены.
  corsOrigins: (env.CORS_ORIGINS || (isProduction ? '' : 'http://localhost:3000'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: env.TRUST_PROXY ? int(env.TRUST_PROXY, 1) : false,
  rateLimitEnabled: bool(env.RATE_LIMIT_ENABLED, true),
  logRequests: bool(env.LOG_REQUESTS, nodeEnv !== 'test'),
};

module.exports = config;
