#!/usr/bin/env node
'use strict';

/**
 * Инициализация БД при старте контейнера:
 *  1. ждёт доступности PostgreSQL;
 *  2. применяет миграции;
 *  3. если RUN_SEED=true и таблица users пуста - заполняет БД тестовыми данными
 *     (повторные запуски контейнера данные НЕ затирают).
 */
const knex = require('knex');
const knexfile = require('../knexfile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDb(db, attempts = 30) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await db.raw('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db-init] БД недоступна (попытка ${i}/${attempts}): ${err.message}`);
      await sleep(2000);
    }
  }
}

async function main() {
  const db = knex(knexfile);
  try {
    await waitForDb(db);
    const [, applied] = await db.migrate.latest();
    console.log(`[db-init] миграции применены: ${applied.length ? applied.join(', ') : 'новых нет'}`);

    const seedAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_SEED === 'true';
    if (process.env.RUN_SEED === 'true' && !seedAllowed) {
      console.log('[db-init] seed пропущен: в production он запрещён (нужен ALLOW_SEED=true)');
    } else if (process.env.RUN_SEED === 'true') {
      const { count } = await db('users').count('* as count').first();
      if (Number(count) === 0) {
        await db.seed.run();
        console.log('[db-init] тестовые данные загружены');
      } else {
        console.log('[db-init] seed пропущен: в базе уже есть пользователи');
      }
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('[db-init] ошибка:', err);
  process.exit(1);
});
