'use strict';

require('dotenv').config();

/**
 * Строка подключения к БД. В режиме test используется ТОЛЬКО TEST_DATABASE_URL,
 * и имя базы обязано заканчиваться на "_test" (защита от запуска тестов на рабочей базе).
 */
function getDatabaseUrl(env = process.env) {
  if (env.NODE_ENV === 'test') {
    const url = env.TEST_DATABASE_URL;
    if (!url) throw new Error('Не задана TEST_DATABASE_URL для тестового окружения (см. .env)');
    if (!/_test(\?.*)?$/.test(url)) {
      throw new Error('TEST_DATABASE_URL должна указывать на базу, имя которой заканчивается на "_test"');
    }
    return url;
  }
  if (!env.DATABASE_URL) throw new Error('Не задана переменная окружения DATABASE_URL (см. .env)');
  return env.DATABASE_URL;
}

module.exports = { getDatabaseUrl };
