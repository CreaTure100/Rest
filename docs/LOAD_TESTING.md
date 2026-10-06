# Нагрузочное тестирование (k6)

Сценарии в `tests/load/`. **Только тестовая БД**: сценарии создают тысячи броней и заказов и входят под учётными записями из seed.

## Быстрый старт в Docker (отдельная БД, tmpfs: данные исчезают после остановки)

```bash
# 1. дымовой тест (1 VU, 30 с)
docker compose --profile load run --rm k6 run /scripts/smoke.js
# 2. основной сценарий (~2 мин)
docker compose --profile load run --rm k6 run /scripts/load.js
# 3. гонка за один интервал
docker compose --profile load run --rm k6 run /scripts/booking-race.js
# уборка (сбрасывает тестовую БД)
docker compose --profile load down
```

Стенд `backend-load` использует БД `restaurant_load`, отключает ограничение частоты входа (`RATE_LIMIT_ENABLED=false`) и логирование запросов.

## Запуск локально

Установите k6, поднимите API на тестовой БД (с seed) и выполните `BASE_URL=http://localhost:3001 k6 run tests/load/smoke.js`
(или `npm run load:smoke`, `load:full`, `load:race`). Повторный запуск на той же БД без перезапуска: задайте `SLOT_OFFSET=5000`.

## Сценарии

| Файл | Профиль | Что проверяет |
|---|---|---|
| `smoke.js` | 1 VU, 30 с | здоровье, меню, столики, вход, очередь кухни, заказы, бронь+заказ |
| `load.js` | browse: 0→30 VU (1 мин на плато); staff: 5 VU; booking: 5/с; auth: 2/с | реалистичная смесь трафика |
| `booking-race.js` | 50 VU (`RACE_VUS`) в один момент | ровно одна бронь, остальные 409 |

## Критерии успеха (thresholds)

- `http_req_failed < 1%`, `checks > 99%`;
- p95 времени ответа: меню/столики < 400 мс, очередь/заказы < 500 мс, бронь+заказ < 800 мс, вход < 1000 мс;
- гонка: `booking_created == 1`, `booking_conflicts == RACE_VUS-1`, `booking_unexpected == 0`.

k6 завершается с ненулевым кодом, если порог не выполнен. Пороги - стартовые значения: подгоните под своё железо.

## Как читать результат

- `http_req_duration` p(95): 95% запросов быстрее этого значения; растёт при нехватке CPU/соединений БД (`DB_POOL_MAX`).
- `http_req_failed`: доля ответов не 2xx/3xx. В `booking-race.js` 409 объявлены ожидаемыми.
- `iterations`/`dropped_iterations`: если `dropped_iterations` > 0, генератор не успевал за заданной скоростью (мало `maxVUs` или сервер перегружен).
- Вход (bcrypt) самый дорогой запрос по CPU: он ограничивает пропускную способность `/auth/login`.
