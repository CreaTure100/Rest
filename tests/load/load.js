// Основной нагрузочный сценарий (~2 минуты): четыре параллельных потока трафика.
//   k6 run tests/load/load.js
// Запускать ТОЛЬКО на тестовой БД (см. docs/LOAD_TESTING.md).
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { API, CREDS, login, authParams, uniqueSlot, orderBody } from './lib.js';

export const options = {
  scenarios: {
    // посетители сайта: меню и столики (ramp: 0 -> 30 VU)
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 30 },
        { duration: '1m', target: 30 },
        { duration: '20s', target: 0 },
      ],
      exec: 'browse',
    },
    // повара и официанты опрашивают очередь и заказы
    staff: { executor: 'constant-vus', vus: 5, duration: '1m50s', exec: 'staff' },
    // 5 новых броней+заказов в секунду
    booking: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '1m30s',
      startTime: '10s',
      preAllocatedVUs: 20,
      maxVUs: 60,
      exec: 'booking',
    },
    // 2 входа в секунду (bcrypt - самая дорогая операция)
    auth: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '1m30s',
      startTime: '10s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'authFlow',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{scenario:browse}': ['p(95)<400'],
    'http_req_duration{scenario:staff}': ['p(95)<500'],
    'http_req_duration{scenario:booking}': ['p(95)<800'],
    'http_req_duration{scenario:auth}': ['p(95)<1000'],
  },
};

export function setup() {
  return { client: login(CREDS.client), chef: login(CREDS.chef), waiter: login(CREDS.waiter) };
}

export function browse(tokens) {
  check(http.get(`${API}/menu`, { tags: { name: 'GET /menu' } }), { 'меню: 200': (r) => r.status === 200 });
  check(http.get(`${API}/tables`, authParams(tokens.client, 'GET /tables')), { 'столики: 200': (r) => r.status === 200 });
  sleep(1);
}

export function staff(tokens) {
  check(http.get(`${API}/kitchen/queue`, authParams(tokens.chef, 'GET /kitchen/queue')), { 'очередь: 200': (r) => r.status === 200 });
  check(http.get(`${API}/orders`, authParams(tokens.waiter, 'GET /orders')), { 'заказы: 200': (r) => r.status === 200 });
  sleep(2);
}

export function booking(tokens) {
  const slot = uniqueSlot(exec.scenario.iterationInTest);
  const res = http.post(`${API}/orders`, JSON.stringify(orderBody(slot)), authParams(tokens.client, 'POST /orders'));
  check(res, { 'бронь+заказ: 201': (r) => r.status === 201 });
}

export function authFlow() {
  login(CREDS.client);
}
