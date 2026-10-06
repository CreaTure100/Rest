'use strict';

/**
 * Заполнение базы данными для разработки. ПОЛНОСТЬЮ очищает таблицы.
 * В production запрещено, если явно не задано ALLOW_SEED=true.
 */
const bcrypt = require('bcrypt');
const { initialMenuItems } = require('../seed-data/menu');
const usersSeed = require('../seed-data/users');
const tablesSeed = require('../seed-data/tables');
const ordersSeed = require('../seed-data/orders');
const { parseTimeSlot } = require('../../server/lib/timeSlots');
const { todayInTz, addDays, DEFAULT_TZ } = require('../../server/lib/dates');

exports.seed = async (knex) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    throw new Error('Seed запрещён в production (задайте ALLOW_SEED=true, если это осознанно)');
  }
  const rounds = Number(process.env.BCRYPT_ROUNDS) || 10;
  const today = todayInTz(process.env.RESTAURANT_TZ || DEFAULT_TZ);

  await knex.raw(
    'TRUNCATE TABLE order_items, orders, bookings, refresh_tokens, menu_items, tables, users RESTART IDENTITY CASCADE',
  );

  // пользователи (пароли только в виде bcrypt-хеша)
  const userRows = [];
  for (const u of usersSeed) {
    userRows.push({
      name: u.name,
      email: u.email.toLowerCase(),
      password_hash: await bcrypt.hash(u.password, rounds),
      role: u.role,
    });
  }
  const users = await knex('users').insert(userRows).returning(['id', 'role']);
  const client = users.find((u) => u.role === 'client');

  // меню (id сохраняем, чтобы совпадали ссылки dishId из заказов и пути картинок)
  await knex('menu_items').insert(
    initialMenuItems.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      category: m.category,
      weight: m.weight,
      description: m.description,
      image: m.image,
      recipe: m.recipe,
      cooking_time: m.cookingTime,
      ingredients: m.ingredients,
    })),
  );
  await knex.raw(
    `SELECT setval(pg_get_serial_sequence('menu_items', 'id'), (SELECT MAX(id) FROM menu_items))`,
  );

  await knex('tables').insert(tablesSeed);

  // брони и заказы
  const menu = new Map(initialMenuItems.map((m) => [m.id, m]));
  for (const o of ordersSeed) {
    const slot = parseTimeSlot(o.slot);
    const [booking] = await knex('bookings')
      .insert({
        table_id: o.table,
        user_id: client.id,
        booking_date: addDays(today, -(o.daysAgo || 0)),
        start_minute: slot.start,
        end_minute: slot.end,
      })
      .returning('id');

    const [order] = await knex('orders')
      .insert({
        user_id: client.id,
        table_id: o.table,
        booking_id: booking.id,
        client_name: 'Гость',
        status: o.served ? 'completed' : 'active',
        completed_at: o.served ? knex.fn.now() : null,
      })
      .returning('id');

    await knex('order_items').insert(
      o.items.map(([dishId, quantity], position) => ({
        order_id: order.id,
        position,
        dish_id: dishId,
        dish_name: menu.get(dishId).name,
        unit_price: menu.get(dishId).price,
        quantity,
        remaining: o.served ? 0 : quantity,
        status: o.served ? 'served' : 'pending',
      })),
    );
  }
};
