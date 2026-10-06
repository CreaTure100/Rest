'use strict';

const { formatSlot, computeTableStatus } = require('./timeSlots');
const { orderTotal } = require('./orderLogic');

const iso = (value) => (value ? new Date(value).toISOString() : null);

const toApiUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  isBlocked: row.is_blocked,
  createdAt: iso(row.created_at),
});

/** Рецепт видят только сотрудники кухни: includeRecipe=true для chef/admin. */
function toApiMenuItem(row, { includeRecipe = false } = {}) {
  const item = {
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category,
    weight: row.weight,
    description: row.description,
    image: row.image,
    cookingTime: row.cooking_time,
    ingredients: row.ingredients,
  };
  if (includeRecipe) item.recipe = row.recipe;
  return item;
}

function toApiTable(table, slots) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  return {
    id: table.id,
    seats: table.seats,
    status: computeTableStatus(sorted),
    slots: sorted.map((s) => formatSlot(s.start, s.end)),
  };
}

/** Формат заказа совместим с прежним API (dishes[].total/remaining/status и т.д.). */
function toApiOrder(order, itemRows) {
  const items = [...itemRows].sort((a, b) => a.position - b.position);
  return {
    id: order.id,
    tableId: order.table_id,
    date: order.booking_date,
    timeSlot: formatSlot(order.start_minute, order.end_minute),
    sortMinutes: order.start_minute,
    dishes: items.map((i) => ({
      id: i.id,
      dishId: i.dish_id,
      name: i.dish_name,
      price: i.unit_price,
      total: i.quantity,
      remaining: i.remaining,
      comment: i.comment,
      status: i.status,
    })),
    totalPrice: orderTotal(items.map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity }))),
    completed: order.status === 'completed',
    status: order.status,
    createdAt: iso(order.created_at),
    clientId: order.user_id,
    clientName: order.client_name,
  };
}

/** Элемент кухонной очереди = одна позиция заказа; id очереди = id позиции. */
const toQueueItem = (row) => ({
  id: row.item_id,
  orderId: row.order_id,
  tableId: row.table_id,
  dishId: row.dish_id,
  dishName: row.dish_name,
  quantity: row.remaining,
  comment: row.comment,
  status: row.status,
  date: row.booking_date,
  timeSlot: formatSlot(row.start_minute, row.end_minute),
  sortMinutes: row.start_minute,
});

module.exports = { toApiUser, toApiMenuItem, toApiTable, toApiOrder, toQueueItem };
