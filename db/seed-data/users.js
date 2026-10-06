'use strict';

/**
 * ТОЛЬКО для разработки и тестов. Пароли хешируются в seed-скрипте через bcrypt.
 * Не используйте эти учётные записи в production.
 */
module.exports = [
  { name: 'Администратор', email: 'admin@restaurant.com', password: 'admin123', role: 'admin' },
  { name: 'Иван Официант', email: 'waiter@restaurant.com', password: 'waiter123', role: 'waiter' },
  { name: 'Петр Повар', email: 'chef@restaurant.com', password: 'chef123', role: 'chef' },
  { name: 'Алексей Клиент', email: 'client@example.com', password: 'client123', role: 'client' },
];
