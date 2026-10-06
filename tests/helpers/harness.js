'use strict';

/**
 * Окружение интеграционных тестов: отдельная тестовая БД (имя заканчивается на _test),
 * миграции, запуск настоящего Express-приложения на свободном порту, фикстуры.
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL ||= 'postgres://restaurant:restaurant@localhost:5432/restaurant_test';
// Тестовые значения (не секреты): живут только в процессе тестов
process.env.JWT_SECRET = 'test-only-access-secret-0123456789abcdef';
process.env.REFRESH_SECRET = 'test-only-refresh-secret-0123456789abcdef';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_REQUESTS = 'false';
process.env.BCRYPT_ROUNDS = '4';

const bcrypt = require('bcrypt');
const config = require('../../server/config');
const db = require('../../server/db');
const { createApp } = require('../../server/app');
const { todayInTz, addDays } = require('../../server/lib/dates');

const PASSWORD = 'Passw0rd!';
const USERS = {
  admin: { name: 'Админ', email: 'admin@test.local', role: 'admin' },
  waiter: { name: 'Официант', email: 'waiter@test.local', role: 'waiter' },
  chef: { name: 'Повар', email: 'chef@test.local', role: 'chef' },
  client: { name: 'Клиент', email: 'client@test.local', role: 'client' },
  client2: { name: 'Клиент Два', email: 'client2@test.local', role: 'client' },
};
const DISHES = [
  { name: 'Брускетта', price: 320, category: 'Закуски', weight: '180г', recipe: 'Рецепт брускетты', cooking_time: '10 минут' },
  { name: 'Карбонара', price: 580, category: 'Паста', weight: '320г', recipe: 'Рецепт карбонары', cooking_time: '20 минут' },
  { name: 'Тирамису', price: 380, category: 'Десерты', weight: '150г', recipe: 'Рецепт тирамису', cooking_time: '30 минут' },
];

let server;
let baseUrl;

async function start() {
  await db.migrate.latest();
  server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
}

/** Полная очистка и фикстуры: 5 пользователей, 17 столов, 3 блюда. */
async function resetData() {
  await db.raw('TRUNCATE TABLE order_items, orders, bookings, refresh_tokens, menu_items, tables, users RESTART IDENTITY CASCADE');
  const hash = await bcrypt.hash(PASSWORD, 4);
  const rows = await db('users')
    .insert(Object.values(USERS).map((u) => ({ ...u, password_hash: hash })))
    .returning(['id', 'email']);
  const users = {};
  for (const [key, u] of Object.entries(USERS)) users[key] = { ...u, id: rows.find((r) => r.email === u.email).id };

  await db('tables').insert(Array.from({ length: 17 }, (_, i) => ({ id: i + 1, seats: 4 })));
  const dishes = await db('menu_items').insert(DISHES).returning('*');
  return { users, dishes };
}

/** HTTP-запрос к тестовому серверу. Возвращает { status, body }. */
async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function login(email, password = PASSWORD) {
  const res = await api('POST', '/api/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`Не удалось войти как ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body; // { accessToken, refreshToken, user }
}

const url = (path) => baseUrl + path;

const tokenFor = async (userKey) => (await login(USERS[userKey].email)).accessToken;

const today = () => todayInTz(config.restaurantTz);
const daysFromToday = (n) => addDays(today(), n);

const book = (token, tableId, timeSlot, extra = {}) => api('POST', `/api/tables/${tableId}/book`, { token, body: { timeSlot, ...extra } });

module.exports = { db, url, start, stop, resetData, api, login, tokenFor, book, today, daysFromToday, PASSWORD, USERS };
