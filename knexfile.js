'use strict';

const path = require('node:path');
const { getDatabaseUrl } = require('./server/dbConfig');

/** Единая конфигурация для приложения и CLI (`knex migrate:latest`, `knex seed:run`). */
module.exports = {
  client: 'pg',
  connection: getDatabaseUrl(),
  pool: { min: 0, max: Number(process.env.DB_POOL_MAX) || 10 },
  migrations: { directory: path.join(__dirname, 'db', 'migrations') },
  seeds: { directory: path.join(__dirname, 'db', 'seeds') },
};
