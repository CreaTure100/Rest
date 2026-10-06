# TableOne: ресторан (React + Express + PostgreSQL)

Бронирование столиков, заказы, кухонная очередь, подача блюд, админ-разделы. Роли: `client`, `waiter`, `chef`, `admin`.

## Запуск одной командой (Docker)

```bash
cp .env .env        # Windows: copy .env .env   (затем замените значения change-me)
docker compose up --build
```

- Сайт: http://localhost:8080  (nginx: статика + прокси `/api`)
- API: http://localhost:3001/api/health
- При первом запуске применяются миграции и (в development) загружаются тестовые данные.
- Тестовые учётные записи: `admin@restaurant.com / admin123`, `waiter@restaurant.com / waiter123`,
  `chef@restaurant.com / chef123`, `client@example.com / client123` (только для разработки).
- Сброс базы: `docker compose down -v`.

## Запуск без Docker

Нужны Node.js >= 20 и PostgreSQL 14+ (базы `restaurant` и `restaurant_test`).

```bash
npm install
cp .env .env         # поправьте DATABASE_URL
npm run db:migrate           # миграции
npm run db:seed              # тестовые данные (стирает данные!)
npm run dev:all              # API :3001 + Vite :3000
```

## База данных

PostgreSQL через Knex (`pg`). Схема и ограничения: `db/migrations/20260101000000_init.js`.
Таблицы: `users`, `refresh_tokens`, `menu_items`, `tables`, `bookings`, `orders`, `order_items`.
Кухонная очередь строится из `order_items` (id очереди = id позиции заказа).

| Команда | Действие |
|---|---|
| `npm run db:migrate` / `db:rollback` | применить / откатить миграции |
| `npm run db:seed` | заполнить тестовыми данными |
| `npm run db:reset` | откатить, применить, заполнить |

Бронирование атомарно: транзакция блокирует строку стола, а `EXCLUDE USING gist` в самой БД
физически не даёт создать пересекающиеся брони.

## Тесты

| Команда | Что делает |
|---|---|
| `npm test` / `npm run test:unit` | модульные тесты (без БД) |
| `npm run test:watch` | то же в watch-режиме |
| `npm run test:coverage` | то же с отчётом покрытия |
| `npm run test:integration` | REST API на тестовой БД PostgreSQL |
| `npm run test:all` | всё вместе |
| `docker compose --profile test run --rm tests` | всё вместе в Docker, с изолированной БД |

Интеграционные тесты берут `TEST_DATABASE_URL` (имя базы **обязано** заканчиваться на `_test`, иначе тест не стартует).
Нагрузочные тесты: [docs/LOAD_TESTING.md](docs/LOAD_TESTING.md). Аудит и список исправлений: [docs/AUDIT.md](docs/AUDIT.md).

## Структура

```
server.js              точка входа API
server/                app.js, config.js, db.js, routes/, services/, middleware/, lib/ (чистая логика)
db/                    migrations/, seeds/, seed-data/
src/                   React-приложение (api/, components/, pages/, utils/)
tests/                 unit/, integration/, helpers/, load/ (k6)
docker/nginx.conf, Dockerfile, docker-compose.yml, .env.example
```
