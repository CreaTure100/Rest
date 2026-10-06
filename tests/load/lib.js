import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
export const API = `${BASE_URL}/api`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Учётные записи из db/seed-data/users.js (только тестовая БД!)
export const CREDS = {
  client: { email: 'client@example.com', password: 'client123' },
  waiter: { email: 'waiter@restaurant.com', password: 'waiter123' },
  chef: { email: 'chef@restaurant.com', password: 'chef123' },
  admin: { email: 'admin@restaurant.com', password: 'admin123' },
};

export function login(creds) {
  const res = http.post(`${API}/auth/login`, JSON.stringify(creds), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /auth/login' },
  });
  if (!check(res, { 'вход: 200': (r) => r.status === 200 })) {
    fail(`Не удалось войти как ${creds.email}: ${res.status} ${res.body}`);
  }
  return res.json('accessToken');
}

export const authParams = (token, name) => ({
  headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
  tags: name ? { name } : {},
});

export const futureDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Уникальная связка (стол, время, дата) по порядковому номеру n: 17 столов x 27 получасовых слотов x дни.
 * Параллельные виртуальные пользователи не конфликтуют между собой.
 * SLOT_OFFSET сдвигает нумерацию, если повторно запускаете тест на той же БД без перезапуска.
 */
export function uniqueSlot(n) {
  const k = n + Number(__ENV.SLOT_OFFSET || 0);
  const start = 9 * 60 + (Math.floor(k / 17) % 27) * 30;
  return {
    tableId: (k % 17) + 1,
    timeSlot: `${hhmm(start)}-${hhmm(start + 30)}`,
    date: futureDate(2 + Math.floor(k / (17 * 27))), // со 2-го дня: не зависит от часового пояса
  };
}

export const orderBody = (slot) => ({
  ...slot,
  book: true,
  clientName: 'Нагрузочный тест',
  dishes: [
    { dishId: 1, quantity: 1, comment: 'k6' },
    { dishId: 5, quantity: 2 },
  ],
});
