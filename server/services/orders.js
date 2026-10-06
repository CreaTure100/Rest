'use strict';

const db = require('../db');
const { badRequest, forbidden, conflict, notFound } = require('../lib/errors');
const { isStaff } = require('../lib/roles');
const { slotContains } = require('../lib/timeSlots');
const { serveOne, isOrderCompleted } = require('../lib/orderLogic');
const { toApiOrder } = require('../lib/mappers');
const { lockTable, createBookingLocked, asSlot } = require('./bookings');

const orderSelect = (conn) =>
  conn('orders as o')
    .join('bookings as b', 'b.id', 'o.booking_id')
    .select('o.id', 'o.user_id', 'o.table_id', 'o.client_name', 'o.status', 'o.created_at', 'b.booking_date', 'b.start_minute', 'b.end_minute');

async function attachItems(orderRows, conn = db) {
  if (orderRows.length === 0) return [];
  const items = await conn('order_items').whereIn('order_id', orderRows.map((o) => o.id)).orderBy(['order_id', 'position']);
  const byOrder = new Map();
  for (const item of items) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
    byOrder.get(item.order_id).push(item);
  }
  return orderRows.map((o) => toApiOrder(o, byOrder.get(o.id) || []));
}

async function getOrderById(id, conn = db) {
  const row = await orderSelect(conn).where('o.id', id).first();
  if (!row) return null;
  return (await attachItems([row], conn))[0];
}

/** Активные заказы идут первыми, затем по дате и времени брони. Выборка ограничена limit. */
async function listOrders({ userId, status, date, limit = 200 }) {
  const query = orderSelect(db);
  if (userId) query.where('o.user_id', userId);
  if (status) query.where('o.status', status);
  if (date) query.where('b.booking_date', date);
  const rows = await query
    .orderByRaw(`(o.status = 'active') DESC`)
    .orderBy([{ column: 'b.booking_date' }, { column: 'b.start_minute' }, { column: 'o.id' }])
    .limit(limit);
  return attachItems(rows);
}

/**
 * Создание заказа. Заказ возможен только для брони этого стола, покрывающей выбранное время.
 * С book=true бронь создаётся в той же транзакции, что и заказ (нет "осиротевших" броней).
 */
async function createOrder({ user, input }) {
  const { tableId, slot, date, dishes, clientName, book } = input;

  const dishIds = [...new Set(dishes.map((d) => d.dishId))];
  const menuRows = await db('menu_items').whereIn('id', dishIds).where({ is_active: true });
  const menu = new Map(menuRows.map((m) => [m.id, m]));
  const missing = dishIds.filter((id) => !menu.has(id));
  if (missing.length) throw badRequest(`Блюдо не найдено: ${missing.join(', ')}`);

  const orderId = await db.transaction(async (trx) => {
    await lockTable(trx, tableId);

    const bookings = await trx('bookings').where({ table_id: tableId, booking_date: date });
    let booking = bookings.find((b) => slotContains(asSlot(b), slot));

    if (booking && booking.user_id !== user.id && !isStaff(user)) {
      throw forbidden('Этот стол забронирован другим гостем');
    }
    if (!booking) {
      if (!book) throw conflict('Стол не забронирован на это время. Сначала забронируйте стол');
      booking = await createBookingLocked(trx, { tableId, userId: user.id, date, slot });
    }

    const [order] = await trx('orders')
      .insert({
        user_id: booking.user_id, // заказ принадлежит гостю, на которого оформлена бронь
        table_id: tableId,
        booking_id: booking.id,
        client_name: clientName || user.name,
      })
      .returning('id');

    await trx('order_items').insert(
      dishes.map((d, position) => {
        const dish = menu.get(d.dishId);
        return {
          order_id: order.id,
          position,
          dish_id: dish.id,
          dish_name: dish.name,
          unit_price: dish.price,
          quantity: d.quantity,
          remaining: d.quantity,
          comment: d.comment,
        };
      }),
    );
    return order.id;
  });

  return getOrderById(orderId);
}

/** Подача одной порции блюда. dishIndex = позиция блюда в заказе (как в прежнем API). */
async function serveDish(orderId, dishIndex) {
  await db.transaction(async (trx) => {
    const order = await trx('orders').where({ id: orderId }).forUpdate().first();
    if (!order) throw notFound('Заказ не найден');
    const item = await trx('order_items').where({ order_id: orderId, position: dishIndex }).forUpdate().first();
    if (!item) throw notFound('Блюдо не найдено в заказе');

    const result = serveOne(item);
    if (!result.ok) throw badRequest(result.error);
    await trx('order_items').where({ id: item.id }).update({ remaining: result.item.remaining, status: result.item.status });

    const all = await trx('order_items').where({ order_id: orderId }).select('remaining');
    if (order.status !== 'completed' && isOrderCompleted(all)) {
      await trx('orders').where({ id: orderId }).update({ status: 'completed', completed_at: trx.fn.now() });
    }
  });
  return getOrderById(orderId);
}

module.exports = { getOrderById, listOrders, createOrder, serveDish };
