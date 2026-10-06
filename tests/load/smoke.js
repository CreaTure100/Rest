// Дымовой тест: 1 пользователь, 30 секунд. Запускать первым - проверяет, что сценарии и стенд исправны.
//   k6 run tests/load/smoke.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { API, CREDS, login, authParams, uniqueSlot, orderBody } from './lib.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'], // меньше 1% ошибок
    http_req_duration: ['p(95)<500'], // 95% ответов быстрее 500 мс
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return { client: login(CREDS.client), chef: login(CREDS.chef), waiter: login(CREDS.waiter) };
}

export default function (tokens) {
  group('здоровье и меню', () => {
    check(http.get(`${API}/health`), { 'health: 200': (r) => r.status === 200 });
    const menu = http.get(`${API}/menu`, { tags: { name: 'GET /menu' } });
    check(menu, { 'меню: 200': (r) => r.status === 200, 'меню не пусто': (r) => r.json().length > 0 });
  });

  group('столики', () => {
    const res = http.get(`${API}/tables`, authParams(tokens.client, 'GET /tables'));
    check(res, { 'столики: 200': (r) => r.status === 200, 'столиков 17': (r) => r.json().length === 17 });
  });

  group('авторизация', () => {
    login(CREDS.client);
  });

  group('персонал', () => {
    check(http.get(`${API}/kitchen/queue`, authParams(tokens.chef, 'GET /kitchen/queue')), { 'очередь кухни: 200': (r) => r.status === 200 });
    check(http.get(`${API}/orders`, authParams(tokens.waiter, 'GET /orders')), { 'заказы: 200': (r) => r.status === 200 });
  });

  group('бронь и заказ', () => {
    const slot = uniqueSlot(exec.scenario.iterationInTest);
    const res = http.post(`${API}/orders`, JSON.stringify(orderBody(slot)), authParams(tokens.client, 'POST /orders'));
    check(res, { 'заказ создан: 201': (r) => r.status === 201 });
  });

  sleep(1);
}
