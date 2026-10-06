'use strict';

const knex = require('knex');
const pg = require('pg');
const knexfile = require('../knexfile');

// bigint (COUNT, SUM) и numeric приходят из pg строками, приводим к числам.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));
// DATE оставляем строкой YYYY-MM-DD, чтобы не зависеть от часового пояса процесса.
pg.types.setTypeParser(1082, (v) => v);

module.exports = knex(knexfile);
