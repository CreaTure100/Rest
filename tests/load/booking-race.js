// Гонка за один интервал: VUS пользователей одновременно бронируют ОДИН стол на ОДНО время.
// Ожидание: ровно одна бронь (201), остальные получают 409, ошибок 5xx нет.
//   k6 run tests/load/booking-race.js        (RACE_VUS=100 для большей нагрузки)
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { API, CREDS, login, authParams, futureDate } from './lib.js';

// 409 здесь - ожидаемый ответ, а не ошибка
http.setResponseCallback(http.expectedStatuses(201, 409));

const created = new Counter('booking_created');
const conflicts = new Counter('booking_conflicts');
const unexpected = new Counter('booking_unexpected');
const VUS = Number(__ENV.RACE_VUS || 50);

export const options = {
  scenarios: {
    race: { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '30s' },
  },
  thresholds: {
    booking_created: ['count==1'],
    booking_conflicts: [`count==${VUS - 1}`],
    booking_unexpected: ['count==0'],
    http_req_duration: ['p(95)<1500'],
  },
};

export function setup() {
  // случайные стол и дата: повторный запуск на той же БД почти наверняка не столкнётся со старой бронью
  return {
    token: login(CREDS.client),
    table: 1 + Math.floor(Math.random() * 17),
    date: futureDate(60 + Math.floor(Math.random() * 25)),
  };
}

export default function (data) {
  const res = http.post(
    `${API}/tables/${data.table}/book`,
    JSON.stringify({ timeSlot: '18:00-20:00', date: data.date }),
    authParams(data.token, 'POST /tables/:id/book'),
  );
  if (res.status === 201) created.add(1);
  else if (res.status === 409) conflicts.add(1);
  else unexpected.add(1);
  check(res, { 'ответ 201 или 409': (r) => r.status === 201 || r.status === 409 });
}
