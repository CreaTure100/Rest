'use strict';

const db = require('../db');
const config = require('../config');
const { badRequest, notFound } = require('../lib/errors');
const { todayInTz } = require('../lib/dates');
const { startCooking, completeCooking } = require('../lib/orderLogic');
const { toQueueItem } = require('../lib/mappers');
const { formatSlot } = require('../lib/timeSlots');

/** Очередь кухни = позиции активных заказов с неподанными порциями; id очереди = id позиции заказа. */
const queueSelect = () =>
  db('order_items as i')
    .join('orders as o', 'o.id', 'i.order_id')
    .join('bookings as b', 'b.id', 'o.booking_id')
    .select(
      'i.id as item_id', 'i.order_id', 'i.dish_id', 'i.dish_name', 'i.remaining', 'i.comment', 'i.status',
      'o.table_id', 'b.booking_date', 'b.start_minute', 'b.end_minute',
    );

/** Только заказы на сегодня и просроченные: заказы на будущие дни кухню не интересуют. */
async function getQueue() {
  const today = todayInTz(config.restaurantTz);
  const rows = await queueSelect()
    .where('i.remaining', '>', 0)
    .where('o.status', 'active')
    .where('b.booking_date', '<=', today)
    .orderBy([{ column: 'b.booking_date' }, { column: 'b.start_minute' }, { column: 'i.order_id' }, { column: 'i.position' }]);
  return rows.map(toQueueItem);
}

/** Атомарный переход статуса: позиция блокируется, повторный старт невозможен. */
async function transition(itemId, step, timestampColumn) {
  await db.transaction(async (trx) => {
    const item = await trx('order_items').where({ id: itemId }).forUpdate().first();
    if (!item) throw notFound('Блюдо в очереди не найдено');
    const result = step(item);
    if (!result.ok) throw badRequest(result.error);
    await trx('order_items').where({ id: itemId }).update({ status: result.item.status, [timestampColumn]: trx.fn.now() });
  });
  return toQueueItem(await queueSelect().where('i.id', itemId).first());
}

const start = (itemId) => transition(itemId, startCooking, 'started_at');
const complete = (itemId) => transition(itemId, completeCooking, 'ready_at');

/** Рецепт блюда + комментарии гостей из ещё не поданных позиций. */
async function getRecipe(dishId) {
  const dish = await db('menu_items').where({ id: dishId }).first(); // и для скрытых из меню блюд
  if (!dish) throw notFound('Блюдо не найдено');
  const rows = await queueSelect()
    .where('i.dish_id', dishId)
    .where('i.remaining', '>', 0)
    .where('o.status', 'active')
    .whereNot('i.comment', '')
    .orderBy([{ column: 'b.booking_date' }, { column: 'b.start_minute' }]);
  return {
    id: dish.id,
    name: dish.name,
    recipe: dish.recipe,
    cookingTime: dish.cooking_time,
    ingredients: dish.ingredients,
    comments: rows.map((r) => ({
      orderId: r.order_id,
      tableId: r.table_id,
      timeSlot: formatSlot(r.start_minute, r.end_minute),
      comment: r.comment,
    })),
  };
}

module.exports = { getQueue, start, complete, getRecipe };
