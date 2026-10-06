'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { orderTotal, startCooking, completeCooking, serveOne, isOrderCompleted } = require('../../server/lib/orderLogic');
const { toApiOrder, toQueueItem, toApiTable, toApiMenuItem, toApiUser } = require('../../server/lib/mappers');

const item = (over = {}) => ({ status: 'pending', quantity: 2, remaining: 2, ...over });

describe('orderTotal', () => {
  it('суммирует цена × количество', () => {
    assert.equal(orderTotal([{ unitPrice: 320, quantity: 2 }, { unitPrice: 550, quantity: 1 }]), 1190);
  });
  it('пустой заказ = 0', () => {
    assert.equal(orderTotal([]), 0);
  });
  it('не накапливает ошибку float', () => {
    assert.equal(orderTotal([{ unitPrice: 0.1, quantity: 3 }]), 0.3);
    assert.equal(orderTotal([{ unitPrice: 19.99, quantity: 3 }]), 59.97);
  });
});

describe('переходы статусов блюда', () => {
  it('pending -> cooking', () => {
    const r = startCooking(item());
    assert.equal(r.ok, true);
    assert.equal(r.item.status, 'cooking');
  });
  it('нельзя повторно начать приготовление', () => {
    assert.match(startCooking(item({ status: 'cooking' })).error, /готовится/);
    assert.match(startCooking(item({ status: 'ready' })).error, /готово/);
  });
  it('cooking -> ready; из других статусов нельзя', () => {
    assert.equal(completeCooking(item({ status: 'cooking' })).item.status, 'ready');
    assert.match(completeCooking(item()).error, /не начали/);
    assert.equal(completeCooking(item({ status: 'ready' })).ok, false);
  });
  it('подача уменьшает remaining; статус остаётся ready, пока есть порции', () => {
    const r = serveOne(item({ status: 'ready' }));
    assert.equal(r.item.remaining, 1);
    assert.equal(r.item.status, 'ready');
  });
  it('последняя порция переводит блюдо в served', () => {
    const r = serveOne(item({ status: 'ready', remaining: 1 }));
    assert.equal(r.item.remaining, 0);
    assert.equal(r.item.status, 'served');
  });
  it('нельзя подать блюдо, которое не готово или уже подано', () => {
    assert.match(serveOne(item({ status: 'cooking' })).error, /не готово/);
    assert.equal(serveOne(item()).ok, false);
    assert.equal(serveOne(item({ status: 'served', remaining: 0 })).ok, false);
  });
  it('функции не мутируют исходный объект', () => {
    const original = item({ status: 'ready' });
    serveOne(original);
    assert.equal(original.remaining, 2);
  });
});

describe('isOrderCompleted', () => {
  it('завершён, когда подано всё', () => {
    assert.equal(isOrderCompleted([{ remaining: 0 }, { remaining: 0 }]), true);
  });
  it('не завершён, если осталась хотя бы одна порция', () => {
    assert.equal(isOrderCompleted([{ remaining: 0 }, { remaining: 1 }]), false);
  });
  it('пустой набор позиций не считается завершённым заказом', () => {
    assert.equal(isOrderCompleted([]), false);
  });
});

describe('преобразование данных (mappers)', () => {
  const orderRow = {
    id: 7, user_id: 'u1', table_id: 4, client_name: 'Гость', status: 'active',
    created_at: '2026-10-05T10:00:00.000Z', booking_date: '2026-10-05', start_minute: 600, end_minute: 660,
  };
  const rows = [
    { id: 12, position: 1, dish_id: 9, dish_name: 'Карбонара', unit_price: 580, quantity: 1, remaining: 1, comment: '', status: 'pending' },
    { id: 11, position: 0, dish_id: 1, dish_name: 'Брускетта', unit_price: 320, quantity: 2, remaining: 2, comment: 'без базилика', status: 'pending' },
  ];

  it('toApiOrder сохраняет прежний формат и считает итог', () => {
    const o = toApiOrder(orderRow, rows);
    assert.equal(o.timeSlot, '10:00-11:00');
    assert.equal(o.sortMinutes, 600);
    assert.equal(o.completed, false);
    assert.equal(o.totalPrice, 1220);
    assert.equal(o.clientId, 'u1');
    assert.deepEqual(o.dishes.map((d) => d.name), ['Брускетта', 'Карбонара']); // порядок по position
    assert.deepEqual(o.dishes[0], {
      id: 11, dishId: 1, name: 'Брускетта', price: 320, total: 2, remaining: 2, comment: 'без базилика', status: 'pending',
    });
  });
  it('toApiOrder: completed вычисляется из статуса', () => {
    assert.equal(toApiOrder({ ...orderRow, status: 'completed' }, rows).completed, true);
  });
  it('toQueueItem связывает очередь с позицией заказа', () => {
    const q = toQueueItem({
      item_id: 11, order_id: 7, table_id: 4, dish_id: 1, dish_name: 'Брускетта', remaining: 2,
      comment: '', status: 'cooking', booking_date: '2026-10-05', start_minute: 600, end_minute: 660,
    });
    assert.equal(q.id, 11);
    assert.equal(q.quantity, 2);
    assert.equal(q.timeSlot, '10:00-11:00');
  });
  it('toApiTable считает статус и сортирует слоты', () => {
    const t = toApiTable({ id: 2, seats: 4 }, [{ start: 660, end: 840 }, { start: 600, end: 660 }]);
    assert.deepEqual(t, { id: 2, seats: 4, status: 'partial', slots: ['10:00-11:00', '11:00-14:00'] });
  });
  it('toApiMenuItem скрывает рецепт, если не запрошен', () => {
    const row = { id: 1, name: 'A', price: 1, category: 'c', weight: 'w', description: '', image: '/i', cooking_time: '5', ingredients: 'x', recipe: 'секрет' };
    assert.equal('recipe' in toApiMenuItem(row), false);
    assert.equal(toApiMenuItem(row, { includeRecipe: true }).recipe, 'секрет');
  });
  it('toApiUser никогда не отдаёт хеш пароля', () => {
    const u = toApiUser({ id: 'u', name: 'N', email: 'e', role: 'chef', is_blocked: false, created_at: '2026-01-01', password_hash: 'secret' });
    assert.equal('password_hash' in u, false);
    assert.equal('password' in u, false);
    assert.equal(u.isBlocked, false);
  });
});
