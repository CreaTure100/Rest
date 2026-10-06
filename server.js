'use strict';

const config = require('./server/config');
const db = require('./server/db');
const { createApp } = require('./server/app');

const server = createApp().listen(config.port, () => {
  console.log(`API запущен на порту ${config.port} (${config.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`${signal}: останавливаю сервер`);
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // страховка от зависших соединений
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
